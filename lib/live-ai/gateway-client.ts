// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — browser gateway transport.
//
// Implements the evolved LiveAiTransport (kind "gateway"): a SAME-ORIGIN broker
// call to mint a one-use session, then an AUTHENTICATED control WebSocket (the
// control token travels in the WS SUBPROTOCOL, never a query string) plus, for
// microphone mode, an owned WebRTC media lifecycle. It NEVER holds a provider key,
// and NEVER lets the caller choose the gateway host / provider / model / endpoint —
// the broker returns the fixed control URL derived from server config, and every
// inbound frame is re-validated through the closed protocol before it is emitted.
//
// Fully dependency-injected (fetch / socket opener / media) so the whole handshake,
// frame I/O and validation are exercised by tests with fakes — NO real network,
// NO real WebRTC, NO provider. Dormant by default: constructed only when every gate
// + config is present AND the user explicitly starts a provider/microphone turn.
// ─────────────────────────────────────────────────────────────────────────
import {
  validateClientFrame,
  validateServerFrame,
  isValidId,
  isEpoch,
  MAX_FRAME_BYTES,
  type ClientFrame,
  type ContextPublishFrame,
  type ActionReceiptFrame,
  type ActionAcceptedFrame,
  type InterruptReason,
  type LiveAiLanguage,
} from "./protocol";
import {
  createNullTransport,
  type LiveAiTransport,
  type TransportEvent,
  type TransportStartInput,
  type TransportStartResult,
  type ConnectionState,
} from "./transport";

export const DEFAULT_BROKER_PATH = "/api/live-ai/session";

/** The CLIENT-visible dormancy gates (V + P). The server B/R gates + config are a
 *  further, independent fail-closed layer at the broker route + gateway. */
export interface ClientGates {
  /** V — NEXT_PUBLIC_VOICE_AI_BETA === "1": runtime + orb + 01A behavior. */
  runtime: boolean;
  /** P — requires V AND NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA === "1": a gateway
   *  transport + conversation controller MAY be constructed (still no automatic
   *  mic/broker/provider — only an explicit user gesture starts a turn). */
  provider: boolean;
}
export function resolveClientGates(env?: Record<string, string | undefined>): ClientGates {
  const e = env || (typeof process !== "undefined" && process.env ? process.env : {});
  const v = e.NEXT_PUBLIC_VOICE_AI_BETA === "1";
  const p = v && e.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA === "1";
  return { runtime: v, provider: p };
}

export interface ControlSocket {
  send(data: string): void;
  close(): void;
}
export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
  onError(): void;
}
export type SocketOpener = (url: string, protocols: string[], handlers: SocketHandlers) => ControlSocket;

/** The owned WebRTC media lifecycle (mic mode). Real adapter is browser-only. */
export interface GatewayMedia {
  /** R5C2 (§6) — `createOffer` acquires the mic (getUserMedia) and, RIGHT AFTER physical
   *  acquisition + BEFORE any peer/negotiation work, invokes `onAcquire` SYNCHRONOUSLY. The
   *  caller admits the controller capture lease there (lease begins at PHYSICAL acquisition,
   *  never after the offer). A falsy return REFUSES the capture: `createOffer` stops the
   *  just-acquired mic tracks and rejects (no peer, no offer) — so a superseded / torn-down /
   *  late acquisition can never construct a peer or leave a hot mic without a lease. */
  createOffer(onAcquire?: () => boolean): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  close(): void;
}

export interface GatewayTransportDeps {
  fetchImpl?: typeof fetch;
  openSocket?: SocketOpener;
  /** R4-03 — the PREFERRED media dependency: a FACTORY that mints a FRESH media session
   *  per start(). Each start owns its OWN session, so an old (superseded) start can NEVER
   *  close the resources a newer start acquired. A start that returns null ⇒ no mic media
   *  (fails closed for a microphone start). */
  createMediaSession?: () => GatewayMedia | null;
  /** Legacy single shared media object (tests / one-shot). Wrapped as a one-per-start
   *  factory when `createMediaSession` is absent; prefer `createMediaSession`. */
  media?: GatewayMedia | null;
  brokerPath?: string;
  /** R5C — the MONOTONIC clock for the controller-lifetime capture ledger (defaults to
   *  performance.now() when available, else Date.now()). Tests inject a deterministic
   *  monotonic fake. */
  now?: () => number;
  /** R5C — deterministic timer seam for the per-lease (20s) capture ceiling. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** R5C — test-only overrides of the capture-ledger ceilings (production uses the
   *  20,000 ms per-lease / 180,000 ms cumulative defaults). */
  maxCaptureLeaseMs?: number;
  maxControllerCaptureMs?: number;
}

interface BrokerClientResponse {
  sessionId: string;
  gatewaySessionId: string;
  controlToken: string;
  expiresInSeconds: number;
  controlUrl: string;
  answerSdp?: string;
}
/** Browser-side validation of the broker JSON (controlUrl must be a bounded wss). */
export function parseBrokerClientResponse(json: unknown): BrokerClientResponse | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const g = json as Record<string, unknown>;
  if (!isValidId(g.sessionId) || !isValidId(g.gatewaySessionId)) return null;
  if (typeof g.controlToken !== "string" || !g.controlToken || g.controlToken.length > 4096) return null;
  if (typeof g.expiresInSeconds !== "number" || !Number.isFinite(g.expiresInSeconds) || g.expiresInSeconds < 0) return null;
  if (typeof g.controlUrl !== "string" || g.controlUrl.length > 2048) return null;
  let u: URL;
  try { u = new URL(g.controlUrl); } catch { return null; }
  if (u.protocol !== "wss:" || u.username || u.password || u.hash) return null;
  const out: BrokerClientResponse = {
    sessionId: g.sessionId as string,
    gatewaySessionId: g.gatewaySessionId as string,
    controlToken: g.controlToken,
    expiresInSeconds: Math.floor(g.expiresInSeconds),
    controlUrl: g.controlUrl,
  };
  if (g.answerSdp !== undefined) {
    if (typeof g.answerSdp !== "string" || !g.answerSdp || g.answerSdp.length > 20 * 1024) return null;
    out.answerSdp = g.answerSdp;
  }
  return out;
}

/** R5C2/R5C3 (§5/§7) — the GENERATION-LOCAL start owner: a SINGLE authority record that owns
 *  EVERY per-start resource (media session, broker abort, control socket, capture lease) across
 *  BOTH the in-flight (pending) phase AND, after a successful start, the installed phase — the
 *  SAME object is transferred pending→installed (never copied). The one release mechanism is the
 *  transport-level `releaseOwner(owner, terminal)` (§7): it releases ONLY the exact current
 *  pending/installed owner, once, invalidating the generation before teardown, aborting its
 *  broker, closing its socket, stopping its mic tracks + peer (media.close), finalizing ITS OWN
 *  capture lease token EXACTLY ONCE, and detaching ONLY the matching transport pointers — a stale
 *  owner can NEVER touch a newer owner's resources (§8/§9). `released` is the idempotency latch. */
