// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — private authenticated OBSERVATION TRANSPORT (OFFLINE). Node built-ins only.
//
// Wire protocol `reader-obs-transport-v1` (unchanged): one newline-terminated JSON request per
// connection → one JSON response. HMAC-SHA256 caller authentication, freshness, single-use nonce,
// the single approved typed op, request/response/concurrency bounds, fixed failure codes only.
//
// Listen modes (explicitly selected — never inferred):
//   • unix            — private Unix-domain socket (intra-container; local/sidecar use)
//   • loopback-tcp    — TCP on 127.0.0.1/::1 only (local tests)
//   • private-network — TCP for a SEPARATE service on a private network (Finding 1). Requires an
//                       explicit literal private bind address, OR a wildcard bind ONLY with an explicit
//                       acknowledgement; ALWAYS a non-empty private peer-CIDR allowlist enforced per
//                       connection; public / loopback / hostname binds are refused. The address/peer
//                       filter is defence-in-depth only — it is NOT authentication; HMAC still is.
//
// Observation deadline (Finding 2): the end-to-end deadline covers observation EXECUTION (not only
// request reception). On expiry the caller gets the fixed code `timeout` and the observation's abort
// signal fires (the reader-only host refuses any further DB query for that observation). The
// concurrency slot is NOT released until the underlying observation actually settles (quarantine) —
// a timeout response is not treated as proof the DB work stopped. If quarantined work outlives
// QUARANTINE_MAX_MS the server becomes sticky-`degraded`: it admits no new work (`unavailable`) and
// reports not-ready, so stalled work can never be replaced by unbounded new work.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { performance } from "node:perf_hooks";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const TRANSPORT_VERSION = "reader-obs-transport-v1";
export const APPROVED_OPS = Object.freeze(["observe"]);
export const MAX_REQUEST_BYTES = 4096;
export const MAX_RESPONSE_BYTES = 65536;
export const REQUEST_TIMEOUT_MS = 5000;        // end-to-end budget from connection accept
export const OBSERVATION_DEADLINE_MS = 3000;    // cap on observation execution within that budget
export const QUARANTINE_MAX_MS = 15000;        // unsettled work older than this ⇒ sticky degraded
export const MAX_CONCURRENT = 8;
export const CLOCK_SKEW_MS = 30000;
export const NONCE_TTL_MS = 120000;
export const MIN_SECRET_LEN = 16;
export const MAX_PEER_CIDRS = 16;

export const LISTEN_MODES = Object.freeze(["unix", "loopback-tcp", "private-network"]);
export const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "::1", "localhost"]);
export const WILDCARD_HOSTS = Object.freeze(["0.0.0.0", "::"]);
// RFC 1918 IPv4 + RFC 4193 IPv6 unique-local. (Railway private networking is IPv6 ULA; the exact
// range is a deferred LIVE verification — see DEPLOYMENT-CONFIG.md.)
export const PRIVATE_RANGES = Object.freeze([
  Object.freeze({ net: "10.0.0.0", prefix: 8, type: "ipv4" }),
  Object.freeze({ net: "172.16.0.0", prefix: 12, type: "ipv4" }),
  Object.freeze({ net: "192.168.0.0", prefix: 16, type: "ipv4" }),
  Object.freeze({ net: "fc00::", prefix: 7, type: "ipv6" }),
]);

const TIMEOUT = Symbol("timeout");
function fail(msg) { throw new Error(msg); }
function ipType(a) { const v = net.isIP(a); return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null; }
function normPeer(a) { if (typeof a !== "string") return null; const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); return m ? m[1] : a; }
function inRange(r, addr) { const bl = new net.BlockList(); bl.addSubnet(r.net, r.prefix, r.type); return bl.check(addr, r.type); }
function containingRange(ranges, addr) { const t = ipType(addr); return ranges.find((r) => r.type === t && inRange(r, addr)) || null; }
function isLoopback(addr) { const t = ipType(addr); return (t === "ipv4" && inRange({ net: "127.0.0.0", prefix: 8, type: "ipv4" }, addr)) || (t === "ipv6" && addr === "::1"); }
function isInt(n, lo, hi) { return Number.isInteger(n) && n >= lo && n <= hi; }

function validateRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > 8) fail("transport_simulated_ranges_invalid");
  return Object.freeze(ranges.map((r) => {
    if (!r || !ipType(r.net) || ipType(r.net) !== r.type || !isInt(r.prefix, 1, r.type === "ipv4" ? 32 : 128)) fail("transport_simulated_ranges_invalid");
    return Object.freeze({ net: r.net, prefix: r.prefix, type: r.type });
  }));
}

