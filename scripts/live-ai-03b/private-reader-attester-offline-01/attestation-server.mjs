// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — ATTESTER: authenticated ATTESTATION CHANNEL SERVER (OFFLINE). Node built-ins only.
//
// Serves the EXACT accepted `reader-attestation-channel-v1` the reader host's adapter speaks: one
// newline-terminated JSON request per connection, HMAC-SHA256 over v⏎op⏎JSON(args)⏎nonce⏎ts with the
// dedicated channel secret, a ±30 s freshness window, a single-use nonce, the single approved "attest"
// operation, exact args, and one JSON response — {ok:true, envelope} or {ok:false, code} with a fixed code.
//
// A valid HMAC authorizes ONLY a request for independently measured evidence about the named connection.
// It selects no SQL, no table, no role, no target and no payload field; it cannot supply a key or a
// privilege claim. Evidence is measured per request (no cached proof) through the bounded observer
// coordinator, and a signature is produced only when the measured state is clean AND the request is still live.
//
// REQUEST-LIFECYCLE CONTAINMENT (v3): request AUTHORITY and computation LIFETIME are ONE bounded lifecycle.
//   • ONE absolute request context is created when a connection is accepted and threaded through auth →
//     observer coordinator (queue, open, evidence) → the PRE-SIGN authority gate → response.
//   • Its budget (ATTESTER_REQUEST_BUDGET_MS) is strictly below the accepted caller's immutable total channel
//     timeout (CHANNEL_TOTAL_TIMEOUT_MS = 4000 ms), leaving a response/network margin — asserted at load.
//   • The request deadline (or a caller disconnect — the accepted caller destroys its socket at 4 s) CANCELS
//     the context. An expired/cancelled request never enters the queue, opens a connection, runs evidence,
//     reaches `signer.issue`, increments `signed`, or emits a proof. `signed` rises ONLY after a successful
//     signature for a request that is still live at that instant. Dropping a late RESPONSE is not enough —
//     the context stops the WORK.
//   • Shutdown is bounded: stop admitting, destroy sockets (which cancels their in-flight contexts), drain/
//     contain the coordinator within a deadline, close the listener.
//
// Replay protection is in-memory and bounded, so this service must run as a SINGLE replica; the deployment
// contract states that constraint rather than claiming protection it does not have.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ATTESTATION_CHANNEL_VERSION, ATTESTATION_CHANNEL_OP, CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, MIN_CHANNEL_SECRET_LEN, CHANNEL_TOTAL_TIMEOUT_MS, CHANNEL_CONNECT_TIMEOUT_MS } from "../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { ATTESTATION_CONTRACT } from "../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { PRIVATE_RANGES } from "../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { READER_ROLE } from "./evidence-queries.mjs";
import { evidenceIsAttestable } from "./evidence-evaluator.mjs";
import { createObserverCoordinator, makeRequestContext } from "./observer-connection.mjs";
import { resolveTarget } from "./target-binding.mjs";