interface StartOwner {
  readonly startGeneration: number;
  readonly mode: "microphone" | "text";
  phase: "pending" | "installed";
  media: GatewayMedia | null;
  abortController: AbortController | null;
  localSocket: ControlSocket | null;
  captureLeaseToken: CaptureLeaseToken | null;
  captureAcquired: boolean;
  released: boolean;
}

export function createGatewayTransport(deps: GatewayTransportDeps): LiveAiTransport {
  const fetchImpl = deps.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
  const openSocket = deps.openSocket || defaultSocketOpener();
  const brokerPath = deps.brokerPath || DEFAULT_BROKER_PATH;

  // R4-03 — media is acquired PER START via a factory, so every start owns a FRESH media
  // session. `deps.media` (legacy single object) is wrapped as a one-per-start factory.
  // An old start's `releaseMine()` closes only ITS OWN session; `ownerMedia` (the CURRENT
  // installed owner's session, set on WIN) is the ONLY session `disposeTransport` closes —
  // a stale start can never close the current owner's media, and dispose never closes a
  // superseded start's already-released session.
  const makeMedia: (() => GatewayMedia | null) | null =
    deps.createMediaSession || (deps.media ? () => deps.media || null : null);

  let socket: ControlSocket | null = null;
  let ownerMedia: GatewayMedia | null = null;
  let connectionState: ConnectionState = "disconnected";
  const listeners = new Set<(e: TransportEvent) => void>();
  // R2-03/R2-04 — a monotonic start-generation token: each start() (and every
  // teardown) increments it. An in-flight start's async continuation is STALE the
  // moment a newer start begins or the transport is disposed — it then refuses to
  // open a socket (a late broker response can never clobber the current owner).
  let startGen = 0;
  // R2-04 — the in-flight broker fetch's abort controller, so a supersede / dispose
  // ABORTS the network call rather than letting it complete against a dead transport.
  let brokerAbort: AbortController | null = null;
  // R2-01 — the gateway session id THIS transport was minted for; a connection.ready
  // for any other gateway session id is an integrity failure and is refused.
  let expectedGatewaySessionId: string | null = null;
  // R5C — the CONTROLLER-LIFETIME capture ledger + the "the mic is currently owned"
  // flag. The ledger lives here (in the transport closure, constructed once with the
  // conversation controller), so cumulative capture SURVIVES media replacement, failed
  // starts, reconnect, end() and reset(); no teardown ever resets it. `micActive` is the
  // invariant guard: while the transport owns a live mic, exactly one lease is active.
  const captureNow = deps.now || (() => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()));
  let micActive = false;
  // R5C2 (§5/§8) — the in-flight (pending) start owner and the currently installed owner. A
  // capture-closing teardown releases BOTH; a stale start's release detaches only its own
  // matching pointers, never a newer owner's. On a successful start the SAME owner object is
  // transferred pending→installed (never a copy), so the installed capture authority IS the
  // one admitted at physical acquisition.
  let pendingOwner: StartOwner | null = null;
  let installedOwner: StartOwner | null = null;
  const ledger = createCaptureLedger({
    now: captureNow,
    maxLeaseMs: deps.maxCaptureLeaseMs,
    maxCumulativeMs: deps.maxControllerCaptureMs,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    // A per-lease (20s) ceiling breach tears the whole capture down (fail closed); the
    // lease is already charged + closed by the ledger before this runs.
    onLeaseExpired: () => { disposeTransport("disconnected"); },
  });
  /** R5C2 (§8/§9) — a CAPTURE-CLOSING interrupt (barge_in / context_change / user_cancel) ends
   *  the capture: release whichever owner PHYSICALLY holds the mic — the installed owner, OR an
   *  in-flight (pending) start that already passed physical acquisition — through the existing
   *  generation-safe, idempotent teardown (disposeTransport), which FINALIZES the exact active
   *  lease once (charging the ACTUAL monotonic elapsed; the cumulative ledger is preserved),
   *  aborts a pending broker, stops the physical mic tracks + closes the peer/socket, and leaves
   *  NO active lease + NO physical capture. It NEVER re-admits a capture lease (no ledger.begin()
   *  here) and NEVER auto-restarts the mic: a later capture requires a fresh explicit
   *  start(mode:"microphone") gesture. Provider/model/VAD activity can never create a lease —
   *  leases are armed only at media acquisition. `route_change` NEVER reaches here (§10). */
  function closeCaptureForInterrupt() {
    // R5C3 (§5 REV-01) — select the exact current MICROPHONE owner by MICROPHONE OWNERSHIP (mode),
    // NOT by captureAcquired: a PENDING mic owner MUST be cancellable BEFORE getUserMedia resolves.
    // Priority: the installed mic owner, else the pending mic owner. MUT-R5C3-01 anchor.
    const holder = (installedOwner && installedOwner.mode === "microphone") ? installedOwner
                 : (pendingOwner && pendingOwner.mode === "microphone") ? pendingOwner
                 : null;
    if (holder) disposeTransport("disconnected");
  }

  function emit(e: TransportEvent) {
    listeners.forEach((l) => { try { l(e); } catch { /* a listener must never break the loop */ } });
  }
  function setState(s: ConnectionState) {
    if (s === connectionState) return;
    connectionState = s;
    emit({ type: "connection", state: s });
  }
  /** R5C3 (§7) — the SINGLE exact-current-owner release primitive. Releases an owner ONCE, and
   *  ONLY the exact current pending or installed owner (a stale / already-detached owner is
   *  inert). Ordering: verify exact identity → invalidate the start generation → latch released →
   *  detach the matching pending/installed/global pointers → abort the matching broker → close the
   *  matching socket → close the matching media (stops mic tracks + peer/dc) → finalize the exact
   *  lease token once → set the bounded terminal state (when given). Pointers are DETACHED BEFORE
   *  the external abort/close calls, so a reentrant close/error callback (§10) sees `released`
   *  latched and is inert. The cumulative ledger is NEVER reset. A stale owner can NEVER clear or
   *  close a newer owner's resources (§8/§9). MUT-R5C3-03/04/05 anchors. */
  function releaseOwner(o: StartOwner, terminal: "disconnected" | "error" | null): void {
    if (o.released) return;                                       // idempotent
    if (pendingOwner !== o && installedOwner !== o) return;       // exact-current-owner only
    startGen++;                                                   // invalidate generation BEFORE teardown
    o.released = true;                                            // latch (before any external close — §10)
    if (pendingOwner === o) pendingOwner = null;                  // detach matching pointers
    if (installedOwner === o) { installedOwner = null; micActive = false; }
    const ab = o.abortController, sk = o.localSocket, md = o.media, tok = o.captureLeaseToken;
    if (brokerAbort === ab) brokerAbort = null;
    if (socket === sk) socket = null;
    if (ownerMedia === md) ownerMedia = null;
    try { ab?.abort(); } catch { /* no-op */ }                    // abort matching broker
    try { sk?.close(); } catch { /* no-op */ }                    // close matching socket
    try { md?.close(); } catch { /* no-op */ }                    // close matching media (stops tracks + peer/dc)
    try { ledger.finalize(tok, "partial"); } catch { /* no-op */ } // finalize exact lease once (cumulative preserved)
    if (terminal) setState(terminal);                            // bounded terminal state
  }
  /** R2-04 — full transport teardown: invalidate any in-flight start, abort the
   *  broker fetch, and close the control socket + owned media. Idempotent. */
  function disposeTransport(reason: "disconnected" | "error") {
    // R5C3 (§7/§8) — release BOTH the in-flight (pending) and the installed owner through the
    // single exact-owner primitive (each invalidates the generation, latches, detaches, aborts /
    // closes / finalizes its own lease exactly once).
    const p = pendingOwner, i = installedOwner;
    if (p) releaseOwner(p, null);
    if (i) releaseOwner(i, null);
    startGen++;                                  // cancel any in-flight start (even with no owner)
    // Backstop for a text / no-owner path (or any resource an owner did not hold): abort the
    // broker fetch + close the socket/owned media that remain.
    try { brokerAbort?.abort(); } catch { /* no-op */ }
    brokerAbort = null;
    expectedGatewaySessionId = null;
    try { socket?.close(); } catch { /* no-op */ }
    try { ownerMedia?.close(); } catch { /* no-op */ }
    socket = null;
    ownerMedia = null;
    micActive = false;
    setState(reason);
  }
  function sendFrame(frame: ClientFrame): boolean {
    if (!socket || connectionState !== "connected") return false;
    const valid = validateClientFrame(frame);
    if (!valid) return false; // never send a malformed frame
    let text: string;
    try { text = JSON.stringify(valid); } catch { return false; }
    if (typeof text !== "string" || text.length > MAX_FRAME_BYTES) return false;
    try { socket.send(text); return true; } catch { return false; }
  }

  return {
    kind: "gateway" as const,
    async start(input: TransportStartInput): Promise<TransportStartResult> {
      if (!fetchImpl) return { ok: false, code: "unsupported" };
      if (!isValidId(input.sessionId) || !isValidId(input.turnId) || !isEpoch(input.generation)) {
        return { ok: false, code: "invalid_response" };
      }
      // R3-03 — SINGLE-START OWNER: a start is honored ONLY from the DISCONNECTED state.
      // A start while the transport already owns a session (connecting / connected /
      // error / offline) is REFUSED and NEVER disturbs the current owner — no supersede,
      // no clobber. The caller reaches DISCONNECTED (end/reset) before starting again.
      if (connectionState !== "disconnected") return { ok: false, code: "already_active" };
      // R3-04 — claim ownership for THIS start. A later dispose/end bumps startGen so
      // `owned()` turns false; this start's async continuation then acts ONLY on the
      // resources IT captured (its own socket + owned media / abort), NEVER on a socket a
      // newer owner installed. The checkpoint is re-tested after every await.
      const myGen = ++startGen;
      // R5C2 (§5) — build THIS start's SINGLE generation-local owner. `owned()` = still this
      // generation AND not released (a late continuation re-checks EXACT generation + owner +
      // released — §8). All per-start resources belong ONLY to this owner.
      const owner: StartOwner = {
        startGeneration: myGen,
        mode: input.mode === "microphone" ? "microphone" : "text",
        phase: "pending",
        media: null,
        abortController: null,
        localSocket: null,
        captureLeaseToken: null,
        captureAcquired: false,
        released: false,
      };
      // Release this start's resources through the single exact-owner primitive (§7).
      const owned = () => startGen === myGen && !owner.released;
      // R5C2 (§5) — REGISTER the pending owner BEFORE any media creation / physical
      // acquisition, so a teardown or barge-in that RACES the in-flight start can find + release
      // it (abort broker, stop tracks, finalize its lease). MUT-R5C2-01 anchor.
      pendingOwner = owner; // R5C2-REG
      // R4-03 — mint a FRESH media session for THIS start (never the shared object). An old
      // start's release/dispose can never touch this session, and this start's release can
      // never touch a newer start's session.
      owner.media = makeMedia ? makeMedia() : null;
      const AC = (globalThis as unknown as { AbortController?: typeof AbortController }).AbortController;
      owner.abortController = AC ? new AC() : null;
      brokerAbort = owner.abortController;
      const abortSignal = owner.abortController ? owner.abortController.signal : undefined;
      setState("connecting");
      let offerSdp: string | undefined;
      // R5C2 (§6) — the controller capture lease is admitted AT PHYSICAL ACQUISITION, inside
      // createOffer, via this acquisition callback: right after getUserMedia resolves (before
      // ANY peer / broker / socket work) the media invokes onAcquire SYNCHRONOUSLY. It verifies
      // this start is STILL the valid owner (a supersede/teardown during a non-abortable
      // permission prompt refuses here — §7), then admits a VAD-independent lease
      // (≤ MAX_CAPTURE_LEASE_MS, ≤ the remaining controller-lifetime allowance). A refusal makes
      // createOffer stop the just-acquired mic tracks and reject, so a lease can NEVER trail
      // physical capture and a late/superseded acquisition never builds a peer or contacts the
      // broker. MUT-R5C2-02 (admission timing) / MUT-R5C2-09 (fail-closed acquisition) anchors.
      let acquireRefusal: "superseded" | "lease" | null = null;
      const onAcquire = (): boolean => {
        if (!owned()) { acquireRefusal = "superseded"; return false; }
        const lease = ledger.begin();
        if (!lease.ok) { acquireRefusal = "lease"; return false; }
        owner.captureLeaseToken = lease.token;
        owner.captureAcquired = true;
        return true;
      };
      if (input.mode === "microphone") {
        // R5C3 (§13 NB-01) — no media adapter after owner registration: release the exact pending
        // owner (detach + terminal) BEFORE returning unsupported (no leaked pending registration).
        if (!owner.media) { releaseOwner(owner, "error"); return { ok: false, code: "unsupported" }; }
        try { offerSdp = await owner.media.createOffer(onAcquire); }
        catch {
          // createOffer rejected: a getUserMedia permission failure, an admission REFUSAL
          // (superseded / exhausted), a stale-cancellation media closure (§6/§7), or a later
          // WebRTC step. The media already stopped its own tracks; release the exact owner
          // (idempotent) and fail closed with the precise code.
          if (acquireRefusal === "lease") { releaseOwner(owner, "error"); return { ok: false, code: "unsupported" }; }
          if (acquireRefusal === "superseded" || !owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; }
          releaseOwner(owner, "error"); return { ok: false, code: "permission_denied" };
        }
        if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; } // §7 — superseded across getUserMedia
        // R5C2 (§6 / MUT-R5C2-09) — FAIL CLOSED if the media adapter produced an offer WITHOUT
        // honoring the acquisition callback: a mic offer with no admitted lease is refused, so
        // physical capture can NEVER exist without an active controller lease.
        if (!owner.captureAcquired || !owner.captureLeaseToken) { releaseOwner(owner, "error"); return { ok: false, code: "unsupported" }; }
      }
      let res: Response;
      try {
        res = await fetchImpl(brokerPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(input.mode === "microphone" ? { mode: "microphone", sessionId: input.sessionId, offerSdp } : { mode: "text", sessionId: input.sessionId }),
          ...(abortSignal ? { signal: abortSignal } : {}),
        });
      } catch {
        if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; } // aborted/superseded
        releaseOwner(owner, "error"); // R5C — a failed media start is fully cleaned up (mic + lease)
        return { ok: false, code: "broker_unavailable" };
      }
      if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; } // R3-04 — late broker after supersede/dispose
      if (!res || !res.ok) {
        releaseOwner(owner, "error");
        return { ok: false, code: res && (res.status === 502 || res.status === 503) ? "gateway_unavailable" : "broker_unavailable" };
      }
      let json: unknown;
      try { json = await res.json(); } catch { if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; } releaseOwner(owner, "error"); return { ok: false, code: "invalid_response" }; }
      if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; }
      const broker = parseBrokerClientResponse(json);
      if (!broker) { releaseOwner(owner, "error"); return { ok: false, code: "invalid_response" }; }
      if (input.mode === "microphone") {
        if (!broker.answerSdp || !owner.media) { releaseOwner(owner, "error"); return { ok: false, code: "invalid_response" }; }
        try { await owner.media.acceptAnswer(broker.answerSdp); } catch { if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; } releaseOwner(owner, "error"); return { ok: false, code: "gateway_unavailable" }; }
        if (!owned()) { releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; }
      }
      // R2-01 — bind THIS transport to the exact gateway session the broker minted; a
      // connection.ready for any other gateway session id is refused (see onMessage).
      expectedGatewaySessionId = broker.gatewaySessionId;
      // R5C3 (§8/§9/§10) — the exact socket ownership lifecycle. openSocket MAY deliver onOpen /
      // onClose / onError SYNCHRONOUSLY before it returns, so a `candidateSocket` + bounded setup
      // state (socketBound / bufferedOpen / bufferedTerminal) hold them. A terminal (close/error)
      // callback gains CAPTURE-CLOSING authority only after the candidate is bound to THIS exact
      // owner (§9), releasing the exact owner (stop media + finalize lease + terminal state); a
      // pre-bind terminal is buffered and handled deterministically below; a reentrant / stale
      // callback is inert (§10). Inbound messages gain NO authority before full binding.
      let candidateSocket: ControlSocket | null = null;
      let socketBound = false;
      let bufferedOpen = false;
      let bufferedTerminal: "close" | "error" | null = null;
      const isCurrentBound = () => socketBound && !owner.released && installedOwner === owner && socket === candidateSocket && owner.localSocket === candidateSocket;
      const onSocketTerminal = (kind: "close" | "error") => {
        if (!socketBound) { if (!bufferedTerminal) bufferedTerminal = kind; return; } // §8 — pre-bind: buffer the FIRST terminal
        if (!isCurrentBound()) return;                       // §9/§10 — stale / reentrant / not-current → INERT
        // R5C3 (§9/§12) — an ACTUAL socket close/error is CAPTURE-CLOSING: release the exact owner
        // (stops media + finalizes the exact lease once, so the browser can never stay active while
        // the transport socket has terminated). MUT-R5C3-03 anchor.
        releaseOwner(owner, kind === "close" ? "disconnected" : "error");
      };
      try {
        candidateSocket = openSocket(broker.controlUrl, ["live-ai.control.v1", "sbt." + broker.controlToken], {
          onOpen: () => { if (!socketBound) { bufferedOpen = true; return; } if (!isCurrentBound()) return; setState("connected"); },
          onMessage: (data) => {
            if (!isCurrentBound()) return;                   // §8 — no authority before full binding / after release
            let parsed: unknown;
            try { parsed = JSON.parse(data); } catch { return; }
            const frame = validateServerFrame(parsed);
            if (!frame) return; // drop any malformed / unknown-discriminant frame
            // R2-01 — a connection.ready must name the gateway session this transport
            // was minted for; a mismatch is an integrity failure → drop + tear down.
            if (frame.t === "connection.ready" && frame.gatewaySessionId !== expectedGatewaySessionId) {
              disposeTransport("error");
              return;
            }
            emit({ type: "frame", frame });
          },
          onClose: () => onSocketTerminal("close"),
          onError: () => onSocketTerminal("error"),
        });
      } catch {
        releaseOwner(owner, "error");
        return { ok: false, code: "gateway_unavailable" };
      }
      // A — the owner went stale/released (supersede/dispose during openSocket): close the
      // candidate DIRECTLY, do not attach, fail closed.
      if (!owned()) { try { candidateSocket?.close(); } catch { /* no-op */ } releaseOwner(owner, null); return { ok: false, code: "gateway_unavailable" }; }
      // B — a terminal (close/error) was delivered SYNCHRONOUSLY before binding: deterministic
      // exact-owner cleanup, close the candidate, fail closed, NO installation.
      if (bufferedTerminal) { try { candidateSocket?.close(); } catch { /* no-op */ } releaseOwner(owner, bufferedTerminal === "error" ? "error" : "disconnected"); return { ok: false, code: "gateway_unavailable" }; }
      // C — a valid candidate: bind it to THIS exact owner, transfer the SAME owner
      // pending→installed (never a copy), assign matching module pointers, ACTIVATE the callback
      // binding, and apply a buffered onOpen only if still current.
      owner.localSocket = candidateSocket;
      owner.phase = "installed";
      pendingOwner = null;
      installedOwner = owner;
      socket = candidateSocket;     // install THIS start's socket as the current owner
      ownerMedia = owner.media;     // R4-03 — and THIS start's media session as the owned session
      brokerAbort = null;           // broker phase done; nothing left to abort for this start
      // R5C — the mic is now owned by the transport: the capture lease begun at physical
      // acquisition is the transport's single ACTIVE lease. `micActive` guards teardown lease
      // finalization. Text mode owns no lease.
      if (input.mode === "microphone") micActive = true;
      socketBound = true;           // §9 — ACTIVATE the callback binding (terminals now have authority)
      if (bufferedOpen) setState("connected"); // apply the buffered open only if still current
      return { ok: true };
    },
    submitText(input): boolean {
      const frame: ClientFrame = input.languageHint
        ? { t: "turn.text", sessionId: input.sessionId, turnId: input.turnId, generation: input.generation, text: input.text, languageHint: input.languageHint as LiveAiLanguage }
        : { t: "turn.text", sessionId: input.sessionId, turnId: input.turnId, generation: input.generation, text: input.text };
      return sendFrame(frame);
    },
    publishContext(input: ContextPublishFrame): boolean {
      return sendFrame(input);
    },
    submitActionAccepted(input: ActionAcceptedFrame): boolean {
      // R3-05 — announce the accepted action (binds the minted actionId server-side).
      return sendFrame(input);
    },
    submitActionReceipt(input: ActionReceiptFrame): boolean {
      return sendFrame(input);
    },
    submitApproval(input: { sessionId: string; turnId: string; generation: number; planId: string; authorityRef: string; textHash: string }): boolean {
      // R2-08 — the browser's approval of an emitted plan; the SOLE trigger for TTS.
      return sendFrame({ t: "answer.approve", sessionId: input.sessionId, turnId: input.turnId, generation: input.generation, planId: input.planId, authorityRef: input.authorityRef, textHash: input.textHash });
    },
    interrupt(input: { sessionId: string; turnId: string; generation: number; reason: InterruptReason }): void {
      // Notify the gateway first (abort the in-flight turn) while the socket is still live.
      sendFrame({ t: "turn.interrupt", sessionId: input.sessionId, turnId: input.turnId, generation: input.generation, reason: input.reason });
      // R5C2 (§8/§9/§10) — EVERY interrupt reason EXCEPT route_change is CAPTURE-CLOSING: a
      // barge_in / context_change / user_cancel ENDS + CLOSES the capture (finalize the active
      // lease exactly once — actual elapsed, cumulative preserved — then tear down the owned
      // mic/peer/socket via the idempotent teardown; NEVER re-admit a lease, so a later capture
      // requires a fresh explicit start(mode:"microphone") gesture). A route_change is the SOLE
      // AUTHORIZED navigation where the SAME capture legitimately continues under its EXISTING
      // lease — the socket stays live for the R5B context reconciliation that runs right after
      // this interrupt — so it neither finalizes nor re-admits a lease.
      if (input.reason !== "route_change") closeCaptureForInterrupt();
    },
    reset(input: { sessionId: string; generation: number }): void {
      sendFrame({ t: "session.reset", sessionId: input.sessionId, generation: input.generation });
    },
    end(input: { sessionId: string; generation: number; reason: "user" | "timeout" | "unmount" }): void {
      // Best-effort graceful end frame, THEN full teardown (R2-04 dispose): cancel any
      // in-flight start, abort the broker fetch, close the socket + owned media.
      sendFrame({ t: "session.end", sessionId: input.sessionId, generation: input.generation, reason: input.reason });
      disposeTransport("disconnected");
    },
    subscribe(listener: (e: TransportEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getConnectionState: (): ConnectionState => connectionState,
  };
}

