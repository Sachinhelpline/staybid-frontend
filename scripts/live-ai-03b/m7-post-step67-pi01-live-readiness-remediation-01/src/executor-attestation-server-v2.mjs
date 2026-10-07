// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Executor Attestation V2 authenticated CHANNEL SERVER. OFFLINE.
//
// Mirrors the reviewed V1 executor channel server's containment 1:1 (freshness ±30 s + single-use nonce + HMAC,
// private peer allowlist, absolute request context, caller-timeline tightening, pre-sign gate, bounded concurrency
// and shutdown, fixed wire codes, in-memory replay state ⇒ SINGLE replica) and swaps ONLY the attestation plane to
// the frozen R3 V2 modules:
//   • protocol `executor-attestation-channel-v2` / op `attest-executor-v2`; contract arg must be
//     AiStagingExecutorAttestationV2 (V1 framing ⇒ unsupported_version; V1 contract ⇒ bad_request);
//   • measurement = measureExecutorEvidenceV2 through the bounded V2 coordinator; target = Owner anchor only;
//   • issuance = the frozen R3 createExecutorAttesterIssuerV2 (observer seam → frozen evaluateObservedExecutorEvidenceV2
//     → frozen createExecutorSigningAdapterV2, issuer staybid.live-ai-03b.executor-attester.v2, fixed);
//   • CONFORMANCE GATE: every envelope is re-verified with the frozen R3 verifyExecutorAttestationV2 against this
//     issuer's own public trust root, the requested token and nonce, before release.
// A signature the frozen V2 verifier would not accept is never emitted; an adverse/uncertain state is never signed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { MIN_CHANNEL_SECRET_LEN } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { PRIVATE_RANGES } from "../../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT_V2, EXECUTOR_ATTESTATION_ISSUER_V2, EXECUTOR_ROLE, verifyExecutorAttestationV2 }
  from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { createExecutorAttesterIssuerV2, EXECUTOR_OBSERVER_ADAPTER_CONTRACT_V2 }
  from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attester-issuer-v2.mjs";
import { EXECUTOR_CHANNEL_VERSION_V2, EXECUTOR_CHANNEL_OP_V2, EXECUTOR_CHANNEL_ARG_KEYS_V2, WIRE_CODES_V2, executorChannelMacV2,
  CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, CHANNEL_TOTAL_TIMEOUT_MS, CHANNEL_CONNECT_TIMEOUT_MS } from "./executor-attestation-channel-v2.mjs";
import { createExecutorObserverCoordinatorV2, makeRequestContext } from "./executor-observer-v2.mjs";
import { toPolicyEvidenceV2 } from "./executor-evidence-evaluator-v2.mjs";

export { WIRE_CODES_V2 };
export const CALLER_TOTAL_TIMEOUT_MS = CHANNEL_TOTAL_TIMEOUT_MS;
export const CALLER_CONNECT_TIMEOUT_MS = CHANNEL_CONNECT_TIMEOUT_MS;
export const RESPONSE_MARGIN_MS = 600;
export const REQUEST_BUDGET_MS = CALLER_TOTAL_TIMEOUT_MS - CALLER_CONNECT_TIMEOUT_MS - RESPONSE_MARGIN_MS;   // 1900
export const READ_DEADLINE_MS = 800;
export const MAX_CONCURRENT = 4;
export const SHUTDOWN_DEADLINE_MS = 3000;
export const CLOCK_SKEW_MS = 30000;
export const NONCE_TTL_MS = 120000;
export const MAX_TRACKED_NONCES = 4096;
export const SINGLE_REPLICA_REQUIRED = true;
if (!(REQUEST_BUDGET_MS > 0 && REQUEST_BUDGET_MS + RESPONSE_MARGIN_MS + CALLER_CONNECT_TIMEOUT_MS <= CALLER_TOTAL_TIMEOUT_MS)) {
  throw new Error("executor_attester_v2_request_budget_unsafe_vs_caller_timeline");
}
const HEX64 = /^[0-9a-f]{64}$/, HEX32 = /^[0-9a-f]{32}$/;

