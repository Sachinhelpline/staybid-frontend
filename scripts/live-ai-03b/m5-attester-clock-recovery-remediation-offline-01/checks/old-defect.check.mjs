// §15 — OLD-DEFECT reproduction against the UNMODIFIED BASELINE bytes (extracted by run-checks.sh with
// `git archive <baseline> scripts/live-ai-03b`). Proves the defects exist before the remediation. No network/DB.
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { BASELINE_TREE, bdir, s03b, sleep, makeOk, deferred } from "./lib.mjs";

if (!BASELINE_TREE) { console.log("old-defect: M5ACR_BASELINE_TREE is required (a skip is not a pass)"); process.exit(2); }
const B = bdir(BASELINE_TREE);
const { createClockMonitor } = await import(B + "/clock-gate.mjs");
const { startAttesterBootstrap } = await import(B + "/attester-bootstrap.mjs");
const { makeClockSamplerOverPhysical } = await import(B + "/production-db-clock.mjs");
const { STATES } = await import(B + "/bootstrap-state.mjs");
const { makeBootstrapEnv } = await import(B + "/tests/fixtures/synthetic-env.mjs");
const { clusterFingerprint } = await import(s03b(BASELINE_TREE) + "/private-reader-attester-offline-01/target-binding.mjs");
const T = makeOk("m5acr-old-defect(baseline)"); const { ok } = T;
const mono = () => Math.round(performance.now() * 1000);

// O1 — the baseline scheduler overlaps probes: one hanging probe ⇒ many concurrent takeSampleFn() calls
{
  let concurrent = 0, maxConcurrent = 0, calls = 0; const gate = deferred();
  const m = createClockMonitor({ takeSampleFn: async () => { calls++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); try { await gate.promise; return { ok: true, L: 0, U: 1, absBoundUs: 1 }; } finally { concurrent--; } }, monoNowUs: mono, periodMs: 40 });
  m.start(); await sleep(500); m.stop(); gate.resolve();
  ok("O1 BASELINE: a hanging probe is overlapped by the scheduler (≥3 concurrent probes = pg's queue-warning condition)", maxConcurrent >= 3 && calls >= 10);
  ok("O2 BASELINE: the monitor has no single-flight state (no tick/inFlight/skippedTicks)", typeof m.tick === "undefined" && !("skippedTicks" in m.stats()));
}
// O3 — the reader over-physical sampler queues a second query behind unresolved work
{
  const cluster = { datname: "railway", databaseOid: "16384", readerRoleOid: "16390", encoding: "6" };
  let outstanding = 0, overlap = 0; const gate = deferred();
  const phys = { async query() { if (outstanding > 0) overlap++; outstanding++; try { await gate.promise; return { rows: [] }; } finally { outstanding--; } } };
  const s = makeClockSamplerOverPhysical(phys, { expectedFingerprint: clusterFingerprint(cluster), deadlineMs: 80 });
  await s.takeSampleFn(); await s.takeSampleFn(); await s.takeSampleFn();
  gate.resolve();
  ok("O3 BASELINE: abandoned probes stay queued on the SAME session and new probes pile up behind them", overlap >= 2);
}
// O4..O7 — the attester signingReady latch: monitor heals, signing never returns without an explicit regate()
const env = await makeBootstrapEnv({ rttUs: 2000 });
const SECRET = randomBytes(32).toString("hex");
{
  const logs = [];
  const att = await startAttesterBootstrap({ takeSampleFn: env.attesterTakeSample, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: SECRET, listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: env.monoNowUs, offlineTestBoundary: true, startMonitor: true, log: (l) => logs.push(l) });
  env.ctrl.attesterBroken = true; await att.monitor.sampleOnce(); env.ctrl.attesterBroken = false;
  ok("O4 BASELINE: a clock invalidation disables signing (CLOCK_INVALID)", att.signingReady() === false && att.status() === STATES.CLOCK_INVALID);
  await sleep(6500);                                   // > the remediation's first 5 s backoff step
  ok("O5 BASELINE: the monitor HEALS by itself (fresh good samples) …", att.monitor.healthy(env.monoNowUs()) === true);
  ok("O6 BASELINE: … but signing stays DISABLED — no automatic regate exists (permanent latch)", att.signingReady() === false && att.status() === STATES.CLOCK_INVALID);
  ok("O7 BASELINE: the only log line is clock_invalidated — nothing reports the stuck state", logs.length === 1 && JSON.parse(logs[0]).event === "clock_invalidated");
  // O8 — baseline peer invalidation goes through the same HEALABLE clock latch: a clock regate restores it
  att.monitor.invalidate("peer_unsafe:dns_answer_changed");
  const rg = await att.regate();
  ok("O8 BASELINE: a peer_unsafe invalidation is restored by a mere clock regate (not a sticky peer latch)", rg.ok === true && att.signingReady() === true);
  await att.stop();
}
await env.cleanup();
{
  const pa = fs.readFileSync(B + "/production-attester.mjs", "utf8");
  const ep = fs.readFileSync(B + "/bootstrap-entrypoint-attester.mjs", "utf8");
  const ab = fs.readFileSync(B + "/attester-bootstrap.mjs", "utf8");
  ok("O9 BASELINE: no production caller of regate() (composition + entrypoint)", !/regate\(/.test(pa) && !/regate\(/.test(ep));
  ok("O10 BASELINE: production logging is a no-op (entrypoint passes no log; composition defaults to () => {})", /startAttesterBootstrapService\(\{\}\)/.test(ep) && /: \(\) => \{\};/.test(pa));
  ok("O11 BASELINE: the pre-sign attester interval is not gated on signing being enabled", ab.includes("attesterClockInterval: () => monitor.currentInterval(monoNowUs())"));
  ok("O12 BASELINE: peer events route to monitor.invalidate (healable)", pa.includes('attRef.monitor.invalidate("peer_unsafe:" + reason)'));
}
T.done(12);