/** REV-03 — the browser WebRTC media adapter (mic → STT). INPUT-ONLY: the mic audio
 *  is transcribed by the provider (transcripts arrive on the data channel and are
 *  surfaced via onFinalTranscript → submitted as a text turn); the ANSWER audio is
 *  the gateway's deterministic, evidence-bound TTS over the control socket, NOT the
 *  realtime voice track (which would be un-evidenced model prose). Constructed ONLY
 *  after an explicit user gesture; returns null when the WebRTC / mic APIs are absent
 *  (SSR / unsupported browser / tests), so a mic start fails closed. Never records.
 *  ⚠ ACTIVATION-TIME: the exact realtime transcription event names must be verified
 *  against the current provider contract before go-live (this code is not exercised
 *  by the dormant build; tests inject a fake GatewayMedia). */
export interface BrowserMediaDeps {
  onFinalTranscript?: (text: string, language: LiveAiLanguage) => void;
  /** R4-R2-NEW-02 — the CURRENT conversation generation, read at commit + completion time,
   *  so a transcript is bound to the turn/route it was captured under (a stale-generation
   *  completion is dropped). Omitted ⇒ a constant 0 (no generation authority — tests/SSR). */
  currentGeneration?: () => number;
}
/**
 * R3-NEW-02 — the INPUT-transcription ITEM AUTHORITY gate (pure + testable). The mic
 * data channel receives many Realtime events; ONLY the documented user-INPUT
 * transcription completion `conversation.item.input_audio_transcription.completed` is
 * treated as user speech. The assistant OUTPUT transcript
 * (`response.audio_transcript.done` / `response.output_audio_transcript.done`) is
 * REJECTED — it is never user input. Each input item is surfaced AT MOST ONCE
 * (dedup by item_id), only if it was previously observed as committed/created (unknown
 * item ids are rejected), and NEVER out of order: a completion whose commit index is not
 * strictly newer than the newest already-surfaced item is discarded, so a late A after a
 * newer B cannot start a stale current turn. `reset()` drops obsolete item authority
 * (route change / new session / teardown). Bounded memory.
 */
