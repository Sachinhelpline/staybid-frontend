// OFFLINE real-PostgreSQL evidence test for the executor attestation issuer — THROWAWAY LOCAL cluster ONLY
// (unix socket, listen_addresses='', trust auth, fsync off, removed on exit). NEVER AI-STAGING, never live.
//
// Base state = the ACCEPTED post-Step-1 shape, built from the frozen, unmodified SQL files in the same order the
// accepted Step-1 harness uses (budget foundation + seeds + reader role + M5 role shapes + FULL M6 boundary + Step-1
// 01 seed + 02 trusted successor). It then runs, unmodified:
//   • the PRESERVED executor session code (makeExecutorPgPhysicalFactory + establishExecutorSession) for a REAL
//     executor physical session and its connection token;
//   • this package's observer + evidence registry + evaluator + signing adapter;
//   • the PRESERVED verifyExecutorAttestation and bindExecutorConnection on the issued envelope;
// plus a REAL drift matrix (grant → refuse → revert → clean) and the full service over the loopback channel.
// If PostgreSQL binaries are unavailable the suite exits 2 (SKIPPED — a skip is never a pass).
import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync, chownSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import os from "node:os";
import process from "node:process";

import { makeExecutorPgPhysicalFactory, establishExecutorSession } from "../../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { verifyExecutorAttestation } from "../../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { bindExecutorConnection } from "../../../m7-v2-production-authority-provisioning-offline-01/src/role-binding.mjs";
import { makeAttesterTrustRoot } from "../../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { publicKeyFingerprintFromDerB64 } from "../../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { makeExecutorObserverPgFactory, establishExecutorObserverSession } from "../../src/executor-observer.mjs";
import { observeExecutorEvidence, executorEvidenceIsAttestable } from "../../src/executor-evidence-evaluator.mjs";
import { createExecutorSigningAdapter } from "../../src/executor-signing-adapter.mjs";
import { executorClusterFingerprint, resolveExecutorTarget, EXECUTOR_ANCHOR_CONTRACT, EXECUTOR_ANCHOR_DOMAIN, AI_STAGING } from "../../src/executor-target-binding.mjs";
import { startExecutorAttesterService } from "../../src/executor-attester-entrypoint.mjs";
import net from "node:net";

// ── network counters (R1): loopback TCP, unix-socket (the throwaway cluster) and external connects + fetch, separately ──
const NET = { connects: [], fetch: 0 };
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = Array.isArray(a[0]) ? a[0][0] : a[0];
  NET.connects.push(typeof o === "object" && o ? (o.path ? "unix" : String(o.host)) : typeof o === "string" && o.startsWith("/") ? "unix" : String(a[1] ?? "localhost"));
  return origConnect.apply(this, a);
};
globalThis.fetch = async () => { NET.fetch++; throw new Error("network forbidden in offline tests"); };
import { createExecutorAttestationSourceChannel } from "../../src/executor-attestation-channel.mjs";
import { ENV } from "../../src/executor-attester-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "../..");
const S = resolve(PKG, "..");                 // scripts/live-ai-03b
const REPO = resolve(S, "../..");
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; fails.push(n); console.log("  FAIL " + n + (d !== undefined ? "  :: " + JSON.stringify(d).slice(0, 300) : "")); } };

