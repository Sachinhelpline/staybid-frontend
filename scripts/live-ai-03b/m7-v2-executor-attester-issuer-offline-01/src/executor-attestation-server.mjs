// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — authenticated ATTESTATION CHANNEL SERVER. OFFLINE candidate.
//
// Protocol `executor-attestation-channel-v1` — a DISTINCT namespace from the accepted reader channel
// (`reader-attestation-channel-v1`): same framing and HMAC construction (one newline-terminated JSON request per
// connection; mac = HMAC-SHA256(channelSecret, v⏎op⏎JSON(args)⏎nonce⏎ts)), but its own version, its own single
// operation "attest-executor", its own channel secret, and EXACT args:
//   { connectionToken:<64 hex>, contract:"AiStagingExecutorAttestationV1", requestNonce:<32 hex>, role:"live_ai_03b_executor" }
// Nothing else is accepted — no privileges, target, issuer, key, expiry, DB URL or SQL can ride in a request. A
// reader-channel request is refused (unsupported_version). Responses are fixed-code or {ok:true, envelope}.
//
// Per request: freshness (±30 s) + single-use nonce + HMAC, then an INDEPENDENT measurement through the bounded
// observer coordinator, the clean-state gate, the anchored target, the signature — and finally the envelope is
// VERIFIED with the PRESERVED verifyExecutorAttestation (this issuer's own public trust root, the requested token and
// nonce). A signature that the preserved verifier would not accept is never emitted. Request lifecycle containment
// (absolute context, caller-timeline tightening, pre-sign gate, bounded shutdown) mirrors the accepted reader server.
// In-memory replay state ⇒ SINGLE replica (see FUTURE-LIVE-SEQUENCE.md).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ATTESTATION_CHANNEL_VERSION as READER_CHANNEL_VERSION, CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, MIN_CHANNEL_SECRET_LEN,
  CHANNEL_TOTAL_TIMEOUT_MS, CHANNEL_CONNECT_TIMEOUT_MS } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { PRIVATE_RANGES } from "../../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT, verifyExecutorAttestation } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { EXECUTOR_ROLE } from "./executor-evidence-queries.mjs";
import { executorEvidenceIsAttestable } from "./executor-evidence-evaluator.mjs";
import { createExecutorObserverCoordinator, makeRequestContext } from "./executor-observer.mjs";
import { resolveExecutorTarget } from "./executor-target-binding.mjs";

