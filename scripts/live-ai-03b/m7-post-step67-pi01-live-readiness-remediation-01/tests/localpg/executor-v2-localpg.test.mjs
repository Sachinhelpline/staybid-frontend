// OFFLINE real-PostgreSQL test for the Executor Attester V2 — THROWAWAY LOCAL cluster ONLY (unix socket,
// listen_addresses='', trust auth, fsync off, removed on exit). NEVER AI-STAGING, never live.
//
// Base = the accepted post-Step-1 shape (same frozen SQL list and order as the reviewed V1 issuer localpg suite),
// then the frozen R3 V3 SQL (m7-v3-01 inactive seed + m7-v3-02 trusted_v3 successor) — i.e. the accepted V3
// pre-activation grant state. It proves on REAL catalogs that:
//   • the frozen V1 issuer evaluator refuses the accepted V3 state (why a V2 measurement is required);
//   • the V2 measurement is CLEAN on it and passes the frozen R3 V2 evidence policy;
//   • the full V2 service (real pg observer) → V2 channel → frozen R3 validateV3ProductionExecutorAuthority accepts
//     the attestation for the REAL executor session token (frozen executor-session code);
//   • a real drift matrix (grant → refuse → revoke → clean).
// If PostgreSQL binaries are unavailable the suite exits 2 (SKIPPED — a skip is never a pass).
import { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync, chownSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import os from "node:os";
import net from "node:net";
import process from "node:process";
import { counter, edKey, hexSecret } from "../_h.mjs";
import { makeExecutorPgPhysicalFactory, establishExecutorSession } from "../../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { observeExecutorEvidence, executorEvidenceIsAttestable } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-evidence-evaluator.mjs";
import { makeExecutorObserverPgFactory, establishExecutorObserverSession } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-observer.mjs";
import { executorClusterFingerprint, EXECUTOR_ANCHOR_CONTRACT, EXECUTOR_ANCHOR_DOMAIN, AI_STAGING } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-target-binding.mjs";
import { ENV } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-attester-config.mjs";
import { EXECUTOR_ATTESTATION_ISSUER_V2 } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { evaluateObservedExecutorEvidenceV2 } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-evidence-policy-v2.mjs";
import { validateV3ProductionExecutorAuthority } from "../../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-production-integration.mjs";
import { PINNED_RUNTIME_BINDING, PINNED_SUCCESSOR_RUNTIME_PIN_REF } from "../../../m7-post-step67-production-integration-01-runtime-01/src/runtime-preservation-binding.mjs";
import { makeExecutorObserverPgFactoryV2, establishExecutorObserverSessionV2, OBSERVER_APPLICATION_NAME_V2 } from "../../src/executor-observer-v2.mjs";
import { measureExecutorEvidenceV2, toPolicyEvidenceV2 } from "../../src/executor-evidence-evaluator-v2.mjs";
import { startExecutorAttesterServiceV2 } from "../../src/executor-attester-v2-entrypoint.mjs";
import { createExecutorAttestationSourceChannelV2 } from "../../src/executor-attestation-channel-v2.mjs";

globalThis.fetch = async () => { throw new Error("network forbidden in offline tests"); };
const HERE = dirname(fileURLToPath(import.meta.url));
const S = resolve(HERE, "../../..");          // scripts/live-ai-03b
const REPO = resolve(S, "../..");
const R3 = join(S, "m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted");
const { ok, done } = counter("executor-v2-localpg");

function findBin() { const base = "/usr/lib/postgresql"; if (!existsSync(base)) return null;
  const v = readdirSync(base).filter((x) => existsSync(join(base, x, "bin", "initdb"))).sort((a, b) => Number(b) - Number(a)); return v.length ? join(base, v[0], "bin") : null; }
const BIN = findBin();
if (!BIN) { console.log("SKIPPED: PostgreSQL binaries unavailable (a skip is never a pass)"); process.exit(2); }
const isRoot = process.getuid && process.getuid() === 0;
const asPg = (cmd, args, opts = {}) => (isRoot ? spawnSync("runuser", ["-u", "postgres", "--", cmd, ...args], { encoding: "utf8", ...opts }) : spawnSync(cmd, args, { encoding: "utf8", ...opts }));
const BASE = mkdtempSync(join(os.tmpdir(), "lai03b-lrr01-pg-"));
if (isRoot) chownSync(BASE, Number(spawnSync("id", ["-u", "postgres"], { encoding: "utf8" }).stdout.trim()), Number(spawnSync("id", ["-g", "postgres"], { encoding: "utf8" }).stdout.trim()));
const DATA = join(BASE, "data");
const stop = () => { asPg(join(BIN, "pg_ctl"), ["-D", DATA, "-m", "immediate", "stop"]); try { rmSync(BASE, { recursive: true, force: true }); } catch {} };
process.on("exit", stop);
const PSQL = join(BIN, "psql");
const psql = (db, input, extra = []) => asPg(PSQL, ["-X", "-q", "-h", BASE, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", ...extra], { input });
const sql = (s) => { const r = psql("railway", s); if (r.status !== 0) throw new Error("sql failed: " + (r.stderr || "").split("\n")[0]); return r; };
const val = (s) => psql("railway", s, ["-tA"]).stdout.trim();

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
  join(R3, "sql/m7-v3-01-inactive-catalog-seed.sql"),
  join(R3, "sql/m7-v3-02-trusted-successor-migration.sql"),
];
for (const f of BASE_SQL) { const x = psql("railway", readFileSync(f, "utf8")); if (x.status !== 0) { console.log("SKIPPED: base SQL failed: " + f.split("/").slice(-1)[0] + " :: " + (x.stderr || "").split("\n")[0]); process.exit(2); } }
const proposal = readFileSync(join(S, "m7-v2-executor-attester-issuer-offline-01/executor-observer-role-proposal.sql"), "utf8").replace(/DO \$guard\$[\s\S]*?\$guard\$;/, "");
ok("L00 base = accepted post-Step-1 state + frozen R3 V3 seed + trusted_v3 successor; executor-observer role applies", psql("railway", proposal).status === 0);
ok("L00b server is PostgreSQL " + val("SHOW server_version"), Number(val("SHOW server_version_num")) >= 160000);
ok("L00c trusted_v3 schema + exactly 2 V3 routines exist", val("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='live_ai_03b_trusted_v3'") === "2");

const url = (role) => `postgresql://${role}@/railway?host=${encodeURIComponent(BASE)}`;
const EX = "live_ai_03b_executor", OBS = "live_ai_03b_executor_attester_observer";
const exPhys = await makeExecutorPgPhysicalFactory({ env: { X: url(EX) }, connectionStringEnvName: "X" }).open();
const exS = await establishExecutorSession(exPhys, { statementTimeoutMs: 5000 });
ok("L01 frozen establishExecutorSession on a REAL executor connection → token", exS.ok === true && /^[0-9a-f]{64}$/.test(exS.session.token), exS.reason);
const TOKEN = exS.session.token;

async function v2Measure(token = TOKEN) {
  const phys = await makeExecutorObserverPgFactoryV2({ env: { O: url(OBS) }, connectionStringEnvName: "O" }).open();
  const es = await establishExecutorObserverSessionV2(phys);
  if (!es.ok) return es;
  try { return await measureExecutorEvidenceV2(es.observer, token); } finally { await es.observer.close(); }
}
const anchorFromCluster = (c) => ({ clusterFingerprint: executorClusterFingerprint(c), contract: EXECUTOR_ANCHOR_CONTRACT, domain: EXECUTOR_ANCHOR_DOMAIN,
  environmentId: AI_STAGING.environmentId, issuedAtMs: Date.now(), pgServiceId: AI_STAGING.pgServiceId, projectId: AI_STAGING.projectId, verifiedBy: "owner-verified-localpg-synthetic" });
async function v2Clean(token = TOKEN) {
  const m = await v2Measure(token); if (!m.ok) return { refused: m.reason };
  const pe = toPolicyEvidenceV2(m.measured, anchorFromCluster(m.measured.cluster)); if (!pe.ok) return { refused: pe.reason };
  const ev = evaluateObservedExecutorEvidenceV2(pe.evidence);
  return ev.ok ? { clean: true, m } : { refused: ev.reason, m };
}

// ── V1 necessity on REAL catalogs ──
{ const phys = await makeExecutorObserverPgFactory({ env: { O: url(OBS) }, connectionStringEnvName: "O" }).open();
  const es = await establishExecutorObserverSession(phys);
  const e = await observeExecutorEvidence(es.observer, TOKEN); await es.observer.close();
  const a = e.ok ? executorEvidenceIsAttestable(e.evidence) : e;
  ok("L02 frozen V1 evaluator REFUSES the accepted V3 state on real PostgreSQL (V2 measurement required)", a.ok === false, a); }

// ── V2 positive on REAL catalogs ──
const c0 = await v2Clean();
ok("L03 V2 measurement of the accepted V3 state is CLEAN under the frozen R3 V2 policy", c0.clean === true, { refused: c0.refused, ctx: c0.m && c0.m.measured && c0.m.measured.context });
if (c0.m) {
  const p = c0.m.measured.privileges;
  ok("L04 measured routines == exactly the 6 R3 V2 routines", JSON.stringify(p.executableRoutines) === JSON.stringify([
    "live_ai_03b_trusted.activate_catalog(jsonb,text)", "live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)",
    "live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)", "live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)",
    "live_ai_03b_trusted_v3.activate_catalog_v3(jsonb,text)", "live_ai_03b_trusted_v3.restore_catalog_v3_inactive(jsonb,text)"]), p.executableRoutines);
  ok("L05 trusted schema USAGE == exactly 3 trusted schemas; 0 budget/ledger privileges; no widening",
    JSON.stringify(p.trustedSchemaUsage) === '["live_ai_03b_trusted","live_ai_03b_trusted_v2","live_ai_03b_trusted_v3"]' && p.budgetTablePrivilegeCount === 0 && p.ledgerPrivilegeCount === 0 && p.publicOrDefaultPrivilegeWidening === false);
  ok("L06 re-derived token == the frozen executor session's token", c0.m.measured.connection.token === TOKEN);
}

// ── full V2 service over loopback with the REAL pg observer ──
const EXK = edKey(), RDK = edKey(), CH = hexSecret(), RCH = hexSecret();
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const svcEnv = { [ENV.issuer]: EXECUTOR_ATTESTATION_ISSUER_V2, [ENV.publicKeyDerB64]: EXK.der, [ENV.fingerprint]: EXK.fp, [ENV.port]: String(port), [ENV.channelSecret]: CH,
  [ENV.signingKeyPkcs8B64]: EXK.pk8, [ENV.observerDbUrl]: url(OBS), [ENV.bindHost]: "10.20.3.4", [ENV.allowedPeerCidrs]: "10.20.3.0/24",
  [ENV.deploymentAnchor]: JSON.stringify(anchorFromCluster(c0.m.measured.cluster)), [ENV.readerAttesterIssuer]: "owner-dedicated-reader-attester-synthetic", [ENV.readerAttesterFingerprint]: RDK.fp };
const svc = await startExecutorAttesterServiceV2({ mode: "offline-test", offlineTestBoundary: true, env: svcEnv, testListen: { bindHost: "127.0.0.1", port, allowedPeerCidrs: ["127.0.0.1/32"] }, log: () => {} });
ok("L07 V2 service starts with the REAL pg observer (production factory) on the throwaway cluster", svc.started === true, svc.reason);
ok("L07b V2 observer session visible with application_name " + OBSERVER_APPLICATION_NAME_V2, val(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${OBSERVER_APPLICATION_NAME_V2}' AND usename='${OBS}'`) === "1");
const src = createExecutorAttestationSourceChannelV2({ host: "127.0.0.1", port, channelSecret: CH, readerChannelSecret: RCH }, { offlineTestBoundary: true }).source;
const nonce = randomBytes(16).toString("hex");
const envl = await src.obtain({ contract: "AiStagingExecutorAttestationV2", connectionToken: TOKEN, requestNonce: nonce, role: "live_ai_03b_executor" }).catch((e) => ({ err: e.code, a: e.attesterCode }));
const vr = validateV3ProductionExecutorAuthority({ executorAttestation: envl, executorTrustRoot: { issuer: EXECUTOR_ATTESTATION_ISSUER_V2, publicKeyDerB64: EXK.der, fingerprint: EXK.fp },
  expectedConnectionToken: TOKEN, expectedRequestNonce: nonce, now: Date.now(), runtimePreservationBinding: PINNED_RUNTIME_BINDING });
ok("L08 REAL end-to-end: V2 attestation for the real executor session accepted by frozen R3 validateV3ProductionExecutorAuthority", vr.ok === true && vr.successorRuntimePinRef === PINNED_SUCCESSOR_RUNTIME_PIN_REF, { envl: envl.err ? envl : "envelope", reason: vr.reason });

// ── real drift matrix (grant → refuse → revoke → clean) ──
const drift = async (label, grant, revoke, expectReason) => {
  sql(grant); const d = await v2Clean(); sql(revoke); const back = await v2Clean();
  ok(label, d.clean !== true && (!expectReason || d.refused === expectReason) && back.clean === true, { refused: d.refused, back: back.refused });
};
sql("CREATE FUNCTION public.lrr01_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'; REVOKE ALL ON FUNCTION public.lrr01_extra() FROM PUBLIC;");
await drift("L09 GRANT EXECUTE on an unreviewed routine ⇒ refused; REVOKE ⇒ clean", "GRANT EXECUTE ON FUNCTION public.lrr01_extra() TO live_ai_03b_executor;", "REVOKE EXECUTE ON FUNCTION public.lrr01_extra() FROM live_ai_03b_executor;");
await drift("L10 GRANT CREATE ON SCHEMA trusted_v3 ⇒ refused (executor_drift_schema_create); REVOKE ⇒ clean", "GRANT CREATE ON SCHEMA live_ai_03b_trusted_v3 TO live_ai_03b_executor;", "REVOKE CREATE ON SCHEMA live_ai_03b_trusted_v3 FROM live_ai_03b_executor;", "executor_drift_schema_create");
await drift("L11 REVOKE EXECUTE on activate_catalog_v3 ⇒ refused (executor_drift_routine_execute); re-GRANT ⇒ clean", "REVOKE EXECUTE ON FUNCTION live_ai_03b_trusted_v3.activate_catalog_v3(jsonb,text) FROM live_ai_03b_executor;", "GRANT EXECUTE ON FUNCTION live_ai_03b_trusted_v3.activate_catalog_v3(jsonb,text) TO live_ai_03b_executor;", "executor_drift_routine_execute");
await drift("L12 REVOKE USAGE on trusted_v3 ⇒ refused (executor_drift_schema_usage); re-GRANT ⇒ clean", "REVOKE USAGE ON SCHEMA live_ai_03b_trusted_v3 FROM live_ai_03b_executor;", "GRANT USAGE ON SCHEMA live_ai_03b_trusted_v3 TO live_ai_03b_executor;", "executor_drift_schema_usage");
await drift("L13 GRANT SELECT on a budget table ⇒ refused; REVOKE ⇒ clean", "GRANT SELECT ON public.budget_price_catalog_versions TO live_ai_03b_executor;", "REVOKE SELECT ON public.budget_price_catalog_versions FROM live_ai_03b_executor;");
await drift("L14 GRANT pg_read_all_data membership ⇒ refused; REVOKE ⇒ clean", "GRANT pg_read_all_data TO live_ai_03b_executor;", "REVOKE pg_read_all_data FROM live_ai_03b_executor;");
const r2 = await v2Clean("0".repeat(64));
ok("L15 token of no real session ⇒ refused no_such_session", r2.refused === "no_such_session", r2.refused);
await svc.stop(); await exS.session.physical.close();
ok("L16 after stop: no V2 observer session remains on the cluster", val(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${OBSERVER_APPLICATION_NAME_V2}'`) === "0");
done();
process.exit(process.exitCode || 0);