export type InputTranscriptOutcome = "committed" | "surfaced" | "duplicate" | "stale" | "stale_generation" | "unknown_item" | "rejected_output" | "ignored";
/**
 * R4-R2-NEW-02 — the gate binds every committed input item to the CONVERSATION GENERATION
 * live at COMMIT time (via `currentGeneration`). A completion is surfaced ONLY if that
 * captured generation is STILL current: a route change / barge-in / reset / new turn
 * advances the generation, so a pre-transition item that completes afterward is stale
 * audio for a superseded turn and is REJECTED (`stale_generation`) — never assigned to the
 * new generation's turn. (`currentGeneration` defaults to a constant 0 for tests that don't
 * exercise generations.) In-order dedup + unknown-item + assistant-output rejection unchanged.
 */
export function createInputTranscriptGate(onFinal: (text: string, language: LiveAiLanguage) => void, currentGeneration: () => number = () => 0) {
  const committedOrder = new Map<string, { idx: number; gen: number }>(); // item_id → { commit order, generation-at-commit }
  const surfaced = new Set<string>();                // item_ids already surfaced (dedup)
  let nextIdx = 0;
  let highestSurfacedIdx = -1;
  const MAX = 256;
  function recordCommit(itemId: string): void {
    if (!committedOrder.has(itemId)) {
      if (committedOrder.size >= MAX) { const k = committedOrder.keys().next().value as string | undefined; if (k !== undefined) committedOrder.delete(k); }
      committedOrder.set(itemId, { idx: nextIdx++, gen: currentGeneration() });
    }
  }
  function handle(data: unknown): InputTranscriptOutcome {
    if (typeof data !== "string") return "ignored";
    let msg: { type?: unknown; item_id?: unknown; transcript?: unknown; item?: { id?: unknown } } | null;
    try { msg = JSON.parse(data); } catch { return "ignored"; }
    if (!msg || typeof msg.type !== "string") return "ignored";
    const type = msg.type;
    // commit-order signals: the input items are created/committed in order.
    if (type === "conversation.item.created" && msg.item && typeof msg.item.id === "string") { recordCommit(msg.item.id); return "committed"; }
    if (type === "input_audio_buffer.committed" && typeof msg.item_id === "string") { recordCommit(msg.item_id); return "committed"; }
    // ONLY the input-audio transcription completion is user-speech authority.
    if (type !== "conversation.item.input_audio_transcription.completed") return "rejected_output";
    const itemId = msg.item_id, transcript = msg.transcript;
    if (typeof itemId !== "string" || !itemId || typeof transcript !== "string") return "ignored";
    if (surfaced.has(itemId)) return "duplicate";              // completion delivered twice
    if (!committedOrder.has(itemId)) return "unknown_item";    // never observed committed → reject
    const rec = committedOrder.get(itemId) as { idx: number; gen: number };
    // R4-R2-NEW-02 — the item's captured conversation generation must still be current; a
    // completion for an item committed under an OLDER generation (route change / barge-in /
    // reset advanced it) is stale audio for a superseded turn → NEVER surfaced.
    if (rec.gen !== currentGeneration()) return "stale_generation";
    if (rec.idx <= highestSurfacedIdx) return "stale";         // older than an already-surfaced item (late / out of order)
    surfaced.add(itemId);
    highestSurfacedIdx = rec.idx;
    if (surfaced.size > MAX) { const k = surfaced.values().next().value as string | undefined; if (k !== undefined) surfaced.delete(k); }
    onFinal(transcript.slice(0, 4000), "en");
    return "surfaced";
  }
  function reset(): void { committedOrder.clear(); surfaced.clear(); nextIdx = 0; highestSurfacedIdx = -1; }
  return { handle, reset };
}

