// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §27b — FIXED DB CLOCK PROBE contract (OFFLINE). Node built-ins only.
// The probe runs ONE fixed read-only SQL, parses the µs clock as an integer, re-derives the anchored cluster
// fingerprint on every call (via the ACCEPTED algorithm), and throws (fails the sample closed) on deadline,
// invalid row, or fingerprint mismatch. Driven by an injected query stub — no real DB.
// ─────────────────────────────────────────────────────────────────────────
import { makeDbClockProbe, DB_CLOCK_QUERY, isPermittedClockSql, READER_ROLE } from "../db-clock-probe.mjs";
import { clusterFingerprint } from "../../private-reader-attester-offline-01/target-binding.mjs";

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const caught = async (p) => { try { await p(); return null; } catch (e) { return e && e.message; } };

const CL = { datname: "railway", databaseOid: "16401", readerRoleOid: "20001", encoding: "6" };
const FP = clusterFingerprint(CL);
const row = (o = {}) => ({ db_micros: "1700000000000000", datname: CL.datname, database_oid: CL.databaseOid, reader_role_oid: CL.readerRoleOid, encoding: CL.encoding, ...o });
const stub = (r, capture) => async (sql, params) => { if (capture) capture(sql, params); return { rows: [r] }; };

async function run() {
  ok("A1. only the fixed clock SQL is permitted", isPermittedClockSql(DB_CLOCK_QUERY) && !isPermittedClockSql("SELECT 1"));
  ok("A2. the fixed SQL is read-only clock_timestamp + fingerprint fields", /clock_timestamp\(\)/.test(DB_CLOCK_QUERY) && /db_micros/.test(DB_CLOCK_QUERY) && !/INSERT|UPDATE|DELETE|DROP/i.test(DB_CLOCK_QUERY));

  // the probe issues exactly the fixed SQL with the reader role as $1
  let seenSql = null, seenParams = null;
  const probe = makeDbClockProbe({ query: stub(row(), (s, p) => { seenSql = s; seenParams = p; }), expectedFingerprint: FP });
  const res = await probe();
  ok("B1. probe runs the fixed SQL with the reader role param", seenSql === DB_CLOCK_QUERY && seenParams[0] === READER_ROLE);
  ok("B2. probe returns integer µs + fingerprint + cluster", res.dbUs === 1700000000000000 && res.fingerprint === FP && res.cluster.datname === "railway");

  // fingerprint mismatch (rebound/swapped DB) fails closed
  const mism = makeDbClockProbe({ query: stub(row({ database_oid: "99999" })), expectedFingerprint: FP });
  ok("C1. fingerprint mismatch throws (swapped DB detected)", (await caught(mism)) === "db_fingerprint_mismatch");

  // invalid clock values fail closed
  ok("C2. non-numeric db_micros fails", (await caught(makeDbClockProbe({ query: stub(row({ db_micros: "not-a-number" })) }))) === "db_micros_invalid");
  ok("C3. non-positive db_micros fails", (await caught(makeDbClockProbe({ query: stub(row({ db_micros: "0" })) }))) === "db_micros_invalid");
  ok("C4. missing fingerprint fields fail", (await caught(makeDbClockProbe({ query: stub(row({ reader_role_oid: null })) }))) === "db_fingerprint_fields_missing");
  ok("C5. empty result set fails", (await caught(makeDbClockProbe({ query: async () => ({ rows: [] }) }))) === "db_probe_empty");

  // deadline fails closed
  const slow = makeDbClockProbe({ query: () => new Promise((r) => setTimeout(() => r({ rows: [row()] }), 60)), deadlineMs: 5 });
  ok("D1. probe deadline throws", (await caught(slow)) === "db_probe_deadline");

  // construction guards
  ok("E1. missing query throws", (() => { try { makeDbClockProbe({}); return false; } catch (e) { return e.message === "db_clock_probe_query_required"; } })());
  ok("E2. malformed expected fingerprint throws", (() => { try { makeDbClockProbe({ query: stub(row()), expectedFingerprint: "short" }); return false; } catch (e) { return e.message === "db_clock_probe_expected_fingerprint_invalid"; } })());
  ok("E3. probe works with no expected fingerprint (discovery time)", (await makeDbClockProbe({ query: stub(row()) })()).ok === true);

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE DB CLOCK PROBE CONTRACT (§27b): PASS");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