function findBin() {
  const base = "/usr/lib/postgresql"; if (!existsSync(base)) return null;
  const v = readdirSync(base).filter((x) => existsSync(join(base, x, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a));
  return v.length ? join(base, v[0], "bin") : null;
}
// M7EA_PGBIN: optional server build (e.g. a local PostgreSQL 18 test build — the live AI-STAGING major version)
const BIN = process.env.M7EA_PGBIN || findBin();
if (!BIN || !existsSync(join(BIN, "initdb"))) { console.log("SKIPPED: PostgreSQL binaries unavailable (a skip is never a pass)"); process.exit(2); }
const LIB = existsSync(join(BIN, "..", "lib")) && process.env.M7EA_PGBIN ? resolve(BIN, "..", "lib") : "";
const isRoot = process.getuid && process.getuid() === 0;
const asPg = (cmd, args, opts = {}) => { const e = ["env", `LD_LIBRARY_PATH=${LIB}`];
  return isRoot ? spawnSync("runuser", ["-u", "postgres", "--", ...e, cmd, ...args], { encoding: "utf8", ...opts }) : spawnSync(e[0], [e[1], cmd, ...args], { encoding: "utf8", ...opts }); };
const BASE = mkdtempSync(join(os.tmpdir(), "lai03b-m7ea-pg-"));
if (isRoot) chownSync(BASE, Number(spawnSync("id", ["-u", "postgres"], { encoding: "utf8" }).stdout.trim()), Number(spawnSync("id", ["-g", "postgres"], { encoding: "utf8" }).stdout.trim()));
const DATA = join(BASE, "data");
const stop = () => { asPg(join(BIN, "pg_ctl"), ["-D", DATA, "-m", "immediate", "stop"]); try { rmSync(BASE, { recursive: true, force: true }); } catch {} };
process.on("exit", stop);
const PSQL = existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";
const psql = (db, input, extra = []) => asPg(PSQL, ["-X", "-q", "-h", BASE, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", ...extra], { input });
const sql = (s) => { const r = psql("railway", s); if (r.status !== 0) throw new Error("sql failed: " + (r.stderr || "").split("\n")[0]); return r; };
const val = (s) => psql("railway", s, ["-tA"]).stdout.trim();

// ── throwaway cluster ──
let r = asPg(join(BIN, "initdb"), ["-D", DATA, "-A", "trust", "-U", "postgres", "-N", "--no-instructions"]);
if (r.status !== 0) { console.log("SKIPPED: initdb failed"); process.exit(2); }
writeFileSync(join(DATA, "pg_hba.conf"), "local all all trust\n");
if (isRoot) spawnSync("chown", ["postgres:postgres", join(DATA, "pg_hba.conf")]);
r = asPg(join(BIN, "pg_ctl"), ["-D", DATA, "-l", join(BASE, "server.log"), "-w", "-t", "60", "-o", `-c listen_addresses='' -c unix_socket_directories=${BASE} -c fsync=off`, "start"]);
if (r.status !== 0) { console.log("SKIPPED: cluster did not start"); process.exit(2); }
psql("postgres", "CREATE DATABASE railway ENCODING 'UTF8' TEMPLATE template0;");
const M7S1 = join(S, "m7-step1-hb1-consolidated-remediation-01");
const BASE_SQL = [
  join(REPO, "migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql"),
  join(REPO, "migrations/2026-09-16-live-ai-budget-01-dormant-control-policy-seed.sql"),
  join(REPO, "migrations/2026-09-18-live-ai-budget-01-inactive-price-catalog-seed.sql"),
  join(S, "trusted-runtime-live-binding-offline-01/trusted-reader-role.sql"),
  join(M7S1, "tests/seed-m5-roles.sql"),
  join(S, "trusted-activation-boundary-01/db/2026-09-19-p1-02-trusted-activation-boundary.sql"),
  join(S, "trusted-boundary-post-apply-offline-01/deferred-ledger-read-grant.sql"),
  join(S, "trusted-runtime-live-binding-offline-01/gateway-store-role.sql"),
  join(M7S1, "sql/m7-v2-01-inactive-catalog-seed.sql"),
  join(M7S1, "sql/m7-v2-02-trusted-successor-migration.sql"),
];
for (const f of BASE_SQL) { const x = psql("railway", readFileSync(f, "utf8")); if (x.status !== 0) { console.log("SKIPPED: base SQL failed: " + f.split("/").slice(-1)[0]); process.exit(2); } }
// this package's distinct observer-role PROPOSAL body (guard stripped) — proves it sufficient on real PostgreSQL
const proposal = readFileSync(join(PKG, "executor-observer-role-proposal.sql"), "utf8").replace(/DO \$guard\$[\s\S]*?\$guard\$;/, "");
ok("L00 base = accepted post-Step-1 state; executor-observer role proposal body applies", psql("railway", proposal).status === 0);
ok("L00b server is PostgreSQL " + val("SHOW server_version"), val("SHOW server_version_num").length >= 6);
// the accepted Step-1 verifier must still pass on this base (our base is the accepted shape)
{ const v8 = psql("railway", readFileSync(join(M7S1, "sql/m7-v2-08-post-apply-verification.sql"), "utf8"));
  ok("L00c accepted Step-1 post-apply verifier (SQL 08, read-only) passes on the base", v8.status === 0 && /ALL HARD CHECKS PASSED/.test(v8.stdout + v8.stderr), (v8.stderr || "").slice(0, 200)); }

const url = (role) => `postgresql://${role}@/railway?host=${encodeURIComponent(BASE)}`;
const EX = "live_ai_03b_executor", OBS = "live_ai_03b_executor_attester_observer", SHARED_OBS = "live_ai_03b_attester_observer";

// ── REAL executor session (PRESERVED session code) ──
const exFactory = makeExecutorPgPhysicalFactory({ env: { X: url(EX) }, connectionStringEnvName: "X" });
const exPhys = await exFactory.open();
const exS = await establishExecutorSession(exPhys, { statementTimeoutMs: 5000 });
ok("L01 PRESERVED establishExecutorSession on a REAL executor connection → token", exS.ok === true && /^[0-9a-f]{64}$/.test(exS.session.token), exS.reason);
const TOKEN = exS.session.token;

async function observeAs(role, token = TOKEN, nowProvider = Date.now) {
  const f = makeExecutorObserverPgFactory({ env: { O: url(role) }, connectionStringEnvName: "O" });
  const phys = await f.open();
  const es = await establishExecutorObserverSession(phys);
  if (!es.ok) { await phys.close(); return es; }
  try { return await observeExecutorEvidence(es.observer, token, { nowProvider }); } finally { await es.observer.close(); }
}
const measure = async (token = TOKEN, role = OBS) => {
  const e = await observeAs(role, token);
  if (!e.ok) return { refused: e.reason };
  const a = executorEvidenceIsAttestable(e.evidence);
  return a.ok ? { clean: true, e } : { refused: a.reason, e };
};

// ── positive: measure → clean → anchor → sign → PRESERVED verifier + PRESERVED binding ──
const m0 = await measure();
ok("L02 accepted post-Step-1 executor state measures CLEAN (distinct executor-observer role)", m0.clean === true, { refused: m0.refused, extended: m0.e && m0.e.evidence && m0.e.evidence.context.extendedFindings });
const m0s = await measure(TOKEN, SHARED_OBS);
ok("L02b …and CLEAN with the SHARED accepted observer role shape (documented future option; no widening)", m0s.clean === true, m0s.refused);
const ev = m0.e.evidence;
ok("L03 measured routines == exactly the 4 accepted routines", JSON.stringify(ev.privileges.executableRoutines) === JSON.stringify([
  "live_ai_03b_trusted.activate_catalog(jsonb,text)", "live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)",
  "live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)", "live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)"]), ev.privileges.executableRoutines);
ok("L03b trusted schema USAGE == exactly the two trusted schemas; 0 budget/ledger privileges; no widening",
  JSON.stringify(ev.privileges.trustedSchemaUsage) === '["live_ai_03b_trusted","live_ai_03b_trusted_v2"]' && ev.privileges.budgetTablePrivilegeCount === 0
  && ev.privileges.ledgerPrivilegeCount === 0 && ev.privileges.publicOrDefaultPrivilegeWidening === false);
ok("L03c re-derived token == the PRESERVED session's token (independent derivation from pg_stat_activity)", ev.connection.token === TOKEN);

const kp = generateKeyPairSync("ed25519");
const pk8 = kp.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const der = kp.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const fpr = publicKeyFingerprintFromDerB64(der);
const readerFp = publicKeyFingerprintFromDerB64(generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64"));
const ISSUER = "TEST-ONLY-executor-attester-localpg";
const anchor = { contract: EXECUTOR_ANCHOR_CONTRACT, domain: EXECUTOR_ANCHOR_DOMAIN, projectId: AI_STAGING.projectId, environmentId: AI_STAGING.environmentId,
  pgServiceId: AI_STAGING.pgServiceId, clusterFingerprint: executorClusterFingerprint(ev.cluster), issuedAtMs: Date.now(), verifiedBy: "TEST-ONLY-localpg" };
const tgt = resolveExecutorTarget(anchor, ev.cluster);
const sa = createExecutorSigningAdapter({ issuer: ISSUER, privateKeyPkcs8B64: pk8, expectedPublicKeyDerB64: der, expectedFingerprint: fpr,
  readerAttesterFingerprint: readerFp, proofLifetimeMs: 120000, offlineTestBoundary: true });
const nonce = randomBytes(16).toString("hex");
const issued = sa.signer.issue({ requestNonce: nonce, target: tgt.target, connection: ev.connection, privileges: ev.privileges });
const tr = makeAttesterTrustRoot({ issuer: ISSUER, publicKeyDerB64: der, fingerprint: fpr }, { allowTestIssuer: true }).trustRoot;
const v = verifyExecutorAttestation(issued.envelope, { trustRoot: tr, expectedConnectionToken: TOKEN, expectedRequestNonce: nonce, now: Date.now() });
ok("L04 issuer envelope from a REAL measurement → PRESERVED verifyExecutorAttestation → PASS (verifier unmodified)", v.ok === true, v.reason);
const bind = bindExecutorConnection({ session: exS.session, envelope: issued.envelope, trustRoot: tr, requestNonce: nonce, nowMs: Date.now(), testBoundary: true });
ok("L05 PRESERVED bindExecutorConnection (identity proof + target binding) → PASS", bind.ok === true, bind.reason);

// ── REAL drift matrix: apply → refuse (issuer) and the PRESERVED verifier rejects the same state if force-signed → revert ──
const col1 = val("SELECT attname FROM pg_attribute WHERE attrelid = 'public.budget_sessions'::regclass AND attnum = 1");
const DRIFT = [
  ["budget-table SELECT", `GRANT SELECT ON public.budget_decisions TO ${EX}`, `REVOKE SELECT ON public.budget_decisions FROM ${EX}`, "drift_budget_table_privilege", "executor_drift_budget_table_privilege"],
  ["budget-table column UPDATE", `GRANT UPDATE (${col1}) ON public.budget_sessions TO ${EX}`, `REVOKE UPDATE (${col1}) ON public.budget_sessions FROM ${EX}`, "drift_budget_table_privilege", "executor_drift_budget_table_privilege"],
  ["forbidden allocation table", `GRANT SELECT ON public.budget_envelope_allocations TO ${EX}`, `REVOKE SELECT ON public.budget_envelope_allocations FROM ${EX}`, "drift_budget_table_privilege", "executor_drift_budget_table_privilege"],
  ["ledger INSERT", `GRANT INSERT ON live_ai_03b_trusted.approval_consumption TO ${EX}`, `REVOKE INSERT ON live_ai_03b_trusted.approval_consumption FROM ${EX}`, "drift_ledger_privilege", "executor_drift_ledger_privilege"],
  ["executor SUPERUSER", `ALTER ROLE ${EX} SUPERUSER`, `ALTER ROLE ${EX} NOSUPERUSER`, "drift_superuser", "executor_drift_wrong_role"],
  ["executor CREATEROLE", `ALTER ROLE ${EX} CREATEROLE`, `ALTER ROLE ${EX} NOCREATEROLE`, "drift_createrole", "executor_drift_createrole"],
  ["executor CREATEDB", `ALTER ROLE ${EX} CREATEDB`, `ALTER ROLE ${EX} NOCREATEDB`, "drift_createdb", "executor_drift_createdb"],
  ["executor REPLICATION", `ALTER ROLE ${EX} REPLICATION`, `ALTER ROLE ${EX} NOREPLICATION`, "drift_replication", "executor_drift_replication"],
  ["executor BYPASSRLS", `ALTER ROLE ${EX} BYPASSRLS`, `ALTER ROLE ${EX} NOBYPASSRLS`, "drift_bypassrls", "executor_drift_bypassrls"],
  ["executor role membership (pg_read_all_data)", `GRANT pg_read_all_data TO ${EX}`, `REVOKE pg_read_all_data FROM ${EX}`, "drift_role_membership", "executor_drift_wrong_role"],
  ["executor role membership (reader)", `GRANT live_ai_03b_reader TO ${EX}`, `REVOKE live_ai_03b_reader FROM ${EX}`, "drift_role_membership", "executor_drift_wrong_role"],
  ["schema CREATE on public", `GRANT CREATE ON SCHEMA public TO ${EX}`, `REVOKE CREATE ON SCHEMA public FROM ${EX}`, "drift_schema_create", "executor_drift_schema_create"],
  ["schema CREATE on trusted_v2", `GRANT CREATE ON SCHEMA live_ai_03b_trusted_v2 TO ${EX}`, `REVOKE CREATE ON SCHEMA live_ai_03b_trusted_v2 FROM ${EX}`, "drift_schema_create", "executor_drift_schema_create"],
  ["missing trusted-schema USAGE", `REVOKE USAGE ON SCHEMA live_ai_03b_trusted_v2 FROM ${EX}`, `GRANT USAGE ON SCHEMA live_ai_03b_trusted_v2 TO ${EX}`, "drift_trusted_schema_usage", "executor_drift_schema_usage"],
  ["extra trusted-schema USAGE", `CREATE SCHEMA live_ai_03b_extra; GRANT USAGE ON SCHEMA live_ai_03b_extra TO ${EX}`, "DROP SCHEMA live_ai_03b_extra", "drift_trusted_schema_usage", "executor_drift_schema_usage"],
  ["unexpected other-schema USAGE", `CREATE SCHEMA m7ea_other; GRANT USAGE ON SCHEMA m7ea_other TO ${EX}`, "DROP SCHEMA m7ea_other", "drift_unexpected_schema_usage", null],
  ["missing expected routine", `REVOKE EXECUTE ON FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text) FROM ${EX}`, `GRANT EXECUTE ON FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text) TO ${EX}`, "drift_routine_execute", "executor_drift_routine_execute"],
  ["extra routine EXECUTE (PUBLIC default on a new public function)", "CREATE FUNCTION public.m7ea_extra() RETURNS int LANGUAGE sql AS 'select 1'", "DROP FUNCTION public.m7ea_extra()", "drift_routine_execute", "executor_drift_routine_execute"],
  ["PUBLIC EXECUTE on a trusted routine", "GRANT EXECUTE ON FUNCTION live_ai_03b_trusted.activate_catalog(jsonb,text) TO PUBLIC", "REVOKE EXECUTE ON FUNCTION live_ai_03b_trusted.activate_catalog(jsonb,text) FROM PUBLIC", "drift_public_or_default_widening", "executor_drift_public_or_default_widening"],
  ["DEFAULT privileges to PUBLIC", "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC", "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM PUBLIC", "drift_public_or_default_widening", "executor_drift_public_or_default_widening"],
  ["DEFAULT privileges to the executor", `ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO ${EX}`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM ${EX}`, "drift_public_or_default_widening", "executor_drift_public_or_default_widening"],
  ["database CREATE", `GRANT CREATE ON DATABASE railway TO ${EX}`, `REVOKE CREATE ON DATABASE railway FROM ${EX}`, "drift_owner_or_database_authority", null],
  ["executor owns an object", `CREATE TYPE public.m7ea_t AS (a int); ALTER TYPE public.m7ea_t OWNER TO ${EX}`, "DROP TYPE public.m7ea_t", "drift_owner_or_database_authority", null],
  ["reviewed object renamed (schema drift)", "ALTER TABLE public.budget_decisions RENAME TO budget_decisions_x", "ALTER TABLE public.budget_decisions_x RENAME TO budget_decisions", "reviewed_object_absent", null],
];
// NOTE: for SUPERUSER / any membership the issuer signs currentUser only when PROVEN (it is "unproven" here), so a
// force-signed copy is rejected by the PRESERVED verifier at its FIRST privilege check (executor_drift_wrong_role).
for (const [label, apply, revert, want, verifierWant] of DRIFT) {
  sql(apply);
  let m; try { m = await measure(); } finally { sql(revert); }
  let vr = null;
  if (verifierWant && m.e && m.e.evidence) {
    const e = m.e.evidence;
    const forced = sa.signer.issue({ requestNonce: nonce, target: tgt.target, connection: e.connection, privileges: e.privileges });
    vr = forced.ok ? verifyExecutorAttestation(forced.envelope, { trustRoot: tr, expectedConnectionToken: TOKEN, expectedRequestNonce: nonce, now: Date.now() }) : { ok: false, reason: "not_signable" };
  }
  ok(`D real drift — ${label}: issuer REFUSES (${want})` + (verifierWant ? ` and the PRESERVED verifier rejects a force-signed copy (${verifierWant})` : ""),
    m.refused === want && (!verifierWant || (vr && vr.ok === false && vr.reason === verifierWant)), { got: m.refused, verifier: vr && vr.reason });
}
const mClean = await measure();
ok("D-post every drift reverted → CLEAN again", mClean.clean === true, mClean.refused);

// ═══ R1 — COMPLETE AUTHORITY COVERAGE on REAL PostgreSQL (catch-all classes). Each: clean → ONE drift → issuer REFUSES
//     with the class identified in its extended findings → a force-signed copy is rejected by the PRESERVED verifier
//     (the widening is folded into the frozen signed field) → revert → clean. ═══
{ const e0 = mClean.e.evidence.context;
  ok("R00 clean real state: 0 extended findings; reviewed ACL-bearing catalog set matched; server major " + Math.floor(e0.serverVersionNum / 10000),
    e0.extendedFindings.length === 0 && [16, 18].includes(Math.floor(e0.serverVersionNum / 10000)), e0.extendedFindings); }
const TS = join(BASE, "ts"); spawnSync("mkdir", ["-p", TS]); if (isRoot) spawnSync("chown", ["postgres:postgres", TS]);
const sqlDb = (db, s2) => { const r = psql(db, s2); if (r.status !== 0) throw new Error("sql failed: " + (r.stderr || "").split("\n")[0]); };
const FDW = "CREATE FOREIGN DATA WRAPPER m7ea_fdw; ", SRV = FDW + "CREATE SERVER m7ea_srv FOREIGN DATA WRAPPER m7ea_fdw; ", DROPFDW = "DROP FOREIGN DATA WRAPPER m7ea_fdw CASCADE";
const LO = "SELECT lo_create(424242); ", DROPLO = "SELECT lo_unlink(424242)";
const W1 = "drift_public_or_default_widening", OWN = "drift_owner_or_database_authority";
const R1 = [
  ["large object SELECT (direct)", LO + `GRANT SELECT ON LARGE OBJECT 424242 TO ${EX}`, DROPLO, W1, /effective:largeobject:424242|shdepend:a:pg_largeobject/],
  ["large object UPDATE (direct)", LO + `GRANT UPDATE ON LARGE OBJECT 424242 TO ${EX}`, DROPLO, W1, /effective:largeobject:424242/],
  ["large object PUBLIC SELECT", LO + "GRANT SELECT ON LARGE OBJECT 424242 TO PUBLIC", DROPLO, W1, /public:largeobject-public:424242/],
  ["large object OWNED by the executor", LO + `ALTER LARGE OBJECT 424242 OWNER TO ${EX}`, DROPLO, OWN, /owner:pg_largeobject_metadata/],
  ["foreign-data wrapper USAGE (direct)", FDW + `GRANT USAGE ON FOREIGN DATA WRAPPER m7ea_fdw TO ${EX}`, DROPFDW, W1, /effective:fdw-usage:m7ea_fdw/],
  ["foreign-data wrapper USAGE to PUBLIC", FDW + "GRANT USAGE ON FOREIGN DATA WRAPPER m7ea_fdw TO PUBLIC", DROPFDW, W1, /public:fdw-public:m7ea_fdw/],
  ["foreign server USAGE (direct)", SRV + `GRANT USAGE ON FOREIGN SERVER m7ea_srv TO ${EX}`, DROPFDW, W1, /effective:server-usage:m7ea_srv/],
  ["foreign server USAGE to PUBLIC", SRV + "GRANT USAGE ON FOREIGN SERVER m7ea_srv TO PUBLIC", DROPFDW, W1, /public:server-public:m7ea_srv/],
  ["user mapping for the executor", SRV + `CREATE USER MAPPING FOR ${EX} SERVER m7ea_srv`, DROPFDW, W1, /effective:user-mapping:m7ea_srv/],
  ["user mapping for PUBLIC", SRV + "CREATE USER MAPPING FOR PUBLIC SERVER m7ea_srv", DROPFDW, W1, /effective:user-mapping:m7ea_srv/],
  ["foreign server OWNED by the executor", SRV + `ALTER SERVER m7ea_srv OWNER TO ${EX}`, DROPFDW, OWN, /owner:pg_foreign_server/],
  ["tablespace CREATE (direct)", `CREATE TABLESPACE m7ea_ts LOCATION '${TS}'; GRANT CREATE ON TABLESPACE m7ea_ts TO ${EX}`, "DROP TABLESPACE m7ea_ts", W1, /effective:tablespace-create:m7ea_ts/],
  ["tablespace CREATE to PUBLIC", `CREATE TABLESPACE m7ea_ts LOCATION '${TS}'; GRANT CREATE ON TABLESPACE m7ea_ts TO PUBLIC`, "DROP TABLESPACE m7ea_ts", W1, /public:tablespace-public:m7ea_ts/],
  ["parameter SET (lo_compat_privileges)", `GRANT SET ON PARAMETER lo_compat_privileges TO ${EX}`, `REVOKE SET ON PARAMETER lo_compat_privileges FROM ${EX}`, W1, /effective:parameter:lo_compat_privileges/],
  ["parameter ALTER SYSTEM (work_mem)", `GRANT ALTER SYSTEM ON PARAMETER work_mem TO ${EX}`, `REVOKE ALTER SYSTEM ON PARAMETER work_mem FROM ${EX}`, W1, /effective:parameter:work_mem/],
  ["parameter SET to PUBLIC", "GRANT SET ON PARAMETER lo_compat_privileges TO PUBLIC", "REVOKE SET ON PARAMETER lo_compat_privileges FROM PUBLIC", W1, /public:parameter-public:lo_compat_privileges/],
  ["domain USAGE (explicit grant)", `CREATE DOMAIN public.m7ea_dom AS int; GRANT USAGE ON DOMAIN public.m7ea_dom TO ${EX}`, "DROP DOMAIN public.m7ea_dom", W1, /shdepend:a:pg_type|public:type-acl:public\.m7ea_dom/],
  ["type USAGE (explicit grant on a PUBLIC-revoked type)", `CREATE TYPE public.m7ea_t2 AS (a int); REVOKE USAGE ON TYPE public.m7ea_t2 FROM PUBLIC; GRANT USAGE ON TYPE public.m7ea_t2 TO ${EX}`, "DROP TYPE public.m7ea_t2", W1, /shdepend:a:pg_type/],
  ["language USAGE (explicit grant on plpgsql)", `GRANT USAGE ON LANGUAGE plpgsql TO ${EX}`, `REVOKE USAGE ON LANGUAGE plpgsql FROM ${EX}`, W1, /shdepend:a:pg_language|public:language-acl:plpgsql/],
  ["system catalog relation granted (pg_authid SELECT)", `GRANT SELECT ON pg_catalog.pg_authid TO ${EX}`, `REVOKE SELECT ON pg_catalog.pg_authid FROM ${EX}`, W1, /public:catalog-relation-acl:pg_authid/],
  ["system function granted to PUBLIC (pg_read_file)", "GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) TO PUBLIC", "REVOKE EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) FROM PUBLIC", W1, /public:catalog-routine-acl:pg_catalog\.pg_read_file/],
  ["system function granted to the executor (pg_ls_dir)", `GRANT EXECUTE ON FUNCTION pg_catalog.pg_ls_dir(text) TO ${EX}`, `REVOKE EXECUTE ON FUNCTION pg_catalog.pg_ls_dir(text) FROM ${EX}`, W1, /shdepend:a:pg_proc|public:catalog-routine-acl:pg_catalog\.pg_ls_dir/],
  ["schema CREATE on pg_catalog", `GRANT CREATE ON SCHEMA pg_catalog TO ${EX}`, `REVOKE CREATE ON SCHEMA pg_catalog FROM ${EX}`, W1, /effective:schema-create:pg_catalog/],
  ["CREATE on ANOTHER database (postgres)", `GRANT CREATE ON DATABASE postgres TO ${EX}`, `REVOKE CREATE ON DATABASE postgres FROM ${EX}`, W1, /effective:database-create:postgres/],
  ["CONNECT-only explicit grant on another database", `GRANT CONNECT ON DATABASE postgres TO ${EX}`, `REVOKE CONNECT ON DATABASE postgres FROM ${EX}`, W1, /database-grant:postgres:CONNECT/],
  ["cross-database table grant (in database postgres)", { db: "postgres", sql: `CREATE TABLE m7ea_x(a int); GRANT SELECT ON m7ea_x TO ${EX}` }, { db: "postgres", sql: "DROP TABLE m7ea_x" }, W1, /shdepend:a:pg_class:other-db-or-shared/],
  ["role-level setting on the executor", `ALTER ROLE ${EX} SET work_mem = '1MB'`, `ALTER ROLE ${EX} RESET work_mem`, W1, /effective:role-setting/],
  ["database-wide lo_compat_privileges = on", "ALTER DATABASE railway SET lo_compat_privileges = on", "ALTER DATABASE railway RESET lo_compat_privileges", W1, /public:(lo-compat-privileges|database-setting-lo-compat)/],
  ["row-level policy naming the executor", `CREATE POLICY m7ea_p ON public.budget_decisions TO ${EX} USING (true)`, "DROP POLICY m7ea_p ON public.budget_decisions", W1, /shdepend:r:pg_policy/],
  ["collation OWNED by the executor (new owner class)", `CREATE COLLATION public.m7ea_c FROM "C"; ALTER COLLATION public.m7ea_c OWNER TO ${EX}`, "DROP COLLATION public.m7ea_c", OWN, /owner:pg_collation/],
  ["text-search dictionary OWNED by the executor", `CREATE TEXT SEARCH DICTIONARY public.m7ea_d (TEMPLATE = simple); ALTER TEXT SEARCH DICTIONARY public.m7ea_d OWNER TO ${EX}`, "DROP TEXT SEARCH DICTIONARY public.m7ea_d", OWN, /owner:pg_ts_dict/],
];
const run = (x) => (typeof x === "string" ? sql(x) : sqlDb(x.db, x.sql));
for (const [label, apply, revert, want, findRe] of R1) {
  let m, applied = false;
  try { run(apply); applied = true; m = await measure(); }
  catch (e) { m = { refused: "APPLY_FAILED:" + e.message }; }
  finally { if (applied) { try { run(revert); } catch (e) { m = { refused: "REVERT_FAILED:" + e.message }; } } }
  const ext = m.e && m.e.evidence ? m.e.evidence.context.extendedFindings : [];
  let vr = null;
  if (m.e && m.e.evidence) {
    const e = m.e.evidence;
    const forced = sa.signer.issue({ requestNonce: nonce, target: tgt.target, connection: e.connection, privileges: e.privileges });
    vr = forced.ok ? verifyExecutorAttestation(forced.envelope, { trustRoot: tr, expectedConnectionToken: TOKEN, expectedRequestNonce: nonce, now: Date.now() }) : { ok: false, reason: "not_signable" };
  }
  const post = await measure();
  ok(`R1 real drift — ${label}: detected (${findRe.source.slice(0, 48)}), issuer REFUSES (${want}), PRESERVED verifier rejects the force-signed copy, clean after revert`,
    m.refused === want && ext.some((f) => findRe.test(f)) && vr && vr.ok === false && vr.reason === "executor_drift_public_or_default_widening" && post.clean === true,
    { got: m.refused, ext, verifier: vr && vr.reason, post: post.refused || "clean" });
}
const mClean2 = await measure();
ok("R-post every R1 drift reverted → CLEAN again (0 extended findings)", mClean2.clean === true && mClean2.e.evidence.context.extendedFindings.length === 0, mClean2.refused);

// ── observer refusals on real PostgreSQL ──
ok("O1 observer is SUPERUSER → refused", (await measure(TOKEN, "postgres")).refused === "observer_is_superuser");
ok("O2 observer IS the executor → refused", (await measure(TOKEN, EX)).refused === "observer_is_executor");
ok("O3 observer IS the reader → refused", (await measure(TOKEN, "live_ai_03b_reader")).refused === "observer_is_reader");
sql(`GRANT ${EX} TO ${OBS}`); let o4; try { o4 = await measure(); } finally { sql(`REVOKE ${EX} FROM ${OBS}`); }
ok("O4 observer holds executor membership → refused", o4.refused === "observer_holds_executor_authority", o4);
sql(`REVOKE pg_read_all_stats FROM ${OBS}`); let o5; try { o5 = await measure(); } finally { sql(`GRANT pg_read_all_stats TO ${OBS}`); }
ok("O5 observer without pg_read_all_stats (backend_start invisible) → refused", o5.refused === "observer_lacks_session_visibility", o5);
sql(`GRANT pg_monitor TO ${OBS}`); let o6; try { o6 = await measure(); } finally { sql(`REVOKE pg_monitor FROM ${OBS}`); }
ok("O6 observer with membership beyond pg_read_all_stats (pg_monitor) → refused", o6.refused === "observer_membership_not_least_privilege", o6);

// ── session identity on real PostgreSQL ──
ok("S1 token of no session → no_such_session", (await measure("f".repeat(64))).refused === "no_such_session");
const ex2 = await exFactory.open(); const ex2S = await establishExecutorSession(ex2, { statementTimeoutMs: 5000 });
const m2 = await measure(ex2S.session.token);
ok("S2 a SECOND real executor session is attested only for ITS own token (distinct pids/app names)", m2.clean === true && m2.e.evidence.connection.token === ex2S.session.token && ex2S.session.token !== TOKEN);
const oldTok = ex2S.session.token; await ex2.close(); await new Promise((r2) => setTimeout(r2, 300));
ok("S3 a CLOSED session's token is no longer attestable", (await measure(oldTok)).refused === "no_such_session");
ok("S4 clock skew between host and DB > 5 s → refused", (await observeAs(OBS, TOKEN, () => Date.now() + 60000)).reason === "attester_clock_skew");

// ── full service over the loopback channel with a REAL observer ──
const readerKp = generateKeyPairSync("ed25519");
const svcEnv = {
  [ENV.issuer]: ISSUER, [ENV.publicKeyDerB64]: der, [ENV.fingerprint]: fpr, [ENV.port]: "8551",
  [ENV.channelSecret]: randomBytes(24).toString("hex"), [ENV.signingKeyPkcs8B64]: pk8, [ENV.observerDbUrl]: url(OBS),
  [ENV.bindHost]: "10.20.3.4", [ENV.allowedPeerCidrs]: "10.20.3.0/24", [ENV.deploymentAnchor]: JSON.stringify(anchor),
  [ENV.readerAttesterIssuer]: "TEST-ONLY-reader-attester", [ENV.readerAttesterFingerprint]: publicKeyFingerprintFromDerB64(readerKp.publicKey.export({ type: "spki", format: "der" }).toString("base64")),
};
const svc = await startExecutorAttesterService({ mode: "offline-test", offlineTestBoundary: true, env: svcEnv, log: () => {},
  testListen: { bindHost: "127.0.0.1", port: 0, allowedPeerCidrs: ["127.0.0.1/32"] },
  observerFactory: makeExecutorObserverPgFactory({ env: svcEnv, connectionStringEnvName: ENV.observerDbUrl }) });
ok("E1 executor attester service starts (offline-test) with a REAL observer", svc.started === true, svc.reason);
if (svc.started) {
  const ch = createExecutorAttestationSourceChannel({ host: "127.0.0.1", port: svc.address.port, channelSecret: svcEnv[ENV.channelSecret] }, { offlineTestBoundary: true });
  const n2 = randomBytes(16).toString("hex");
  let envl = null; try { envl = await ch.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: TOKEN, role: EX, requestNonce: n2 }); } catch (e) { envl = { err: e.code, at: e.attesterCode }; }
  const v2 = verifyExecutorAttestation(envl, { trustRoot: tr, expectedConnectionToken: TOKEN, expectedRequestNonce: n2, now: Date.now() });
  ok("E2 channel obtain() → envelope → PRESERVED verifyExecutorAttestation PASS (end to end on real PostgreSQL)", v2.ok === true, v2.reason || envl);
  const b2 = bindExecutorConnection({ session: exS.session, envelope: envl, trustRoot: tr, requestNonce: n2, nowMs: Date.now(), testBoundary: true });
  ok("E3 PRESERVED bindExecutorConnection on the channel envelope → PASS", b2.ok === true, b2.reason);
  sql(`GRANT SELECT ON public.budget_decisions TO ${EX}`);
  let e4; try { e4 = await ch.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: TOKEN, role: EX, requestNonce: randomBytes(16).toString("hex") }); } catch (e) { e4 = { code: e.code, at: e.attesterCode }; }
  finally { sql(`REVOKE SELECT ON public.budget_decisions FROM ${EX}`); }
  ok("E4 live drift during service → channel refuses (no envelope, fixed code)", e4 && e4.code === "executor_attester_rejected" && e4.at === "unavailable", e4);
  ok("E5 service counters: signed == 1, selfVerifyFailed == 0", svc.stats().signed === 1 && svc.stats().selfVerifyFailed === 0, svc.stats());
  await svc.stop();
}
await exPhys.close();
{ const lo = NET.connects.filter((h) => h === "127.0.0.1").length, ux = NET.connects.filter((h) => h === "unix").length, ext = NET.connects.length - lo - ux;
  ok("N01 zero external network: every connect was the throwaway unix socket or 127.0.0.1 loopback, fetch never called", ext === 0 && NET.fetch === 0 && ux > 0, NET.connects.filter((h) => h !== "unix" && h !== "127.0.0.1"));
  console.log(`  (network counters: loopback_socket_connects=${lo} unix_socket_connects=${ux} external_network_connects=${ext} fetch_calls=${NET.fetch})`); }
console.log(`m7-v2-executor-attester-localpg: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