/**
 * Validate + resolve a listen configuration WITHOUT binding. Returns
 * { mode, kind:'unix'|'tcp', listenArg, peerAllow|null }. Throws a fixed-code Error on any invalid,
 * public, loopback-in-private-mode, unacknowledged-wildcard or non-private-peer configuration.
 * `testBoundary` is required for port 0 and for `simulatedPrivateRanges` (local simulation only).
 */
export function validateListenConfig(listen, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!listen || typeof listen !== "object") fail("transport_listen_config_absent");
  const { mode } = listen;
  if (!LISTEN_MODES.includes(mode)) fail("transport_listen_mode_invalid");

  if (mode === "unix") {
    if (typeof listen.socketPath !== "string" || listen.socketPath.length === 0) fail("transport_address_invalid");
    return Object.freeze({ mode, kind: "unix", listenArg: listen.socketPath, peerAllow: null });
  }
  if (mode === "loopback-tcp") {
    if (!LOOPBACK_HOSTS.includes(listen.host)) fail("transport_bind_not_loopback");
    if (!isInt(listen.port, 0, 65535)) fail("transport_port_invalid");
    return Object.freeze({ mode, kind: "tcp", listenArg: { host: listen.host, port: listen.port }, peerAllow: null });
  }

  // ── private-network ──
  let ranges = PRIVATE_RANGES;
  if (listen.simulatedPrivateRanges !== undefined) {
    if (!testBoundary) fail("transport_simulated_ranges_require_test_boundary");
    ranges = validateRanges(listen.simulatedPrivateRanges);
  }
  const { bindHost, port, allowedPeerCidrs, allowWildcardBind } = listen;
  if (typeof bindHost !== "string" || bindHost.length === 0) fail("transport_bind_host_required");
  if (WILDCARD_HOSTS.includes(bindHost)) {
    if (allowWildcardBind !== true) fail("transport_wildcard_bind_not_acknowledged"); // never inferred
  } else {
    if (!ipType(bindHost)) fail("transport_bind_host_not_literal_ip");
    if (isLoopback(bindHost)) fail("transport_private_mode_rejects_loopback");
    if (!containingRange(ranges, bindHost)) fail("transport_bind_not_private");
  }
  if (!isInt(port, testBoundary ? 0 : 1, 65535)) fail("transport_port_invalid");
  if (!Array.isArray(allowedPeerCidrs) || allowedPeerCidrs.length === 0 || allowedPeerCidrs.length > MAX_PEER_CIDRS) fail("transport_peer_allowlist_required");
  const peerAllow = new net.BlockList();
  for (const c of allowedPeerCidrs) {
    const m = typeof c === "string" ? /^([^/]+)\/(\d{1,3})$/.exec(c) : null;
    if (!m) fail("transport_peer_cidr_invalid");
    const addr = m[1], prefix = Number(m[2]), t = ipType(addr);
    if (!t || !isInt(prefix, 0, t === "ipv4" ? 32 : 128)) fail("transport_peer_cidr_invalid"); // /0 then refused as not private
    const r = containingRange(ranges, addr);
    if (!r || prefix < r.prefix) fail("transport_peer_cidr_not_private"); // e.g. 0.0.0.0/0, 10.0.0.0/4
    peerAllow.addSubnet(addr, prefix, t);
  }
  return Object.freeze({ mode, kind: "tcp", listenArg: { host: bindHost, port }, peerAllow });
}

// legacy options → explicit listen config (unix / loopback-tcp only)
function legacyListen({ socketPath, tcp }) {
  if (tcp !== undefined && tcp !== null) return { mode: "loopback-tcp", host: tcp.host, port: tcp.port };
  return { mode: "unix", socketPath };
}

function canonArgs(args) { return JSON.stringify(args === undefined ? null : args); }
function macFor(secret, v, op, args, nonce, ts) {
  return createHmac("sha256", secret).update([v, op, canonArgs(args), nonce, String(ts)].join("\n")).digest("hex");
}
function eqHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); } catch { return false; }
}
function tighter(value, def) {
  if (value === undefined) return def;
  if (!isInt(value, 1, def)) fail("transport_limit_invalid"); // limits may only be tightened
  return value;
}

