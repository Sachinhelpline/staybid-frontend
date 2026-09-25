// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: private-DNS → EXACT-PEER allowlist resolver + refresh (OFFLINE). Node built-ins.
//
// Railway private addresses rotate, so the peer allowlist is derived by resolving an approved
// `<service>.railway.internal` name to its CURRENT A/AAAA records and converting each resolved address to an
// EXACT host range (/32 or /128). Loopback, public, malformed, zero and broad results are rejected; results are
// deduplicated and bounded to the single-replica/service contract. On refresh the new set is validated FULLY
// before it atomically replaces the effective set — there is never a window of broad/unvalidated peer access,
// and a failed refresh keeps the last validated set (never widens) while signalling unhealthy so authority can
// be refused. This is defence-in-depth ONLY: exact peer ranges never replace HMAC authentication.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { PRIVATE_RANGES } from "../private-reader-host-runtime-offline-01/observation-transport.mjs";

export const RAILWAY_INTERNAL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.railway\.internal$/;
export const DEFAULT_MAX_ADDRESSES = 4;          // one single-replica peer, allowing dual-stack (A + AAAA) + slack
export const DEFAULT_RESOLVE_DEADLINE_MS = 3000;

function ipType(a) { const v = net.isIP(a); return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null; }
function isLoopback(addr, type) { return type === "ipv4" ? /^127\./.test(addr) : (addr === "::1"); }
function isUnspecified(addr, type) { return type === "ipv4" ? (addr === "0.0.0.0") : (addr === "::"); }
function isPrivate(addr, type) {
  for (const r of PRIVATE_RANGES) {
    if (r.type !== type) continue;
    const bl = new net.BlockList(); bl.addSubnet(r.net, r.prefix, r.type);
    if (bl.check(addr, type)) return true;
  }
  return false;
}
function normalize(addr) {
  if (typeof addr !== "string") return null;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);   // IPv4-mapped IPv6 → treat as IPv4 host
  return m ? m[1] : addr;
}
function withDeadline(p, ms, reason) {
  let t; const d = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(reason)), Math.max(1, ms)); });
  return Promise.race([Promise.resolve().then(() => p), d]).finally(() => clearTimeout(t));
}

/**
 * Resolve one approved private service name to an EXACT-host CIDR allowlist.
 * @param deps.serviceName `<name>.railway.internal`
 * @param deps.resolver async (name) → [{ address, family }]  (default dns.promises.lookup all+verbatim)
 * @param deps.maxAddresses default 4
 * Returns { ok:true, cidrs:[...], addresses:[{address,type}], observedAtMs } | { ok:false, reason }.
 */
export async function resolvePeerAllowlist(deps) {
  const serviceName = deps && deps.serviceName;
  const maxAddresses = deps && Number.isInteger(deps.maxAddresses) ? deps.maxAddresses : DEFAULT_MAX_ADDRESSES;
  const deadlineMs = deps && Number.isInteger(deps.deadlineMs) ? deps.deadlineMs : DEFAULT_RESOLVE_DEADLINE_MS;
  if (typeof serviceName !== "string" || !RAILWAY_INTERNAL_RE.test(serviceName)) return { ok: false, reason: "service_name_not_railway_internal" };
  let resolver = deps && deps.resolver;
  if (typeof resolver !== "function") {
    resolver = async (name) => { const dns = await import("node:dns"); return dns.promises.lookup(name, { all: true, verbatim: true }); };
  }
  let recs;
  try { recs = await withDeadline(resolver(serviceName), deadlineMs, "dns_deadline"); }
  catch { return { ok: false, reason: "dns_resolution_failed" }; }
  if (!Array.isArray(recs) || recs.length === 0) return { ok: false, reason: "dns_empty" };

  const seen = new Set(); const cidrs = []; const addresses = [];
  for (const rec of recs) {
    const addr = normalize(rec && rec.address);
    const type = addr ? ipType(addr) : null;
    if (!type) return { ok: false, reason: "dns_malformed_address" };            // any bad record fails closed
    if (isUnspecified(addr, type)) return { ok: false, reason: "dns_unspecified_address" };
    if (isLoopback(addr, type)) return { ok: false, reason: "dns_loopback_address" };
    if (!isPrivate(addr, type)) return { ok: false, reason: "dns_public_address" }; // public contamination ⇒ fail closed
    const cidr = type === "ipv4" ? `${addr}/32` : `${addr}/128`;                   // EXACT host only, never broad
    if (seen.has(cidr)) continue;                                                  // dedupe
    seen.add(cidr); cidrs.push(cidr); addresses.push({ address: addr, type });
  }
  if (cidrs.length === 0) return { ok: false, reason: "dns_no_valid_addresses" };
  if (cidrs.length > maxAddresses) return { ok: false, reason: "dns_too_many_addresses" }; // more than a single replica
  cidrs.sort();
  return { ok: true, cidrs, addresses, observedAtMs: null };
}

