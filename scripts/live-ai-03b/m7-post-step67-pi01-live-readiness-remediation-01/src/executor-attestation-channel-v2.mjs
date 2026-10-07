// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Executor Attestation V2 channel PROTOCOL + Authority CLIENT.
// OFFLINE candidate (not deployed).
//
// Protocol `executor-attestation-channel-v2` — a DISTINCT namespace from both the frozen V1 executor channel
// (`executor-attestation-channel-v1`) and the reader channels. Same framing and HMAC construction as the reviewed V1
// executor channel (one newline-terminated JSON request per connection; mac = HMAC-SHA256(secret, v⏎op⏎JSON(args)⏎
// nonce⏎ts)), with its own version, its own single operation and EXACT args:
//   { connectionToken:<64 hex>, contract:"AiStagingExecutorAttestationV2", requestNonce:<32 hex>, role:"live_ai_03b_executor" }
// A V1 request is refused by the V2 server (unsupported_version) and a V1 contract inside V2 framing is refused
// (bad_request). There is NO V1 fallback and NO V1→V2 envelope translation anywhere.
//
// The client exposes exactly the `obtain({contract, connectionToken, role, requestNonce})` shape the accepted PI01
// core calls; it returns the raw envelope `{payload, signatureB64}`, which the accepted PI01 core then verifies with
// the frozen R3 validateV3ProductionExecutorAuthority (verifyExecutorAttestationV2) against the PINNED V2 trust root.
// Nothing here marks an envelope trusted. Bounded connect/total deadlines and sizes; NO retries.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { validateAttesterChannelConfig, CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, CHANNEL_CONNECT_TIMEOUT_MS, CHANNEL_TOTAL_TIMEOUT_MS }
  from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT_V2, EXECUTOR_ROLE }
  from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";

export const EXECUTOR_CHANNEL_VERSION_V2 = "executor-attestation-channel-v2";
export const EXECUTOR_CHANNEL_OP_V2 = "attest-executor-v2";
export const FROZEN_V1_EXECUTOR_CHANNEL_VERSION = "executor-attestation-channel-v1";   // refused, never spoken
export const EXECUTOR_CHANNEL_ARG_KEYS_V2 = Object.freeze(["connectionToken", "contract", "requestNonce", "role"]);
export const WIRE_CODES_V2 = Object.freeze(["unauthenticated", "stale", "replayed", "bad_request", "unknown_op", "unsupported_version",
  "no_such_session", "busy", "unavailable", "internal"]);
export const CLIENT_FAILURE_CODES_V2 = Object.freeze(["executor_attester_request_invalid", "executor_attester_unreachable",
  "executor_attester_deadline_exceeded", "executor_attester_response_too_large", "executor_attester_bad_response", "executor_attester_rejected"]);
export { CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, CHANNEL_CONNECT_TIMEOUT_MS, CHANNEL_TOTAL_TIMEOUT_MS };
if (EXECUTOR_CHANNEL_VERSION_V2 === FROZEN_V1_EXECUTOR_CHANNEL_VERSION) throw new Error("executor_v2_channel_namespace_collides_with_v1");

const WIRE = new Set(WIRE_CODES_V2);
const HEX64 = /^[0-9a-f]{64}$/, HEX32 = /^[0-9a-f]{32}$/;