/**
 * R3-13 / R4-13 — the MIC CAPTURE-CEILING guard (pure + testable). It bounds captured audio
 * at HARD LIMITS and, on breach, invokes `onCeiling` EXACTLY ONCE so the caller TERMINATES
 * the realtime transcription stream (stop tracks / close the mic + peer). The AUTHORITATIVE
 * ceilings are CAPTURE-DURATION, measured from LOCAL CAPTURE OWNERSHIP — never from provider
 * VAD / transcript events (which can assist UX but can never be the authority — R4-13):
 *   • R4-13 a hard cumulative per-SESSION CAPTURE-DURATION — armed by `startCapture()` the
 *     moment the local mic capture begins; if capture is still live after
 *     `maxSessionCaptureMs`, the allowance has expired and the stream is torn down (no
 *     further audio may be transmitted). This is a WALL-CLOCK timer, independent of any
 *     provider event, so a provider that stops sending transcripts can't keep the mic open.
 *   • a per-UTTERANCE duration ceiling — armed on `input_audio_buffer.speech_started` and
 *     cleared on `input_audio_buffer.speech_stopped`; a VAD-assisted secondary bound so a
 *     single stuck/held utterance also trips.
 *   • a cumulative captured-TRANSCRIPT char cap — DEFENSE-IN-DEPTH only (transcript chars are
 *     NOT audio duration — R4-13); the duration ceiling above is the authority.
 * Timers are injected for testability. `onCeiling` never throws into the loop; once tripped
 * the guard is inert until `reset()` (route change / new session / teardown).
 */
