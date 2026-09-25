// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §30 — FULL SYNTHETIC LIFECYCLE + ENTRYPOINT FAIL-CLOSED (OFFLINE). Node built-ins only.
// Drives the REAL reader + attester bootstraps against the synthetic env (real Ed25519, synthetic observer,
// real loopback sockets, one controllable shared DB clock). Proves: the reader boots RUNNING-NOT-SERVING; the
// attester reaches BOOTSTRAP_LISTENING before it will sign; authority is granted only via the pre/post clock
// bracket around a verified proof; a DB clock STEP inside the bracket is rejected; a monitor invalidation drops
// authority + rotates the boot generation; a restart yields a NEW generation (prior evidence void); the
// production entrypoints fail closed (exit 70) with no live wiring.
// ─────────────────────────────────────────────────────────────────────────
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makeBootstrapEnv } from "./fixtures/synthetic-env.mjs";
import { startAttesterBootstrap } from "../attester-bootstrap.mjs";
import { startReaderBootstrap, BRACKET_STEP_TOL_US } from "../reader-bootstrap.mjs";
import { startReaderBootstrapService } from "../bootstrap-entrypoint-reader.mjs";
import { startAttesterBootstrapService } from "../bootstrap-entrypoint-attester.mjs";
import { STATES } from "../bootstrap-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "..");
const SECRET = "s".repeat(48);
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };

