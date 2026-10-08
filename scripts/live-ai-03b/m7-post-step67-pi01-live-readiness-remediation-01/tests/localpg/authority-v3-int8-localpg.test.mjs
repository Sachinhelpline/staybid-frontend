// OFFLINE real-PostgreSQL test — V3 RUNTIME PG BIGINT NORMALIZATION REMEDIATION 01. THROWAWAY LOCAL cluster ONLY
// (unix socket, listen_addresses='', trust auth, fsync off, removed on exit). NEVER AI-STAGING, never live.
//
// Base = the accepted V3 pre-activation state (same frozen SQL list/order as executor-v2-localpg: post-Step-1 shape +
// m7-v3-01 inactive seed + m7-v3-02 trusted_v3 successor). Real `pg` (repo lockfile 8.23.0), real reader-session
// factory, real establishReaderSession / establishExecutorSession, real guarded reader client, the accepted PI01
// createV3ProductionIntegrationCore run() and the FROZEN R3 runtime checks / approval verifier / restricted
// activation adapter. TEST doubles ONLY for: executor/reader attestation transport + their validation, reviewer
// trust-root config (synthetic TEST Ed25519 key). Scenarios A–D, I, J of the remediation matrix.
// If PostgreSQL binaries are unavailable, or the frozen V3 catalog window is closed, the suite exits 2 (SKIPPED —
// a skip is never a pass).
import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync, chownSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes, sign as edSign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import os from "node:os";
import process from "node:process";
import { counter, edKey } from "../_h.mjs";
import { makePgPhysicalFactory, establishReaderSession, connectionTokenFor } from "../../../private-reader-production-integration-offline-01/reader-session.mjs";
import { makeExecutorPgPhysicalFactory, establishExecutorSession } from "../../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { makeProductionClock } from "../../../m7-v2-production-authority-provisioning-offline-01/src/trusted-clock.mjs";
import { makeGuardedReaderClientV3 } from "../../../m7-post-step67-production-integration-01-runtime-01/src/v3-guarded-clients.mjs";
import { createV3ProductionIntegrationCore } from "../../../m7-post-step67-production-integration-01-runtime-01/src/v3-integration-core.mjs";
import { PINNED_RUNTIME_BINDING, PINNED_SUCCESSOR_RUNTIME_PIN_REF } from "../../../m7-post-step67-production-integration-01-runtime-01/src/runtime-preservation-binding.mjs";
import { QUERIES, REGISTRY_DIGEST } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-query-registry.mjs";
import { checkPreActivationState, checkActivatedState } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-contract.mjs";
import { checkV3Catalog, reviewedV3Rows } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-catalog-contract.mjs";
import { validateRuntimePreservationBinding, runtimePinRef } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-identity.mjs";
import { verifyApprovalV3 } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/approval-verify-v3.mjs";
import { buildApprovalPayloadV3, canonicalize, FIXED_V3 } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT_V2, EXECUTOR_ROLE } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { ACTIVATE_SQL_V3, makeRestrictedActivationAdapterV3 } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-restricted-activation-adapter.mjs";
import * as G from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-digest-gen.mjs";
import { makeInt8NormalizingReaderPhysicalFactory, normalizeObservationRows, INT8_OBSERVATION_FIELDS } from "../../src/authority-v3-int8-observation-normalizer.mjs";

globalThis.fetch = async () => { throw new Error("network forbidden in offline tests"); };
const HERE = dirname(fileURLToPath(import.meta.url));
const S = resolve(HERE, "../../..");          // scripts/live-ai-03b
const REPO = resolve(S, "../..");
const R3 = join(S, "m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted");
const M7S1 = join(S, "m7-step1-hb1-consolidated-remediation-01");
const { ok, done } = counter("authority-v3-int8-localpg");
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
if (Date.now() >= Date.parse(FIXED_V3.catalog_verification_expiry) || Date.now() < Date.parse(FIXED_V3.catalog_t0)) {
  console.log("SKIPPED: frozen V3 catalog verification window closed for this clock (a skip is never a pass)"); process.exit(2);
}

