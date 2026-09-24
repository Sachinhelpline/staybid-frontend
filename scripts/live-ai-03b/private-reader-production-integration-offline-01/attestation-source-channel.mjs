// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — versioned PRODUCTION ATTESTATION-SOURCE adapter (`reader-attestation-channel-v1`, OFFLINE).
// Node built-ins only.
//
// Sole purpose: REQUEST and RECEIVE the independent attester's signed AiStagingReaderAttestationV1
// envelope over ONE deployment-configured private channel. It never issues, signs, fabricates or trusts
// an attestation: the envelope it returns is verified afterwards, unchanged, by reader-attestation.mjs
// against the PINNED trust root (a key or destination inside a response is never used).
//
// Channel (same framing + canonical HMAC construction as the accepted `reader-obs-transport-v1`):
//   request  : ONE newline-terminated JSON line
//              { v:"reader-attestation-channel-v1", op:"attest",
//                args:{ contract:"AiStagingReaderAttestationV1", connectionToken, role, requestNonce },
//                nonce, ts, mac }   mac = HMAC-SHA256(channelSecret, v⏎op⏎JSON(args)⏎nonce⏎ts)
//   response : ONE JSON line — { ok:true, envelope:{ payload, signatureB64 } } | { ok:false, code:<fixed> }
// Channel authentication (HMAC with a dedicated channel secret, freshness, single-use nonce — enforced by
// the attester) keeps the attester from answering unauthenticated callers; the envelope's INTEGRITY and
// AUTHORITY come only from the Ed25519 signature verified by the reader host.
// Destination: deployment-owned configuration only — a `*.railway.internal` name or a literal private
// (RFC 1918 / RFC 4193) address + port; URLs, public addresses, external names and loopback (outside an
// explicit offline test boundary) are refused. Bounded connect/total deadlines and request/response sizes;
// NO retries; failures are fixed codes attached as `err.code` (no raw transport error, no detail).
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { randomBytes } from "node:crypto";
import { validateDestination, macFor } from "./gateway-observation-caller.mjs";
import { ATTESTATION_CONTRACT } from "./reader-attestation.mjs";
import { READER_ROLE } from "../private-reader-host-runtime-offline-01/reader-only-authority.mjs";

export const ATTESTATION_CHANNEL_VERSION = "reader-attestation-channel-v1";
export const ATTESTATION_CHANNEL_OP = "attest";
export const CHANNEL_MAX_REQUEST_BYTES = 2048;
export const CHANNEL_MAX_RESPONSE_BYTES = 16384;
export const CHANNEL_CONNECT_TIMEOUT_MS = 1500;
export const CHANNEL_TOTAL_TIMEOUT_MS = 4000;
export const MIN_CHANNEL_SECRET_LEN = 32;
// fixed codes the ATTESTER may answer with (anything else ⇒ attester_bad_response)
export const ATTESTER_WIRE_CODES = Object.freeze(["unauthenticated", "stale", "replayed", "bad_request", "unknown_op", "unsupported_version",
  "no_such_session", "busy", "unavailable", "internal"]);
// fixed codes this adapter raises (err.code)
export const CHANNEL_FAILURE_CODES = Object.freeze(["attester_request_invalid", "attester_unreachable", "attester_deadline_exceeded",
  "attester_response_too_large", "attester_bad_response", "attester_rejected"]);
const WIRE = new Set(ATTESTER_WIRE_CODES);

function channelError(code) { const e = new Error("attestation_channel_failure"); e.code = code; return e; }
const HEX64 = /^[0-9a-f]{64}$/; const HEX32 = /^[0-9a-f]{32}$/;

/** Validate the deployment-owned channel configuration (no I/O). */
export function validateAttesterChannelConfig(cfg, { offlineTestBoundary = false } = {}) {
  if (!cfg || typeof cfg !== "object") return { ok: false, reason: "attester_channel_config_absent" };
  const dv = validateDestination({ host: cfg.host, port: cfg.port }, { offlineTestBoundary });
  if (!dv.ok) return { ok: false, reason: "attester_" + dv.reason };
  if (typeof cfg.channelSecret !== "string" || cfg.channelSecret.length < MIN_CHANNEL_SECRET_LEN) return { ok: false, reason: "attester_channel_secret_invalid" };
  if (typeof cfg.transportSecret === "string" && cfg.transportSecret === cfg.channelSecret) return { ok: false, reason: "attester_channel_secret_reused" };
  return { ok: true };
}

