// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §28 — CLOCK-GATED SIGNING AUTHORITY (OFFLINE). Node built-ins only.
// Real Ed25519 signer + real least-privilege observer (synthetic cluster) + real loopback sockets. Proves the
// attester mints a signature ONLY when request-auth + lifecycle + anchor + observer + evidence + the reader/
// attester clock gate ALL hold, and NEVER otherwise. The `signed` counter is the ground truth: it must be 0
// across every failure case and exactly 1 on the single valid request. Anchor alone / observer alone / a passing
// clock without a valid request never sign. A malformed bootstrap generation is rejected.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { randomBytes } from "node:crypto";
import { makeBootstrapEnv } from "./fixtures/synthetic-env.mjs";
import { startV2AttestationServer, buildV2Request, preSignClockGuard, verifyV2RequestFrame } from "../attestation-channel-v2.mjs";
import { verifyReaderAttestation } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const SECRET = "s".repeat(48);
const hex = (n) => randomBytes(n).toString("hex");
const RCLK = { L: -1000, U: 2000 };            // reader interval carried in the request
const ACLK = () => ({ L: -1000, U: 2000 });     // attester's fresh monitor interval (pairwise ≈ small)

function sendRaw(addr, line) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0), done = false;
    const sock = net.createConnection({ host: addr.host, port: addr.port });
    const fin = (r) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(r); };
    const t = setTimeout(() => fin({ code: "timeout" }), 4000);
    sock.on("connect", () => { try { sock.write(line); } catch { fin({ code: "werr" }); } });
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
    sock.on("end", () => { clearTimeout(t); try { fin(JSON.parse(buf.toString("utf8").trim())); } catch { fin({ code: "parse" }); } });
    sock.on("error", () => fin({ code: "sockerr" }));
  });
}

