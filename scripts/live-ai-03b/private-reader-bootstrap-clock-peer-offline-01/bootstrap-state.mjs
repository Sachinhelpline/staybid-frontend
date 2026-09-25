// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: shared state machine, process-boot generation, and the v2 socket client (OFFLINE).
// Node built-ins only. A boot generation is an in-memory nonce created at process boot; it cannot survive a
// restart/redeploy, so clock/authority evidence bound to it is automatically void after a new boot.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { randomBytes } from "node:crypto";
import { buildV2Request } from "./attestation-channel-v2.mjs";
import { CHANNEL_MAX_RESPONSE_BYTES } from "../private-reader-production-integration-offline-01/attestation-source-channel.mjs";

export const STATES = Object.freeze({
  UNPROVISIONED: "UNPROVISIONED",
  WAITING_FOR_CLOCK: "WAITING_FOR_CLOCK",
  WAITING_FOR_ATTESTER: "WAITING_FOR_ATTESTER",
  BOOTSTRAP_LISTENING: "BOOTSTRAP_LISTENING",
  AUTHORITY_READY: "AUTHORITY_READY",
  CLOCK_INVALID: "CLOCK_INVALID",
  PEER_INVALID: "PEER_INVALID",
  OBSERVER_INVALID: "OBSERVER_INVALID",
  SUSPENDED: "SUSPENDED",
  FAILED: "FAILED",
  STOPPED: "STOPPED",
});

export function randomHex(bytes) { return randomBytes(bytes).toString("hex"); }
/** A fresh 32-hex process-boot generation. Not persisted; a restart yields a new id ⇒ prior evidence is void. */
export function createBootGeneration() { return Object.freeze({ id: randomHex(16), createdAtMonoUs: null }); }

/**
 * v2 channel client: send one clock-bound attestation request, resolve on socket end (matching the accepted
 * client's framing). Returns { ok:true, envelope } | { ok:false, code }.
 */
export function obtainV2(opts) {
  const { host, port, channelSecret, connectionToken, requestNonce, readerClock, nowMs = Date.now, connectTimeoutMs = 1500, totalTimeoutMs = 4000 } = opts;
  const nonce = randomHex(16); const ts = nowMs();
  const line = buildV2Request({ channelSecret, connectionToken, requestNonce, readerClock, nonce, ts });
  return new Promise((resolve) => {
    let done = false, connected = false, buf = Buffer.alloc(0);
    const sock = net.createConnection({ host, port });
    const finish = (r) => { if (done) return; done = true; clearTimeout(tConn); clearTimeout(tAll); try { sock.destroy(); } catch {} resolve(r); };
    const tConn = setTimeout(() => { if (!connected) finish({ ok: false, code: "attester_unreachable" }); }, connectTimeoutMs);
    const tAll = setTimeout(() => finish({ ok: false, code: "attester_deadline_exceeded" }), totalTimeoutMs);
    sock.on("connect", () => { connected = true; clearTimeout(tConn); try { sock.write(line); } catch { finish({ ok: false, code: "attester_unreachable" }); } });
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.length > CHANNEL_MAX_RESPONSE_BYTES) finish({ ok: false, code: "attester_response_too_large" }); });
    sock.on("end", () => { let env; try { env = JSON.parse(buf.toString("utf8").trim()); } catch { return finish({ ok: false, code: "attester_bad_response" }); } if (env && env.ok === true && env.envelope) return finish({ ok: true, envelope: env.envelope }); finish({ ok: false, code: env && env.code ? env.code : "attester_bad_response" }); });
    sock.on("error", () => finish({ ok: false, code: connected ? "attester_bad_response" : "attester_unreachable" }));
  });
}