export const EXECUTOR_CHANNEL_VERSION = "executor-attestation-channel-v1";
export const EXECUTOR_CHANNEL_OP = "attest-executor";
export const EXECUTOR_CHANNEL_ARG_KEYS = Object.freeze(["connectionToken", "contract", "requestNonce", "role"]);
export const WIRE_CODES = Object.freeze(["unauthenticated", "stale", "replayed", "bad_request", "unknown_op", "unsupported_version",
  "no_such_session", "busy", "unavailable", "internal"]);
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
  throw new Error("executor_attester_request_budget_unsafe_vs_caller_timeline");
}
if (EXECUTOR_CHANNEL_VERSION === READER_CHANNEL_VERSION) throw new Error("executor_channel_namespace_collides_with_reader");
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
export function executorChannelMac(secret, v, op, args, nonce, ts) {
  return createHmac("sha256", secret).update([v, op, JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex");
}

/**
 * Start the executor attestation channel server.
 * @param opts.observerProvider async () → { ok:true, observer } — opens + validates a least-privilege observer
 * @param opts.signer from createExecutorSigningAdapter() · @param opts.anchor parsed executor deployment anchor
 */
export async function startExecutorAttestationServer(opts) {
  const { channelSecret, listen, observerProvider, signer, anchor, nowProvider = Date.now, log, offlineTestBoundary = false } = opts;
  if (typeof channelSecret !== "string" || channelSecret.length < MIN_CHANNEL_SECRET_LEN) throw new Error("executor_attester_channel_secret_invalid");
  if (!signer || typeof signer.issue !== "function") throw new Error("executor_attester_signer_absent");
  if (signer.test && !offlineTestBoundary) throw new Error("executor_attester_test_signer_refused");
  if (!anchor) throw new Error("executor_attester_anchor_absent");
  if (typeof observerProvider !== "function") throw new Error("executor_attester_observer_absent");
  const wildcard = listen.bindHost === "::" || listen.bindHost === "0.0.0.0";
  if (wildcard && listen.allowWildcardBind !== true) throw new Error("executor_attester_wildcard_bind_not_acknowledged");
  const peerAllow = buildPeerAllow(listen.allowedPeerCidrs || [], { offlineTestBoundary });
  if (!peerAllow) throw new Error("executor_attester_peer_allowlist_invalid");
  // the issuer's OWN public identity, used to re-verify every envelope with the PRESERVED verifier before release
  const selfRoot = makeAttesterTrustRoot({ issuer: signer.issuer, publicKeyDerB64: signer.publicKeyDerB64, fingerprint: signer.keyId }, { allowTestIssuer: offlineTestBoundary });
  if (!selfRoot.ok) throw new Error("executor_attester_self_trust_root_invalid");
  const requestBudgetMs = (offlineTestBoundary && Number.isInteger(opts.requestBudgetMs) && opts.requestBudgetMs > 0) ? opts.requestBudgetMs : REQUEST_BUDGET_MS;

  const coordinator = createExecutorObserverCoordinator({ provider: observerProvider, nowProvider });
  const nonces = new Map(); const inflight = new Set(); const sockets = new Set();
  let seq = 0, closing = false;
  const counters = { requests: 0, signed: 0, refused: 0, deadlined: 0, cancelled: 0, selfVerifyFailed: 0 };
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
    if (req.v !== EXECUTOR_CHANNEL_VERSION) return { ok: false, code: "unsupported_version" };
    if (req.op !== EXECUTOR_CHANNEL_OP) return { ok: false, code: "unknown_op" };
    const { args, nonce, ts, mac } = req;
    if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) return { ok: false, code: "bad_request" };
    if (typeof ts !== "number" || !Number.isFinite(ts)) return { ok: false, code: "bad_request" };
    if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, code: "bad_request" };
    const now = nowProvider();
    if (Math.abs(now - ts) > CLOCK_SKEW_MS) return { ok: false, code: "stale" };
    if (!macOk(mac, executorChannelMac(channelSecret, req.v, req.op, args, nonce, ts))) return { ok: false, code: "unauthenticated" };
    ctx.tightenRemaining(CALLER_TOTAL_TIMEOUT_MS - Math.max(0, now - ts) - RESPONSE_MARGIN_MS);
    sweep(now);
    if (nonces.has(nonce)) return { ok: false, code: "replayed" };
    nonces.set(nonce, now + NONCE_TTL_MS);
    if (Object.keys(args).sort().join(",") !== EXECUTOR_CHANNEL_ARG_KEYS.join(",")) return { ok: false, code: "bad_request" };
    if (args.contract !== EXECUTOR_ATTESTATION_CONTRACT || args.role !== EXECUTOR_ROLE) return { ok: false, code: "bad_request" };
    if (typeof args.connectionToken !== "string" || !HEX64.test(args.connectionToken) || typeof args.requestNonce !== "string" || !HEX32.test(args.requestNonce)) return { ok: false, code: "bad_request" };
    if (closing) return { ok: false, code: "unavailable" };
    if (!ctx.live()) { counters.cancelled++; return { ok: false, code: "unavailable" }; }
    if (inflight.size >= MAX_CONCURRENT) return { ok: false, code: "busy" };

    const id = ++seq; inflight.add(id);
    try {
      const obs = await coordinator.observe(args.connectionToken, { nowProvider, context: ctx });
      if (!obs.ok) { counters.refused++; if (obs.reason === "request_expired") counters.cancelled++; return { ok: false, code: codeForReason(obs.reason) }; }
      if (!ctx.live()) { counters.refused++; counters.cancelled++; return { ok: false, code: "unavailable" }; }
      const clean = executorEvidenceIsAttestable(obs.evidence);
      if (!clean.ok) { counters.refused++; return { ok: false, code: "unavailable" }; }             // never sign adverse state
      const tgt = resolveExecutorTarget(anchor, obs.evidence.cluster);
      if (!tgt.ok) { counters.refused++; return { ok: false, code: "unavailable" }; }
      if (obs.evidence.connection.token !== args.connectionToken) { counters.refused++; return { ok: false, code: "no_such_session" }; }
      if (!ctx.live()) { counters.refused++; counters.cancelled++; return { ok: false, code: "unavailable" }; }   // PRE-SIGN gate
      if (typeof peerAlive === "function" && !peerAlive()) { counters.refused++; counters.cancelled++; ctx.cancel("caller_gone"); return { ok: false, code: "unavailable" }; }
      const issued = signer.issue({ requestNonce: args.requestNonce, target: tgt.target, connection: obs.evidence.connection, privileges: obs.evidence.privileges });
      if (!issued.ok) { counters.refused++; return { ok: false, code: "internal" }; }
      // CONFORMANCE GATE: the PRESERVED verifier must accept exactly what we are about to release
      const v = verifyExecutorAttestation(issued.envelope, { trustRoot: selfRoot.trustRoot, expectedConnectionToken: args.connectionToken, expectedRequestNonce: args.requestNonce, now: nowProvider() });
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
        (log || (() => {}))(JSON.stringify({ executorAttester: "attestation-request", ok: res.ok === true, code: res.ok ? undefined : res.code, ms: Math.round(performance.now() - started) }));
        finish(res);
      }, () => finish({ ok: false, code: "internal" }));
    });
  });

  return await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("executor_attester_listen_failed")));
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
