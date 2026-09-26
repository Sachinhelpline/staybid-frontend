"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — global session provider.
//
// Mounts ONE bounded in-memory Live-AI session ABOVE the individual pages so a
// conversation can survive ordinary route changes, while PAGE action authority
// never does. Renders the existing app children UNCHANGED, plus the minimal
// floating orb (LiveAiShell).
//
// FOUR-GATE DORMANCY (client-visible V + P; the server B/R gates + config are an
// independent fail-closed layer at the broker route + gateway):
//   • V=0 → NOTHING is constructed (no runtime, orb, transport, mic or network);
//   • V=1, P=0 → the existing 01A orb + FAIL-CLOSED NULL transport only. No
//     conversation controller, no microphone, no broker, no provider;
//   • V=1, P=1 → a gateway transport + conversation controller MAY be constructed
//     (browser only, lazily), but NOTHING starts automatically — only an explicit
//     user gesture (startProvider) begins a turn, and the broker/gateway still
//     fail closed unless their own server gates + config are present.
//
// This packet activates no provider by default and returns no token value into
// state (role is derived ONLY from the PRESENCE of a session key).
// ─────────────────────────────────────────────────────────────────────────
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { isLiveAiEnabled, type LiveAiPageId, type LiveAiRole } from "@/lib/live-ai/contracts";
import {
  createLiveAiRuntime,
  type LiveAiRuntime,
  type PageRegistration,
} from "@/lib/live-ai/runtime";
import { createNullTransport, type LiveAiTransport } from "@/lib/live-ai/transport";
import { createGatewayTransport, createBrowserMedia, resolveClientGates } from "@/lib/live-ai/gateway-client";
import { createConversation, type Conversation, type ConversationState } from "@/lib/live-ai/conversation";
import { createAudioPlayback, createWebAudioSink } from "@/lib/live-ai/audio-playback";
import {
  interpretOwnerPreview,
  formatExecutionReply,
  formatVerifiedReply,
  previewGreeting,
  resolveOwnerPreviewGate,
} from "@/lib/live-ai/owner-preview";

const PREVIEW_RECONCILE_ATTEMPTS = 16;   // bounded local verification window
const PREVIEW_RECONCILE_INTERVAL_MS = 250;

export type OrbState = "idle" | "listening" | "processing" | "speaking" | "error" | "sleep";

interface LiveAiContextValue {
  enabled: boolean;
  /** V AND P — a provider/microphone turn CAN be started by explicit gesture. */
  providerEnabled: boolean;
  /** V AND owner-preview flag AND provider dormant — deterministic text-only preview owns the turn. */
  previewEnabled: boolean;
  /** The single transient owner-preview reply (replaces the previous; no history). Null when none. */
  previewReply: string | null;
  /** Dismiss the transient preview reply. */
  dismissPreviewReply: () => void;
  runtime: LiveAiRuntime | null;
  transport: LiveAiTransport | null;
  conversation: Conversation | null;
  registeredPageId: LiveAiPageId | null;
  activated: boolean;
  orbState: OrbState;
  activate: () => void;
  deactivate: () => void;
  toggle: () => void;
  /** Explicit user gesture — start a provider/microphone turn. No-op unless
   *  providerEnabled; NEVER auto-called. */
  startProvider: (mode: "text" | "microphone") => void;
  /** Explicit user gesture — submit one bounded text turn (composer). */
  submitText: (text: string) => void;
  /** Barge-in / stop. No-op unless a provider turn is live. */
  bargeIn: () => void;
  /** REV-03 — resume blocked audio on a user gesture (no-op unless providerEnabled). */
  resumeAudio: () => void;
  /** NEW-02 — true when answer audio is BLOCKED by the browser's autoplay policy and
   *  a user gesture (resumeAudio) is required to hear it. The Shell renders a bounded,
   *  operable "Tap to hear reply" control while this is true. */
  audioNeedsResume: boolean;
  /** A bridge notifies a synchronous contextRevision change so the controller can
   *  re-publish the bounded context (no-op unless providerEnabled). */
  notifyContext: () => void;
  /** Register the current page. Returns a TOKEN-GATED unregister fn that removes
   *  ONLY this exact registration (a stale/older bridge cleanup can never remove
   *  a newer registration — REV-04). No-op when disabled. */
  registerPage: (reg: Omit<PageRegistration, "routeKey">) => () => void;
}

