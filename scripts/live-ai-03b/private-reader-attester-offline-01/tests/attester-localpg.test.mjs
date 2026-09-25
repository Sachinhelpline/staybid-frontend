// OFFLINE real-PostgreSQL evidence test — THROWAWAY LOCAL cluster ONLY (never AI-STAGING, never live).
//
// Validates what a synthetic fixture cannot: that the attester's fixed evidence SQL actually executes on
// real PostgreSQL, and that its semantics are right (PUBLIC grants, NOINHERIT memberships, pg_stat_activity
// visibility, to_regclass, parameter typing). It runs, unmodified:
//   • the ACCEPTED reader connection code (reader-session.mjs makePgPhysicalFactory + establishReaderSession)
//   • the REAL attester observer + evidence code (observer-connection.mjs, evidence-evaluator.mjs)
//   • the REAL signing adapter, verified by the ACCEPTED reader-host verifier
// and applies the observer-role proposal BODY (guard stripped) to the throwaway cluster to prove it valid.
// Unix-socket only (listen_addresses=''), trust auth, fsync off, removed on exit. If PostgreSQL binaries are
// unavailable the suite reports SKIPPED — a skip is never a pass.
import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync, chownSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import os from "node:os";
import process from "node:process";

import { makePgPhysicalFactory, establishReaderSession } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { verifyReaderAttestation, makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { makeObserverPgFactory, establishObserverSession } from "../observer-connection.mjs";
import { observeReaderEvidence, evidenceIsAttestable, EXPECTED_SELECT_GRANT_COUNT } from "../evidence-evaluator.mjs";
import { PERMITTED_SELECT_OBJECTS } from "../evidence-queries.mjs";
import { createSigningAdapter } from "../signing-adapter.mjs";
import { clusterFingerprint, resolveTarget, ANCHOR_CONTRACT, ANCHOR_DOMAIN, parseDeploymentAnchor } from "../target-binding.mjs";
import { AI_STAGING } from "../attester-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
let pass = 0, fail = 0, skip = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };

