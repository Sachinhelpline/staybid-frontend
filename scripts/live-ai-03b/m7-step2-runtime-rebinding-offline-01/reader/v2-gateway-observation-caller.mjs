// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — authenticated V2 GATEWAY CALLER for the private reader. OFFLINE.
//
// Successor of private-reader-production-integration-offline-01/gateway-observation-caller.mjs (V1,
// frozen: V1 observations + V1 outward guard). Same wire (`reader-obs-transport-v1`, HMAC-SHA256,
// fresh ts + 128-bit nonce per call, NO automatic retry, connect/total deadlines, response size cap) and
// the SAME destination policy (private DNS `*.railway.internal` / RFC1918 / RFC4193; loopback ONLY under
// an explicit offline test boundary). A success response must pass the V2 outward guard, match the
// requested V2 phase and the expected mode. Holds ONLY the caller-auth transport secret — never a DB
// credential. The live gateway is NOT modified or connected by this module.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { randomBytes } from "node:crypto";
import { TRANSPORT_VERSION, APPROVED_OPS, MAX_RESPONSE_BYTES, MIN_SECRET_LEN } from "../../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { validateDestination, macFor, READER_TRANSPORT_CODES, CONNECT_TIMEOUT_MS, TOTAL_TIMEOUT_MS, CALLER_CODES } from "../../private-reader-production-integration-offline-01/gateway-observation-caller.mjs";
import { OBSERVATIONS_V2, ERROR_CODES, assertOutwardMessageV2 } from "./v2-observation-contract.mjs";

export { CALLER_CODES };
export const CALLER_VERSION_V2 = "reader-gateway-caller-v2";
const HOST_CODES = new Set(ERROR_CODES);
const WIRE_CODES = new Set(READER_TRANSPORT_CODES);
function fail(code, extra) { return Object.freeze({ ok: false, code, ...(extra || {}) }); }

export function createGatewayObservationCallerV2(opts = {}) {
  const { destination, secret, nowProvider, offlineTestBoundary = false } = opts;
  const expectedMode = opts.expectedMode === undefined ? "production" : opts.expectedMode;
  const dv = validateDestination(destination, { offlineTestBoundary });
  if (!dv.ok) return Object.freeze({ available: false, code: dv.code, reason: dv.reason });
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) return Object.freeze({ available: false, code: "config_invalid", reason: "secret_absent" });
  if (expectedMode !== "production" && !(expectedMode === "test" && offlineTestBoundary === true)) return Object.freeze({ available: false, code: "config_invalid", reason: "mode" });
  const connectTimeoutMs = Number.isInteger(opts.connectTimeoutMs) && opts.connectTimeoutMs > 0 && opts.connectTimeoutMs <= CONNECT_TIMEOUT_MS ? opts.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const totalTimeoutMs = Number.isInteger(opts.totalTimeoutMs) && opts.totalTimeoutMs > 0 && opts.totalTimeoutMs <= TOTAL_TIMEOUT_MS ? opts.totalTimeoutMs : TOTAL_TIMEOUT_MS;
  const now = typeof nowProvider === "function" ? nowProvider : Date.now;
  const dest = Object.freeze({ host: destination.host, port: destination.port });

  function exchange(line) {
    return new Promise((resolve) => {
      let done = false; let buf = Buffer.alloc(0); let connected = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(tConn); clearTimeout(tAll); try { sock.destroy(); } catch {} resolve(r); };
      const sock = net.createConnection({ host: dest.host, port: dest.port });
      const tConn = setTimeout(() => { if (!connected) finish({ err: "reader_unreachable" }); }, connectTimeoutMs);
      const tAll = setTimeout(() => finish({ err: "deadline_exceeded" }), totalTimeoutMs);
      sock.on("connect", () => { connected = true; clearTimeout(tConn); try { sock.write(line); } catch { finish({ err: "reader_unreachable" }); } });
      sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (buf.length > MAX_RESPONSE_BYTES + 1) finish({ err: "response_too_large" }); });
      sock.on("end", () => finish({ body: buf.toString("utf8") }));
      sock.on("error", () => finish({ err: connected ? "bad_response" : "reader_unreachable" }));
    });
  }

  async function observe(observation) {
    if (typeof observation !== "string" || !OBSERVATIONS_V2.includes(observation)) return fail("observation_not_approved");
    const v = TRANSPORT_VERSION; const op = APPROVED_OPS[0]; const args = { observation };
    const nonce = randomBytes(16).toString("hex"); const ts = now();
    const r = await exchange(JSON.stringify({ v, op, args, nonce, ts, mac: macFor(secret, v, op, args, nonce, ts) }) + "\n");
    if (r.err) return fail(r.err);
    let env;
    try { env = JSON.parse(r.body.trim()); } catch { return fail("bad_response"); }
    if (!env || typeof env !== "object" || Array.isArray(env)) return fail("bad_response");
    if (env.ok === false) {
      if (Object.keys(env).sort().join(",") !== "code,ok" || !WIRE_CODES.has(env.code)) return fail("bad_response");
      return fail("reader_rejected", { readerCode: env.code });
    }
    if (env.ok !== true || Object.keys(env).sort().join(",") !== "message,ok") return fail("bad_response");
    const m = env.message;
    if (!assertOutwardMessageV2(m).ok) return fail("bad_response");
    if (m.mode !== expectedMode) return fail("bad_response");
    if (m.ok === false) return HOST_CODES.has(m.code) ? fail("observation_failed", { hostCode: m.code }) : fail("bad_response");
    if (m.phase !== observation) return fail("bad_response");
    return Object.freeze({ ok: true, message: m });
  }
  return Object.freeze({ available: true, version: CALLER_VERSION_V2, destination: dest, observe });
}