export type SpeechCeilingReason = "session_capture_duration" | "utterance_timeout" | "session_speech";
export type SpeechCeilingOutcome = "utterance_start" | "utterance_stop" | "counted" | "tripped" | "ignored";
export const MAX_UTTERANCE_MS = 20_000;
export const MAX_SESSION_TRANSCRIPT_CHARS = 64_000;
// R4-13 — the hard cumulative captured-audio DURATION per session (wall-clock from local
// capture start). The server's realtime budget reservation is a documented mapping over this
// same duration (see server/voice-gateway/index.ts RESERVE_TRANSCRIPTION_UNITS).
export const MAX_SESSION_CAPTURE_MS = 180_000;
export function createSpeechCeilingGuard(opts: {
  onCeiling: (reason: SpeechCeilingReason) => void;
  maxUtteranceMs?: number;
  maxSessionChars?: number;
  maxSessionCaptureMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}) {
  const maxUtterMs = opts.maxUtteranceMs && opts.maxUtteranceMs > 0 ? opts.maxUtteranceMs : MAX_UTTERANCE_MS;
  const maxChars = opts.maxSessionChars && opts.maxSessionChars > 0 ? opts.maxSessionChars : MAX_SESSION_TRANSCRIPT_CHARS;
  const maxCaptureMs = opts.maxSessionCaptureMs && opts.maxSessionCaptureMs > 0 ? opts.maxSessionCaptureMs : MAX_SESSION_CAPTURE_MS;
  const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer || ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let utterTimer: unknown = null;
  let captureTimer: unknown = null;
  let sessionChars = 0;
  let fired = false;
  function clearUtter() { if (utterTimer !== null) { try { clearTimer(utterTimer); } catch { /* no-op */ } utterTimer = null; } }
  function clearCapture() { if (captureTimer !== null) { try { clearTimer(captureTimer); } catch { /* no-op */ } captureTimer = null; } }
  function trip(reason: SpeechCeilingReason) {
    if (fired) return;
    fired = true;
    clearUtter();
    clearCapture();
    try { opts.onCeiling(reason); } catch { /* onCeiling must never throw into the loop */ }
  }
  // R4-13 — arm the AUTHORITATIVE cumulative capture-duration ceiling the instant local mic
  // capture begins (from the media owner, NOT a provider event). Idempotent per capture.
  function startCapture(): void {
    if (fired || captureTimer !== null) return;
    captureTimer = setTimer(() => trip("session_capture_duration"), maxCaptureMs);
  }
  function handle(data: unknown): SpeechCeilingOutcome {
    if (fired) return "ignored";
    if (typeof data !== "string") return "ignored";
    let msg: { type?: unknown; transcript?: unknown } | null;
    try { msg = JSON.parse(data); } catch { return "ignored"; }
    if (!msg || typeof msg.type !== "string") return "ignored";
    if (msg.type === "input_audio_buffer.speech_started") { clearUtter(); utterTimer = setTimer(() => trip("utterance_timeout"), maxUtterMs); return "utterance_start"; }
    if (msg.type === "input_audio_buffer.speech_stopped") { clearUtter(); return "utterance_stop"; }
    if (msg.type === "conversation.item.input_audio_transcription.completed") {
      sessionChars += typeof msg.transcript === "string" ? msg.transcript.length : 0;
      if (sessionChars > maxChars) { trip("session_speech"); return "tripped"; }
      return "counted";
    }
    return "ignored";
  }
  function reset() { clearUtter(); clearCapture(); sessionChars = 0; fired = false; }
  return { handle, startCapture, reset };
}

