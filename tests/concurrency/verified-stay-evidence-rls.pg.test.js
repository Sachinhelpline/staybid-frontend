#!/usr/bin/env node
/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════════
// SEC-00B — verified_stay_evidence RLS shape proof (real Postgres, hermetic).
//   Run: node tests/concurrency/verified-stay-evidence-rls.pg.test.js
// Applies migrations/2026-09-09-v746-verified-stay-evidence.sql to a THROWAWAY
// Postgres cluster (socket-only, via .pg-harness) with Supabase-like roles
// (anon / authenticated NOLOGIN, service_role BYPASSRLS) and proves the
// deny-by-default security model the owner required:
//   • RLS enabled AND forced.
//   • NO policies at all → no permissive public ALL policy.
//   • anon / authenticated have NO table privileges (no INSERT/UPDATE/DELETE/SELECT).
//   • PK + unique(source_type, source_id) exist (idempotency).
//   • service_role CAN write; anon CANNOT (RLS blocks the INSERT).
//   • the migration is idempotent (safe to re-apply).
// If postgres binaries are unavailable the harness exits NON-ZERO (unproven) —
// a SKIP is never a PASS. NEVER touches Supabase / staging / production.
// ═════════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const cp = require("child_process");
const harness = require("./.pg-harness");

const MIGRATION = path.resolve(__dirname, "..", "..", "migrations", "2026-09-09-v746-verified-stay-evidence.sql");

let pass = 0, fail = 0;
const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }

function psqlArgs(extra) {
  return ["-h", harness.SOCKET_DIR, "-U", harness.DB_USER, "-d", harness.DB_NAME, "-v", "ON_ERROR_STOP=1", ...extra];
}
function psql(sql, { expectFail = false } = {}) {
  const r = cp.spawnSync("psql", psqlArgs(["-t", "-A", "-F", "|", "-c", sql]), { encoding: "utf8" });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (expectFail) return { failed: r.status !== 0, out };
  if (r.status !== 0) throw new Error("psql failed: " + sql + "\n" + out);
  return { failed: false, out: (r.stdout || "").trim() };
}
function psqlFile(file) {
  const r = cp.spawnSync("psql", psqlArgs(["-f", file]), { encoding: "utf8" });
  if (r.status !== 0) throw new Error("psql -f " + file + " failed:\n" + ((r.stdout || "") + (r.stderr || "")));
}

async function main() {
  await harness.start();
  try {
    // Supabase-like roles.
    psql(
      "DO $$ BEGIN " +
        "IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; " +
        "IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; " +
        "IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; " +
        "END $$;"
    );

    // Apply the migration (and again — must be idempotent).
    psqlFile(MIGRATION);
    let reapplyOk = true;
    try { psqlFile(MIGRATION); } catch { reapplyOk = false; }
    ok(reapplyOk, "migration is idempotent (safe re-apply)");

    ok(psql("SELECT to_regclass('public.verified_stay_evidence') IS NOT NULL;").out === "t", "table exists");

    const rls = psql("SELECT (relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE relname='verified_stay_evidence';").out;
    ok(rls === "true", "RLS is ENABLED and FORCED (got " + rls + ")");

    ok(psql("SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='verified_stay_evidence';").out === "0", "NO policies exist → no permissive public ALL policy");

    const clientGrants = psql(
      "SELECT count(*) FROM information_schema.role_table_grants " +
        "WHERE table_schema='public' AND table_name='verified_stay_evidence' AND grantee IN ('anon','authenticated');"
    ).out;
    ok(clientGrants === "0", "anon/authenticated have NO table privileges (got " + clientGrants + ")");

    const svcGrants = psql(
      "SELECT count(*) FROM information_schema.role_table_grants " +
        "WHERE table_schema='public' AND table_name='verified_stay_evidence' AND grantee='service_role' " +
        "AND privilege_type IN ('INSERT','SELECT','UPDATE','DELETE');"
    ).out;
    ok(Number(svcGrants) >= 4, "service_role has full table privileges (got " + svcGrants + ")");

    ok(psql("SELECT count(*) FROM pg_constraint WHERE conrelid='public.verified_stay_evidence'::regclass AND contype='p';").out === "1", "primary key exists");
    ok(psql("SELECT count(*) FROM pg_indexes WHERE tablename='verified_stay_evidence' AND indexname='uniq_vse_source';").out === "1", "unique index on (source_type, source_id) exists");

    // service_role CAN write (BYPASSRLS).
    const svcWrite = psql(
      "SET ROLE service_role; INSERT INTO public.verified_stay_evidence " +
        "(id,customer_id,hotel_id,source_type,source_id,proof_state,verifier_type,verifier_id) " +
        "VALUES ('vse_bid_ok','c1','h1','bid','ok','checked_in','partner','p1'); RESET ROLE;",
      { expectFail: true }
    );
    ok(svcWrite.failed === false, "service_role CAN INSERT evidence");

    // idempotent upsert on the deterministic id.
    const svcUpsert = psql(
      "SET ROLE service_role; INSERT INTO public.verified_stay_evidence " +
        "(id,customer_id,hotel_id,source_type,source_id,proof_state,verifier_type,verifier_id) " +
        "VALUES ('vse_bid_ok','c1','h1','bid','ok','checked_out','partner','p1') " +
        "ON CONFLICT (id) DO UPDATE SET proof_state=EXCLUDED.proof_state; RESET ROLE;",
      { expectFail: true }
    );
    ok(svcUpsert.failed === false, "idempotent upsert on id works (replay-safe)");

    // anon CANNOT write (RLS + revoked grant).
    const anonWrite = psql(
      "SET ROLE anon; INSERT INTO public.verified_stay_evidence " +
        "(id,customer_id,hotel_id,source_type,source_id,proof_state,verifier_type,verifier_id) " +
        "VALUES ('vse_bid_forge','victim','h1','bid','forge','checked_out','partner','attacker'); RESET ROLE;",
      { expectFail: true }
    );
    ok(anonWrite.failed === true, "anon CANNOT INSERT (forgery blocked by RLS + revoked grant)");

    // authenticated CANNOT write either.
    const authWrite = psql(
      "SET ROLE authenticated; INSERT INTO public.verified_stay_evidence " +
        "(id,customer_id,hotel_id,source_type,source_id,proof_state,verifier_type,verifier_id) " +
        "VALUES ('vse_bid_forge2','victim','h1','bid','forge2','checked_out','partner','attacker'); RESET ROLE;",
      { expectFail: true }
    );
    ok(authWrite.failed === true, "authenticated CANNOT INSERT (forgery blocked)");

    // anon CANNOT read (no policy, revoked grant) — the row the service_role wrote is invisible.
    const anonRead = psql("SET ROLE anon; SELECT count(*) FROM public.verified_stay_evidence; RESET ROLE;", { expectFail: true });
    ok(anonRead.failed === true, "anon CANNOT SELECT (fully private evidence)");
  } finally {
    harness.stop();
  }

  console.log(`\n• RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("FAILURES:\n  " + failures.join("\n  "));
  if (fail > 0) process.exitCode = 1;
  else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main().catch((e) => { console.error("FATAL: " + (e && e.message ? e.message : e)); process.exitCode = 2; });