/**
 * Construct the approved attestation source from VALIDATED deployment configuration.
 * Returns { ok:true, source } or { ok:false, reason } (fail closed). The source exposes only obtain().
 */
export function createAttestationSourceChannel(cfg, { offlineTestBoundary = false, nowProvider } = {}) {
  const v = validateAttesterChannelConfig(cfg, { offlineTestBoundary });
  if (!v.ok) return v;
  const host = cfg.host; const port = cfg.port; const secret = cfg.channelSecret;
  const now = typeof nowProvider === "function" ? nowProvider : Date.now;

  function exchange(line) {
    return new Promise((resolve) => {
      let done = false; let connected = false; let buf = Buffer.alloc(0);
      const sock = net.createConnection({ host, port });
      const finish = (r) => { if (done) return; done = true; clearTimeout(tConn); clearTimeout(tAll); try { sock.destroy(); } catch {} resolve(r); };
      const tConn = setTimeout(() => { if (!connected) finish({ err: "attester_unreachable" }); }, CHANNEL_CONNECT_TIMEOUT_MS);
      const tAll = setTimeout(() => finish({ err: "attester_deadline_exceeded" }), CHANNEL_TOTAL_TIMEOUT_MS);
      sock.on("connect", () => { connected = true; clearTimeout(tConn); try { sock.write(line); } catch { finish({ err: "attester_unreachable" }); } });
      sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.length > CHANNEL_MAX_RESPONSE_BYTES) finish({ err: "attester_response_too_large" }); });
      sock.on("end", () => finish({ body: buf.toString("utf8") }));
      sock.on("error", () => finish({ err: connected ? "attester_bad_response" : "attester_unreachable" }));
    });
  }

  async function obtain(request) {
    // exactly the minimum fields the authority manager supplies — nothing caller-chosen beyond them
    const r = request && typeof request === "object" ? request : {};
    if (Object.keys(r).sort().join(",") !== "connectionToken,contract,requestNonce,role" || r.contract !== ATTESTATION_CONTRACT
      || r.role !== READER_ROLE || !HEX64.test(r.connectionToken) || !HEX32.test(r.requestNonce)) throw channelError("attester_request_invalid");
    const args = { contract: r.contract, connectionToken: r.connectionToken, role: r.role, requestNonce: r.requestNonce };
    const v = ATTESTATION_CHANNEL_VERSION; const op = ATTESTATION_CHANNEL_OP;
    const nonce = randomBytes(16).toString("hex"); const ts = now();
    const line = JSON.stringify({ v, op, args, nonce, ts, mac: macFor(secret, v, op, args, nonce, ts) }) + "\n";
    if (Buffer.byteLength(line, "utf8") > CHANNEL_MAX_REQUEST_BYTES) throw channelError("attester_request_invalid");
    const res = await exchange(line);
    if (res.err) throw channelError(res.err);
    let env;
    try { env = JSON.parse(res.body.trim()); } catch { throw channelError("attester_bad_response"); }
    if (!env || typeof env !== "object" || Array.isArray(env)) throw channelError("attester_bad_response");
    const keys = Object.keys(env).sort().join(",");
    if (env.ok === false) { if (keys !== "code,ok" || !WIRE.has(env.code)) throw channelError("attester_bad_response"); const e = channelError("attester_rejected"); e.attesterCode = env.code; throw e; }
    if (env.ok !== true || keys !== "envelope,ok") throw channelError("attester_bad_response");
    const e2 = env.envelope;
    if (!e2 || typeof e2 !== "object" || Array.isArray(e2) || Object.keys(e2).sort().join(",") !== "payload,signatureB64") throw channelError("attester_bad_response");
    // returned as-is for independent verification; nothing here marks it trusted
    return { payload: e2.payload, signatureB64: e2.signatureB64 };
  }

  return { ok: true, source: Object.freeze({ version: ATTESTATION_CHANNEL_VERSION, destination: Object.freeze({ host, port }), obtain }) };
}