// ─────────────────────────────────────────────────────────────────────────
// R5C — CONTROLLER-LIFETIME BROWSER CAPTURE LEDGER (media-ownership / capture-limit
// authority). A single in-memory cumulative capture authority owned by the Live-AI
// controller (transport) lifetime — SEPARATE from, and NOT reset by, the per-media
// `createSpeechCeilingGuard` (which is minted fresh per media session and therefore
// resets on every media replacement). The ledger is the DURATION AUTHORITY:
//   • exactly ONE active capture lease at a time;
//   • each admitted lease duration = min(MAX_CAPTURE_LEASE_MS, remaining cumulative);
//   • cumulative capture across the controller lifetime is HARD-capped at
//     MAX_CONTROLLER_CAPTURE_MS and SURVIVES media replacement / failed starts /
//     reconnect / end() / reset() (the ledger lives in the transport closure, and no
//     teardown ever resets `usedMs`);
//   • a PARTIAL capture (finalized early by end / interrupt / replacement) charges the
//     ACTUAL monotonic elapsed time (clamped to the admitted duration);
//   • an EXPIRED lease (the 20s per-lease ceiling elapsed) charges the full admitted
//     duration and tears the capture down via `onLeaseExpired`;
//   • finalization is EXACTLY-ONCE + idempotent (a second finalize of the same lease,
//     or a finalize with no active lease, is an inert no-op);
//   • an injected monotonic clock + timer seam make it fully deterministic under test;
//   • a clock anomaly (non-finite / going backwards) latches `broken` and fails CLOSED
//     (charges the admitted maximum, refuses further leases).
// Provider VAD is never consulted here: a lease is armed from LOCAL capture ownership
// (media acquisition), never from a speech_started / transcript event.
// ─────────────────────────────────────────────────────────────────────────
export const MAX_CAPTURE_LEASE_MS = 20_000;
export const MAX_CONTROLLER_CAPTURE_MS = 180_000;

export interface CaptureLedgerSnapshot {
  /** cumulative charged capture over the controller lifetime (monotonic; ≤ max). */
  usedMs: number;
  /** the remaining cumulative allowance (≥ 0). */
  remainingMs: number;
  /** a lease is currently open. */
  active: boolean;
  /** the fail-closed latch tripped (clock anomaly) — no further lease may be admitted. */
  broken: boolean;
  /** the number of leases ever begun (monotonic). */
  leaseCount: number;
  /** the admitted duration of the CURRENT active lease (0 when none). */
  admittedMs: number;
}
/** An opaque lease token; only the lease that owns the token may be finalized via it. */
export interface CaptureLeaseToken { readonly id: number; }
export type CaptureBeginResult =
  | { ok: true; token: CaptureLeaseToken; admittedMs: number }
  | { ok: false; reason: "broken" | "busy" | "exhausted" | "clock" };

export function createCaptureLedger(opts: {
  now: () => number;
  maxLeaseMs?: number;
  maxCumulativeMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** invoked when a lease reaches its admitted ceiling (the 20s per-lease cap) — the
   *  transport tears the capture down here. The lease is already charged + closed. */
  onLeaseExpired?: () => void;
}) {
  const now = opts.now;
  const MAX_LEASE = opts.maxLeaseMs && opts.maxLeaseMs > 0 ? opts.maxLeaseMs : MAX_CAPTURE_LEASE_MS;
  const MAX_CUM = opts.maxCumulativeMs && opts.maxCumulativeMs > 0 ? opts.maxCumulativeMs : MAX_CONTROLLER_CAPTURE_MS;
  const setTimer = opts.setTimer || ((fn, ms) => { const h = setTimeout(fn, ms); if (h && typeof (h as { unref?: () => void }).unref === "function") (h as { unref?: () => void }).unref!(); return h; });
  const clearTimer = opts.clearTimer || ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let usedMs = 0;
  let leaseSeq = 0;
  let broken = false;
  let active: { id: number; admittedMs: number; startedAt: number } | null = null;
  let leaseTimer: unknown = null;

  function clearLeaseTimer() { if (leaseTimer !== null) { try { clearTimer(leaseTimer); } catch { /* no-op */ } leaseTimer = null; } }
  function remaining(): number { const r = MAX_CUM - usedMs; return r > 0 ? r : 0; }
  function readClock(): number | null { let t: number; try { t = now(); } catch { return null; } return typeof t === "number" && Number.isFinite(t) ? t : null; }
  // Charge a lease's usage. EXPIRED → the full admitted duration; PARTIAL → the actual
  // monotonic elapsed clamped to [0, admitted]. A clock anomaly (non-finite or going
  // backwards) latches broken and fails CLOSED toward the admitted maximum.
  function charge(lease: { admittedMs: number; startedAt: number }, kind: "partial" | "expired"): number {
    let elapsed: number;
    if (kind === "expired") {
      elapsed = lease.admittedMs;
    } else {
      const t = readClock();
      if (t === null || t < lease.startedAt) { broken = true; elapsed = lease.admittedMs; }
      else { const d = t - lease.startedAt; elapsed = d < lease.admittedMs ? d : lease.admittedMs; }
    }
    if (!(elapsed >= 0)) { broken = true; elapsed = lease.admittedMs; }
    usedMs += elapsed;
    if (usedMs > MAX_CUM) usedMs = MAX_CUM;
    return elapsed;
  }

  return {
    /** admit + open a lease. Fails CLOSED: broken latch, an already-active lease
     *  (never two at once), an exhausted cumulative allowance, or a bad clock. */
    begin(): CaptureBeginResult {
      if (broken) return { ok: false, reason: "broken" };
      if (active) return { ok: false, reason: "busy" };
      const rem = remaining();
      if (rem <= 0) return { ok: false, reason: "exhausted" };
      const t = readClock();
      if (t === null) { broken = true; return { ok: false, reason: "clock" }; }
      const admittedMs = rem < MAX_LEASE ? rem : MAX_LEASE;
      const id = ++leaseSeq;
      active = { id, admittedMs, startedAt: t };
      clearLeaseTimer();
      leaseTimer = setTimer(() => {
        if (!active || active.id !== id) return;   // superseded / already finalized
        const lease = active; active = null; leaseTimer = null;
        charge(lease, "expired");
        try { opts.onLeaseExpired?.(); } catch { /* a callback must never throw into the timer */ }
      }, admittedMs);
      return { ok: true, token: { id }, admittedMs };
    },
    /** finalize a SPECIFIC lease (a start's own release) — inert unless it is still the
     *  active lease, so a superseded start can never charge a newer owner's lease. */
    finalize(token: CaptureLeaseToken | null, kind: "partial" | "expired"): number {
      if (!active || !token || active.id !== token.id) return 0;
      const lease = active; active = null; clearLeaseTimer();
      return charge(lease, kind);
    },
    /** finalize WHATEVER lease is active (teardown / interrupt); idempotent no-op when none. */
    finalizeActive(kind: "partial" | "expired"): number {
      if (!active) return 0;
      const lease = active; active = null; clearLeaseTimer();
      return charge(lease, kind);
    },
    snapshot(): CaptureLedgerSnapshot {
      return { usedMs, remainingMs: remaining(), active: active !== null, broken, leaseCount: leaseSeq, admittedMs: active ? active.admittedMs : 0 };
    },
  };
}
export type CaptureLedger = ReturnType<typeof createCaptureLedger>;