// The ONLY permitted caller (the accepted reader-host adapter) starts its total-timeout timer at OUTBOUND
// CONNECT, not at the attester's accept — and that total window (CHANNEL_TOTAL_TIMEOUT_MS = 4000 ms) already
// includes the connection phase (up to CHANNEL_CONNECT_TIMEOUT_MS = 1500 ms). The two clocks therefore do NOT
// start together: by the time the attester accepts, the caller has already spent its connection phase. So the
// attester's per-request budget (measured from accept) must fit inside the caller's WORST-CASE remaining
// lifetime = total − connect, minus a response/scheduling margin. A connection that is established did so
// before the connect timeout fired, so remaining-at-accept > total − connect; a budget ≤ total − connect −
// margin therefore loses signing authority strictly before the caller can legitimately expire.
export const ATTESTER_CALLER_TOTAL_TIMEOUT_MS = CHANNEL_TOTAL_TIMEOUT_MS;     // 4000 (accepted, immutable — imported)
export const ATTESTER_CALLER_CONNECT_TIMEOUT_MS = CHANNEL_CONNECT_TIMEOUT_MS; // 1500 (accepted, immutable — imported)
export const ATTESTER_RESPONSE_MARGIN_MS = 600;                              // reserved for response write + network + scheduling
// Caller-safe absolute request budget (from accept): total − connect allowance − response margin.
export const ATTESTER_REQUEST_BUDGET_MS = ATTESTER_CALLER_TOTAL_TIMEOUT_MS - ATTESTER_CALLER_CONNECT_TIMEOUT_MS - ATTESTER_RESPONSE_MARGIN_MS; // 1900
export const ATTESTER_READ_DEADLINE_MS = 800;      // the request newline must fully arrive within this window
export const ATTESTER_MAX_CONCURRENT = 4;          // bounded outstanding channel requests
export const ATTESTER_SHUTDOWN_DEADLINE_MS = 3000; // bounded drain/containment on close
export const CLOCK_SKEW_MS = 30000;
export const NONCE_TTL_MS = 120000;
export const MAX_TRACKED_NONCES = 4096;
export const SINGLE_REPLICA_REQUIRED = true;       // in-memory replay state — see DEPLOYMENT-CONTRACT.md
// Fail-closed invariant (accounts for the different timer origins): budget + margin + connect allowance must
// fit within the accepted caller's total lifetime. If the accepted caller constants change to make this
// unsatisfiable, the module refuses to load rather than run an unsafe (caller-outliving) configuration.
if (!(ATTESTER_REQUEST_BUDGET_MS > 0 && ATTESTER_REQUEST_BUDGET_MS + ATTESTER_RESPONSE_MARGIN_MS + ATTESTER_CALLER_CONNECT_TIMEOUT_MS <= ATTESTER_CALLER_TOTAL_TIMEOUT_MS)) {
  throw new Error("attester_request_budget_unsafe_vs_caller_timeline");
}
const HEX64 = /^[0-9a-f]{64}$/, HEX32 = /^[0-9a-f]{32}$/;

function ipType(a) { const v = net.isIP(a); return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null; }
function normPeer(a) { if (typeof a !== "string") return null; const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); return m ? m[1] : a; }
function buildPeerAllow(cidrs, { offlineTestBoundary }) {
  const bl = new net.BlockList();
  for (const c of cidrs) {
    const m = typeof c === "string" ? /^([^/]+)\/(\d{1,3})$/.exec(c) : null;
    if (!m) return null;
    const addr = m[1], prefix = Number(m[2]), t = ipType(addr);
    if (!t || !Number.isInteger(prefix) || prefix < 0 || prefix > (t === "ipv4" ? 32 : 128)) return null;
    const loop = addr === "::1" || /^127\./.test(addr);
    if (loop) { if (!offlineTestBoundary) return null; }
    else {
      const r = PRIVATE_RANGES.find((x) => { if (x.type !== t) return false; const b2 = new net.BlockList(); b2.addSubnet(x.net, x.prefix, x.type); return b2.check(addr, t); });
      if (!r || prefix < r.prefix) return null;   // public or over-broad
    }
    bl.addSubnet(addr, prefix, t);
  }
  return bl;
}

// session-identity failures for the requested token map to no_such_session; everything else (observer
// unavailable/deadline/busy, expired/cancelled request) maps to a generic fixed code — never a signature.
function codeForReason(reason) {
  if (reason === "observer_busy") return "busy";
  if (reason === "no_such_session" || reason === "no_reader_session_observed" || reason === "ambiguous_session") return "no_such_session";
  return "unavailable";
}

/**
 * Start the attestation channel server.
 * @param deps.observerProvider async () → { ok:true, observer } — opens + fully validates a least-privilege
 *   observer session. Wrapped by the bounded, lifecycle-aware coordinator.
 * @param deps.signer from createSigningAdapter()
 * @param deps.anchor parsed deployment anchor (required; no anchor ⇒ no signature)
 */
