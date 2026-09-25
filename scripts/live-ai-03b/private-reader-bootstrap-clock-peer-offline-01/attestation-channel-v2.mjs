// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: CLOCK-GATED attestation channel v2 (OFFLINE). Node built-ins only.
//
// A NEW versioned channel (v1 accepted source is untouched). The v2 authenticated request binds the reader's
// fresh clock interval + bootstrap generation IN ADDITION to the accepted authority fields, all under one
// HMAC of the same construction strength as v1 (extended to cover the clock evidence). The attester enforces a
// PRE-SIGN CLOCK GUARD: no signature unless request auth + lifecycle + anchor + observer + privilege evidence
// are all valid AND the attester's own clock monitor is fresh AND the conservative reader↔attester pairwise
// interval ≤ 500 ms. The v2 server COMPOSES the accepted primitives (observer coordinator, evidence evaluator,
// target binding, signing adapter) — it does not fork their security semantics.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CHANNEL_MAX_REQUEST_BYTES, CHANNEL_MAX_RESPONSE_BYTES, MIN_CHANNEL_SECRET_LEN } from "../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { ATTESTATION_CONTRACT } from "../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { READER_ROLE } from "../private-reader-attester-offline-01/evidence-queries.mjs";
import { evidenceIsAttestable } from "../private-reader-attester-offline-01/evidence-evaluator.mjs";
import { resolveTarget } from "../private-reader-attester-offline-01/target-binding.mjs";
import { createObserverCoordinator, makeRequestContext } from "../private-reader-attester-offline-01/observer-connection.mjs";
import { pairwiseInterval, PAIRWISE_ABS_BOUND_US } from "./clock-interval.mjs";

export const V2_CHANNEL_VERSION = "reader-attestation-channel-v2";
export const V2_CHANNEL_OP = "attest";
export const V2_CLOCK_SKEW_MS = 30000;
export const V2_NONCE_TTL_MS = 120000;
export const V2_MAX_TRACKED_NONCES = 4096;
export const V2_REQUEST_BUDGET_MS = 1900;    // caller-safe budget parity with the accepted attester
export const V2_WIRE_CODES = Object.freeze(["unauthenticated", "stale", "replayed", "bad_request", "unknown_op", "unsupported_version", "no_such_session", "clock_gate_failed", "busy", "unavailable", "internal"]);
const HEX64 = /^[0-9a-f]{64}$/, HEX32 = /^[0-9a-f]{32}$/;
const isInt = (n) => Number.isInteger(n) && Number.isSafeInteger(n);

