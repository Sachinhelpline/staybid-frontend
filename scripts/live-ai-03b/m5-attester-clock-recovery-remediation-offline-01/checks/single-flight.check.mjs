// §16 / §17 (deterministic part) — SINGLE-FLIGHT + dead/timed-out session handling on the CANDIDATE tree.
// Monitor scheduler (clock-gate.mjs), production sampler (production-db-clock.mjs) over a pg-like fake with driver
// queue emulation, and the reader's over-physical sampler. No network, no DB, no Railway.
import { CANDIDATE_TREE, bdir, s03b, sleep, makeOk, deferred, waitFor, makeFakePhysicalFactory } from "./lib.mjs";

const B = bdir(CANDIDATE_TREE);
const { createClockMonitor } = await import(B + "/clock-gate.mjs");
const { makeProductionClockSampler, makeClockSamplerOverPhysical } = await import(B + "/production-db-clock.mjs");
const { clusterFingerprint } = await import(s03b(CANDIDATE_TREE) + "/private-reader-attester-offline-01/target-binding.mjs");
const T = makeOk("m5acr-single-flight");
const { ok } = T;
const cluster = { datname: "railway", databaseOid: "16384", readerRoleOid: "16390", encoding: "6" };
const fp = clusterFingerprint(cluster);
const mono = () => Math.round(performance.now() * 1000);
const good = () => ({ ok: true, L: -1000, U: 1000, absBoundUs: 1000 });

// ── S1 monitor: a hanging probe is NEVER overlapped by the scheduler; skipped ticks run only the watchdog ──
{
  let concurrent = 0, maxConcurrent = 0, calls = 0; let gate = null; const invalid = [];
  const take = async () => { calls++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); try { if (gate) await gate.promise; return good(); } finally { concurrent--; } };
  const m = createClockMonitor({ takeSampleFn: take, monoNowUs: mono, periodMs: 40, maxAgeMs: 200, onInvalid: (r) => invalid.push(r) });
  await m.sampleOnce();
  const lastGoodBefore = m.stats().lastGoodAtMonoUs;
  gate = deferred();                       // next probe hangs
  m.start();
  await sleep(700);
  const st = m.stats();
  ok("S1.1 at most ONE monitor probe in flight while a probe hangs (maxConcurrent=1)", maxConcurrent === 1);
  ok("S1.2 the scheduler SKIPPED ticks instead of launching overlapping probes (skippedTicks>0, calls bounded)", st.skippedTicks >= 10 && calls === 2);
  ok("S1.3 a skipped tick is never a fresh sample (lastGood unchanged → cleared by the watchdog, never advanced)", st.lastGoodAtMonoUs === null && lastGoodBefore !== null);
  ok("S1.4 the independent watchdog failed closed on staleness while the probe was unresolved (sample_stale)", invalid.includes("sample_stale") && m.healthy(mono()) === false);
  ok("S1.5 exactly one onInvalid transition per invalidation (no repeated callbacks per skipped tick)", invalid.length === 1);
  gate.resolve(); gate = null;
  await waitFor(() => m.healthy(mono()), 1000);
  ok("S1.6 once the probe settles the scheduler resumes and a fresh good sample restores monitor health", m.healthy(mono()) === true && m.stats().inFlight === 0);
  m.stop();
}

// ── S2 production sampler: serialized samples; an unresolved probe RETIRES its physical; fresh session next ──
{
  const { factory, ctl, release } = makeFakePhysicalFactory({ cluster });
  const s = makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: fp, statementTimeoutMs: 2000, deadlineMs: 150, closeDeadlineMs: 100, physicalFactory: factory });
  const a = await s.takeSampleFn();
  ok("S2.1 a normal sample succeeds over a freshly hardened session", a.ok === true && ctl.opened === 1);
  // three overlapping callers: serialized, never concurrent on the physical
  const r3 = await Promise.all([s.takeSampleFn(), s.takeSampleFn(), s.takeSampleFn()]);
  ok("S2.2 overlapping takeSampleFn() callers are serialized (all ok, zero driver-level overlap)", r3.every((x) => x.ok) && ctl.overlapCalls === 0 && ctl.maxOutstanding === 1);
  ctl.hang = true;
  const t0 = Date.now();
  const h = await s.takeSampleFn();
  ok("S2.3 a hanging probe fails closed at its bounded deadline with the unchanged reason db_probe_failed", h.ok === false && h.reason === "db_probe_failed" && Date.now() - t0 < 1000);
  const p1 = ctl.physicals[0];
  ok("S2.4 the physical with UNRESOLVED work was retired: marked dead + close() called + detached", p1.dead === true && p1.closeCalled === true && s.stats().retiredUnresolved === 1 && s.stats().hasPhysical === false);
  ctl.hang = false;
  const n = await s.takeSampleFn();
  ok("S2.5 the NEXT probe opens a FRESH read-only session (new physical) and succeeds", n.ok === true && ctl.opened === 2 && ctl.physicals[1].queries === 4);
  ok("S2.6 no query was ever issued on the retired physical (no second query behind unresolved work)", ctl.queriesOnRetired === 0 && p1.queries === 3 + 1 + 3 + 1);
  release();                                  // the abandoned query finally settles: nothing reuses p1
  await sleep(20);
  const n2 = await s.takeSampleFn();
  ok("S2.7 the late settlement of the abandoned query does not revive the retired session", n2.ok === true && ctl.opened === 2 && p1.queries === 8);
  ok("S2.8 per-physical outstanding queries never exceeded 1 (sampler + fake driver agree)", ctl.maxOutstanding === 1 && ctl.overlapCalls === 0 && s.stats().maxConcurrentQueriesPerPhysical === 1 && s.stats().concurrencyViolations === 0);
  await s.close();
}