/**
 * Start the observation server. `listen` = explicit listen config (see validateListenConfig); legacy
 * `socketPath` / `tcp` still map to unix / loopback-tcp. `host` = reader-only host (observe(req, {signal})).
 * `limits` may only TIGHTEN the defaults. Returns { address, unixSocket, mode, health(), close() }.
 */
export function startObservationServer(opts) {
  const { host, secret, nowProvider, log, testBoundary } = opts;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LEN) throw new Error("transport_secret_invalid");
  if (!host || typeof host.observe !== "function") throw new Error("transport_host_invalid");
  const target = validateListenConfig(opts.listen || legacyListen(opts), { testBoundary });
  const L = opts.limits || {};
  const requestTimeoutMs = tighter(L.requestTimeoutMs, REQUEST_TIMEOUT_MS);
  const observationDeadlineMs = tighter(L.observationDeadlineMs, OBSERVATION_DEADLINE_MS);
  const quarantineMaxMs = tighter(L.quarantineMaxMs, QUARANTINE_MAX_MS);
  const maxConcurrent = tighter(L.maxConcurrent, MAX_CONCURRENT);
  const now = typeof nowProvider === "function" ? nowProvider : Date.now; // protocol freshness clock
  const seenNonces = new Map();
  const inflight = new Map(); // id -> monotonic start (held until the observation truly settles)
  const sockets = new Set();
  let seq = 0; let degraded = false; let closing = false;

  function checkDegraded() {
    if (degraded) return true;
    const t = performance.now();
    for (const start of inflight.values()) if (t - start > quarantineMaxMs) { degraded = true; break; }
    return degraded;
  }

  const server = net.createServer((sock) => {
    sockets.add(sock); sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {}); // a peer reset (incl. a refused peer) must never crash the process
    if (target.peerAllow) {
      const p = normPeer(sock.remoteAddress); const t = p ? ipType(p) : null;
      if (!t || !target.peerAllow.check(p, t)) return endObj(sock, { ok: false, code: "peer_not_allowed" });
    }
    const t0 = performance.now();
    let buf = ""; let handled = false;
    sock.setEncoding("utf8");
    const timer = setTimeout(() => { if (!handled) { handled = true; endObj(sock, { ok: false, code: "timeout" }); } }, requestTimeoutMs);
    sock.on("error", () => { handled = true; clearTimeout(timer); });
    sock.on("data", (chunk) => {
      if (handled) return;
      buf += chunk;
      if (Buffer.byteLength(buf, "utf8") > MAX_REQUEST_BYTES) { handled = true; clearTimeout(timer); return endObj(sock, { ok: false, code: "request_too_large" }); }
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      handled = true; clearTimeout(timer);
      void handleLine(buf.slice(0, nl), sock, t0);
    });
  });

  async function handleLine(line, sock, t0) {
    try {
      let req; try { req = JSON.parse(line); } catch { return endObj(sock, { ok: false, code: "bad_request" }); }
      if (!req || typeof req !== "object" || Array.isArray(req)) return endObj(sock, { ok: false, code: "bad_request" });
      const { v, op, args, nonce, ts, mac } = req;
      if (v !== TRANSPORT_VERSION) return endObj(sock, { ok: false, code: "unsupported_version" });
      if (typeof op !== "string" || !APPROVED_OPS.includes(op)) return endObj(sock, { ok: false, code: "unknown_op" });
      if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) return endObj(sock, { ok: false, code: "bad_request" });
      if (typeof ts !== "number" || !Number.isFinite(ts)) return endObj(sock, { ok: false, code: "bad_request" });
      if (typeof mac !== "string" || mac.length !== 64) return endObj(sock, { ok: false, code: "unauthenticated" });
      const a = args && typeof args === "object" && !Array.isArray(args) ? args : null;
      if (!a) return endObj(sock, { ok: false, code: "bad_request" });
      const n = now();
      if (Math.abs(n - ts) > CLOCK_SKEW_MS) return endObj(sock, { ok: false, code: "stale" });
      if (!eqHex(mac, macFor(secret, v, op, a, nonce, ts))) return endObj(sock, { ok: false, code: "unauthenticated" });
      for (const [k, exp] of seenNonces) if (exp <= n) seenNonces.delete(k);
      if (seenNonces.has(nonce)) return endObj(sock, { ok: false, code: "replayed" });
      seenNonces.set(nonce, n + NONCE_TTL_MS);
      if (op !== "observe") return endObj(sock, { ok: false, code: "unauthorized_op" });
      const keys = Object.keys(a);
      if (keys.length !== 1 || keys[0] !== "observation" || typeof a.observation !== "string") return endObj(sock, { ok: false, code: "bad_args" });

      // ── admission: fail closed while degraded; bounded concurrency incl. quarantined work ──
      if (closing || checkDegraded()) return endObj(sock, { ok: false, code: "unavailable" });
      if (inflight.size >= maxConcurrent) return endObj(sock, { ok: false, code: "busy" });
      const remaining = Math.min(observationDeadlineMs, requestTimeoutMs - (performance.now() - t0));
      if (remaining <= 0) return endObj(sock, { ok: false, code: "timeout" });

      const id = ++seq;
      inflight.set(id, performance.now());
      const ac = new AbortController();
      const work = Promise.resolve().then(() => host.observe({ observation: a.observation }, { signal: ac.signal }));
      // the slot is released ONLY when the underlying observation settles — never on timeout
      work.then(() => {}, () => {}).finally(() => { inflight.delete(id); });
      let dl;
      const deadline = new Promise((res) => { dl = setTimeout(() => res(TIMEOUT), remaining); });
      const r = await Promise.race([work.then((m) => ({ m }), () => ({ err: true })), deadline]);
      clearTimeout(dl);
      if (r === TIMEOUT) { ac.abort(); return endObj(sock, { ok: false, code: "timeout" }); } // work stays quarantined
      if (r.err) return endObj(sock, { ok: false, code: "internal" });
      const s = JSON.stringify({ ok: true, message: r.m });
      if (Buffer.byteLength(s, "utf8") > MAX_RESPONSE_BYTES) return endObj(sock, { ok: false, code: "response_too_large" });
      return endRaw(sock, s);
    } catch { return endObj(sock, { ok: false, code: "internal" }); }
  }

  function endObj(sock, obj) { endRaw(sock, JSON.stringify(obj)); }
  function endRaw(sock, s) { try { sock.end(s + "\n"); } catch {} }

  return new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("transport_listen_failed")));
    server.listen(target.listenArg, () => {
      const unix = target.kind === "unix";
      const a = server.address();
      const address = unix ? target.listenArg : { host: a.address, port: a.port };
      (log || (() => {}))(JSON.stringify({ transport: TRANSPORT_VERSION, listening: true, mode: target.mode, peerFiltered: !!target.peerAllow }));
      resolve(Object.freeze({
        address, unixSocket: unix, mode: target.mode,
        health() { return { active: inflight.size, degraded: checkDegraded(), maxConcurrent }; },
        async close() {
          closing = true;
          for (const s of sockets) { try { s.destroy(); } catch {} }
          return new Promise((res) => server.close(() => res(true)));
        },
      }));
    });
  });
}

