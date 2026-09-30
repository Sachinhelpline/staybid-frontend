// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — CLIENT adapter for `executor-attestation-channel-v1`. OFFLINE.
//
// Provided for the FUTURE, SEPARATELY AUTHORIZED authority-binding step. It is NOT wired into the preserved authority
// package here: acquireExecutorAttestationSourceV2() stays `executor_attestation_source_unprovisioned`.
//
// Its shape is exactly what the preserved provisioner already calls: `source.obtain({ contract, connectionToken, role,
// requestNonce })` → the raw envelope `{ payload, signatureB64 }`, which the provisioner then verifies unchanged with
// verifyExecutorAttestation against the PINNED executor trust root. Nothing here marks an envelope trusted, and no key
// or destination inside a response is ever used. Destination/secret validation reuses the ACCEPTED
// validateAttesterChannelConfig (private destination, ≥32-char secret); the reader channel secret must differ.
// Bounded connect/total deadlines and sizes; NO retries; failures are fixed codes on err.code.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { randomBytes } from "node:crypto";
import { validateAttesterChannelConfig, CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, CHANNEL_CONNECT_TIMEOUT_MS, CHANNEL_TOTAL_TIMEOUT_MS }
  from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { EXECUTOR_ROLE } from "./executor-evidence-queries.mjs";
import { EXECUTOR_CHANNEL_VERSION, EXECUTOR_CHANNEL_OP, WIRE_CODES, executorChannelMac } from "./executor-attestation-server.mjs";

export const CLIENT_FAILURE_CODES = Object.freeze(["executor_attester_request_invalid", "executor_attester_unreachable", "executor_attester_deadline_exceeded",
  "executor_attester_response_too_large", "executor_attester_bad_response", "executor_attester_rejected"]);
const WIRE = new Set(WIRE_CODES);
const HEX64 = /^[0-9a-f]{64}$/, HEX32 = /^[0-9a-f]{32}$/;
function channelError(code) { const e = new Error("executor_attestation_channel_failure"); e.code = code; return e; }

/** Construct the executor attestation source from VALIDATED deployment configuration (no I/O). */
export function createExecutorAttestationSourceChannel(cfg, { offlineTestBoundary = false, nowProvider } = {}) {
  const v = validateAttesterChannelConfig(cfg ? { host: cfg.host, port: cfg.port, channelSecret: cfg.channelSecret } : cfg, { offlineTestBoundary });
  if (!v.ok) return { ok: false, reason: v.reason.replace(/^attester_/, "executor_attester_") };
  if (typeof cfg.readerChannelSecret === "string" && cfg.readerChannelSecret === cfg.channelSecret) return { ok: false, reason: "executor_attester_channel_secret_reuses_reader" };
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
    const r = request && typeof request === "object" ? request : {};
    if (Object.keys(r).sort().join(",") !== "connectionToken,contract,requestNonce,role" || r.contract !== EXECUTOR_ATTESTATION_CONTRACT
      || r.role !== EXECUTOR_ROLE || !HEX64.test(r.connectionToken) || !HEX32.test(r.requestNonce)) throw channelError("executor_attester_request_invalid");
    const args = { connectionToken: r.connectionToken, contract: r.contract, requestNonce: r.requestNonce, role: r.role };
    const v2 = EXECUTOR_CHANNEL_VERSION, op = EXECUTOR_CHANNEL_OP;
    const nonce = randomBytes(16).toString("hex"); const ts = now();
    const line = JSON.stringify({ v: v2, op, args, nonce, ts, mac: executorChannelMac(secret, v2, op, args, nonce, ts) }) + "\n";
    if (Buffer.byteLength(line, "utf8") > CHANNEL_MAX_REQUEST_BYTES) throw channelError("executor_attester_request_invalid");
    const res = await exchange(line);
    if (res.err) throw channelError(res.err);
    let env; try { env = JSON.parse(res.body.trim()); } catch { throw channelError("executor_attester_bad_response"); }
    if (!env || typeof env !== "object" || Array.isArray(env)) throw channelError("executor_attester_bad_response");
    const keys = Object.keys(env).sort().join(",");
    if (env.ok === false) { if (keys !== "code,ok" || !WIRE.has(env.code)) throw channelError("executor_attester_bad_response"); const e = channelError("executor_attester_rejected"); e.attesterCode = env.code; throw e; }
    if (env.ok !== true || keys !== "envelope,ok") throw channelError("executor_attester_bad_response");
    const e2 = env.envelope;
    if (!e2 || typeof e2 !== "object" || Array.isArray(e2) || Object.keys(e2).sort().join(",") !== "payload,signatureB64") throw channelError("executor_attester_bad_response");
    return { payload: e2.payload, signatureB64: e2.signatureB64 };   // verified afterwards by the preserved verifier
  }
  return { ok: true, source: Object.freeze({ version: EXECUTOR_CHANNEL_VERSION, destination: Object.freeze({ host, port }), obtain }) };
}