// Clock evidence is serialized unambiguously (no JSON key-order dependence) and covered by the MAC.
function clockField(clk) { return `${clk.L}|${clk.U}|${clk.generation}`; }
export function v2Mac(secret, v, op, args, clk, nonce, ts) {
  return createHmac("sha256", secret).update([v, op, JSON.stringify(args), clockField(clk), nonce, String(ts)].join("\n")).digest("hex");
}
function macOk(mac, expected) {
  if (typeof mac !== "string" || mac.length !== 64) return false;
  try { return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex")); } catch { return false; }
}

/** Build the v2 wire line the reader sends (args exact; clock = reader's fresh interval + bootstrap generation). */
export function buildV2Request({ channelSecret, connectionToken, requestNonce, readerClock, nonce, ts }) {
  const args = { contract: ATTESTATION_CONTRACT, connectionToken, role: READER_ROLE, requestNonce };
  const clk = { L: readerClock.L, U: readerClock.U, generation: readerClock.generation };
  const mac = v2Mac(channelSecret, V2_CHANNEL_VERSION, V2_CHANNEL_OP, args, clk, nonce, ts);
  return JSON.stringify({ v: V2_CHANNEL_VERSION, op: V2_CHANNEL_OP, args, clock: clk, nonce, ts, mac }) + "\n";
}

/** Parse + authenticate a v2 request frame (schema, size, version/op, freshness, nonce, HMAC, clock shape). */
export function verifyV2RequestFrame(line, { channelSecret, nowMs, seenNonces }) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > CHANNEL_MAX_REQUEST_BYTES) return { ok: false, code: "bad_request" };
  let req; try { req = JSON.parse(line); } catch { return { ok: false, code: "bad_request" }; }
  if (!req || typeof req !== "object" || Array.isArray(req)) return { ok: false, code: "bad_request" };
  if (req.v !== V2_CHANNEL_VERSION) return { ok: false, code: "unsupported_version" };
  if (req.op !== V2_CHANNEL_OP) return { ok: false, code: "unknown_op" };
  if (JSON.stringify(Object.keys(req).sort()) !== JSON.stringify(["args", "clock", "mac", "nonce", "op", "ts", "v"])) return { ok: false, code: "bad_request" };
  const { args, clock, nonce, ts, mac } = req;
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128) return { ok: false, code: "bad_request" };
  if (!isInt(ts)) return { ok: false, code: "bad_request" };
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, code: "bad_request" };
  if (JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(["connectionToken", "contract", "requestNonce", "role"])) return { ok: false, code: "bad_request" };
  if (args.contract !== ATTESTATION_CONTRACT || args.role !== READER_ROLE) return { ok: false, code: "bad_request" };
  if (!HEX64.test(args.connectionToken) || !HEX32.test(args.requestNonce)) return { ok: false, code: "bad_request" };
  if (!clock || typeof clock !== "object" || Array.isArray(clock)) return { ok: false, code: "bad_request" };
  if (JSON.stringify(Object.keys(clock).sort()) !== JSON.stringify(["L", "U", "generation"])) return { ok: false, code: "bad_request" };
  if (!isInt(clock.L) || !isInt(clock.U) || clock.U < clock.L) return { ok: false, code: "bad_request" };
  if (typeof clock.generation !== "string" || !HEX32.test(clock.generation)) return { ok: false, code: "bad_request" };
  if (Math.abs(nowMs - ts) > V2_CLOCK_SKEW_MS) return { ok: false, code: "stale" };
  if (!macOk(mac, v2Mac(channelSecret, req.v, req.op, args, clock, nonce, ts))) return { ok: false, code: "unauthenticated" };
  if (seenNonces && seenNonces.has(nonce)) return { ok: false, code: "replayed" };
  return { ok: true, args, clock, nonce, ts };
}

/**
 * PURE pre-sign clock guard (§12). Returns { ok:true } only when EVERY authority + clock precondition holds.
 * readerInterval is the (authenticated) reader interval from the request; attesterInterval is the attester's
 * OWN fresh monitor interval (null ⇒ fail closed). Both measured against the shared DB clock, so the pairwise
 * difference cancels the DB offset.
 */
export function preSignClockGuard(g) {
  if (!g.requestAuthenticated) return { ok: false, reason: "request_unauthenticated" };
  if (!g.ctxLive) return { ok: false, reason: "request_not_live" };
  if (!g.anchorOk) return { ok: false, reason: "anchor_invalid" };
  if (!g.observerOk) return { ok: false, reason: "observer_invalid" };
  if (!g.evidenceAttestable) return { ok: false, reason: "evidence_not_attestable" };
  if (!g.generationOk) return { ok: false, reason: "generation_invalid" };
  const rd = g.readerInterval, at = g.attesterInterval;
  if (!rd || !isInt(rd.L) || !isInt(rd.U) || rd.U < rd.L) return { ok: false, reason: "reader_clock_invalid" };
  if (!at || !isInt(at.L) || !isInt(at.U) || at.U < at.L) return { ok: false, reason: "attester_clock_stale" };
  const pi = pairwiseInterval(rd, at);
  if (!pi || pi.absBoundUs > PAIRWISE_ABS_BOUND_US) return { ok: false, reason: "pairwise_bound_exceeded" };
  return { ok: true, pairwise: pi };
}

