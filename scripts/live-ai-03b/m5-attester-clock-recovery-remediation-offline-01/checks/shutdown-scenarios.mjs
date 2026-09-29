// Shared shutdown-containment scenarios, parameterized by TREE (prior candidate v1 = red side, revised = green side)
// and by the composition's stop ordering. Counts STARTS (open initiations, SQL starts, sample starts), not completions.
import { randomBytes } from "node:crypto";
import { bdir, s03b, sleep, deferred, waitFor, makeFakePhysicalFactory } from "./lib.mjs";

export async function loadTree(tree) {
  const B = bdir(tree);
  return {
    B,
    ...(await import(B + "/attester-bootstrap.mjs")),
    ...(await import(B + "/production-db-clock.mjs")),
    STATES: (await import(B + "/bootstrap-state.mjs")).STATES,
    makeBootstrapEnv: (await import(B + "/tests/fixtures/synthetic-env.mjs")).makeBootstrapEnv,
    clusterFingerprint: (await import(s03b(tree) + "/private-reader-attester-offline-01/target-binding.mjs")).clusterFingerprint,
    productionAttester: await import(B + "/production-attester.mjs"),
  };
}
export function fakeTimers() {
  const q = [];
  return { q, setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; q.push(t); return t; }, clearTimer: (t) => { if (t) t.cleared = true; },
    pending() { return q.filter((t) => !t.cleared && !t.fired); }, fireNoAwait() { const t = this.pending()[0]; if (!t) return null; t.fired = true; return t.fn(); } };
}
export function events() { const ev = []; return { ev, log: (l) => { try { ev.push({ ...JSON.parse(l), at: Date.now() }); } catch {} }, of: (e) => ev.filter((x) => x.event === e) }; }

/** v1's composition stop body, VERBATIM in effect: `supervisor.stop(); await baseStop(); await sampler.close();` */
export function v1CompositionStop({ baseStop, sampler }) { return async () => { try { await baseStop(); } catch {} try { await sampler.close(); } catch {} return true; }; }

/**
 * Build an attester over the PRODUCTION clock sampler driven by the pg-like fake driver (the fake counts every
 * open() initiation and every SQL start). Attester-level sample calls are counted by a transparent wrapper.
 */
export async function buildRig(T, { deadlineMs = 300, closeDeadlineMs = 100 } = {}) {
  const env = await T.makeBootstrapEnv({ rttUs: 2000 });
  const cluster = { datname: env.cl.state.datname, databaseOid: env.cl.state.databaseOid, readerRoleOid: env.cl.state.readerRoleOid, encoding: env.cl.state.encoding };
  const { factory, ctl, release } = makeFakePhysicalFactory({ cluster });
  const sampler = T.makeProductionClockSampler({ env: {}, connectionStringEnvName: "X", expectedFingerprint: T.clusterFingerprint(cluster), deadlineMs, closeDeadlineMs, physicalFactory: factory });
  const calls = { n: 0 };
  const take = async () => { calls.n++; return sampler.takeSampleFn(); };
  const E = events(); const ft = fakeTimers();
  const att = await T.startAttesterBootstrap({ takeSampleFn: take, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor, channelSecret: randomBytes(32).toString("hex"),
    listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs, monoNowUs: sampler.monoNowUs, offlineTestBoundary: true, startMonitor: false,
    autoRecover: true, log: E.log, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  const snap = () => ({ openCalls: ctl.openCalls, sqlStarts: ctl.sqlStarts, sampleCalls: calls.n, samplerSamples: sampler.stats().samples, physicals: ctl.physicals.length });
  return { env, ctl, release, sampler, att, E, ft, calls, snap };
}
/** Put the rig into CLOCK_INVALID with its physical retired, so the next recovery sample must OPEN a new physical. */
export async function invalidateAndRetire(rig) {
  rig.ctl.hang = true; await rig.att.monitor.sampleOnce(); rig.ctl.hang = false; rig.release();
  await sleep(20);
}
export const delta = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]));
export { sleep, deferred, waitFor };