export function createBrowserMedia(deps?: BrowserMediaDeps): GatewayMedia | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") return null;
  const RTC = (globalThis as unknown as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  if (!RTC) return null;
  let pc: RTCPeerConnection | null = null;
  let stream: MediaStream | null = null;
  let dc: RTCDataChannel | null = null;
  // R5C3 (§6) — media-local ONE-WAY closure latch. Once closed, a stream that resolves later
  // (a non-abortable getUserMedia permission that lands after teardown) is immediately stopped,
  // and the same media instance is NEVER reopened. MUT-R5C3-02/07 anchors.
  let closed = false;
  // R3-NEW-02 / R4-R2-NEW-02 — the item-authority gate owns dedup / ordering / event-type
  // filtering + CONVERSATION-GENERATION binding (a stale-generation completion is dropped).
  const gate = createInputTranscriptGate((text, language) => { try { deps?.onFinalTranscript?.(text, language); } catch { /* no-op */ } }, deps?.currentGeneration);
  function close(): void {
    // R5C3 (§6/§10) — LATCH closed + DETACH refs BEFORE any external stop/close, so a reentrant
    // close (or a late-resolving stream, handled in createOffer) can never reopen or double-stop.
    closed = true;
    const s = stream, d = dc, p = pc;
    stream = null; dc = null; pc = null;
    try { guard.reset(); } catch { /* no-op */ } // R3-13 — drop the speech-ceiling state
    try { gate.reset(); } catch { /* no-op */ }  // R3-NEW-02 — teardown drops obsolete input-item authority
    try { if (s) s.getTracks().forEach((t) => t.stop()); } catch { /* no-op */ } // stop the REAL mic tracks
    try { d?.close(); } catch { /* no-op */ }
    try { p?.close(); } catch { /* no-op */ }
  }
  // R3-13 — a breached mic ceiling TERMINATES the realtime transcription stream (stops
  // the mic tracks + closes the peer / data channel), so unbounded capture can't continue.
  const guard = createSpeechCeilingGuard({ onCeiling: () => { try { close(); } catch { /* no-op */ } } });
  return {
    async createOffer(onAcquire?: () => boolean): Promise<string> {
      // R4-04 — PARTIAL-ACQUISITION teardown: if ANY step after getUserMedia throws
      // (peer construction, addTrack, createOffer, setLocalDescription), the mic tracks +
      // any partial pc/dc are already acquired and would otherwise leak (a hot mic with no
      // live session). Clean every resource acquired so far via close(), then rethrow so
      // the caller's start() still fails closed. close() is idempotent.
      // R5C3 (§6) — a closed media instance is never reopened.
      if (closed) throw new Error("media_closed");
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
        // R5C3 (§6/§7) — if the media was CLOSED while getUserMedia was pending (a capture-closing
        // event during a non-abortable permission prompt), immediately STOP the returned stream's
        // REAL tracks and reject — NO assignment, NO acquisition callback, NO peer, NO broker, NO
        // socket. A late permission grant can never resurrect capture authority. This physical
        // cleanup does NOT rely on onAcquire refusal.
        if (closed) { try { acquired.getTracks().forEach((t) => t.stop()); } catch { /* no-op */ } throw new Error("media_closed_during_acquire"); }
        stream = acquired;
        // R5C2 (§6/§7) — PHYSICAL ACQUISITION just completed. Hand control to the acquisition
        // callback SYNCHRONOUSLY, BEFORE constructing any peer / data channel: it admits the
        // controller capture lease (the lease begins at physical acquisition, not after the
        // offer) and re-checks that this start still owns the transport. A refusal stops the
        // just-acquired mic tracks and rejects WITHOUT building a peer / contacting the broker.
        if (onAcquire && !onAcquire()) { try { close(); } catch { /* no-op */ } throw new Error("capture_admission_refused"); }
        // R4-13 — local capture ownership begins NOW: arm the authoritative cumulative
        // capture-DURATION ceiling from this instant (a wall-clock timer, not a provider
        // event). A breach tears down the media (close()), so capture can never run past it.
        guard.startCapture();
        pc = new RTC();
        for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
        dc = pc.createDataChannel("oai-events");
        // Every data-channel event feeds BOTH the input-item transcript gate AND the
        // speech-ceiling guard (utterance-duration + cumulative-speech caps).
        dc.onmessage = (ev: MessageEvent) => { gate.handle(ev.data); guard.handle(ev.data); };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // R5C3 (§6) — a capture-closing event during peer/offer construction: stop + refuse.
        if (closed) { try { close(); } catch { /* no-op */ } throw new Error("media_closed_post_offer"); }
        return offer.sdp || "";
      } catch (err) {
        try { close(); } catch { /* no-op */ }
        throw err;
      }
    },
    async acceptAnswer(sdp: string): Promise<void> {
      if (!pc) throw new Error("no_peer");
      await pc.setRemoteDescription({ type: "answer", sdp });
    },
    close,
  };
}

/** Real browser control-socket opener (WebSocket). Falls back to a no-op that
 *  immediately closes when WebSocket is unavailable (SSR / tests without a fake). */
function defaultSocketOpener(): SocketOpener {
  const WS = (globalThis as unknown as { WebSocket?: new (url: string, protocols?: string[]) => {
    onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null;
    onclose: (() => void) | null; onerror: (() => void) | null; send: (d: string) => void; close: () => void;
  } }).WebSocket;
  if (!WS) {
    return (_url, _protocols, handlers) => { handlers.onClose(); return { send: () => {}, close: () => {} }; };
  }
  return (url, protocols, handlers) => {
    const ws = new WS(url, protocols);
    ws.onopen = () => handlers.onOpen();
    ws.onmessage = (e: { data: unknown }) => handlers.onMessage(typeof e.data === "string" ? e.data : "");
    ws.onclose = () => handlers.onClose();
    ws.onerror = () => handlers.onError();
    return { send: (d: string) => ws.send(d), close: () => ws.close() };
  };
}

/** Re-export so callers can construct the fully dormant default. */
export { createNullTransport };