const DISABLED_VALUE: LiveAiContextValue = {
  enabled: false,
  providerEnabled: false,
  previewEnabled: false,
  previewReply: null,
  dismissPreviewReply: () => {},
  runtime: null,
  transport: null,
  conversation: null,
  registeredPageId: null,
  activated: false,
  orbState: "sleep",
  activate: () => {},
  deactivate: () => {},
  toggle: () => {},
  startProvider: () => {},
  submitText: () => {},
  bargeIn: () => {},
  resumeAudio: () => {},
  audioNeedsResume: false,
  notifyContext: () => {},
  registerPage: () => () => {},
};

const LiveAiContext = createContext<LiveAiContextValue>(DISABLED_VALUE);

export function useLiveAi(): LiveAiContextValue {
  return useContext(LiveAiContext);
}

/**
 * Register the current supported page's bounded snapshot + resolved-command
 * executor. Always reads the LATEST getSnapshot/execute via a ref (no churn). A
 * `routeKey` change re-runs the effect (token-gated unregister + fresh register).
 * ALSO notifies the provider of a synchronous contextRevision change so the
 * (dormant unless providerEnabled) controller can re-publish the bounded context.
 * No-op when the feature is disabled.
 */
export function useLiveAiPageRegistration(
  pageId: LiveAiPageId,
  routeKey: string,
  getSnapshot: PageRegistration["getSnapshot"],
  execute: PageRegistration["execute"],
): void {
  const ctx = useContext(LiveAiContext);
  const register = ctx.registerPage;
  const enabled = ctx.enabled;
  const implRef = useRef({ getSnapshot, execute });
  implRef.current = { getSnapshot, execute };

  useEffect(() => {
    if (!enabled) return;
    const unregister = register({
      pageId,
      getSnapshot: () => implRef.current.getSnapshot(),
      execute: (cmd) => implRef.current.execute(cmd),
    });
    return unregister; // token-gated — removes ONLY this registration.
    // routeKey forces re-registration across a dynamic-segment change.
  }, [register, enabled, pageId, routeKey]);
}

/**
 * Notify the provider of a SYNCHRONOUS contextRevision change so the (dormant
 * unless providerEnabled) conversation controller can re-publish the bounded
 * context and require a fresh ACK before any new proposal. No-op when disabled.
 */
export function useLiveAiContextNotify(contextRevision: string): void {
  const { enabled, notifyContext } = useContext(LiveAiContext);
  useEffect(() => {
    if (!enabled || !contextRevision) return;
    notifyContext();
  }, [enabled, notifyContext, contextRevision]);
}

function mapOrb(state: ConversationState | null): OrbState {
  switch (state) {
    case "LISTENING": return "listening";
    case "TRANSCRIBING":
    case "THINKING":
    case "ACTING": return "processing";
    case "SPEAKING": return "speaking";
    case "ERROR": return "error";
    case "OFFLINE":
    case "DISCONNECTED":
    case null: return "sleep";
    default: return "idle";
  }
}

