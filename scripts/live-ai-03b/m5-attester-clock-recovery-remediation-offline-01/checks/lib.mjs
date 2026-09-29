// M5 attester clock-recovery remediation — shared OFFLINE check helpers (never Railway / live DB / provider).
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Trees: CANDIDATE defaults to the repo tree this evidence dir lives in; BASELINE must be an extracted copy of the
// pre-remediation bytes (run-checks.sh extracts it with `git archive <baseline> scripts/live-ai-03b`).
export const CANDIDATE_TREE = process.env.M5ACR_CANDIDATE_TREE || path.resolve(HERE, "../../../..");
export const BASELINE_TREE = process.env.M5ACR_BASELINE_TREE || null;
// The PRIOR reviewed candidate (v1 = baseline + REMEDIATION-v1.diff), rebuilt by run-checks.sh for the shutdown red side.
export const V1_TREE = process.env.M5ACR_V1_TREE || null;
export const bdir = (tree) => path.join(tree, "scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01");
export const s03b = (tree) => path.join(tree, "scripts/live-ai-03b");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function makeOk(name) {
  let pass = 0, fail = 0; const failed = [];
  const ok = (label, cond) => { if (cond) { pass++; console.log("  ok   " + label); } else { fail++; failed.push(label); console.log("  FAIL " + label); } };
  const done = (expected) => {
    const n = pass + fail;
    console.log(`${name}: ${pass} passed, ${fail} failed (checks run: ${n}${expected ? ", expected: " + expected : ""})`);
    process.exit(fail === 0 && (!expected || n === expected) ? 0 : 1);
  };
  return { ok, done, get pass() { return pass; }, get fail() { return fail; } };
}
export function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
export async function waitFor(pred, timeoutMs = 5000, stepMs = 10) {
  const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (await pred()) return true; await sleep(stepMs); } return !!(await pred());
}

/**
 * A pg-LIKE fake physical factory with driver-queue emulation. Each physical records its outstanding query count;
 * a query issued while another is outstanding increments `overlapCalls` (the exact condition under which the real
 * `pg` client queues + eventually emits its concurrent-query DeprecationWarning). The DB clock row is synthesized
 * from Date.now() with the fingerprint fields of a fixed synthetic cluster. `ctl.hang` makes the NEXT clock queries
 * hang until released; `ctl.openHang` delays open(); `ctl.openFail` rejects open(); `ctl.hardenHang` hangs harden.
 */
export function makeFakePhysicalFactory({ cluster }) {
  const ctl = { hang: false, openHang: null, openFail: false, hardenHang: false, releaseAll: [], physicals: [], overlapCalls: 0, maxOutstanding: 0, opened: 0, closed: 0, queriesOnRetired: 0,
    openCalls: 0,                                                   // open() INITIATIONS (counted at entry)
    get sqlStarts() { return ctl.physicals.reduce((n, p) => n + p.queries, 0) + ctl.queriesOnRetired; } };   // SQL STARTS (incl. refused attempts on dead physicals)
  const factory = {
    kind: "fake-pg",
    async open() {
      ctl.openCalls++;
      if (ctl.openFail) throw new Error("reader_db_connect_failed");
      if (ctl.openHang) await ctl.openHang;
      const id = ++ctl.opened;
      let outstanding = 0, dead = false; const deadCbs = [];
      const markDead = () => { if (dead) return; dead = true; for (const cb of deadCbs) { try { cb(); } catch {} } };
      const rec = { id, get outstanding() { return outstanding; }, get dead() { return dead; }, queries: 0, closeCalled: false };
      ctl.physicals.push(rec);
      const phys = {
        applicationName: "fake_" + id,
        async query(sql, params) {
          if (dead) { ctl.queriesOnRetired++; throw new Error("Client was closed and is not queryable"); }
          if (outstanding > 0) ctl.overlapCalls++;
          outstanding++; rec.queries++; if (outstanding > ctl.maxOutstanding) ctl.maxOutstanding = outstanding;
          try {
            const isClock = sql.startsWith("SELECT (EXTRACT(EPOCH FROM clock_timestamp())");
            if ((isClock && ctl.hang) || (!isClock && ctl.hardenHang)) { const d = deferred(); ctl.releaseAll.push(d.resolve); await d.promise; }
            if (sql.includes("default_transaction_read_only") && sql.startsWith("SELECT current_setting")) return { rows: [{ v: "on" }] };
            if (!isClock) return { rows: [{ v: "ok" }] };
            return { rows: [{ db_micros: String(Date.now() * 1000), datname: cluster.datname, database_oid: cluster.databaseOid, reader_role_oid: cluster.readerRoleOid, encoding: cluster.encoding }] };
          } finally { outstanding--; }
        },
        onDead(cb) { if (dead) { try { cb(); } catch {} } else deadCbs.push(cb); },
        isDead() { return dead; },
        async close() { rec.closeCalled = true; markDead(); ctl.closed++; },
      };
      return phys;
    },
  };
  const release = () => { const r = ctl.releaseAll.splice(0); for (const f of r) f(); };
  return { factory, ctl, release };
}