export async function startAttestationServer(opts) {
  const { channelSecret, listen, observerProvider, signer, anchor, nowProvider = Date.now, log, offlineTestBoundary = false } = opts;
  if (typeof channelSecret !== "string" || channelSecret.length < MIN_CHANNEL_SECRET_LEN) throw new Error("attester_channel_secret_invalid");
  if (!signer || typeof signer.issue !== "function") throw new Error("attester_signer_absent");
  if (!anchor) throw new Error("attester_anchor_absent");
  if (typeof observerProvider !== "function") throw new Error("attester_observer_absent");
  const wildcard = listen.bindHost === "::" || listen.bindHost === "0.0.0.0";
  if (wildcard && listen.allowWildcardBind !== true) throw new Error("attester_wildcard_bind_not_acknowledged");
  const peerAllow = buildPeerAllow(listen.allowedPeerCidrs || [], { offlineTestBoundary });
  if (!peerAllow) throw new Error("attester_peer_allowlist_invalid");
  // TEST-ONLY: a smaller absolute request budget for deterministic lifecycle probes. Production uses the
  // caller-derived 3400 ms; injection is refused unless the offline test boundary is explicit.
  const requestBudgetMs = (offlineTestBoundary && Number.isInteger(opts.requestBudgetMs) && opts.requestBudgetMs > 0) ? opts.requestBudgetMs : ATTESTER_REQUEST_BUDGET_MS;

  const coordinator = createObserverCoordinator({ provider: observerProvider, nowProvider });
  const nonces = new Map(); const inflight = new Set(); const sockets = new Set();
  let seq = 0, closing = false;
  const counters = { requests: 0, signed: 0, refused: 0, deadlined: 0, cancelled: 0 };

  function sweep(now) {
    for (const [k, exp] of nonces) if (exp <= now) nonces.delete(k);
    if (nonces.size > MAX_TRACKED_NONCES) { const drop = nonces.size - MAX_TRACKED_NONCES; let i = 0; for (const k of nonces.keys()) { if (i++ >= drop) break; nonces.delete(k); } }
  }
  function macFor(v, op, args, nonce, ts) { return createHmac("sha256", channelSecret).update([v, op, JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex"); }
  function macOk(mac, expected) {
    if (typeof mac !== "string" || mac.length !== 64) return false;
    try { return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex")); } catch { return false; }
  }

  async function handle(line, ctx, peerAlive) {
    counters.requests++;
    let req; try { req = JSON.parse(line); } catch { return { ok: false, code: "bad_request" }; }
    if (!req || typeof req !== "object" || Array.isArray(req)) return { ok: false, code: "bad_request" };
    if (req.v !== ATTESTATION_CHANNEL_VERSION) return { ok: false, code: "unsupported_version" };
    if (req.op !== ATTESTATION_CHANNEL_OP) return { ok: false, code: "unknown_op" };
    const { args, nonce, ts, mac } = req;
    if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) return { ok: false, code: "bad_request" };
    if (typeof ts !== "number" || !Number.isFinite(ts)) return { ok: false, code: "bad_request" };
    if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, code: "bad_request" };
    const now = nowProvider();
    if (Math.abs(now - ts) > CLOCK_SKEW_MS) return { ok: false, code: "stale" };
    if (!macOk(mac, macFor(req.v, req.op, args, nonce, ts))) return { ok: false, code: "unauthenticated" };
    // CALLER-TIMELINE TIGHTENING (ts is now HMAC-authenticated). The accepted caller starts its total-timeout
    // timer at its own connect (≈ ts, set just before it dials), NOT at the attester's accept — and the accept
    // callback can be deferred beyond the connect timeout by a busy event loop or accept backlog, so an
    // accept-anchored budget alone can outlive the caller. Tighten the request context to the caller's OWN
    // remaining lifetime = total − elapsed-since-ts − response margin. `max(0, …)` means a caller whose clock
    // runs ahead (negative elapsed) never EXTENDS the window (it falls back to the accept-anchored budget); the
    // tighten can only ever SHORTEN it, so it strictly improves caller-safety and cannot be abused to keep
    // authority longer. A caller already past its safe window yields callerRemaining ≤ 0 ⇒ the ctx.live() gate
    // below refuses it with no observer work and no signature.
    ctx.tightenRemaining(ATTESTER_CALLER_TOTAL_TIMEOUT_MS - Math.max(0, now - ts) - ATTESTER_RESPONSE_MARGIN_MS);
    sweep(now);
    if (nonces.has(nonce)) return { ok: false, code: "replayed" };
    nonces.set(nonce, now + NONCE_TTL_MS);
    // exact args — nothing else is accepted, so no field can widen what is attested
    if (Object.keys(args).sort().join(",") !== "connectionToken,contract,requestNonce,role") return { ok: false, code: "bad_request" };
    if (args.contract !== ATTESTATION_CONTRACT || args.role !== READER_ROLE) return { ok: false, code: "bad_request" };
    if (!HEX64.test(args.connectionToken) || !HEX32.test(args.requestNonce)) return { ok: false, code: "bad_request" };
    if (closing) return { ok: false, code: "unavailable" };
    if (!ctx.live()) { counters.cancelled++; return { ok: false, code: "unavailable" }; }   // expired/abandoned before any work
    if (inflight.size >= ATTESTER_MAX_CONCURRENT) return { ok: false, code: "busy" };

    const id = ++seq; inflight.add(id);
    try {
      const obs = await coordinator.observe(args.connectionToken, { nowProvider, context: ctx });  // bounded, contained, lifecycle-aware
      if (!obs.ok) { counters.refused++; if (obs.reason === "request_expired") counters.cancelled++; return { ok: false, code: codeForReason(obs.reason) }; }
      if (!ctx.live()) { counters.refused++; counters.cancelled++; return { ok: false, code: "unavailable" }; }  // expired during evidence
      const clean = evidenceIsAttestable(obs.evidence);
      if (!clean.ok) { counters.refused++; return { ok: false, code: "unavailable" }; }   // never sign adverse state
      const tgt = resolveTarget(anchor, obs.evidence.cluster);
      if (!tgt.ok) { counters.refused++; return { ok: false, code: "unavailable" }; }
      // ── PRE-SIGN AUTHORITY GATE: recheck the request is still live immediately before issuing ──
      if (!ctx.live()) { counters.refused++; counters.cancelled++; return { ok: false, code: "unavailable" }; }
      // Supplementary delivery-boundary guard (defence-in-depth): if the caller's socket is already gone
      // (its close/RST was processed before this synchronous point), the caller has abandoned the request —
      // do not mint a proof it can never receive. Synchronous, so it catches the case where 'close' won the
      // race against the observation result even though the 'close' macrotask has not run ctx.cancel yet.
      if (typeof peerAlive === "function" && !peerAlive()) { counters.refused++; counters.cancelled++; ctx.cancel("caller_gone"); return { ok: false, code: "unavailable" }; }
      const issued = signer.issue({ requestNonce: args.requestNonce, target: tgt.target, connection: obs.evidence.connection, privileges: obs.evidence.privileges });
      if (!issued.ok) { counters.refused++; return { ok: false, code: "internal" }; }
      // signed rises ONLY after a valid signature for a request that is STILL live at this instant
      if (!ctx.live()) { counters.refused++; counters.cancelled++; return { ok: false, code: "unavailable" }; }
      counters.signed++;
      return { ok: true, envelope: issued.envelope };
    } catch { return { ok: false, code: "internal" }; }
    finally { inflight.delete(id); }
  }

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf = ""; let settled = false; let reading = true;
    // ONE absolute request context per connection, created at accept (≈ the caller's connect). It is the single
    // source of truth for "still authorised", threaded into handle()/the coordinator, and cancelled by the
    // request deadline, the read deadline, or a caller disconnect before the response.
    const ctx = makeRequestContext(requestBudgetMs);
    sock.on("close", () => { sockets.delete(sock); if (!settled) { counters.cancelled++; ctx.cancel("caller_disconnect"); } });
    sock.on("error", () => {});
    const peer = normPeer(sock.remoteAddress); const t = peer ? ipType(peer) : null;
    if (!t || !peerAllow.check(peer, t)) { settled = true; try { sock.end(JSON.stringify({ ok: false, code: "unauthenticated" }) + "\n"); } catch {} return; }
    sock.setEncoding("utf8");
    const finish = (res) => {
      if (settled) return; settled = true;
      clearTimeout(readTimer); clearTimeout(totalTimer);
      let s = JSON.stringify(res);
      if (Buffer.byteLength(s, "utf8") > CHANNEL_MAX_RESPONSE_BYTES) s = JSON.stringify({ ok: false, code: "internal" });
      try { sock.end(s + "\n"); } catch {}
    };
    // The request deadline cancels the CONTEXT (stops the work), not just the response. It is never cleared at
    // the newline; a shorter read-phase deadline bounds the read alone.
    const totalTimer = setTimeout(() => { ctx.cancel("request_deadline"); counters.deadlined++; finish({ ok: false, code: "unavailable" }); }, requestBudgetMs);
    const readTimer = setTimeout(() => { if (reading) { ctx.cancel("read_deadline"); counters.deadlined++; finish({ ok: false, code: "unavailable" }); } }, Math.min(ATTESTER_READ_DEADLINE_MS, requestBudgetMs));
    sock.on("data", (chunk) => {
      if (settled || !reading) return;
      buf += chunk;
      if (Buffer.byteLength(buf, "utf8") > CHANNEL_MAX_REQUEST_BYTES) { finish({ ok: false, code: "bad_request" }); return; }
      const nl = buf.indexOf("\n"); if (nl < 0) return;
      reading = false; clearTimeout(readTimer);           // read phase done; the request context deadline stays armed
      const started = performance.now();
      void handle(buf.slice(0, nl), ctx, () => !sock.destroyed).then((res) => {
        (log || (() => {}))(JSON.stringify({ attester: "attestation-request", ok: res.ok === true, code: res.ok ? undefined : res.code, ms: Math.round(performance.now() - started) }));
        finish(res);
      }, () => finish({ ok: false, code: "internal" }));
    });
  });

  return await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("attester_listen_failed")));
    server.listen({ host: listen.bindHost, port: listen.port }, () => {
      const a = server.address();
      resolve(Object.freeze({
        address: { host: a.address, port: a.port },
        stats() { return { ...counters, inflight: inflight.size, trackedNonces: nonces.size, observer: coordinator.stats() }; },
        // Bounded shutdown: stop admitting, destroy sockets (which cancels their in-flight request contexts),
        // drain/contain the coordinator within a deadline, close the listener — never an unbounded wait.
        async close({ deadlineMs = ATTESTER_SHUTDOWN_DEADLINE_MS } = {}) {
          closing = true;
          for (const s of sockets) { try { s.destroy(); } catch {} }
          try { await Promise.race([coordinator.shutdown({ deadlineMs }), new Promise((r) => setTimeout(r, deadlineMs))]); } catch {}
          await new Promise((r) => { let done = false; const to = setTimeout(() => { if (!done) { done = true; r(true); } }, 1000); try { server.close(() => { if (!done) { done = true; clearTimeout(to); r(true); } }); } catch { if (!done) { done = true; clearTimeout(to); r(true); } } });
          return true;
        },
      }));
    });
  });
}