// ── S3 production sampler: a late open() after the deadline never issues the abandoned query ──
{
  const { factory, ctl } = makeFakePhysicalFactory({ cluster });
  const s = makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: fp, deadlineMs: 120, closeDeadlineMs: 100, physicalFactory: factory });
  const og = deferred(); ctl.openHang = og.promise;
  const r = await s.takeSampleFn();
  ok("S3.1 a sample whose open() outlives the deadline fails closed (db_probe_failed)", r.ok === false && r.reason === "db_probe_failed");
  ctl.openHang = null; og.resolve();
  await sleep(30);
  ok("S3.2 the late-opened session issued NO clock query for the abandoned sample (cancel token)", s.stats().cancelledBeforeQuery === 1 && ctl.physicals[0].queries === 3);
  const r2 = await s.takeSampleFn();
  ok("S3.3 the late-opened (idle, hardened) session is reused by the next sample", r2.ok === true && ctl.opened === 1);
  await s.close();
}

// ── S4 production sampler: a hanging HARDEN step is bounded; reopen failure fails closed ──
{
  const { factory, ctl, release } = makeFakePhysicalFactory({ cluster });
  const s = makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: fp, deadlineMs: 120, closeDeadlineMs: 100, physicalFactory: factory });
  ctl.hardenHang = true;
  const r = await s.takeSampleFn();
  ok("S4.1 a hanging harden step fails the sample closed", r.ok === false && r.reason === "db_probe_failed");
  await waitFor(() => s.stats().opening === false, 1000);
  ok("S4.2 the harden step itself is bounded (opening cleared, session discarded + closed)", s.stats().opening === false && ctl.physicals[0].closeCalled === true && s.stats().hasPhysical === false);
  ctl.hardenHang = false; release();
  ctl.openFail = true;
  const f = await s.takeSampleFn();
  ok("S4.3 a reopen failure fails the sample closed (db_probe_failed), no query issued", f.ok === false && f.reason === "db_probe_failed" && ctl.opened === 1);
  ctl.openFail = false;
  const g = await s.takeSampleFn();
  ok("S4.4 after the fault clears a fresh session is opened and sampling succeeds", g.ok === true && ctl.opened === 2);
  ok("S4.5 no driver-level overlap anywhere in the fault sequence", ctl.overlapCalls === 0 && ctl.queriesOnRetired === 0);
  await s.close();
}

// ── S5 production sampler: a driver-level query FAILURE retires the session (reopen fresh) ──
{
  const { factory } = makeFakePhysicalFactory({ cluster });
  const s2 = makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: fp, deadlineMs: 500, closeDeadlineMs: 100, physicalFactory: {
    async open() { const ph = await factory.open(); let n = 0; return { ...ph, async query(sql, prm) { if (sql.startsWith("SELECT (EXTRACT") && ++n === 2) throw new Error("synthetic statement timeout"); return ph.query(sql, prm); } }; } } });
  const x1 = await s2.takeSampleFn(); const x2 = await s2.takeSampleFn(); const x3 = await s2.takeSampleFn();
  ok("S5.1 a failed (settled) clock query fails that sample closed and retires the session; next sample reopens", x1.ok === true && x2.ok === false && x2.reason === "db_probe_failed" && x3.ok === true && s2.stats().retiredFailed === 1 && s2.stats().opened === 2);
  await s2.close();
}

// ── S6 reader over-physical sampler: never a second query behind unresolved work; dead ⇒ no query ──
{
  let outstanding = 0, overlap = 0, queries = 0, dead = false; let gate = null;
  const phys = {
    async query(sql) { queries++; if (outstanding > 0) overlap++; outstanding++; try { if (gate) await gate.promise; return { rows: [{ db_micros: String(Date.now() * 1000), datname: cluster.datname, database_oid: cluster.databaseOid, reader_role_oid: cluster.readerRoleOid, encoding: cluster.encoding }] }; } finally { outstanding--; } },
    isDead: () => dead,
  };
  const s = makeClockSamplerOverPhysical(phys, { expectedFingerprint: fp, deadlineMs: 120 });
  const a = await s.takeSampleFn();
  ok("S6.1 reader sampler: normal sample succeeds on its own session", a.ok === true && queries === 1);
  gate = deferred();
  const h = await s.takeSampleFn();
  ok("S6.2 reader sampler: a hanging probe fails closed at the deadline (db_probe_failed)", h.ok === false && h.reason === "db_probe_failed");
  const b = await s.takeSampleFn();
  ok("S6.3 reader sampler: while that probe is UNRESOLVED the next sample fails closed WITHOUT a query (same reason)", b.ok === false && b.reason === "db_probe_failed" && queries === 2 && overlap === 0 && s.stats().skippedBusy === 1);
  gate.resolve(); gate = null; await sleep(10);
  const c = await s.takeSampleFn();
  ok("S6.4 reader sampler: once the prior probe settles, sampling resumes on the SAME session", c.ok === true && queries === 3 && overlap === 0);
  const r3 = await Promise.all([s.takeSampleFn(), s.takeSampleFn(), s.takeSampleFn()]);
  ok("S6.5 reader sampler: overlapping callers are serialized (no driver overlap)", r3.every((x) => x.ok) && overlap === 0 && s.stats().maxConcurrentQueries === 1);
  dead = true;
  const d = await s.takeSampleFn();
  ok("S6.6 reader sampler: a DEAD session is never queried (fails closed db_probe_failed)", d.ok === false && d.reason === "db_probe_failed" && queries === 6 && s.stats().skippedDead === 1);
}

T.done(29);