export function LiveAiProvider({ children }: { children: React.ReactNode }) {
  // FEATURE-OFF CONTRACT: construct NOTHING when V isn't exactly "1".
  const enabled = isLiveAiEnabled();
  const providerEnabled = useMemo(() => resolveClientGates().provider, []);
  // OWNER-PREVIEW — deterministic, provider-dormant only (fail-closed, default OFF).
  const previewEnabled = useMemo(() => resolveOwnerPreviewGate(enabled, providerEnabled), [enabled, providerEnabled]);

  const runtimeRef = useRef<LiveAiRuntime | null>(null);
  const transportRef = useRef<LiveAiTransport | null>(null);
  const conversationRef = useRef<Conversation | null>(null);
  // V=1 → runtime + a FAIL-CLOSED null transport (01A). The provider-capable
  // gateway transport + controller are constructed lazily in a browser effect.
  if (enabled && !runtimeRef.current) {
    runtimeRef.current = createLiveAiRuntime("anonymous");
    transportRef.current = createNullTransport();
  }
  const runtime = runtimeRef.current;

  const pathname = usePathname();
  const pathRef = useRef<string>(pathname || "");
  pathRef.current = pathname || "";

  const [registeredPageId, setRegisteredPageId] = useState<LiveAiPageId | null>(null);
  const [activated, setActivated] = useState(false);
  const [convState, setConvState] = useState<ConversationState | null>(null);
  // NEW-02 — reactive mirror of the controller's blocked-audio flag for the Shell.
  const [audioNeedsResume, setAudioNeedsResume] = useState(false);
  // OWNER-PREVIEW — the single transient reply + a lightweight processing flag + a bounded reconcile poller.
  const [previewReply, setPreviewReply] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewTurnRef = useRef(0);
  // R2-03 — SINGLE cancellable start owner: at most ONE start() may be in flight. A
  // second start gesture while one is pending (or a turn is live) is a no-op, so a
  // double-tap can never open two sessions/sockets. Reset on teardown.
  const startInFlightRef = useRef(false);

  // Role projection — presence of a customer session key ONLY (never its value).
  useEffect(() => {
    if (!enabled || !runtime) return;
    const applyRole = () => {
      let role: LiveAiRole = "anonymous";
      try {
        if (typeof window !== "undefined" && window.localStorage.getItem("sb_token")) role = "customer";
      } catch { role = "anonymous"; }
      runtime.setRole(role);
    };
    applyRole();
    const onStorage = (e: StorageEvent) => { if (e.key === "sb_token") applyRole(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, runtime]);

  // REV-04 — text turns submitted before the transport is connected are buffered here
  // and flushed once the controller reaches IDLE (connected + acked); the first text
  // turn thus safely STARTS the transport instead of being silently dropped.
  const pendingTextRef = useRef<string | null>(null);

  // V=1,P=1 → lazily construct the gateway transport (WITH the browser mic media
  // adapter — REV-03) + conversation controller (browser only). Nothing starts here:
  // the media adapter requests NO microphone until an explicit mic gesture calls
  // start("microphone"); only an explicit gesture begins a turn.
  useEffect(() => {
    if (!enabled || !providerEnabled || !runtime) return;
    if (conversationRef.current) return;
    if (typeof window === "undefined") return;
    const sink = createWebAudioSink();
    if (!sink) return;
    // The mic media adapter surfaces final STT transcripts as text turns (STT →
    // reasoning). It reads conversationRef at call time, so the late binding is fine.
    // R4-R2-NEW-02 — bind captured speech to the live conversation generation: a transcript
    // committed under an older generation (route change / barge-in / reset) is dropped by the
    // gate and never becomes a new turn under a different route/context.
    // R4-03 — pass a media FACTORY (not a shared object): the transport mints a FRESH media
    // session per start(), so an old (superseded) start can never close a newer start's mic /
    // peer / data channel. A start that returns null ⇒ mic unavailable (fails closed).
    const transport = createGatewayTransport({
      createMediaSession: () => createBrowserMedia({
        onFinalTranscript: (t) => { try { conversationRef.current?.submitText(t); } catch { /* no-op */ } },
        currentGeneration: () => { try { return conversationRef.current?.getGeneration() ?? 0; } catch { return 0; } },
      }),
    });
    transportRef.current = transport;
    const conv = createConversation({
      runtime,
      transport,
      audio: createAudioPlayback({ sink }),
      onEvent: (ev) => {
        if (ev.type === "state") {
          setConvState(ev.state);
          // REV-04 — flush a buffered first-text turn once connected + acked.
          if (ev.state === "IDLE" && pendingTextRef.current) {
            const t = pendingTextRef.current; pendingTextRef.current = null;
            try { conversationRef.current?.submitText(t); } catch { /* no-op */ }
          }
        }
      },
    });
    conversationRef.current = conv;
    setConvState(conv.getState());
    // R5C — BACKGROUND + PAGEHIDE capture shutdown. When the tab is hidden or the page
    // is being unloaded / frozen into the bfcache, END the conversation so the transport
    // tears the mic down and FINALIZES the active capture lease (charging the actual
    // elapsed against the cumulative allowance). Registered ONLY inside this V=1,P=1
    // effect (no listener when the gates are off) and removed on cleanup. A later
    // visibility RESTORE never auto-starts capture — resuming stays an explicit gesture.
    const onHiddenShutdown = () => { try { conversationRef.current?.end("user"); } catch { /* no-op */ } };
    const onVisibilityChange = () => { try { if (typeof document !== "undefined" && document.visibilityState === "hidden") onHiddenShutdown(); } catch { /* no-op */ } };
    try { document.addEventListener("visibilitychange", onVisibilityChange); } catch { /* no-op */ }
    try { window.addEventListener("pagehide", onHiddenShutdown); } catch { /* no-op */ }
    // REV-04 — a single owned reconciliation/timeout clock drives catalogue
    // reconciliation + session/idle teardown; cleaned up with the controller.
    const tickTimer = setInterval(() => { try { conversationRef.current?.tick(); } catch { /* no-op */ } }, 5_000);
    // NEW-02 — poll the blocked-audio flag into React state so the Shell can offer a
    // "tap to hear reply" control the moment a chunk is buffered behind autoplay.
    const resumeTimer = setInterval(() => {
      try { setAudioNeedsResume(!!conversationRef.current?.audioNeedsResume()); } catch { /* no-op */ }
    }, 800);
    return () => {
      clearInterval(tickTimer);
      clearInterval(resumeTimer);
      // R5C — remove the background/pagehide capture-shutdown listeners with the controller.
      try { document.removeEventListener("visibilitychange", onVisibilityChange); } catch { /* no-op */ }
      try { window.removeEventListener("pagehide", onHiddenShutdown); } catch { /* no-op */ }
      pendingTextRef.current = null;
      startInFlightRef.current = false;
      setAudioNeedsResume(false);
      // R2-04 — disposing the controller now ALSO closes the transport (socket + media
      // + any in-flight broker fetch), so an unmount leaves nothing live.
      try { conv.dispose(); } catch { /* no-op */ }
      conversationRef.current = null;
    };
  }, [enabled, providerEnabled, runtime]);

  // ROUTE EPOCH — a pathname change invalidates old page authority + pending work;
  // the registration is KEPT only when it already belongs to the new route.
  // When a controller exists it is then notified (new generation + re-publish).
  useEffect(() => {
    if (!enabled || !runtime) return;
    runtime.invalidateRoute(pathRef.current);
    setRegisteredPageId(runtime.getRegisteredPageId());
    try { conversationRef.current?.onRouteChange(); } catch { /* no-op */ }
    // OWNER-PREVIEW — the runtime session survives the route change, but old page ACTION authority does not:
    // supersede any in-flight reconcile poll and drop the stale transient reply (a fresh turn re-verifies).
    previewTurnRef.current += 1;
    if (previewTimerRef.current) { clearInterval(previewTimerRef.current); previewTimerRef.current = null; }
    setPreviewBusy(false);
    setPreviewReply(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, runtime, pathname]);

  const registerPage = useCallback<LiveAiContextValue["registerPage"]>(
    (reg) => {
      if (!enabled || !runtime) return () => {};
      const token = runtime.registerPage({ ...reg, routeKey: pathRef.current });
      setRegisteredPageId(runtime.getRegisteredPageId());
      return () => {
        runtime.unregisterPage(token);
        setRegisteredPageId(runtime.getRegisteredPageId());
      };
    },
    [enabled, runtime],
  );

  // ── OWNER-PREVIEW helpers (declared before activate/deactivate/toggle that reference them) ──
  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) { clearInterval(previewTimerRef.current); previewTimerRef.current = null; }
  }, []);
  const dismissPreviewReply = useCallback(() => { setPreviewReply(null); }, []);

  const activate = useCallback(() => {
    if (!enabled || !runtime) return;
    runtime.activate();
    setActivated(true);
    runtime.greet();
    // OWNER-PREVIEW — a context-aware greeting bubble on the explicit orb tap (no auto-send).
    if (previewEnabled) { setPreviewReply(previewGreeting(runtime.publishedContext())); }
  }, [enabled, runtime, previewEnabled]);

  const deactivate = useCallback(() => {
    if (!enabled || !runtime) return;
    runtime.deactivate();
    setActivated(false);
    pendingTextRef.current = null;
    startInFlightRef.current = false;      // R2-03 — release the start owner
    setAudioNeedsResume(false);            // NEW-02 — no blocked audio after teardown
    clearPreviewTimer(); setPreviewBusy(false); setPreviewReply(null);   // OWNER-PREVIEW — clear on teardown
    // R2-04 — end() closes the transport (socket + media + in-flight broker fetch).
    try { conversationRef.current?.end("user"); } catch { /* no-op */ }
  }, [enabled, runtime, clearPreviewTimer]);

  const toggle = useCallback(() => {
    if (!enabled || !runtime) return;
    if (runtime.isActivated()) {
      // REV-04 — deactivation routes through ONE teardown: end the transport/media/
      // audio so no session survives an orb deactivation.
      runtime.deactivate();
      setActivated(false);
      pendingTextRef.current = null;
      startInFlightRef.current = false;    // R2-03 — release the start owner
      setAudioNeedsResume(false);          // NEW-02 — clear blocked-audio state
      clearPreviewTimer(); setPreviewBusy(false); setPreviewReply(null);   // OWNER-PREVIEW — clear on teardown
      try { conversationRef.current?.end("user"); } catch { /* no-op */ }
    } else {
      runtime.activate(); setActivated(true); runtime.greet();
      if (previewEnabled) { setPreviewReply(previewGreeting(runtime.publishedContext())); }
    }
  }, [enabled, runtime, previewEnabled, clearPreviewTimer]);

  // R2-03/R3-03 — the SINGLE cancellable start owner. Returns true iff it actually
  // initiated a start. A start already in flight, or an already-live/connecting session,
  // is refused — a double gesture can never open two sessions/sockets. R3-03 — a provider
  // turn is started ONLY from DISCONNECTED: from a terminal ERROR/OFFLINE the controller
  // is RESET FIRST (end → DISCONNECTED) so the transport's single-start owner is free,
  // then started; any live/connecting state is refused outright.
  const beginStart = useCallback((mode: "text" | "microphone"): boolean => {
    const conv = conversationRef.current;
    if (!conv) return false;
    if (startInFlightRef.current) return false; // a start is already in flight
    let st = conv.getState();
    if (st === "ERROR" || st === "OFFLINE") {
      // reset the prior terminal session before starting a fresh one (DISCONNECTED-only).
      try { conv.end("user"); } catch { /* no-op */ }
      st = conv.getState();
    }
    if (st !== "DISCONNECTED") return false; // already live/connecting (or not yet reset) → refuse
    startInFlightRef.current = true;
    Promise.resolve(conv.start(mode)).catch(() => {}).finally(() => { startInFlightRef.current = false; });
    return true;
  }, []);

  const startProvider = useCallback((mode: "text" | "microphone") => {
    if (!enabled || !providerEnabled) return;
    const conv = conversationRef.current;
    if (!conv) return;
    setActivated(true);
    try { conv.resumeAudio(); } catch { /* no-op */ } // REV-03 — resume on the gesture
    beginStart(mode); // R2-03 — single-owner; a duplicate concurrent start is a no-op
  }, [enabled, providerEnabled, beginStart]);

  /**
   * Drive ONE deterministic preview turn through the EXISTING runtime authorities:
   *   beginTurn → interpret → makeEnvelope → execute → (APPLY) reconcile.
   * Never constructs a socket/gateway/mic and never calls a hotel setter/router directly (execute dispatches to
   * the registered page bridge, the ONLY UI execution adapter). Reply is built ONLY from runtime output.
   */
  const runPreview = useCallback((raw: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearPreviewTimer();
    const myTurn = ++previewTurnRef.current;   // supersede any in-flight reconcile poll
    if (!runtime.isActivated()) { runtime.activate(); setActivated(true); }

    const ctx = runtime.publishedContext();
    const outcome = interpretOwnerPreview(raw, ctx);
    if (outcome.kind === "info" || outcome.kind === "unavailable") {
      setPreviewBusy(false);
      setPreviewReply(outcome.message);
      return;
    }

    // Resolve an OPEN label from the pre-navigation list context (never from free text).
    let openLabel: string | undefined;
    if (outcome.operation.op === "OPEN_VISIBLE_HOTEL" && ctx && ctx.pageId === "hotels") {
      const row = ctx.visibleHotels.find((h) => h.position === (outcome.operation as { position: number }).position);
      if (row) openLabel = row.name;
    }

    const turnId = runtime.beginTurn(raw);
    const env = runtime.makeEnvelope(outcome.operation, turnId);
    if (!env) { setPreviewBusy(false); setPreviewReply("I can't do that on this screen right now."); return; }
    const result = runtime.execute(env);

    if (outcome.operation.op === "APPLY_HOTEL_REFINEMENT") {
      if (!result.ok) { setPreviewBusy(false); setPreviewReply(formatExecutionReply(result)); return; }
      // §10 — do NOT claim success on the setter running; wait for the page's resolved receipt + a verifying
      // reconcile within a bounded window, else a neutral retry (never fake success).
      setPreviewBusy(true);
      setPreviewReply("Applying…");
      let attempts = 0;
      previewTimerRef.current = setInterval(() => {
        if (previewTurnRef.current !== myTurn) { clearPreviewTimer(); return; }
        attempts += 1;
        let verified = null as ReturnType<typeof runtime.reconcile>;
        try { verified = runtime.reconcile(); } catch { verified = null; }
        const speech = formatVerifiedReply(verified);
        if (speech) { clearPreviewTimer(); setPreviewBusy(false); setPreviewReply(speech); return; }
        if (attempts >= PREVIEW_RECONCILE_ATTEMPTS) {
          clearPreviewTimer(); setPreviewBusy(false);
          setPreviewReply("Couldn't confirm the update — please try again.");
        }
      }, PREVIEW_RECONCILE_INTERVAL_MS);
      return;
    }

    setPreviewBusy(false);
    const op = outcome.operation;
    const section = op.op === "SHOW_HOTEL_SECTION" ? op.section : undefined;
    setPreviewReply(formatExecutionReply(result, { factsFocus: outcome.factsFocus, openLabel, section }));
  }, [clearPreviewTimer]);

  const submitText = useCallback((text: string) => {
    if (!enabled) return;
    // OWNER-PREVIEW owns the turn when the provider is dormant + the flag is on (exactly one controller).
    if (previewEnabled) { runPreview(text); return; }
    if (!providerEnabled) return;
    const conv = conversationRef.current;
    if (!conv) return;
    try { conv.resumeAudio(); } catch { /* no-op */ } // REV-03 — resume on the gesture
    setActivated(true);
    const state = conv.getState();
    if (state === "DISCONNECTED" || state === "OFFLINE" || state === "ERROR") {
      // REV-04 — connect on first text, then deliver it once IDLE (buffered). R2-03 —
      // if a start is already in flight the text is still buffered and flushed on IDLE.
      pendingTextRef.current = text;
      beginStart("text");
      return;
    }
    conv.submitText(text);
  }, [enabled, providerEnabled, previewEnabled, runPreview, beginStart]);

  const bargeIn = useCallback(() => {
    if (!enabled || !providerEnabled) return;
    conversationRef.current?.bargeIn();
  }, [enabled, providerEnabled]);

  const notifyContext = useCallback(() => {
    if (!enabled || !providerEnabled) return;
    // REV-09 — drive re-publish + reconciliation + detail-context verification.
    conversationRef.current?.notifyContext();
  }, [enabled, providerEnabled]);

  const resumeAudio = useCallback(() => {
    if (!enabled || !providerEnabled) return;
    conversationRef.current?.resumeAudio();
    // NEW-02 — reflect the post-resume state promptly (the poll also reconciles it).
    try { setAudioNeedsResume(!!conversationRef.current?.audioNeedsResume()); } catch { /* no-op */ }
  }, [enabled, providerEnabled]);

  const orbState: OrbState = providerEnabled
    ? (activated ? mapOrb(convState) : "sleep")
    : previewEnabled
      ? (activated ? (previewBusy ? "processing" : "idle") : "sleep")
      : (activated ? "idle" : "sleep");

  const value = useMemo<LiveAiContextValue>(
    () => ({
      enabled,
      providerEnabled,
      previewEnabled,
      previewReply,
      dismissPreviewReply,
      runtime,
      transport: transportRef.current,
      conversation: conversationRef.current,
      registeredPageId,
      activated,
      orbState,
      activate,
      deactivate,
      toggle,
      startProvider,
      submitText,
      bargeIn,
      resumeAudio,
      audioNeedsResume,
      notifyContext,
      registerPage,
    }),
    [enabled, providerEnabled, previewEnabled, previewReply, dismissPreviewReply, runtime, registeredPageId, activated, orbState, convState, audioNeedsResume, activate, deactivate, toggle, startProvider, submitText, bargeIn, resumeAudio, notifyContext, registerPage],
  );

  return <LiveAiContext.Provider value={enabled ? value : DISABLED_VALUE}>{children}</LiveAiContext.Provider>;
}

export { LiveAiContext };