function buildPeerAllow(cidrs, { offlineTestBoundary }) {
  if (!Array.isArray(cidrs) || cidrs.length === 0) return null;      // no allowlist ⇒ admit nobody (fail closed)
  const bl = new net.BlockList();
  for (const c of cidrs) {
    const m = typeof c === "string" ? /^([^/]+)\/(\d{1,3})$/.exec(c) : null;
    if (!m) return null;
    const addr = m[1], prefix = Number(m[2]); const v = net.isIP(addr); const t = v === 4 ? "ipv4" : v === 6 ? "ipv6" : null;
    if (!t) return null;
    const loop = addr === "::1" || /^127\./.test(addr);
    if (loop && !offlineTestBoundary) return null;
    // v2 peer allowlist is EXACT hosts only
    if ((t === "ipv4" && prefix !== 32) || (t === "ipv6" && prefix !== 128)) return null;
    bl.addSubnet(addr, prefix, t);
  }
  return bl;
}
function normPeer(a) { if (typeof a !== "string") return null; const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); return m ? m[1] : a; }

/**
 * Start the v2 clock-gated attestation server. Composes accepted primitives + the clock gate.
 * @param deps.observerProvider async () → { ok, observer } (wrapped in the accepted bounded coordinator)
 * @param deps.signer accepted signing adapter
 * @param deps.anchor parsed deployment anchor (required)
 * @param deps.attesterClockInterval () → { L,U } | null  — the attester monitor's fresh interval (null ⇒ gate fails)
 * @param deps.signingEnabled () → boolean — false while the attester is BOOTSTRAP_LISTENING but not clock-ready
 * @param deps.peerCidrs exact-host CIDR allowlist (from the private-peer resolver)
 */
