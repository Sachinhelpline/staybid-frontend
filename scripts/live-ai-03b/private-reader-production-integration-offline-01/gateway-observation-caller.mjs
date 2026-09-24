// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — authenticated GATEWAY CALLER for the accepted private-reader observation transport
// (`reader-obs-transport-v1`, OFFLINE). Node built-ins only.
//
// A bounded, versioned downstream caller the voice gateway can later wire in (the live gateway is NOT
// modified or connected here). It holds only the caller-auth transport secret — never a DB credential,
// readerDbClient or executorDbClient — and can ask for exactly the three approved observations.
//   • destination: a configured private-network endpoint only (Railway private DNS name
//     `*.railway.internal` or a literal RFC1918 / RFC4193 address); URLs, public addresses, loopback
//     and hostnames outside the private suffix are refused before any connection is attempted;
//   • request: the accepted envelope {v, op:"observe", args:{observation}, nonce, ts, mac} with
//     mac = HMAC-SHA256(secret, v⏎op⏎JSON(args)⏎nonce⏎ts) — the accepted canonical contract;
//     fresh ts + a new 128-bit nonce per call; NO automatic retry (never reuses a nonce);
//   • bounds: connect deadline, total deadline, response size cap (accepted MAX_RESPONSE_BYTES);
//   • response: must be the accepted envelope; a success message must pass the ACCEPTED outward guard
//     (assertOutwardMessage), match the requested phase and the expected mode; failure codes are
//     mapped to fixed caller codes. Nothing from the secret or the wire error text is returned/logged.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { TRANSPORT_VERSION, APPROVED_OPS, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, MIN_SECRET_LEN, PRIVATE_RANGES } from "../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { OBSERVATIONS, ERROR_CODES, assertOutwardMessage } from "../private-reader-host-offline-01/private-reader-host.mjs";

export const CALLER_VERSION = "reader-gateway-caller-v1";
export const PRIVATE_DNS_SUFFIX = ".railway.internal";
export const CONNECT_TIMEOUT_MS = 1500;
export const TOTAL_TIMEOUT_MS = REQUEST_TIMEOUT_MS + 1000; // server budget + transit margin
// fixed failure codes the accepted transport can return (source: observation-transport.mjs)
export const READER_TRANSPORT_CODES = Object.freeze(["unauthenticated", "stale", "replayed", "unknown_op", "unauthorized_op", "unsupported_version",
  "bad_args", "bad_request", "request_too_large", "response_too_large", "busy", "timeout", "unavailable", "peer_not_allowed", "internal"]);
export const CALLER_CODES = Object.freeze(["config_invalid", "observation_not_approved", "reader_unreachable", "deadline_exceeded", "response_too_large",
  "bad_response", "reader_rejected", "observation_failed"]);
const HOST_CODES = new Set(ERROR_CODES);
const WIRE_CODES = new Set(READER_TRANSPORT_CODES);

function fail(code, extra) { return Object.freeze({ ok: false, code, ...(extra || {}) }); }
function inRanges(addr, ranges) {
  const t = net.isIP(addr) === 4 ? "ipv4" : net.isIP(addr) === 6 ? "ipv6" : null; if (!t) return false;
  return ranges.some((r) => { if (r.type !== t) return false; const bl = new net.BlockList(); bl.addSubnet(r.net, r.prefix, r.type); return bl.check(addr, t); });
}

/** Validate the configured destination. Loopback is permitted ONLY under an explicit offline test boundary. */
export function validateDestination(dest, { offlineTestBoundary = false } = {}) {
  if (!dest || typeof dest !== "object" || Array.isArray(dest)) return fail("config_invalid", { reason: "destination_absent" });
  const keys = Object.keys(dest).sort().join(",");
  if (keys !== "host,port") return fail("config_invalid", { reason: "destination_shape" });
  const { host, port } = dest;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail("config_invalid", { reason: "destination_port" });
  if (typeof host !== "string" || host.length === 0 || host.length > 253 || /[\/@\s?#]|:\/\//.test(host)) return fail("config_invalid", { reason: "destination_host" });
  if (net.isIP(host)) {
    const loop = host === "::1" || inRanges(host, [{ net: "127.0.0.0", prefix: 8, type: "ipv4" }]);
    if (loop) return offlineTestBoundary ? { ok: true } : fail("config_invalid", { reason: "destination_loopback" });
    return inRanges(host, PRIVATE_RANGES) ? { ok: true } : fail("config_invalid", { reason: "destination_not_private" });
  }
  const h = host.toLowerCase();
  if (!h.endsWith(PRIVATE_DNS_SUFFIX) || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h)) return fail("config_invalid", { reason: "destination_not_private_dns" });
  return { ok: true };
}

export function macFor(secret, v, op, args, nonce, ts) {
  return createHmac("sha256", secret).update([v, op, JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex");
}

/**
 * @param opts.destination { host, port } — the approved private reader endpoint (validated here)
 * @param opts.secret caller-auth transport secret (≥16 chars; from the gateway's own secret store)
 * @param opts.expectedMode 'production' (default) | 'test' (only with offlineTestBoundary)
 * @param opts.nowProvider clock for the request timestamp
 */
export function createGatewayObservationCaller(opts = {}) {
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
    if (typeof observation !== "string" || !OBSERVATIONS.includes(observation)) return fail("observation_not_approved");
    const v = TRANSPORT_VERSION; const op = APPROVED_OPS[0]; const args = { observation };
    const nonce = randomBytes(16).toString("hex"); const ts = now();
    const line = JSON.stringify({ v, op, args, nonce, ts, mac: macFor(secret, v, op, args, nonce, ts) }) + "\n";
    const r = await exchange(line);
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
    if (!assertOutwardMessage(m).ok) return fail("bad_response");                  // accepted outward guard
    if (m.mode !== expectedMode) return fail("bad_response");
    if (m.ok === false) return HOST_CODES.has(m.code) ? fail("observation_failed", { hostCode: m.code }) : fail("bad_response");
    if (m.phase !== observation) return fail("bad_response");
    return Object.freeze({ ok: true, message: m });
  }

  return Object.freeze({ available: true, version: CALLER_VERSION, destination: dest, observe });
}