function findBin() { const base = "/usr/lib/postgresql"; if (!existsSync(base)) return null;
  const v = readdirSync(base).filter((x) => existsSync(join(base, x, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a)); return v.length ? join(base, v[0], "bin") : null; }
const BIN = findBin();
if (!BIN) { console.log("SKIPPED: PostgreSQL binaries unavailable (a skip is never a pass)"); process.exit(2); }
const isRoot = process.getuid && process.getuid() === 0;
const asPg = (cmd, args, opts = {}) => (isRoot ? spawnSync("runuser", ["-u", "postgres", "--", cmd, ...args], { encoding: "utf8", ...opts }) : spawnSync(cmd, args, { encoding: "utf8", ...opts }));
const BASE = mkdtempSync(join(os.tmpdir(), "lai03b-bigint01-pg-"));
if (isRoot) chownSync(BASE, Number(spawnSync("id", ["-u", "postgres"], { encoding: "utf8" }).stdout.trim()), Number(spawnSync("id", ["-g", "postgres"], { encoding: "utf8" }).stdout.trim()));
const DATA = join(BASE, "data");
const stop = () => { asPg(join(BIN, "pg_ctl"), ["-D", DATA, "-m", "immediate", "stop"]); try { rmSync(BASE, { recursive: true, force: true }); } catch {} };
process.on("exit", stop);
const PSQL = join(BIN, "psql");
const psql = (db, input, extra = []) => asPg(PSQL, ["-X", "-q", "-h", BASE, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", ...extra], { input });
const val = (s) => psql("railway", s, ["-tA"]).stdout.trim();

let r = asPg(join(BIN, "initdb"), ["-D", DATA, "-A", "trust", "-U", "postgres", "-N", "--no-instructions"]);
if (r.status !== 0) { console.log("SKIPPED: initdb failed"); process.exit(2); }
writeFileSync(join(DATA, "pg_hba.conf"), "local all all trust\n");
if (isRoot) spawnSync("chown", ["postgres:postgres", join(DATA, "pg_hba.conf")]);
r = asPg(join(BIN, "pg_ctl"), ["-D", DATA, "-l", join(BASE, "server.log"), "-w", "-t", "60", "-o", `-c listen_addresses='' -c unix_socket_directories=${BASE} -c fsync=off`, "start"]);
if (r.status !== 0) { console.log("SKIPPED: cluster did not start"); process.exit(2); }
psql("postgres", "CREATE DATABASE railway ENCODING 'UTF8' TEMPLATE template0;");
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
  join(R3, "sql/m7-v3-01-inactive-catalog-seed.sql"),
  join(R3, "sql/m7-v3-02-trusted-successor-migration.sql"),
];
for (const f of BASE_SQL) { const x = psql("railway", readFileSync(f, "utf8")); if (x.status !== 0) { console.log("SKIPPED: base SQL failed: " + f.split("/").slice(-1)[0] + " :: " + (x.stderr || "").split("\n")[0]); process.exit(2); } }
ok("L00 base = accepted V3 pre-activation state on PostgreSQL " + val("SHOW server_version"), val("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='live_ai_03b_trusted_v3'") === "2");
ok("L00b schema: the 10 observation columns are BIGINT NOT NULL", val(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND data_type='bigint' AND is_nullable='NO' AND
  ((table_name='budget_price_catalog_entries' AND column_name IN ('unit_size','rate_micros')) OR (table_name='budget_control_epochs' AND column_name='control_epoch') OR
   (table_name='budget_policy_versions' AND column_name IN (${INT8_OBSERVATION_FIELDS.policy.map((c) => `'${c}'`).join(",")})))`) === "10");
ok("L00c the frozen observation queries select NO other BIGINT/INT8 column (version + ledger queries carry none)",
  val(`SELECT count(*) FROM information_schema.columns WHERE table_schema IN ('public','live_ai_03b_trusted') AND data_type='bigint' AND table_name IN ('budget_price_catalog_versions','approval_consumption')`) === "0");

const url = (role) => `postgresql://${role}@/railway?host=${encodeURIComponent(BASE)}`;
const READER = "live_ai_03b_reader", EX = "live_ai_03b_executor";
const RAW = makePgPhysicalFactory({ env: { R: url(READER) }, connectionStringEnvName: "R" });           // accepted production reader path, unmodified
const WRAPPED = makeInt8NormalizingReaderPhysicalFactory(makePgPhysicalFactory({ env: { R: url(READER) }, connectionStringEnvName: "R" }));   // the composition wiring
async function observe(factory) {   // exactly the accepted v3-integration-core observeState over a guarded reader client
  const phys = await factory.open();
  try {
    const s = await establishReaderSession(phys, { statementTimeoutMs: 2000 });
    if (!s.ok) throw new Error("reader_session_" + s.reason);
    const rd = makeGuardedReaderClientV3(s.session, QUERIES);
    const rows = async (sql) => (await rd.query(sql)).rows;
    const [versions, entries, policyRows, controlRows] = await Promise.all([rows(QUERIES.catalogVersions), rows(QUERIES.catalogEntries), rows(QUERIES.policy), rows(QUERIES.controls)]);
    return { versions, entries, policyRows, controlRows };
  } finally { await phys.close(); }
}
const dbState = () => val(`SELECT (SELECT count(*) FROM public.budget_price_catalog_versions WHERE status='active')||'/'||(SELECT count(*) FROM public.budget_price_catalog_entries WHERE status='active')||'/'||(SELECT count(*) FROM live_ai_03b_trusted.approval_consumption)||'/'||(SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id='${G.V3_ID}')`);
const writes = () => val("SELECT coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) FROM pg_stat_user_tables");
const E = INT8_OBSERVATION_FIELDS.catalogEntries, P = INT8_OBSERVATION_FIELDS.policy, C = INT8_OBSERVATION_FIELDS.controls;
const expectedPred = [...G.entryRows(G.V1.id, G.V1_RATES, G.V1.t0, G.V1.expiry, G.V1.source_digest, "inactive"), ...G.entryRows(G.V2.id, G.V2_RATES, G.V2.t0, G.V2.expiry, G.V2.source_digest, "inactive")].sort((a, b) => a.id.localeCompare(b.id));
const predOf = (obs) => obs.entries.filter((e) => e.catalog_version_id === G.V1.id || e.catalog_version_id === G.V2.id).sort((a, b) => a.id.localeCompare(b.id));

// ═══ A — BEFORE-FIX REPRODUCTION (unmodified accepted reader path) ═══
const before = await observe(RAW);
const a = checkPreActivationState(before, isoNow());
ok("A01 BEFORE: real pg + accepted reader path + frozen checkPreActivationState → predecessor_not_byte_exact", a.ok === false && a.reason === "predecessor_not_byte_exact", a);
const e0 = predOf(before)[0], x0 = expectedPred[0];
ok(`A02 BEFORE: typeof actual ${e0.id}.unit_size === "string" && value "1000000"`, typeof e0.unit_size === "string" && e0.unit_size === "1000000", e0.unit_size);
ok(`A03 EXPECTED: typeof expected.unit_size === "number" && value 1000000`, typeof x0.unit_size === "number" && x0.unit_size === 1000000);
ok("A04 BEFORE: canonical(actual predecessor rows) !== canonical(expected rows)", G.canonicalize(predOf(before)) !== G.canonicalize(expectedPred));
const typeOf = (rows, cols) => cols.map((c) => [...new Set(rows.map((x) => typeof x[c]))].join("|"));
ok("A05 BEFORE: every allowlisted entry BIGINT column arrives as string (all 8 rows)", typeOf(before.entries, E).every((t) => t === "string"));
ok("A06 BEFORE: every policy BIGINT column arrives as string", typeOf(before.policyRows, P).every((t) => t === "string") && before.policyRows[0].session_provider_calls === "0");
ok("A07 BEFORE: control_epoch arrives as string \"1\" (booleans are real booleans)", typeOf(before.controlRows, C)[0] === "string" && before.controlRows.every((c) => c.control_epoch === "1" && typeof c.enabled === "boolean"));
ok("A08 BEFORE: no other column of the 4 observation result sets is a non-string/non-null/non-boolean (no other INT8 surface)",
  [...before.versions, ...before.entries, ...before.policyRows, ...before.controlRows].every((row) => Object.values(row).every((v) => v === null || typeof v === "string" || typeof v === "boolean")));
// each normalized family is INDIVIDUALLY necessary (all others normalized → still refused)
const norm = (obs, skip) => ({ versions: obs.versions,
  entries: obs.entries.map((e) => { const isV3 = e.catalog_version_id === G.V3_ID; if ((skip === "pred" && !isV3) || (skip === "v3" && isV3)) return e; return normalizeObservationRows(QUERIES.catalogEntries, [e])[0]; }),
  policyRows: skip === "policy" ? obs.policyRows : normalizeObservationRows(QUERIES.policy, obs.policyRows),
  controlRows: skip === "control" ? obs.controlRows : normalizeObservationRows(QUERIES.controls, obs.controlRows) });
for (const [fam, reason] of [["pred", "predecessor_not_byte_exact"], ["policy", "dormant_policy_controls_mismatch"], ["control", "dormant_policy_controls_mismatch"], ["v3", "v3_entry_identity_mismatch"]]) {
  const x = checkPreActivationState(norm(before, fam), isoNow());
  ok(`A09 surface: every family normalized EXCEPT ${fam} → still refused (${reason})`, x.ok === false && x.reason === reason, x);
}
ok("A10 surface: all 4 families normalized → passes (the surface is complete and minimal)", checkPreActivationState(norm(before, "none"), isoNow()).ok === true);

// ═══ shared core harness: accepted PI01 core run() over REAL sessions (TEST doubles only for attestation/config) ═══
const REV = edKey();   // synthetic TEST reviewer key (never a real key)
const receipt = JSON.parse(readFileSync(join(R3, "evidence/SUPPLIED-EVIDENCE-RECEIPT-CANDIDATE-V3.json"), "utf8")).receipt;
function testRequest() {
  const now = Date.now(), iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const exec = "test-exec-" + randomBytes(8).toString("hex");
  const payload = buildApprovalPayloadV3({ approval_id: "test-appr-" + randomBytes(8).toString("hex"), reviewer_public_key_fingerprint: REV.fp,
    evidence: { receipt_id: receipt.id, content_digest: receipt.digest, verified_at: FIXED_V3.catalog_t0, evidence_expiry: FIXED_V3.catalog_verification_expiry },
    scope: { openai_account_ref: "org-SyntheticTestOnly0001", openai_project_ref: "proj_SyntheticTestOnly0001" }, successor_runtime_pin_ref: PINNED_SUCCESSOR_RUNTIME_PIN_REF,
    execution: { execution_id: exec, issued_at: iso(now), not_before: iso(now - 300000), expiry: iso(Math.min(now + 3600000, Date.parse(FIXED_V3.catalog_verification_expiry))) } });
  const signature_b64 = edSign(null, Buffer.from(canonicalize(payload), "utf8"), REV.kp.privateKey).toString("base64");
  return { approvalEnvelope: { alg: "ed25519", signature_b64, payload }, executionId: exec, suppliedEvidence: { id: receipt.id, digest: receipt.digest, content: receipt.content } };
}
function makeCore(readerPhysicalFactory, seen) {
  const runtime = Object.freeze({
    loadRuntimeConfigV3: () => ({ ok: true, reviewer: { pinnedPublicKeyDerB64: REV.der, pinnedFingerprint: REV.fp } }),            // TEST double (config)
    validateRuntimePreservationBinding, runtimePinRef, verifyApprovalV3,                                                            // frozen
    checkPreActivationState: (o, n) => { seen.pre = o; return checkPreActivationState(o, n); },                                    // frozen (observed)
    checkActivatedState: (o, n) => { seen.post = o; return checkActivatedState(o, n); },                                           // frozen (observed)
    validateV3ProductionExecutorAuthority: () => ({ ok: true }),                                                                   // TEST double (attestation)
    EXECUTOR_ATTESTATION_CONTRACT_V2, EXECUTOR_ROLE, QUERIES, REGISTRY_DIGEST, ACTIVATE_SQL_V3, makeRestrictedActivationAdapterV3 });  // frozen
  return createV3ProductionIntegrationCore({
    env: {}, clock: makeProductionClock(), runtime, runtimePreservationBinding: PINNED_RUNTIME_BINDING,
    executorPhysicalFactory: makeExecutorPgPhysicalFactory({ env: { X: url(EX) }, connectionStringEnvName: "X" }), establishExecutorSession,
    readerPhysicalFactory, establishReaderSession,
    executorAttestationSource: { obtain: async () => ({ testDouble: true }) }, executorTrustRoot: { testDouble: true },
    readerAttestationProvider: { obtain: async () => ({ ok: true, protocol: "reader-attestation-channel-v2", envelope: { testDouble: true }, requestNonce: randomBytes(16).toString("hex") }) },
    readerTrustRoot: { testDouble: true }, bindReaderConnection: () => ({ ok: true }) }, { testBoundary: true });
}

// A11 — the LIVE failure reproduced through the accepted core with the UNMODIFIED reader factory
const stateA = dbState(); const seenA = {};
const coreA = makeCore(RAW, seenA);
ok("A11 accepted core composes over real sessions (runtime pin intact)", coreA.available === true && coreA.successorRuntimePinRef === PINNED_SUCCESSOR_RUNTIME_PIN_REF, coreA.reason);
const runA = await coreA.run(testRequest());
ok("A12 BEFORE (core): stage pre_activation_observation, reason predecessor_not_byte_exact — exactly the live refusal", runA.ok === false && runA.stage === "pre_activation_observation" && runA.reason === "predecessor_not_byte_exact" && !runA.uncertain, runA);
ok("A13 BEFORE (core): refusal is pre-mutation — DB unchanged (0 active, 0 consumed, V3 inactive digest)", dbState() === stateA && stateA === `0/0/0/${G.v3Inactive.digest}`, dbState());

// ═══ B / C — AFTER-FIX PRE-ACTIVATION ═══
const w0 = writes();
const after = await observe(WRAPPED);
ok("J01 wrapped observation performed zero DB writes (pg_stat_user_tables ins+upd+del unchanged)", writes() === w0);
const b = checkPreActivationState(after, isoNow());
ok("B01 AFTER: same DB bytes through the wrapped factory → checkPreActivationState PASS", b.ok === true, b);
const e1 = predOf(after)[0];
ok(`B02 AFTER: typeof normalized ${e1.id}.unit_size === "number" && value 1000000`, typeof e1.unit_size === "number" && e1.unit_size === 1000000);
ok("B03 AFTER: canonical(normalized predecessor rows) === canonical(expected rows)", G.canonicalize(predOf(after)) === G.canonicalize(expectedPred));
ok("B04 AFTER: policy BIGINT fields are number 0; control_epoch number 1 (both rows)", P.every((f) => after.policyRows[0][f] === 0) && after.controlRows.every((c) => c.control_epoch === 1));
ok("C01 counts: 3 versions / 8 entries", after.versions.length === 3 && after.entries.length === 8);
const vExp = [{ id: G.V1.id, status: "inactive", effective_from: G.V1.t0, effective_until: null, catalog_digest: G.V1.inactive_catalog_digest, created_at: G.V1.t0 },
  { id: G.V2.id, status: "inactive", effective_from: G.V2.t0, effective_until: null, catalog_digest: G.V2.inactive_catalog_digest, created_at: G.V2.t0 }];
ok("C02 V1/V2 version rows exact + inactive", G.canonicalize(after.versions.filter((v) => v.id !== G.V3_ID)) === G.canonicalize(vExp));
const v3c = checkV3Catalog(after.versions.find((v) => v.id === G.V3_ID), after.entries.filter((e) => e.catalog_version_id === G.V3_ID), "inactive", isoNow());
ok("C03 V3 exact + inactive (frozen checkV3Catalog, digest " + G.v3Inactive.digest.slice(0, 8) + "…)", v3c.ok === true && v3c.digest === G.v3Inactive.digest, v3c);
ok("C04 V3 entries canonical == reviewed rows", G.canonicalize(after.entries.filter((e) => e.catalog_version_id === G.V3_ID)) === G.canonicalize(reviewedV3Rows("inactive").entries));
ok("C05 dormant policy exact", after.policyRows.length === 1 && after.policyRows[0].id === G.DORMANT.policy_id && after.policyRows[0].status === "inactive" && after.policyRows[0].policy_digest === G.DORMANT.policy_digest);
ok("C06 dormant controls exact (global + project, epoch 1, disabled, not killed, digests)", after.controlRows.length === 2 &&
  after.controlRows.some((c) => c.scope_type === "global" && c.control_epoch === 1 && c.enabled === false && c.killed === false && c.record_digest === G.DORMANT.control_global_digest) &&
  after.controlRows.some((c) => c.scope_type === "project" && c.control_epoch === 1 && c.enabled === false && c.killed === false && c.record_digest === G.DORMANT.control_project_digest));
ok("H01 versions rows were NOT touched (string/null only, identical to the raw read)", G.canonicalize(after.versions) === G.canonicalize(before.versions));
ok("H02 every non-allowlisted entry/policy/control column identical to the raw read",
  after.entries.every((e, i) => Object.keys(e).filter((k) => !E.includes(k)).every((k) => Object.is(e[k], before.entries[i][k]))) &&
  Object.keys(after.policyRows[0]).filter((k) => !P.includes(k)).every((k) => Object.is(after.policyRows[0][k], before.policyRows[0][k])) &&
  after.controlRows.every((c, i) => Object.keys(c).filter((k) => !C.includes(k)).every((k) => Object.is(c[k], before.controlRows[i][k]))));
ok("H03 nullable service_tier preserved (2 null + 1 'cache_write' on each catalog that has cache-write)", after.entries.filter((e) => e.service_tier === null).length === before.entries.filter((e) => e.service_tier === null).length);

// ═══ I — CONNECTION / SESSION CONTRACT through the wrapped factory ═══
{
  const phys = await WRAPPED.open();
  const s = await establishReaderSession(phys, { statementTimeoutMs: 2000 });
  ok("I01 frozen establishReaderSession succeeds through the wrapper (timeout 2000ms applied + read back, read-only on, role reader)", s.ok === true && s.session.effectiveStatementTimeoutMs === 2000, s.reason);
  ok("I02 session identity is the real reader backend; token = connectionTokenFor(identity)", s.ok && s.session.identity.applicationName === phys.applicationName && s.session.token === connectionTokenFor(s.session.identity) && Number.isInteger(s.session.identity.pid));
  ok("I03 the session holds the wrapper as its physical (same object the attester sampler + guarded client use)", s.ok && s.session.physical === phys);
  let roRefused = false; try { await phys.query("CREATE TEMP TABLE lai03b_int8_probe(i int)"); } catch (e) { roRefused = /read-only|permission/i.test(String(e.message)); }
  ok("I04 read-only enforcement unchanged: a write over the wrapped physical is refused by PostgreSQL", roRefused);
  const g = makeGuardedReaderClientV3(s.session, QUERIES);
  let admitted = true; try { await g.query("SELECT 1"); } catch (e) { admitted = e.code !== "READER_SQL_NOT_ADMITTED"; }
  ok("I05 guarded reader client still refuses any non-registry SQL", admitted === false);
  const lt = await phys.query("SELECT current_setting('statement_timeout') AS v", []);
  ok("I06 non-observation SQL passes through untouched (statement_timeout text)", lt.rows[0].v === "2s");
  const big = await phys.query("SELECT 1000000::bigint AS unit_size, 1::bigint AS control_epoch", []);
  ok("I07 an INT8 column in any OTHER statement is NOT normalized (string preserved)", big.rows[0].unit_size === "1000000" && big.rows[0].control_epoch === "1");
  const pid = await phys.query("SELECT pg_backend_pid() AS pid", []);
  ok("I08 same physical backend for every statement (no reconnection / no second connection)", Number(pid.rows[0].pid) === s.session.identity.pid);
  await phys.close();
  ok("I09 close delegates to the real connection (isDead true)", phys.isDead() === true);
}

// ═══ D — ACTIVATED STATE via the accepted core + restricted activation adapter (TEST approval) ═══
const seenD = {};
const coreD = makeCore(WRAPPED, seenD);
const reqD = testRequest();
const runD = await coreD.run(reqD);
ok("D01 accepted core run() with the wrapped reader: activated, committed and correlated", runD.ok === true && runD.activated === true && runD.stage === "V3_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED", runD);
ok("D02 core consumed exactly the TEST approval/execution", runD.approvalId === reqD.approvalEnvelope.payload.approval_id && runD.executionId === reqD.executionId && /^[0-9]{4}-/.test(runD.consumedAt || ""));
ok("D03 the core's own pre/post observations were the normalized numeric rows", typeof seenD.pre?.entries?.[0]?.unit_size === "number" && typeof seenD.post?.controlRows?.[0]?.control_epoch === "number");
ok("D04 DB: V3 sole ACTIVE (1 version + 3 entries), active digest, exactly 1 consumption row", dbState() === `1/3/1/${G.v3Active.digest}`, dbState());
const postW = await observe(WRAPPED);
const cA = checkActivatedState(postW, isoNow());
ok("D05 independent wrapped observation → checkActivatedState PASS", cA.ok === true, cA);
ok("D06 predecessors unchanged (canonical == expected inactive rows) after activation", G.canonicalize(predOf(postW)) === G.canonicalize(expectedPred));
ok("D07 policy + controls still dormant after activation", P.every((f) => postW.policyRows[0][f] === 0) && postW.controlRows.every((c) => c.control_epoch === 1 && c.enabled === false && c.killed === false));
ok("D08 sole active = exactly the 3 V3 entries + the V3 version", postW.versions.filter((v) => v.status === "active").map((v) => v.id).join() === G.V3_ID && postW.entries.filter((e) => e.status === "active").every((e) => e.catalog_version_id === G.V3_ID) && postW.entries.filter((e) => e.status === "active").length === 3);
const postRaw = await observe(RAW);
const cR = checkActivatedState(postRaw, isoNow());
ok("D09 BEFORE-fix reader on the ACTIVATED state → checkActivatedState also fails (would have been an UNCERTAIN post-commit result)", cR.ok === false && cR.reason === "predecessor_not_byte_exact", cR);
const led = val(`SELECT approval_id||'|'||execution_id||'|'||content_digest||'|'||active_catalog_digest||'|'||action FROM live_ai_03b_trusted.approval_consumption`);
ok("D10 ledger row exact (approval, execution, content digest, active digest, action=activate)", led === [reqD.approvalEnvelope.payload.approval_id, reqD.executionId, receipt.digest, G.v3Active.digest, "activate"].join("|"), led);
const runD2 = await coreD.run(reqD);
ok("D11 one-shot boundary refuses a second run (no retry path introduced)", runD2.ok === false && runD2.reason === "activation_boundary_is_one_shot");
done();