function findBin() {
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const vers = readdirSync(base).filter((v) => existsSync(join(base, v, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a));
  return vers.length ? join(base, vers[0], "bin") : null;
}
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
function pgRun(bin, args) {
  const cmd = isRoot ? ["runuser", ["-u", "postgres", "--", bin, ...args]] : [bin, args];
  return spawnSync(cmd[0], cmd[1], { encoding: "utf8", timeout: 120000 });
}

async function run() {
  const BIN = findBin();
  if (!BIN) { skip++; console.log("SKIPPED: no local PostgreSQL binaries — real-SQL evidence NOT verified (a skip is not a pass)"); return finish(); }
  try { await import("pg"); } catch { skip++; console.log("SKIPPED: the repository 'pg' dependency is not installed here (run from a repo checkout with node_modules) — real-SQL evidence NOT verified"); return finish(); }
  const dir = mkdtempSync(join(os.tmpdir(), "lai03b-attester-pg-"));
  if (isRoot) { try { const pw = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" }); const uid = Number(pw.stdout.trim()); chownSync(dir, uid, uid); } catch {} }
  const data = join(dir, "data");
  let started = false; const clients = [];
  try {
    const init = pgRun(join(BIN, "initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "-N", "--no-instructions"]);
    if (init.status !== 0) { skip++; console.log("SKIPPED: initdb failed in this environment — real-SQL evidence NOT verified"); return finish(); }
    const st = pgRun(join(BIN, "pg_ctl"), ["-D", data, "-l", join(dir, "server.log"), "-w", "-t", "60", "-o", `-c listen_addresses='' -c unix_socket_directories=${dir} -c fsync=off`, "start"]);
    if (st.status !== 0) { skip++; console.log("SKIPPED: local cluster did not start — real-SQL evidence NOT verified"); return finish(); }
    started = true;
    const url = (user) => `postgresql://${user}@/postgres?host=${encodeURIComponent(dir)}`;
    const { default: pg } = await import("pg");
    const su = new pg.Client({ connectionString: url("postgres") }); await su.connect(); clients.push(su);
    const SQ = (q) => su.query(q);

    console.log("R1. Accepted reader role (Sections I–III shape) + proposed observer role on a THROWAWAY cluster");
    await SQ("CREATE ROLE live_ai_03b_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT");
    await SQ("GRANT USAGE ON SCHEMA public TO live_ai_03b_reader");
    for (const o of PERMITTED_SELECT_OBJECTS) await SQ(`CREATE TABLE ${o} (id text)`);
    await SQ("CREATE TABLE public.budget_envelope_allocations (id text)");
    await SQ(`GRANT SELECT ON ${PERMITTED_SELECT_OBJECTS.join(", ")} TO live_ai_03b_reader`);
    const proposal = readFileSync(join(ROOT, "observer-role-proposal.sql"), "utf8");
    let guardRefused = false; try { await SQ(proposal); } catch { guardRefused = true; }
    ok("observer-role proposal is NON-EXECUTABLE as-is (guard raises before any statement)", guardRefused === true && (await SQ("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='live_ai_03b_attester_observer'")).rows[0].n === 0);
    const body = proposal.split("\n").filter((l) => !l.startsWith("DO $guard$")).join("\n");
    await SQ(body);
    const obsRole = (await SQ("SELECT rolsuper, rolinherit, rolconnlimit FROM pg_roles WHERE rolname='live_ai_03b_attester_observer'")).rows[0];
    ok("proposal body applies cleanly on real PostgreSQL (non-superuser, INHERIT, connection limit 3)", obsRole && obsRole.rolsuper === false && obsRole.rolinherit === true && obsRole.rolconnlimit === 3);
    const mem = (await SQ("SELECT string_agg(r.rolname, ',') AS m FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='live_ai_03b_attester_observer'::regrole")).rows[0].m;
    ok("observer holds exactly one membership: pg_read_all_stats", mem === "pg_read_all_stats");

    console.log("R2. ACCEPTED reader connection + REAL attester observation against real PostgreSQL");
    const env = { READER_URL: url("live_ai_03b_reader"), OBSERVER_URL: url("live_ai_03b_attester_observer") };
    const rPhys = await makePgPhysicalFactory({ env, connectionStringEnvName: "READER_URL" }).open();
    const rSess = await establishReaderSession(rPhys, { statementTimeoutMs: 2000 });
    ok("accepted establishReaderSession works on real PostgreSQL (timeout + read-only read back, identity token)", rSess.ok === true && rSess.session.effectiveStatementTimeoutMs === 2000 && /^[0-9a-f]{64}$/.test(rSess.session.token));
    const oFactory = makeObserverPgFactory({ env, connectionStringEnvName: "OBSERVER_URL" });
    const observe = async () => { const p = await oFactory.open(); const es = await establishObserverSession(p, { statementTimeoutMs: 2000 }); if (!es.ok) return es; const r = await observeReaderEvidence(es.observer, rSess.session.token); await es.observer.close(); return r; };
    const ev = await observe();
    ok("REAL evidence SQL executes on PostgreSQL (no overload/parameter/permission error)", ev.ok === true);
    ok("attester INDEPENDENTLY re-derives the SAME connection token the reader host derived (cross-code, real to_char format)", ev.ok && ev.evidence.connection.token === rSess.session.token);
    ok("clean accepted state: exactly 12 SELECT, 0 write, forbidden inaccessible, no membership/routine/owner authority -> attestable", ev.ok && ev.evidence.privileges.selectGrantCount === EXPECTED_SELECT_GRANT_COUNT && ev.evidence.privileges.writePrivilegeCount === 0 && ev.evidence.privileges.forbiddenObjectAccessible === false && ev.evidence.privileges.unapprovedRoleMembership === false && ev.evidence.privileges.unapprovedRoutineAuthority === false && ev.evidence.privileges.ownerOrExecutorAuthority === false && evidenceIsAttestable(ev.evidence).ok === true);
    // anchor from the OBSERVED cluster (simulating the future Owner-verified anchor) + real signature
    const anchorJson = JSON.stringify({ contract: ANCHOR_CONTRACT, domain: ANCHOR_DOMAIN, clusterFingerprint: clusterFingerprint(ev.evidence.cluster), projectId: AI_STAGING.projectId, environmentId: AI_STAGING.environmentId, pgServiceId: AI_STAGING.pgServiceId, issuedAtMs: Date.now(), verifiedBy: "offline-localpg-test-only" });
    const tgt = resolveTarget(parseDeploymentAnchor(anchorJson).anchor, ev.evidence.cluster);
    const k = generateKeyPairSync("ed25519");
    const sig = createSigningAdapter({ issuer: "owner-attester-localpg", privateKeyPkcs8B64: k.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), proofLifetimeMs: 120000 });
    const nonce = "0123456789abcdef0123456789abcdef";
    const issued = sig.signer.issue({ requestNonce: nonce, target: tgt.target, connection: ev.evidence.connection, privileges: ev.evidence.privileges });
    const tr = makeAttesterTrustRoot({ issuer: sig.signer.issuer, publicKeyDerB64: sig.signer.publicKeyDerB64, fingerprint: sig.signer.keyId });
    ok("real-PostgreSQL evidence -> real signature -> ACCEPTED reader-host verifier accepts", tgt.ok === true && issued.ok === true && verifyReaderAttestation(issued.envelope, { trustRoot: tr.trustRoot, expectedConnectionToken: rSess.session.token, expectedRequestNonce: nonce, now: Date.now() }).ok === true);

    console.log("R3. Real PostgreSQL privilege semantics — every drift is detected and refused");
    const drift = async (setup, undo) => { await SQ(setup); const r = await observe(); await SQ(undo); return r; };
    const d1 = await drift("GRANT INSERT ON public.budget_decisions TO live_ai_03b_reader", "REVOKE INSERT ON public.budget_decisions FROM live_ai_03b_reader");
    ok("direct write grant -> writePrivilegeCount > 0 -> not attestable", d1.ok && d1.evidence.privileges.writePrivilegeCount > 0 && evidenceIsAttestable(d1.evidence).ok === false);
    const d2 = await drift("GRANT SELECT ON public.budget_envelope_allocations TO PUBLIC", "REVOKE SELECT ON public.budget_envelope_allocations FROM PUBLIC");
    ok("PUBLIC grant on the forbidden object -> forbiddenObjectAccessible (PUBLIC counted) -> not attestable", d2.ok && d2.evidence.privileges.forbiddenObjectAccessible === true && evidenceIsAttestable(d2.evidence).ok === false);
    const d3 = await drift("CREATE ROLE lai_grp NOLOGIN; GRANT SELECT ON public.budget_envelope_allocations TO lai_grp; GRANT lai_grp TO live_ai_03b_reader", "REVOKE lai_grp FROM live_ai_03b_reader; DROP OWNED BY lai_grp; DROP ROLE lai_grp");
    ok("NOINHERIT membership (invisible to has_table_privilege, reachable by SET ROLE) -> unapprovedRoleMembership -> not attestable", d3.ok && d3.evidence.privileges.unapprovedRoleMembership === true && d3.evidence.privileges.forbiddenObjectAccessible === false && evidenceIsAttestable(d3.evidence).ok === false);
    const d4 = await drift("CREATE FUNCTION public.lai_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'", "DROP FUNCTION public.lai_probe()");
    ok("function in public (EXECUTE via PUBLIC by default) -> unapprovedRoutineAuthority -> not attestable", d4.ok && d4.evidence.privileges.unapprovedRoutineAuthority === true && evidenceIsAttestable(d4.evidence).ok === false);
    const d5 = await drift("CREATE TABLE public.lai_new (id text); GRANT SELECT ON public.lai_new TO PUBLIC", "DROP TABLE public.lai_new");
    ok("new table readable via PUBLIC -> unexpected authority -> not attestable", d5.ok && d5.evidence.privileges.ownerOrExecutorAuthority === true && evidenceIsAttestable(d5.evidence).ok === false);
    const d6 = await drift("ALTER ROLE live_ai_03b_reader CREATEDB", "ALTER ROLE live_ai_03b_reader NOCREATEDB");
    ok("reader role over-privileged (CREATEDB) -> refused before any claim", d6.ok === false && d6.reason === "reader_role_overprivileged");
    const d7 = await drift("GRANT CREATE ON SCHEMA public TO live_ai_03b_reader", "REVOKE CREATE ON SCHEMA public FROM live_ai_03b_reader");
    ok("schema CREATE authority -> not attestable", d7.ok && d7.evidence.privileges.ownerOrExecutorAuthority === true && evidenceIsAttestable(d7.evidence).ok === false);
    const d9 = await drift("CREATE SEQUENCE public.lai_seq; GRANT USAGE ON SEQUENCE public.lai_seq TO live_ai_03b_reader", "DROP SEQUENCE public.lai_seq");
    ok("sequence USAGE (nextval) -> counted as write authority -> not attestable", d9.ok && d9.evidence.privileges.writePrivilegeCount > 0 && evidenceIsAttestable(d9.evidence).ok === false);
    const d10 = await drift("GRANT CREATE ON DATABASE postgres TO live_ai_03b_reader", "REVOKE CREATE ON DATABASE postgres FROM live_ai_03b_reader");
    ok("database CREATE -> write authority -> not attestable", d10.ok && d10.evidence.privileges.writePrivilegeCount > 0 && evidenceIsAttestable(d10.evidence).ok === false);
    ok("TEMPORARY via PUBLIC default is RECORDED (not hidden) and does not by itself block attestation", ev.ok && ev.evidence.context.databaseTemporary === true);
    const ver = Number((await SQ("SELECT current_setting('server_version_num') AS v")).rows[0].v);
    ok("version-guarded MAINTAIN check executes without error on this server (PG " + Math.floor(ver / 10000) + "; MAINTAIN evaluated only on 17+)", ev.ok && ev.evidence.context.maintainAuthority === false);
    const d8 = await drift("ALTER TABLE public.budget_sessions RENAME TO budget_sessions_moved", "ALTER TABLE public.budget_sessions_moved RENAME TO budget_sessions");
    ok("permitted object missing (schema drift) -> fail closed", d8.ok === false && d8.reason === "permitted_object_absent");

    console.log("R4. Observer capability boundaries on real PostgreSQL");
    await SQ("REVOKE pg_read_all_stats FROM live_ai_03b_attester_observer");
    const noStats = await observe();
    await SQ("GRANT pg_read_all_stats TO live_ai_03b_attester_observer");
    ok("observer WITHOUT pg_read_all_stats -> fail closed (backend_start not visible; pg_read_all_stats genuinely required)", noStats.ok === false && noStats.reason === "observer_lacks_session_visibility");
    const suF = makeObserverPgFactory({ env: { SU: url("postgres") }, connectionStringEnvName: "SU" });
    const suEs = await establishObserverSession(await suF.open(), { statementTimeoutMs: 2000 });
    const suEv = await observeReaderEvidence(suEs.observer, rSess.session.token); await suEs.observer.close();
    ok("superuser as observer -> refused (least privilege is enforced, not assumed)", suEv.ok === false && suEv.reason === "observer_is_superuser");
    const oc = new pg.Client({ connectionString: env.OBSERVER_URL }); await oc.connect(); clients.push(oc);
    let rowDenied = false; try { await oc.query("SELECT count(*) FROM public.budget_decisions"); } catch { rowDenied = true; }
    ok("observer role CANNOT read application rows (no table data access)", rowDenied === true);
    let writeDenied = false; try { await oc.query("CREATE TABLE public.lai_obs_write (id int)"); } catch { writeDenied = true; }
    ok("observer role cannot create/write (read-only session default + no CREATE)", writeDenied === true);

    console.log("R5. Session drift on real PostgreSQL");
    await rSess.session.physical.close();
    const gone = await observe();
    ok("reader connection closed -> its token is no longer attestable", gone.ok === false && (gone.reason === "no_reader_session_observed" || gone.reason === "no_such_session"));
  } catch (e) {
    fail++; fails.push("harness: " + (e && e.message ? String(e.message).slice(0, 160) : "error")); console.log("  HARNESS ERROR:", e && e.message);
  } finally {
    for (const c of clients) { try { await c.end(); } catch {} }
    if (started) pgRun(join(BIN, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  return finish();
}
function finish() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed, ${skip} skipped  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  if (skip > 0) { console.log("REAL-POSTGRESQL EVIDENCE: NOT VERIFIED (skipped)"); process.exitCode = 0; return; }
  console.log("REAL-POSTGRESQL EVIDENCE VERIFICATION (throwaway local cluster): PASS");
  console.log("SCOPE: local PostgreSQL " + "cluster created and destroyed by this test — NOT AI-STAGING, NOT a live database, NOT hosted-PostgreSQL behaviour.");
}
run();