/**
 * Stateful resolver with atomic, validate-before-swap refresh. `current()` is null until a first successful
 * resolution (⇒ fail closed: no peer admitted). A failed refresh keeps the last validated set and flips
 * `healthy` false so the caller can refuse authority; it never widens the set.
 */
export function createPeerAllowlistResolver(deps) {
  const serviceName = deps && deps.serviceName;
  let currentCidrs = null;
  let healthy = false;
  let lastReason = "never_resolved";
  async function refresh() {
    const r = await resolvePeerAllowlist({ ...deps, serviceName });
    if (!r.ok) { healthy = false; lastReason = r.reason; return { ok: false, reason: r.reason, changed: false }; } // keep old set
    const changed = !currentCidrs || currentCidrs.join(",") !== r.cidrs.join(",");
    currentCidrs = r.cidrs.slice();                     // atomic swap only after full validation
    healthy = true; lastReason = null;
    return { ok: true, cidrs: currentCidrs.slice(), changed };
  }
  return Object.freeze({
    refresh,
    current() { return currentCidrs ? currentCidrs.slice() : null; },
    healthy() { return healthy; },
    get reason() { return lastReason; },
  });
}

/**
 * Peer supervisor (§21/§22): periodically refreshes the exact-host allowlist and drives safety callbacks. On an
 * unsafe refresh (DNS failure / public / malformed / oversize) it KEEPS the last-good set (never widens) and calls
 * onUnsafe(reason); on a validated peer-identity CHANGE it calls onChange(newCidrs, oldCidrs) so the caller can
 * perform the architecture-approved controlled listener recreation / authority invalidation. It never widens the
 * effective set automatically. `start()` uses an unref'd interval (never keeps a process alive); the deterministic
 * core (`refreshOnce`) is exposed for offline tests.
 */
export function createPeerSupervisor(deps) {
  const serviceName = deps && deps.serviceName;
  const intervalMs = deps && Number.isInteger(deps.intervalMs) ? deps.intervalMs : 30000;
  const onUnsafe = typeof (deps && deps.onUnsafe) === "function" ? deps.onUnsafe : () => {};
  const onChange = typeof (deps && deps.onChange) === "function" ? deps.onChange : () => {};
  const resolver = createPeerAllowlistResolver({ ...deps, serviceName });
  let timer = null, stopped = false, last = null;

  async function refreshOnce() {
    const r = await resolver.refresh();
    if (!r.ok) { try { onUnsafe(r.reason); } catch {} return { ok: false, reason: r.reason, current: resolver.current() }; }
    const prev = last;
    if (prev && prev.join(",") !== r.cidrs.join(",")) { try { onChange(r.cidrs.slice(), prev.slice()); } catch {} }
    last = r.cidrs.slice();
    return { ok: true, cidrs: r.cidrs.slice(), changed: prev ? prev.join(",") !== r.cidrs.join(",") : true };
  }
  function start() {
    if (timer || stopped) return;
    timer = setInterval(() => { void refreshOnce(); }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }
  function stop() { stopped = true; if (timer) { clearInterval(timer); timer = null; } }
  return Object.freeze({ refreshOnce, start, stop, current() { return resolver.current(); }, healthy() { return resolver.healthy(); } });
}