function ipType(a) { const v = net.isIP(a); return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null; }
function normPeer(a) { if (typeof a !== "string") return null; const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); return m ? m[1] : a; }
export function buildPeerAllowV2(cidrs, { offlineTestBoundary }) {
  const bl = new net.BlockList();
  if (!Array.isArray(cidrs) || cidrs.length === 0) return null;
  for (const c of cidrs) {
    const m = typeof c === "string" ? /^([^/]+)\/(\d{1,3})$/.exec(c) : null;
    if (!m) return null;
    const addr = m[1], prefix = Number(m[2]), t = ipType(addr);
    if (!t || !Number.isInteger(prefix) || prefix < 0 || prefix > (t === "ipv4" ? 32 : 128)) return null;
    const loop = addr === "::1" || /^127\./.test(addr);
    if (loop) { if (!offlineTestBoundary) return null; }
    else {
      const r = PRIVATE_RANGES.find((x) => { if (x.type !== t) return false; const b2 = new net.BlockList(); b2.addSubnet(x.net, x.prefix, x.type); return b2.check(addr, t); });
      if (!r || prefix < r.prefix) return null;
    }
    bl.addSubnet(addr, prefix, t);
  }
  return bl;
}
function codeForReason(reason) {
  if (reason === "observer_busy") return "busy";
  if (reason === "no_such_session" || reason === "no_executor_session_observed" || reason === "ambiguous_session") return "no_such_session";
  return "unavailable";
}

/**
 * Start the V2 executor attestation channel server.
 * @param opts.observerProvider async () → { ok:true, observer } (V2 observer session)
 * @param opts.signer from the frozen R3 createExecutorSigningAdapterV2().signer
 * @param opts.anchor parsed executor deployment anchor (frozen parseExecutorDeploymentAnchor)
 */