export async function startV2AttestationServer(deps) {
  const { channelSecret, listen, observerProvider, signer, anchor, attesterClockInterval, signingEnabled, peerCidrs, nowMs = Date.now, log, offlineTestBoundary = false } = deps;
  if (typeof channelSecret !== "string" || channelSecret.length < MIN_CHANNEL_SECRET_LEN) throw new Error("v2_channel_secret_invalid");
  if (!signer || typeof signer.issue !== "function") throw new Error("v2_signer_absent");
  if (!anchor) throw new Error("v2_anchor_absent");
  if (typeof observerProvider !== "function") throw new Error("v2_observer_absent");
  if (typeof attesterClockInterval !== "function") throw new Error("v2_attester_clock_absent");
  const peerAllow = buildPeerAllow(peerCidrs || [], { offlineTestBoundary });
  if (!peerAllow) throw new Error("v2_peer_allowlist_invalid");
  const coordinator = createObserverCoordinator({ provider: observerProvider, nowProvider: nowMs });
  const nonces = new Map(); const sockets = new Set(); let closing = false;
  const counters = { requests: 0, signed: 0, refused: 0, clockRefused: 0 };
  const enabled = typeof signingEnabled === "function" ? signingEnabled : () => true;

  function sweep(now) { for (const [k, e] of nonces) if (e <= now) nonces.delete(k); if (nonces.size > V2_MAX_TRACKED_NONCES) { const drop = nonces.size - V2_MAX_TRACKED_NONCES; let i = 0; for (const k of nonces.keys()) { if (i++ >= drop) break; nonces.delete(k); } } }

  async function handle(line, ctx) {
    counters.requests++;
    const now = nowMs();
    const v = verifyV2RequestFrame(line, { channelSecret, nowMs: now, seenNonces: nonces });
    if (!v.ok) return { ok: false, code: v.code };
    nonces.set(v.nonce, now + V2_NONCE_TTL_MS); sweep(now);
    if (closing || !enabled()) return { ok: false, code: "unavailable" };   // BOOTSTRAP_LISTENING but signing disabled
    if (!ctx.live()) return { ok: false, code: "unavailable" };
    const obs = await coordinator.observe(v.args.connectionToken, { nowProvider: nowMs, context: ctx });
    if (!obs.ok) { counters.refused++; return { ok: false, code: obs.reason === "no_such_session" || obs.reason === "no_reader_session_observed" || obs.reason === "ambiguous_session" ? "no_such_session" : (obs.reason === "observer_busy" ? "busy" : "unavailable") }; }
    const clean = evidenceIsAttestable(obs.evidence);
    const tgt = clean.ok ? resolveTarget(anchor, obs.evidence.cluster) : { ok: false };
    // ── PRE-SIGN CLOCK GUARD ──
    const guard = preSignClockGuard({
      requestAuthenticated: true, ctxLive: ctx.live(), anchorOk: tgt.ok, observerOk: true,
      evidenceAttestable: clean.ok, generationOk: HEX32.test(v.clock.generation),
      readerInterval: { L: v.clock.L, U: v.clock.U }, attesterInterval: attesterClockInterval(),
    });
    if (!guard.ok) { counters.refused++; counters.clockRefused++; return { ok: false, code: guard.reason === "evidence_not_attestable" || guard.reason === "anchor_invalid" ? "unavailable" : "clock_gate_failed" }; }
    if (!ctx.live()) { counters.refused++; return { ok: false, code: "unavailable" }; }
    const issued = signer.issue({ requestNonce: v.args.requestNonce, target: tgt.target, connection: obs.evidence.connection, privileges: obs.evidence.privileges });
    if (!issued.ok) { counters.refused++; return { ok: false, code: "internal" }; }
    if (!ctx.live()) { counters.refused++; return { ok: false, code: "unavailable" }; }
    counters.signed++;
    return { ok: true, envelope: issued.envelope };
  }

  const server = net.createServer((sock) => {
    sockets.add(sock); let buf = ""; let settled = false;
    const ctx = makeRequestContext(V2_REQUEST_BUDGET_MS);
    sock.on("close", () => { sockets.delete(sock); if (!settled) ctx.cancel("caller_disconnect"); });
    sock.on("error", () => {});
    const peer = normPeer(sock.remoteAddress); const t = peer ? (net.isIP(peer) === 4 ? "ipv4" : net.isIP(peer) === 6 ? "ipv6" : null) : null;
    if (!t || !peerAllow.check(peer, t)) { settled = true; try { sock.end(JSON.stringify({ ok: false, code: "unauthenticated" }) + "\n"); } catch {} return; }
    sock.setEncoding("utf8");
    const finish = (res) => { if (settled) return; settled = true; clearTimeout(timer); let s = JSON.stringify(res); if (Buffer.byteLength(s, "utf8") > CHANNEL_MAX_RESPONSE_BYTES) s = JSON.stringify({ ok: false, code: "internal" }); try { sock.end(s + "\n"); } catch {} };
    const timer = setTimeout(() => { ctx.cancel("request_deadline"); finish({ ok: false, code: "unavailable" }); }, V2_REQUEST_BUDGET_MS);
    sock.on("data", (chunk) => {
      if (settled) return; buf += chunk;
      if (Buffer.byteLength(buf, "utf8") > CHANNEL_MAX_REQUEST_BYTES) { finish({ ok: false, code: "bad_request" }); return; }
      const nl = buf.indexOf("\n"); if (nl < 0) return;
      const line = buf.slice(0, nl);
      void handle(line, ctx).then(finish, () => finish({ ok: false, code: "internal" }));
    });
  });

  return await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("v2_listen_failed")));
    server.listen({ host: listen.bindHost, port: listen.port }, () => {
      const a = server.address();
      resolve(Object.freeze({
        address: { host: a.address, port: a.port },
        stats() { return { ...counters, observer: coordinator.stats() }; },
        async close() { closing = true; for (const s of sockets) { try { s.destroy(); } catch {} } try { await coordinator.shutdown({ deadlineMs: 3000 }); } catch {} return new Promise((r) => { let d = false; const to = setTimeout(() => { if (!d) { d = true; r(true); } }, 1000); try { server.close(() => { if (!d) { d = true; clearTimeout(to); r(true); } }); } catch { if (!d) { d = true; r(true); } } }); },
      }));
    });
  });
}