export function executorChannelMacV2(secret, v, op, args, nonce, ts) {
  return createHmac("sha256", secret).update([v, op, JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex");
}
function channelError(code) { const e = new Error("executor_attestation_channel_v2_failure"); e.code = code; return e; }

/**
 * Construct the V2 executor attestation source from VALIDATED deployment configuration. No I/O at construction.
 * @param cfg { host, port, channelSecret, readerChannelSecret } — the reader secret is compared only (must differ)
 */
export function createExecutorAttestationSourceChannelV2(cfg, { offlineTestBoundary = false, nowProvider } = {}) {
  const v = validateAttesterChannelConfig(cfg ? { host: cfg.host, port: cfg.port, channelSecret: cfg.channelSecret } : cfg, { offlineTestBoundary });
  if (!v.ok) return { ok: false, reason: String(v.reason).replace(/^attester_/, "executor_attester_") };
  if (typeof cfg.readerChannelSecret !== "string" || cfg.readerChannelSecret === "") return { ok: false, reason: "executor_attester_reader_channel_secret_absent" };
  if (cfg.readerChannelSecret === cfg.channelSecret) return { ok: false, reason: "executor_attester_channel_secret_reuses_reader" };
  const { host, port, channelSecret: secret } = cfg;
  const now = typeof nowProvider === "function" ? nowProvider : Date.now;

  function exchange(line) {
    return new Promise((resolve) => {
      let done = false, connected = false, buf = Buffer.alloc(0);
      const sock = net.createConnection({ host, port });
      const finish = (r) => { if (done) return; done = true; clearTimeout(tConn); clearTimeout(tAll); try { sock.destroy(); } catch {} resolve(r); };
      const tConn = setTimeout(() => { if (!connected) finish({ err: "executor_attester_unreachable" }); }, CHANNEL_CONNECT_TIMEOUT_MS);
      const tAll = setTimeout(() => finish({ err: "executor_attester_deadline_exceeded" }), CHANNEL_TOTAL_TIMEOUT_MS);
      sock.on("connect", () => { connected = true; clearTimeout(tConn); try { sock.write(line); } catch { finish({ err: "executor_attester_unreachable" }); } });
      sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.length > CHANNEL_MAX_RESPONSE_BYTES) finish({ err: "executor_attester_response_too_large" }); });
      sock.on("end", () => finish({ body: buf.toString("utf8") }));
      sock.on("error", () => finish({ err: connected ? "executor_attester_bad_response" : "executor_attester_unreachable" }));
    });
  }

  async function obtain(request) {
    const r = request && typeof request === "object" && !Array.isArray(request) ? request : {};
    if (Object.keys(r).sort().join(",") !== EXECUTOR_CHANNEL_ARG_KEYS_V2.join(",") || r.contract !== EXECUTOR_ATTESTATION_CONTRACT_V2
      || r.role !== EXECUTOR_ROLE || typeof r.connectionToken !== "string" || !HEX64.test(r.connectionToken)
      || typeof r.requestNonce !== "string" || !HEX32.test(r.requestNonce)) throw channelError("executor_attester_request_invalid");
    const args = { connectionToken: r.connectionToken, contract: r.contract, requestNonce: r.requestNonce, role: r.role };
    const ver = EXECUTOR_CHANNEL_VERSION_V2, op = EXECUTOR_CHANNEL_OP_V2;
    const nonce = randomBytes(16).toString("hex"); const ts = now();
    const line = JSON.stringify({ v: ver, op, args, nonce, ts, mac: executorChannelMacV2(secret, ver, op, args, nonce, ts) }) + "\n";
    if (Buffer.byteLength(line, "utf8") > CHANNEL_MAX_REQUEST_BYTES) throw channelError("executor_attester_request_invalid");
    const res = await exchange(line);
    if (res.err) throw channelError(res.err);
    let env; try { env = JSON.parse(res.body.trim()); } catch { throw channelError("executor_attester_bad_response"); }
    if (!env || typeof env !== "object" || Array.isArray(env)) throw channelError("executor_attester_bad_response");
    const keys = Object.keys(env).sort().join(",");
    if (env.ok === false) {
      if (keys !== "code,ok" || !WIRE.has(env.code)) throw channelError("executor_attester_bad_response");
      const e = channelError("executor_attester_rejected"); e.attesterCode = env.code; throw e;
    }
    if (env.ok !== true || keys !== "envelope,ok") throw channelError("executor_attester_bad_response");
    const e2 = env.envelope;
    if (!e2 || typeof e2 !== "object" || Array.isArray(e2) || Object.keys(e2).sort().join(",") !== "payload,signatureB64") throw channelError("executor_attester_bad_response");
    return { payload: e2.payload, signatureB64: e2.signatureB64 };   // verified afterwards by the frozen R3 V2 verifier
  }
  return { ok: true, source: Object.freeze({ version: EXECUTOR_CHANNEL_VERSION_V2, destination: Object.freeze({ host, port }), obtain }) };
}