/** Legitimate downstream caller / test client (unix socket or TCP host:port). */
export function createObservationClient({ socketPath, tcp, secret, nowProvider }) {
  const now = typeof nowProvider === "function" ? nowProvider : Date.now;
  const connectArg = (tcp !== undefined && tcp !== null) ? { host: tcp.host, port: tcp.port } : socketPath;
  return {
    async request(op, args, overrides = {}) {
      const v = TRANSPORT_VERSION;
      const a = args || {};
      const nonce = overrides.nonce !== undefined ? overrides.nonce : randomBytes(12).toString("hex");
      const ts = overrides.ts !== undefined ? overrides.ts : now();
      const mac = overrides.mac !== undefined ? overrides.mac : (overrides.badMac ? "0".repeat(64) : macFor(secret, v, op, a, nonce, ts));
      const wire = overrides.raw !== undefined ? overrides.raw : (JSON.stringify({ v, op, args: a, nonce, ts, mac }) + "\n");
      return new Promise((resolve, reject) => {
        const sock = net.createConnection(connectArg, () => { try { sock.write(wire); } catch (e) { reject(e); } });
        let buf = ""; sock.setEncoding("utf8");
        const t = setTimeout(() => { try { sock.destroy(); } catch {} reject(new Error("client_timeout")); }, REQUEST_TIMEOUT_MS + 2000);
        sock.on("data", (d) => { buf += d; });
        sock.on("end", () => { clearTimeout(t); try { resolve(JSON.parse(buf.trim() || "{}")); } catch { resolve({ ok: false, code: "bad_response" }); } });
        sock.on("error", (e) => { clearTimeout(t); reject(e); });
      });
    },
    observe(observation, overrides) { return this.request("observe", { observation }, overrides); },
  };
}