async function run() {
  const env = await makeBootstrapEnv({ rttUs: 2000 });
  const closeables = [];

  const att = await startAttesterBootstrap({
    takeSampleFn: env.attesterTakeSample, observerProvider: env.observerProvider,
    signer: env.signer, anchor: env.anchor, channelSecret: SECRET,
    listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs,
    monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false,
  });
  closeables.push(att);
  ok("1. attester started + BOOTSTRAP_LISTENING", att.started === true && att.status() === STATES.BOOTSTRAP_LISTENING);
  ok("2. attester signing ready after startup gate + monitor seed", att.signingReady() === true);

  // reader with a wrapped takeSampleFn so we can inject a DB step at a chosen sample index
  let readerCalls = 0; let corruptAt = -1; let corruptDelta = 0;
  const wrappedReaderTake = async () => {
    readerCalls++; const s = await env.readerTakeSample();
    if (s.ok && readerCalls === corruptAt) s.probe = { ...s.probe, dbUs: s.probe.dbUs + corruptDelta };
    return s;
  };
  const mkReader = () => startReaderBootstrap({
    takeSampleFn: wrappedReaderTake, connectionToken: env.connectionToken,
    attester: { host: att.address.host, port: att.address.port }, channelSecret: SECRET,
    trustRoot: env.trustRoot, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: false,
  });

  const reader = await mkReader();
  closeables.push(reader);
  ok("3. reader started + startup clock gate passed", reader.started === true && reader.startupPassed === true);
  ok("4. reader WAITING_FOR_ATTESTER after clock pass", reader.status() === STATES.WAITING_FOR_ATTESTER);
  ok("5. reader RUNNING but NOT serving (gateway listener never opened)", reader.serving() === false);
  const gen0 = reader.generation();

  const acq = await reader.acquireAuthority();
  ok("6. reader acquires authority via the clock bracket", acq.ok === true);
  ok("7. reader AUTHORITY_READY", reader.status() === STATES.AUTHORITY_READY && reader.authorityReady() === true);
  ok("8. attester signed exactly once", att.stats().server.signed === 1);
  ok("9. reader STILL not serving after authority", reader.serving() === false);

  // ── monitor invalidation drops authority, rotates the generation, and returns to WAITING_FOR_CLOCK (M1-R1) ──
  reader.monitor.invalidate("induced_test_invalidation");
  ok("10. monitor invalidation drops authority → WAITING_FOR_CLOCK", reader.authorityReady() === false && reader.status() === STATES.WAITING_FOR_CLOCK);
  ok("11. boot generation rotated on invalidation", reader.generation() !== gen0);
  ok("11b. startup-gate evidence invalidated (re-gate required)", reader.gatePassed() === false);

  // a single good monitor sample does NOT restore authority nor substitute for the full startup gate (M1-R1)
  await reader.monitor.sampleOnce();
  const notReady = await reader.acquireAuthority();
  ok("11c. one good sample cannot re-acquire (clock gate required)", notReady.ok === false && notReady.reason === "clock_gate_required" && reader.authorityReady() === false);

  // re-entry requires a COMPLETE fresh startup gate, THEN a fresh acquisition
  const rg = await reader.regate();
  const reAcq = await reader.acquireAuthority();
  ok("12. reader re-acquires authority only after a full re-gate + fresh attestation", rg.ok === true && reAcq.ok === true && reader.status() === STATES.AUTHORITY_READY);

  // ── DB clock STEP inside the bracket is rejected (forward jump) ──
  {
    const r2 = await mkReader(); closeables.push(r2);
    // after mkReader (startup 5 + monitor seed 1), acquireAuthority calls: pre = +1, post = +2 → corrupt the POST
    corruptAt = readerCalls + 2; corruptDelta = 600000;   // +600 ms DB jump inconsistent with monotonic
    const a = await r2.acquireAuthority();
    ok("13. forward DB clock step in the bracket rejected", a.ok === false && a.reason === "common_db_clock_inconsistency");
    ok("14. reader denied authority after DB step", r2.authorityReady() === false);
    corruptAt = -1;
  }

  // ── DB clock BACKWARD inside the bracket is rejected ──
  {
    const r3 = await mkReader(); closeables.push(r3);
    corruptAt = readerCalls + 2; corruptDelta = -10_000_000;  // post dbUs < pre dbUs
    const a = await r3.acquireAuthority();
    ok("15. backward DB clock in the bracket rejected", a.ok === false && a.reason === "db_clock_backward");
    corruptAt = -1;
  }
  ok("16. bracket tolerance is 2·RTT + 1·discrepancy budget", BRACKET_STEP_TOL_US === 2 * 100000 + 10000);

  // ── attester monitor invalidation disables signing; regate restores; reader follows ──
  env.ctrl.attesterBroken = true;
  await att.monitor.sampleOnce();
  ok("17. attester signing disabled after its clock breaks", att.signingReady() === false);
  const acqBroken = await reader.acquireAuthority();
  ok("18. reader cannot acquire while attester clock is broken", acqBroken.ok === false);
  env.ctrl.attesterBroken = false;
  const re = await att.regate();
  ok("19. attester regate (full fresh startup pass) restores signing", re.ok === true && att.signingReady() === true);
  await reader.monitor.sampleOnce();
  const acqOk = await reader.acquireAuthority();
  ok("20. reader re-acquires after attester recovery", acqOk.ok === true);

  // ── restart is non-authoritative: a fresh reader has a new generation, no carried authority ──
  await reader.stop();
  ok("21. stopped reader reports STOPPED + not serving", reader.status() === STATES.STOPPED && reader.serving() === false);
  const readerB = await mkReader(); closeables.push(readerB);
  ok("22. a restarted reader boots without authority (must re-prove)", readerB.authorityReady() === false && readerB.status() === STATES.WAITING_FOR_ATTESTER);
  ok("23. a restarted reader has a fresh boot generation", readerB.generation() !== gen0 && readerB.generation() !== reader.generation());

  for (const c of closeables) { try { await c.stop(); } catch {} }
  await env.cleanup();

  // ── entrypoint fail-closed on missing config (in-process); the permanent live_wiring stub is GONE (M1-R2) ──
  const rSvc = await startReaderBootstrapService({ env: {} });
  ok("24. reader entrypoint fails closed on missing config (no permanent stub)", rSvc.started === false && rSvc.reason === "reader_config_incomplete" && rSvc.reason !== "live_wiring_is_a_future_gate");
  const aSvc = await startAttesterBootstrapService({ env: {} });
  ok("25. attester entrypoint fails closed on missing config (no permanent stub)", aSvc.started === false && aSvc.reason === "attester_config_incomplete" && aSvc.reason !== "live_wiring_is_a_future_gate");
  ok("26. bare offlineTestBoundary flag (mode missing) does NOT enter the test seam → production path, not started", (await startAttesterBootstrapService({ offlineTestBoundary: true, env: {} })).started === false);

  // ── entrypoint fail-closed (spawned process, clean env → exit code 70) ──
  for (const [name, file] of [["reader", "bootstrap-entrypoint-reader.mjs"], ["attester", "bootstrap-entrypoint-attester.mjs"]]) {
    const p = spawnSync(process.execPath, [resolve(DIR, file)], { encoding: "utf8", timeout: 15000, env: { PATH: process.env.PATH } });
    const out = (p.stdout || "").trim();
    ok(`27.${name}. spawned entrypoint exits 70 (unprovisioned)`, p.status === 70);
    ok(`28.${name}. spawned entrypoint prints a config-incomplete status line (no permanent stub)`, /"status":"UNPROVISIONED"/i.test(out) && /_config_incomplete/.test(out) && !/live_wiring_is_a_future_gate/.test(out));
    ok(`29.${name}. spawned entrypoint never claims serving/signing`, /"serving":false/.test(out) || /"signingReady":false/.test(out));
  }

  // ── G. the 1 s runtime monitor is actually STARTED by the bootstrap (default startMonitor:true) ──
  // A broken clock, with no manual driving, must auto-invalidate within one scheduler period.
  {
    const env2 = await makeBootstrapEnv({ rttUs: 2000 });
    const att2 = await startAttesterBootstrap({
      takeSampleFn: env2.attesterTakeSample, observerProvider: env2.observerProvider,
      signer: env2.signer, anchor: env2.anchor, channelSecret: SECRET,
      listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env2.peerCidrs,
      monoNowUs: env2.monoNowUs, offlineTestBoundary: true,   // startMonitor defaults to TRUE
    });
    ok("30. attester with default monitor is signing-ready", att2.signingReady() === true);
    env2.ctrl.attesterBroken = true;                          // break the clock; do NOT drive sampleOnce manually
    await new Promise((r) => setTimeout(r, 1300));            // one 1 s scheduler tick + margin
    ok("31. started scheduler auto-invalidates signing on a broken clock (no manual driving)", att2.signingReady() === false);
    await att2.stop(); await env2.cleanup();
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE FULL LIFECYCLE + ENTRYPOINT FAIL-CLOSED (§30): PASS");
  console.log("SCOPE: real bootstraps + synthetic env + real loopback sockets. NOT live AI-STAGING.");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