async function run() {
  const env = await makeBootstrapEnv({ rttUs: 2000 });
  const servers = [];
  async function server(over = {}) {
    const s = await startV2AttestationServer({
      channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 },
      observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor,
      attesterClockInterval: ACLK, signingEnabled: () => true, peerCidrs: env.peerCidrs,
      nowMs: Date.now, offlineTestBoundary: true, ...over,
    });
    servers.push(s); return s;
  }
  const frame = (o = {}) => buildV2Request({
    channelSecret: SECRET, connectionToken: env.connectionToken, requestNonce: o.requestNonce || hex(16),
    readerClock: { L: RCLK.L, U: RCLK.U, generation: o.generation || hex(16) },
    nonce: o.nonce || hex(16), ts: o.ts != null ? o.ts : Date.now(),
  });

  // ── A. the single VALID request signs exactly once, and the proof verifies ──
  {
    const s = await server();
    const valNonce = hex(16);
    const res = await sendRaw(s.address, frame({ requestNonce: valNonce }));
    ok("A1. valid request returns an envelope", res && res.ok === true && !!res.envelope);
    ok("A2. attester signed exactly once", s.stats().signed === 1);
    const ver = verifyReaderAttestation(res.envelope, { trustRoot: env.trustRoot, expectedConnectionToken: env.connectionToken, expectedRequestNonce: valNonce, now: Date.now() });
    ok("A3. minted proof verifies against the accepted trust root", ver.ok === true);
  }

  // ── B. NO-SIGN matrix (signed stays 0 on a fresh server for each) ──
  const noSign = async (name, mutate, expectCode) => {
    const s = await server(mutate.server || {});
    const line = mutate.line || frame(mutate.frameOpts || {});
    const res = await sendRaw(s.address, line);
    const okCode = expectCode ? (res.code === expectCode) : true;
    ok(`${name} (no signature)`, s.stats().signed === 0 && okCode);
  };

  await noSign("B1. signing disabled (bootstrap-listening, clock not ready)", { server: { signingEnabled: () => false } }, "unavailable");
  await noSign("B2. attester clock stale (monitor interval null)", { server: { attesterClockInterval: () => null } }, "clock_gate_failed");
  await noSign("B3. reader↔attester pairwise > 500 ms", { frameOpts: {}, line: buildV2Request({ channelSecret: SECRET, connectionToken: env.connectionToken, requestNonce: hex(16), readerClock: { L: 600000, U: 600000, generation: hex(16) }, nonce: hex(16), ts: Date.now() }) }, "clock_gate_failed");
  await noSign("B4. stale timestamp (> 30 s skew)", { frameOpts: { ts: Date.now() - 40000 } }, "stale");
  await noSign("B5. tampered MAC → unauthenticated", { line: frame().replace(/"mac":"[0-9a-f]{64}"/, '"mac":"' + "0".repeat(64) + '"') }, "unauthenticated");
  await noSign("B6. reader clock inverted (U < L)", { line: buildV2Request({ channelSecret: SECRET, connectionToken: env.connectionToken, requestNonce: hex(16), readerClock: { L: 5000, U: -5000, generation: hex(16) }, nonce: hex(16), ts: Date.now() }) }, "bad_request");
  await noSign("B7. malformed bootstrap generation (not 32-hex)", { line: buildV2Request({ channelSecret: SECRET, connectionToken: env.connectionToken, requestNonce: hex(16), readerClock: { L: RCLK.L, U: RCLK.U, generation: "SHORT" }, nonce: hex(16), ts: Date.now() }) }, "bad_request");
  await noSign("B8. anchor does not match the observed cluster", { server: { anchor: { ...env.anchor, clusterFingerprint: "deadbeefdeadbeef" } } }, "unavailable");
  await noSign("B9. unknown connection token (no observed session)", { line: buildV2Request({ channelSecret: SECRET, connectionToken: "a".repeat(64), requestNonce: hex(16), readerClock: { L: RCLK.L, U: RCLK.U, generation: hex(16) }, nonce: hex(16), ts: Date.now() }) }, "no_such_session");

  // ── C. replay: the same nonce is refused the second time; signed does not double ──
  {
    const s = await server();
    const line = frame();
    const r1 = await sendRaw(s.address, line);
    const r2 = await sendRaw(s.address, line);
    ok("C1. first request signs, replay refused, signed stays 1", r1.ok === true && r2.ok === false && r2.code === "replayed" && s.stats().signed === 1);
  }

  // ── D. anchor alone / observer alone / clock alone never sign (composition, not any single factor) ──
  {
    // a request that authenticates + has a valid clock but names a non-existent session (observer yields nothing)
    const s = await server();
    const res = await sendRaw(s.address, buildV2Request({ channelSecret: SECRET, connectionToken: "b".repeat(64), requestNonce: hex(16), readerClock: { L: RCLK.L, U: RCLK.U, generation: hex(16) }, nonce: hex(16), ts: Date.now() }));
    ok("D1. auth + valid clock but no observed session → no sign", s.stats().signed === 0 && res.ok === false);
  }

  // ── E. preSignClockGuard PURE unit matrix ──
  const base = { requestAuthenticated: true, ctxLive: true, anchorOk: true, observerOk: true, evidenceAttestable: true, generationOk: true, readerInterval: { L: 0, U: 1000 }, attesterInterval: { L: 0, U: 1000 } };
  ok("E1. all preconditions → ok", preSignClockGuard(base).ok === true);
  ok("E2. unauthenticated → fail", preSignClockGuard({ ...base, requestAuthenticated: false }).reason === "request_unauthenticated");
  ok("E3. not live → fail", preSignClockGuard({ ...base, ctxLive: false }).reason === "request_not_live");
  ok("E4. anchor invalid → fail", preSignClockGuard({ ...base, anchorOk: false }).reason === "anchor_invalid");
  ok("E5. observer invalid → fail", preSignClockGuard({ ...base, observerOk: false }).reason === "observer_invalid");
  ok("E6. evidence not attestable → fail", preSignClockGuard({ ...base, evidenceAttestable: false }).reason === "evidence_not_attestable");
  ok("E7. generation invalid → fail", preSignClockGuard({ ...base, generationOk: false }).reason === "generation_invalid");
  ok("E8. reader interval null → fail", preSignClockGuard({ ...base, readerInterval: null }).reason === "reader_clock_invalid");
  ok("E9. attester interval null → fail (stale)", preSignClockGuard({ ...base, attesterInterval: null }).reason === "attester_clock_stale");
  ok("E10. pairwise > 500 ms → fail", preSignClockGuard({ ...base, readerInterval: { L: 600000, U: 600000 }, attesterInterval: { L: 0, U: 0 } }).reason === "pairwise_bound_exceeded");
  ok("E11. pairwise exactly 500 ms → ok", preSignClockGuard({ ...base, readerInterval: { L: 0, U: 500000 }, attesterInterval: { L: 0, U: 0 } }).ok === true);

  // ── F. verifyV2RequestFrame code coverage ──
  ok("F1. unsupported version", verifyV2RequestFrame(JSON.stringify({ v: "x", op: "attest" }) + "\n", { channelSecret: SECRET, nowMs: Date.now(), seenNonces: new Map() }).code === "unsupported_version");
  ok("F2. non-JSON → bad_request", verifyV2RequestFrame("{not json\n", { channelSecret: SECRET, nowMs: Date.now(), seenNonces: new Map() }).code === "bad_request");
  ok("F3. oversized frame → bad_request", verifyV2RequestFrame("x".repeat(3000), { channelSecret: SECRET, nowMs: Date.now(), seenNonces: new Map() }).code === "bad_request");

  for (const s of servers) { try { await s.close(); } catch {} }
  await env.cleanup();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE CLOCK-GATED SIGNING AUTHORITY (§28): PASS");
  console.log("SCOPE: real Ed25519 + synthetic least-privilege observer + real loopback sockets. NOT live AI-STAGING.");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