export async function startExecutorAttestationServerV2(opts) {
  const { channelSecret, listen, observerProvider, signer, anchor, nowProvider = Date.now, log, offlineTestBoundary = false } = opts;
  if (typeof channelSecret !== "string" || channelSecret.length < MIN_CHANNEL_SECRET_LEN) throw new Error("executor_attester_v2_channel_secret_invalid");
  if (!signer || typeof signer.issue !== "function") throw new Error("executor_attester_v2_signer_absent");
  if (signer.issuer !== EXECUTOR_ATTESTATION_ISSUER_V2) throw new Error("executor_attester_v2_signer_issuer_not_v2");
  if (!anchor) throw new Error("executor_attester_v2_anchor_absent");
  if (typeof observerProvider !== "function") throw new Error("executor_attester_v2_observer_absent");
  if (!listen || typeof listen !== "object") throw new Error("executor_attester_v2_listen_absent");
  const wildcard = listen.bindHost === "::" || listen.bindHost === "0.0.0.0";
  if (wildcard && listen.allowWildcardBind !== true) throw new Error("executor_attester_v2_wildcard_bind_not_acknowledged");
  const peerAllow = buildPeerAllowV2(listen.allowedPeerCidrs || [], { offlineTestBoundary });
  if (!peerAllow) throw new Error("executor_attester_v2_peer_allowlist_invalid");
  const selfRoot = makeAttesterTrustRoot({ issuer: signer.issuer, publicKeyDerB64: signer.publicKeyDerB64, fingerprint: signer.keyId }, { allowTestIssuer: false });
  if (!selfRoot.ok) throw new Error("executor_attester_v2_self_trust_root_invalid");
  const requestBudgetMs = (offlineTestBoundary && Number.isInteger(opts.requestBudgetMs) && opts.requestBudgetMs > 0) ? opts.requestBudgetMs : REQUEST_BUDGET_MS;

  const coordinator = createExecutorObserverCoordinatorV2({ provider: observerProvider, nowProvider });
  const nonces = new Map(); const inflight = new Set(); const sockets = new Set();
  let seq = 0, closing = false;
  const counters = { requests: 0, signed: 0, refused: 0, deadlined: 0, cancelled: 0, selfVerifyFailed: 0, policyRefused: 0 };
  function sweep(now) {
    for (const [k, exp] of nonces) if (exp <= now) nonces.delete(k);
    if (nonces.size > MAX_TRACKED_NONCES) { const drop = nonces.size - MAX_TRACKED_NONCES; let i = 0; for (const k of nonces.keys()) { if (i++ >= drop) break; nonces.delete(k); } }
  }
  const macOk = (mac, expected) => { if (typeof mac !== "string" || mac.length !== 64) return false; try { return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex")); } catch { return false; } };

  async function handle(line, ctx, peerAlive) {
    counters.requests++;
    let req; try { req = JSON.parse(line); } catch { return { ok: false, code: "bad_request" }; }
    if (!req || typeof req !== "object" || Array.isArray(req)) return { ok: false, code: "bad_request" };
    if (Object.keys(req).sort().join(",") !== "args,mac,nonce,op,ts,v") return { ok: false, code: "bad_request" };
    if (req.v !== EXECUTOR_CHANNEL_VERSION_V2) return { ok: false, code: "unsupported_version" };   // V1 framing refused here
    if (req.op !== EXECUTOR_CHANNEL_OP_V2) return { ok: false, code: "unknown_op" };
    const { args, nonce, ts, mac } = req;
    if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) return { ok: false, code: "bad_request" };
    if (typeof ts !== "number" || !Number.isFinite(ts)) return { ok: false, code: "bad_request" };
    if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, code: "bad_request" };
    const now = nowProvider();
    if (Math.abs(now - ts) > CLOCK_SKEW_MS) return { ok: false, code: "stale" };
    if (!macOk(mac, executorChannelMacV2(channelSecret, req.v, req.op, args, nonce, ts))) return { ok: false, code: "unauthenticated" };
    ctx.tightenRemaining(CALLER_TOTAL_TIMEOUT_MS - Math.max(0, now - ts) - RESPONSE_MARGIN_MS);
    sweep(now);
    if (nonces.has(nonce)) return { ok: false, code: "replayed" };
    nonces.set(nonce, now + NONCE_TTL_MS);
    if (Object.keys(args).sort().join(",") !== EXECUTOR_CHANNEL_ARG_KEYS_V2.join(",")) return { ok: false, code: "bad_request" };
    if (args.contract !== EXECUTOR_ATTESTATION_CONTRACT_V2 || args.role !== EXECUTOR_ROLE) return { ok: false, code: "bad_request" };   // V1 contract refused
    if (typeof args.connectionToken !== "string" || !HEX64.test(args.connectionToken) || typeof args.requestNonce !== "string" || !HEX32.test(args.requestNonce)) return { ok: false, code: "bad_request" };
    if (closing) return { ok: false, code: "unavailable" };
    if (!ctx.live()) { counters.cancelled++; return { ok: false, code: "unavailable" }; }
    if (inflight.size >= MAX_CONCURRENT) return { ok: false, code: "busy" };

    const id = ++seq; inflight.add(id);
    const st = { code: null };
    try {
      // per-request observer seam bound to THIS request's context (frozen R3 issuer composition, unchanged)
      const observerAdapter = Object.freeze({
        contract: EXECUTOR_OBSERVER_ADAPTER_CONTRACT_V2,
        async observeExecutorEvidence(claimedConnectionToken) {
          const obs = await coordinator.observe(claimedConnectionToken, { nowProvider, context: ctx });
          if (!obs.ok) { if (obs.reason === "request_expired") counters.cancelled++; st.code = codeForReason(obs.reason); throw new Error("observe_refused"); }
          if (!ctx.live()) { counters.cancelled++; st.code = "unavailable"; throw new Error("request_not_live"); }
          if (obs.measured.connection.token !== claimedConnectionToken) { st.code = "no_such_session"; throw new Error("token_mismatch"); }
          const pe = toPolicyEvidenceV2(obs.measured, anchor);
          if (!pe.ok) { st.code = "unavailable"; throw new Error("target_unbound"); }
          // PRE-SIGN gate: nothing awaits between here and the synchronous evaluate+sign inside the frozen issuer
          if (!ctx.live()) { counters.cancelled++; st.code = "unavailable"; throw new Error("request_not_live"); }
          if (typeof peerAlive === "function" && !peerAlive()) { counters.cancelled++; ctx.cancel("caller_gone"); st.code = "unavailable"; throw new Error("caller_gone"); }
          return pe.evidence;
        },
      });
      const ir = createExecutorAttesterIssuerV2({ observerAdapter, signingAdapter: signer });
      if (!ir.ok) { counters.refused++; return { ok: false, code: "internal" }; }
      const issued = await ir.issuer.issue({ requestNonce: args.requestNonce, claimedConnectionToken: args.connectionToken });
      if (!issued || issued.ok !== true) {
        counters.refused++;
        if (st.code) return { ok: false, code: st.code };
        if (issued && (issued.reason === "signing_failed" || issued.reason === "evidence_not_independently_evaluated")) return { ok: false, code: "internal" };
        counters.policyRefused++;
        return { ok: false, code: "unavailable" };                                                 // never sign adverse state
      }
      // CONFORMANCE GATE: the frozen R3 V2 verifier must accept exactly what is about to be released
      const v = verifyExecutorAttestationV2(issued.envelope, { trustRoot: selfRoot.trustRoot, expectedConnectionToken: args.connectionToken, expectedRequestNonce: args.requestNonce, now: nowProvider() });
      if (!v.ok) { counters.refused++; counters.selfVerifyFailed++; return { ok: false, code: "internal" }; }
      if (!ctx.live()) { counters.refused++; counters.cancelled++; return { ok: false, code: "unavailable" }; }
      counters.signed++;
      return { ok: true, envelope: issued.envelope };
    } catch { return { ok: false, code: "internal" }; }
    finally { inflight.delete(id); }
  }

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf = ""; let settled = false; let reading = true;
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
    const totalTimer = setTimeout(() => { ctx.cancel("request_deadline"); counters.deadlined++; finish({ ok: false, code: "unavailable" }); }, requestBudgetMs);
    const readTimer = setTimeout(() => { if (reading) { ctx.cancel("read_deadline"); counters.deadlined++; finish({ ok: false, code: "unavailable" }); } }, Math.min(READ_DEADLINE_MS, requestBudgetMs));
    sock.on("data", (chunk) => {
      if (settled || !reading) return;
      buf += chunk;
      if (Buffer.byteLength(buf, "utf8") > CHANNEL_MAX_REQUEST_BYTES) { finish({ ok: false, code: "bad_request" }); return; }
      const nl = buf.indexOf("\n"); if (nl < 0) return;
      reading = false; clearTimeout(readTimer);
      const started = performance.now();
      void handle(buf.slice(0, nl), ctx, () => !sock.destroyed).then((res) => {
        (log || (() => {}))(JSON.stringify({ executorAttesterV2: "attestation-request", ok: res.ok === true, code: res.ok ? undefined : res.code, ms: Math.round(performance.now() - started) }));
        finish(res);
      }, () => finish({ ok: false, code: "internal" }));
    });
  });

  return await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("executor_attester_v2_listen_failed")));
    server.listen({ host: listen.bindHost, port: listen.port }, () => {
      const a = server.address();
      resolve(Object.freeze({
        address: { host: a.address, port: a.port },
        stats() { return { ...counters, inflight: inflight.size, trackedNonces: nonces.size, observer: coordinator.stats() }; },
        async close({ deadlineMs = SHUTDOWN_DEADLINE_MS } = {}) {
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
