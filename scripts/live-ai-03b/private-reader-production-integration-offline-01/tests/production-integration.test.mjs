// OFFLINE production-integration tests. Synthetic only: a synthetic PostgreSQL session fixture, an
// offline REFERENCE attester (TEST-ONLY issuer, fixture Ed25519 key), synthetic transport secret, and REAL
// local loopback sockets. Connects to NOTHING external (no Railway / Postgres / Supabase / CORE-PROD /
// provider / internet). Node built-ins only. Synthetic fixtures are NOT evidence about live AI-STAGING.
import { readFileSync, readdirSync } from "node:fs";
import { createHash, generateKeyPairSync, createPrivateKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import net from "node:net";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { startProductionReaderService, EXIT, PRODUCTION_OPTION_KEYS, composeProductionAttestationSource } from "../production-entrypoint.mjs";
import { createAttestationSourceChannel, ATTESTATION_CHANNEL_VERSION, CHANNEL_FAILURE_CODES } from "../attestation-source-channel.mjs";
import { register } from "node:module";
import dns from "node:dns";
import { spawn } from "node:child_process";
import { startSimulatedAttester } from "./fixtures/simulated-attester-server.mjs";
import { createReaderAuthorityManager, READER_OBSERVATION_SQL } from "../production-reader-authority.mjs";
import { verifyReaderAttestation, makeAttesterTrustRoot, ATTESTATION_CONTRACT, ATTESTATION_DOMAIN } from "../reader-attestation.mjs";
import { establishReaderSession, parsePgDurationMs, LIFECYCLE_SQL } from "../reader-session.mjs";
import { createGatewayObservationCaller, validateDestination, macFor } from "../gateway-observation-caller.mjs";
import { loadIntegrationConfig, ENV } from "../integration-config.mjs";
import { makeReferenceAttester } from "./fixtures/reference-attester.mjs";
import { makeSyntheticPg } from "./fixtures/synthetic-pg.mjs";
import { validateReaderOnlyAuthority } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { publicKeyFingerprintFromDerB64, FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const L03B = resolve(ROOT, "..");
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const NOW = 1750000000000;
const clock = { t: NOW }; const nowP = () => clock.t;
const SECRET = "synthetic-gateway-transport-secret-0123456789"; // synthetic; NOT a real secret
const CHANNEL_SECRET = "synthetic-attester-channel-secret-0123456789abcdef"; // synthetic; NOT a real secret
const SENTINEL_URL = "postgres://sentinel_user:sentinel_pw@127.0.0.1:9/railway";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaked = (x) => { const s = JSON.stringify(x === undefined ? null : x); return s.includes("sentinel") || s.includes(SECRET) || s.includes(CHANNEL_SECRET) || s.includes("postgres://") || /ECONN|EHOST|ENOTFOUND|\bat [A-Za-z_.]+ \(/.test(s); };
const openCtrls = [];

function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); }); }
function world(opts = {}) { const db = makeSyntheticPg(opts); const att = makeReferenceAttester({ db, nowProvider: nowP }); return { db, att }; }
async function startSvc(w, port, extra = {}) {
  const logs = [];
  const ctrl = await startProductionReaderService({
    mode: "offline-test", offlineTestBoundary: true, trustRootConfig: w.att.trustRootConfig, physicalFactory: w.db.factory,
    attestationSource: w.att.source, nowProvider: nowP, listen: { mode: "loopback-tcp", host: "127.0.0.1", port },
    transportSecretProvider: async () => SECRET, tickMs: 0, recoveryBackoffMs: 0, maxRecoveryAttempts: 3, log: (l) => logs.push(l), ...extra,
  });
  if (ctrl.started) openCtrls.push(ctrl);
  return { ctrl, logs };
}
const gwFor = (port, over = {}) => createGatewayObservationCaller({ destination: { host: "127.0.0.1", port }, secret: SECRET, nowProvider: nowP, offlineTestBoundary: true, expectedMode: "test", ...over });
function mgrFor(w, over = {}) {
  const tr = makeAttesterTrustRoot(w.att.trustRootConfig, { allowTestIssuer: true });
  return createReaderAuthorityManager({ mode: "offline-test", physicalFactory: w.db.factory, attestationSource: w.att.source, trustRoot: tr.trustRoot, statementTimeoutMs: 2000, nowProvider: nowP, ...over });
}
// build a signed envelope with the fixture key for a live session (for the verification matrix)
function signedFor(w, token, nonce, mutate) {
  const t = clock.t;
  let payload = { contract: ATTESTATION_CONTRACT, domain: ATTESTATION_DOMAIN, issuer: w.att.trustRootConfig.issuer, keyId: w.att.trustRootConfig.fingerprint,
    issuedAtMs: t, expiresAtMs: t + 300000, requestNonce: nonce,
    target: { projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment, pgServiceId: FIXED.ai_staging_postgres },
    connection: { token, role: "live_ai_03b_reader" },
    privileges: { currentUser: "live_ai_03b_reader", effectiveSelectOnly: true, writePrivilegeCount: 0, selectGrantCount: 12, forbiddenObjectAccessible: false, unapprovedRoleMembership: false, unapprovedRoutineAuthority: false, ownerOrExecutorAuthority: false } };
  if (mutate) payload = mutate(JSON.parse(JSON.stringify(payload)));
  return { payload, signatureB64: w.att.signPayload(payload) };
}
// minimal scripted TCP responder for gateway-caller response-validation tests (local only)
function scriptedServer(respond) {
  return new Promise((res) => {
    const lines = [];
    const srv = net.createServer((s) => { let b = ""; s.setEncoding("utf8"); s.on("error", () => {}); s.on("data", (d) => { b += d; const i = b.indexOf("\n"); if (i >= 0) { lines.push(b.slice(0, i)); respond(s, b.slice(0, i)); } }); });
    srv.listen(0, "127.0.0.1", () => res({ port: srv.address().port, lines, close: () => new Promise((r) => srv.close(() => r())) }));
  });
}

async function run() {
  // ───────────────────────────────────────────────────────────────
  console.log("A. Production entrypoint (fail closed; no synthetic authority in the production path)");
  const fx = world();
  const channelEnv = { [ENV.attesterHost]: "reader-attester.railway.internal", [ENV.attesterPort]: "7444", [ENV.attesterChannelSecret]: CHANNEL_SECRET };
  const baseEnv = { [ENV.readerDbUrl]: SENTINEL_URL, [ENV.attesterIssuer]: "owner-reader-attester", [ENV.attesterPublicKeyDerB64]: fx.att.trustRootConfig.publicKeyDerB64, [ENV.attesterFingerprint]: fx.att.trustRootConfig.fingerprint, ...channelEnv };
  const la = []; const a1 = await startProductionReaderService({ env: {}, log: (l) => la.push(l) });
  ok("empty env -> unprovisioned (integration_config_incomplete), no listener", a1.started === false && a1.status === "unprovisioned" && a1.reason === "integration_config_incomplete");
  const a2 = await startProductionReaderService({ env: { ...baseEnv, LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "x" }, log: () => {} });
  ok("executor credential present in reader env -> refused", a2.started === false && a2.reason === "executor_credential_present");
  const a3 = await startProductionReaderService({ env: { ...baseEnv, [ENV.attesterIssuer]: fx.att.trustRootConfig.issuer }, log: () => {} });
  ok("TEST-ONLY attester trust root refused in production", a3.started === false && a3.reason === "trust_root_test_issuer_refused");
  const la4 = []; const noChannel = { ...baseEnv }; delete noChannel[ENV.attesterHost]; delete noChannel[ENV.attesterPort]; delete noChannel[ENV.attesterChannelSecret];
  const a4 = await startProductionReaderService({ env: noChannel, log: (l) => la4.push(l) });
  ok("attestation-source channel config absent -> fail closed at config (before any DB connection)", a4.started === false && a4.reason === "integration_config_incomplete");
  ok("production logs never contain the DB URL / credential", ![...la, ...la4].some(leaked));
  const a5 = await startProductionReaderService({ env: baseEnv, physicalFactory: fx.db.factory, attestationSource: fx.att.source, log: () => {} });
  ok("production mode REFUSES injected session factory / attestation source", a5.started === false && a5.reason === "test_injection_refused_in_production");
  const a6 = await startProductionReaderService({ mode: "offline-test", physicalFactory: fx.db.factory, log: () => {} });
  ok("offline-test mode without explicit test boundary -> refused", a6.started === false && a6.reason === "offline_test_boundary_required");
  const a7 = await startProductionReaderService({ mode: "staging-magic", log: () => {} });
  ok("unknown mode -> refused", a7.started === false && a7.reason === "mode_invalid");
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
  ok("trust root fingerprint mismatch -> refused", loadIntegrationConfig({ ...baseEnv, [ENV.attesterPublicKeyDerB64]: other }).reason === "trust_root_fingerprint_mismatch");
  const ecDer = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
  ok("non-Ed25519 trust root -> refused", loadIntegrationConfig({ ...baseEnv, [ENV.attesterPublicKeyDerB64]: ecDer, [ENV.attesterFingerprint]: publicKeyFingerprintFromDerB64(ecDer) }).reason === "trust_root_key_not_ed25519");
  ok("statement timeout config > 2000 -> refused", loadIntegrationConfig({ ...baseEnv, [ENV.statementTimeoutMs]: "5000" }).reason === "statement_timeout_config_invalid");
  const cfgOk = loadIntegrationConfig(baseEnv);
  ok("valid production config returns NAMES only (no secret value)", cfgOk.ok === true && cfgOk.statementTimeoutMs === 2000 && !leaked(cfgOk));
  const child = spawnSync(process.execPath, [join(ROOT, "production-entrypoint.mjs")], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 20000 });
  ok("process entrypoint with clean env: exit 70, status unprovisioned, no listener", child.status === EXIT.unprovisioned && /"status":"unprovisioned"/.test(child.stdout) && !/serving/.test(child.stdout));

  // ───────────────────────────────────────────────────────────────
  console.log("B. Reader authority: independent attestation verification matrix");
  const wb = world();
  const trB = makeAttesterTrustRoot(wb.att.trustRootConfig, { allowTestIssuer: true }).trustRoot;
  const TOK = "a".repeat(64), NON = "nonce-0123456789";
  const V = (env, over = {}) => verifyReaderAttestation(env, { trustRoot: trB, expectedConnectionToken: TOK, expectedRequestNonce: NON, now: clock.t, ...over });
  ok("genuine signed attestation (synthetic evidence) passes", V(signedFor(wb, TOK, NON)).ok === true);
  ok("missing attestation -> absent", V(null).reason === "attestation_absent");
  ok("plain object with 'trusted provenance' (no signature) -> rejected", V({ provenance: "trusted-approved-reader-privilege-proof", role: "live_ai_03b_reader" }).reason === "attestation_malformed");
  const tampered = signedFor(wb, TOK, NON); tampered.payload.privileges.writePrivilegeCount = 0; tampered.payload.issuedAtMs = clock.t - 1;
  ok("payload tampered after signing -> signature invalid", V(tampered).reason === "attestation_signature_invalid");
  const attacker = makeReferenceAttester({ db: wb.db, nowProvider: nowP });
  const forgedEnv = signedFor(wb, TOK, NON); forgedEnv.signatureB64 = attacker.signPayload(forgedEnv.payload);
  ok("forged signature (attacker key, trusted keyId) -> signature invalid", V(forgedEnv).reason === "attestation_signature_invalid");
  const withKey = signedFor({ att: attacker }, TOK, NON); withKey.publicKeyDerB64 = attacker.trustRootConfig.publicKeyDerB64;
  ok("envelope carrying its OWN key is ignored (untrusted keyId)", V(withKey).reason === "attestation_key_untrusted");
  ok("untrusted issuer -> rejected", V(signedFor(wb, TOK, NON, (p) => ({ ...p, issuer: "someone-else" }))).reason === "attestation_issuer_untrusted");
  ok("wrong connection binding -> rejected", V(signedFor(wb, "b".repeat(64), NON)).reason === "attestation_connection_mismatch");
  ok("wrong request nonce (replayed answer) -> rejected", V(signedFor(wb, TOK, "other-nonce-xyz")).reason === "attestation_request_nonce_mismatch");
  ok("wrong role on connection -> rejected", V(signedFor(wb, TOK, NON, (p) => { p.connection.role = "postgres"; return p; })).reason === "attestation_role_mismatch");
  ok("wrong current_user -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.currentUser = "postgres"; return p; })).reason === "drift_current_user");
  ok("CORE-PROD target -> refused", V(signedFor(wb, TOK, NON, (p) => { p.target.pgServiceId = FIXED.core_excluded_postgres; return p; })).reason === "drift_target_is_core_prod");
  ok("other non-AI-STAGING target -> refused", V(signedFor(wb, TOK, NON, (p) => { p.target.environmentId = "00000000-0000-0000-0000-000000000000"; return p; })).reason === "drift_target_not_ai_staging");
  ok("unexpected write privilege -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.writePrivilegeCount = 1; return p; })).reason === "drift_write_privilege");
  ok("not select-only -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.effectiveSelectOnly = false; return p; })).reason === "drift_not_select_only");
  ok("wrong SELECT grant count -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.selectGrantCount = 13; return p; })).reason === "drift_select_grant_count");
  ok("forbidden object accessible -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.forbiddenObjectAccessible = true; return p; })).reason === "drift_forbidden_object_accessible");
  ok("unapproved role membership -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.unapprovedRoleMembership = true; return p; })).reason === "drift_role_membership");
  ok("unapproved routine authority -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.unapprovedRoutineAuthority = true; return p; })).reason === "drift_routine_authority");
  ok("owner/executor authority -> drift", V(signedFor(wb, TOK, NON, (p) => { p.privileges.ownerOrExecutorAuthority = true; return p; })).reason === "drift_owner_or_executor_authority");
  ok("stale proof (>5 min) -> rejected", V(signedFor(wb, TOK, NON, (p) => ({ ...p, issuedAtMs: clock.t - 301000, expiresAtMs: clock.t - 1000 }))).reason === "attestation_stale");
  ok("future-dated proof -> rejected", V(signedFor(wb, TOK, NON, (p) => ({ ...p, issuedAtMs: clock.t + 60000, expiresAtMs: clock.t + 120000 }))).reason === "attestation_future_dated");
  ok("expired proof -> rejected", V(signedFor(wb, TOK, NON, (p) => ({ ...p, issuedAtMs: clock.t - 10000, expiresAtMs: clock.t - 1 }))).reason === "attestation_expired");
  ok("lifetime > 5 min -> rejected", V(signedFor(wb, TOK, NON, (p) => ({ ...p, expiresAtMs: p.issuedAtMs + 600000 }))).reason === "attestation_lifetime_too_long");
  ok("extra/unknown payload field -> malformed", V(signedFor(wb, TOK, NON, (p) => ({ ...p, trusted: true }))).reason === "attestation_malformed");
  ok("TEST-ONLY trust root refused without test allowance", makeAttesterTrustRoot(wb.att.trustRootConfig).reason === "trust_root_test_issuer_refused");
  let prodRefused = false; try { mgrFor(wb, { mode: "production" }); } catch (e) { prodRefused = e.message === "production_refuses_test_trust_root"; }
  ok("production-mode manager refuses a TEST trust root", prodRefused === true);
  // production-mode construction mapping, exercised with an OFFLINE key under a non-test issuer (the
  // production entrypoint cannot receive this: its attestation source is UNPROVISIONED)
  const offlineIssuer = makeReferenceAttester({ db: wb.db, nowProvider: nowP, issuer: "offline-construction-check" });
  const mProd = createReaderAuthorityManager({ mode: "production", physicalFactory: wb.db.factory, attestationSource: offlineIssuer.source, trustRoot: makeAttesterTrustRoot(offlineIssuer.trustRootConfig).trustRoot, statementTimeoutMs: 2000, nowProvider: nowP });
  const eProd = await mProd.establish();
  const aProd = mProd.acceptedAuthority();
  ok("production-mode mapping: verified attestation -> accepted reader-only authority passes accepted validator (production mode)", eProd.ok === true && validateReaderOnlyAuthority(aProd, { testBoundary: false }).ok === true);
  ok("accepted authority carries NO executor client / proof", aProd.executorDbClient === undefined && aProd.privilegeProof === undefined && aProd.readerDbClient.__testFixture === undefined);
  await mProd.close();

  // ───────────────────────────────────────────────────────────────
  console.log("C. Proof lifecycle: expiry, renewal, reconnection, drift");
  clock.t = NOW;
  const wc = world(); const m = mgrFor(wc);
  const e1 = await m.establish(); const tok1 = m.current().token;
  ok("startup requires a fresh bound proof -> valid", e1.ok === true && m.current().ok === true);
  const q0 = wc.db.obsQueries;
  await m.readerClient.query(READER_OBSERVATION_SQL[0], []);
  ok("valid authority admits a registry query", wc.db.obsQueries === q0 + 1);
  let refusedSql = false; try { await m.readerClient.query("SELECT * FROM budget_envelope_allocations", []); } catch { refusedSql = true; }
  ok("non-registry SQL refused by the reader client (no arbitrary SQL)", refusedSql === true && wc.db.obsQueries === q0 + 1);
  clock.t += 150000; wc.att.ctl.fail = true;
  const rn1 = await m.renew();
  ok("failed renewal -> previous proof kept ONLY until its own expiry", rn1.ok === false && m.current().ok === true);
  clock.t = NOW + 300001;
  ok("proof expiry -> authority invalid (no fallback to the expired proof)", m.current().ok === false && m.current().reason === "attestation_expired");
  const q1 = wc.db.obsQueries; let refusedExp = false; try { await m.readerClient.query(READER_OBSERVATION_SQL[0], []); } catch { refusedExp = true; }
  ok("no query begins under expired authority", refusedExp === true && wc.db.obsQueries === q1);
  ok("renewal after expiry does not resurrect authority", (await m.renew()).ok === false && m.current().ok === false);
  wc.att.ctl.fail = false; clock.t = NOW + 400000;
  const e2 = await m.establish(); const tok2 = m.current().token;
  ok("re-establish with a NEW connection -> new token, valid again", e2.ok === true && tok2 !== tok1 && m.current().ok === true);
  const oldEnv = wc.att.ctl.last;
  wc.db.killAll();
  ok("connection loss -> authority invalid immediately", m.current().ok === false && m.current().reason === "connection_lost");
  wc.att.ctl.replay = oldEnv;
  const e3 = await m.establish();
  ok("proof bound to the previous connection cannot validate the new one", e3.ok === false && e3.reason === "attestation_connection_mismatch");
  wc.att.ctl.replay = null;
  ok("new connection with renewed checks -> valid", (await m.establish()).ok === true);
  wc.db.privileges.writePrivilegeCount = 1; clock.t += 130000;
  const rd = await m.renew();
  ok("privilege drift at renewal -> immediate revocation", rd.ok === false && rd.reason === "drift_write_privilege" && m.current().ok === false);
  wc.db.privileges.writePrivilegeCount = 0; await m.establish();
  wc.db.currentUser = "postgres";
  const rs = await m.renew();
  ok("session role drift (same-connection self-check) -> revocation", rs.ok === false && rs.reason === "drift_session_role" && m.current().ok === false);
  wc.db.currentUser = "live_ai_03b_reader"; await m.establish();
  wc.db.target.pgServiceId = FIXED.core_excluded_postgres;
  const rt = await m.renew();
  ok("target drift to CORE-PROD -> revocation", rt.ok === false && rt.reason === "drift_target_is_core_prod" && m.current().ok === false);
  wc.db.target.pgServiceId = FIXED.ai_staging_postgres;
  await m.close();

  // ───────────────────────────────────────────────────────────────
  console.log("D. PostgreSQL statement_timeout enforcement (synthetic session protocol)");
  clock.t = NOW;
  const est = async (beh, st = 2000) => { const w = world({ timeoutBehaviour: beh }); const p = await w.db.factory.open(); return establishReaderSession(p, { statementTimeoutMs: st }); };
  const dOk = await est("honor");
  ok("timeout SET + read back on the same connection -> 2000 ms verified", dOk.ok === true && dOk.session.effectiveStatementTimeoutMs === 2000);
  ok("lower configured timeout (400 ms) verified", (await est("honor", 400)).session.effectiveStatementTimeoutMs === 400);
  ok("SET silently ineffective (effective 0) -> refused", (await est("ignore")).reason === "statement_timeout_disabled");
  ok("server-applied value above 2000 -> refused", (await est("cap5s")).reason === "statement_timeout_above_limit");
  ok("declared vs effective mismatch -> refused", (await est("fixed1000")).reason === "statement_timeout_not_applied");
  ok("unsupported mechanism (SET errors) -> refused", (await est("unsupported")).reason === "session_setup_failed");
  ok("unverifiable readback -> refused", (await est("garbled")).reason === "statement_timeout_unverifiable");
  ok("configured timeout > 2000 -> refused before any SQL", (await est("honor", 2500)).reason === "statement_timeout_config_invalid");
  ok("duration parser (PostgreSQL units)", parsePgDurationMs("2s") === 2000 && parsePgDurationMs("1500ms") === 1500 && parsePgDurationMs("1min") === 60000 && parsePgDurationMs("0") === 0 && Number.isNaN(parsePgDurationMs("2 seconds")));
  const wd = world(); const md = mgrFor(wd, { statementTimeoutMs: 1500 });
  await md.establish();
  ok("reader client declares the VERIFIED effective value", md.readerClient.statementTimeoutMs === 1500);
  const lcBefore = wd.db.lifecycleQueries; wd.db.killAll(); wd.db.timeoutBehaviour = "ignore";
  const dRe = await md.establish();
  ok("timeout re-enforced + re-verified on reconnection (ineffective -> blocked)", dRe.ok === false && dRe.reason === "statement_timeout_disabled" && wd.db.lifecycleQueries > lcBefore && md.current().ok === false);
  await md.close();
  ok("lifecycle SQL is a fixed parameterized set (no string building)", LIFECYCLE_SQL.setStatementTimeout.includes("$1") && Object.isFrozen(LIFECYCLE_SQL));

  // containment through the ACCEPTED runtime: DB-side timeout ends a stalled statement
  const wdc = world(); const portD = await freePort();
  const sd = await startSvc(wdc, portD, { statementTimeoutMs: 300 });
  const gD = gwFor(portD);
  wdc.db.stall = "statement_timeout";
  let t0 = Date.now(); const rStall = await gD.observe("dormant"); const elD = Date.now() - t0;
  ok("stalled statement ended by the (synthetic) DB timeout -> fixed failure, no hang", rStall.ok === false && rStall.code === "observation_failed" && rStall.hostCode === "observation_error" && elD < 2000);
  await sleep(20);
  ok("accepted containment: slot released after the statement ended", sd.ctrl.health().active === 0 && sd.ctrl.health().degraded === false);
  wdc.db.stall = null;
  ok("recovers for the next observation", (await gD.observe("dormant")).ok === true);
  await sd.ctrl.stop();
  const wdh = world(); const portH = await freePort();
  const sh = await startSvc(wdh, portH, { limits: { observationDeadlineMs: 200 } });
  wdh.db.stall = "hang";
  const rHang = await gwFor(portH).observe("armed");
  ok("hung statement -> accepted deadline answers 'timeout' (AbortSignal alone does not cancel it)", rHang.ok === false && rHang.code === "reader_rejected" && rHang.readerCode === "timeout" && sh.ctrl.health().active === 1);
  await sh.ctrl.stop();

  // ───────────────────────────────────────────────────────────────
  console.log("E. Gateway caller");
  ok("destination: Railway private DNS accepted", validateDestination({ host: "live-ai-03b-private-reader.railway.internal", port: 7443 }).ok === true);
  ok("destination: private IPv4 / ULA IPv6 accepted", validateDestination({ host: "10.1.2.3", port: 7443 }).ok === true && validateDestination({ host: "fd12:3456::9", port: 7443 }).ok === true);
  ok("destination: URL refused", validateDestination({ host: "http://reader.railway.internal", port: 80 }).reason === "destination_host");
  ok("destination: public IP refused", validateDestination({ host: "8.8.8.8", port: 443 }).reason === "destination_not_private");
  ok("destination: external hostname refused", validateDestination({ host: "reader.example.com", port: 443 }).reason === "destination_not_private_dns");
  ok("destination: loopback refused outside the test boundary", validateDestination({ host: "127.0.0.1", port: 7443 }).reason === "destination_loopback");
  ok("destination: extra field / bad port refused", validateDestination({ host: "10.1.2.3", port: 7443, path: "/x" }).reason === "destination_shape" && validateDestination({ host: "10.1.2.3", port: 0 }).reason === "destination_port");
  ok("caller refuses missing/short secret", createGatewayObservationCaller({ destination: { host: "10.1.2.3", port: 7443 }, secret: "short" }).available === false);
  ok("caller refuses test mode without test boundary", createGatewayObservationCaller({ destination: { host: "10.1.2.3", port: 7443 }, secret: SECRET, expectedMode: "test" }).available === false);
  const gwProd = createGatewayObservationCaller({ destination: { host: "10.1.2.3", port: 7443 }, secret: SECRET });
  ok("caller exposes ONLY observe (no arbitrary op / raw request)", gwProd.available === true && Object.keys(gwProd).sort().join(",") === "available,destination,observe,version" && !leaked(gwProd));
  ok("unapproved observation -> refused without connecting", (await gwProd.observe("drop_tables")).code === "observation_not_approved");

  const we = world(); const portE = await freePort();
  const se = await startSvc(we, portE);
  const gE = gwFor(portE);
  const okE = await gE.observe("ceilings");
  ok("valid authenticated observation through the accepted transport", okE.ok === true && okE.message.phase === "ceilings" && okE.message.mode === "test");
  ok("wrong HMAC secret -> reader_rejected/unauthenticated", (await gwFor(portE, { secret: "a-different-synthetic-secret-000" }).observe("dormant")).readerCode === "unauthenticated");
  ok("stale request clock -> reader_rejected/stale", (await gwFor(portE, { nowProvider: () => clock.t - 60000 }).observe("dormant")).readerCode === "stale");
  ok("production-mode caller rejects a test-mode message", (await createGatewayObservationCaller({ destination: { host: "127.0.0.1", port: portE }, secret: SECRET, nowProvider: nowP, offlineTestBoundary: true }).observe("dormant")).code === "bad_response");
  // capture a caller-built line, then replay it against the REAL accepted server
  const cap = await scriptedServer((s) => s.end(JSON.stringify({ ok: false, code: "busy" }) + "\n"));
  const gCap = gwFor(cap.port);
  const busyR = await gCap.observe("dormant"); await gCap.observe("dormant");
  const l1 = JSON.parse(cap.lines[0]), l2 = JSON.parse(cap.lines[1]);
  ok("caller envelope follows the accepted contract (fresh nonce each call, HMAC over v/op/args/nonce/ts)", busyR.readerCode === "busy" && l1.nonce !== l2.nonce && l1.nonce.length === 32 && l1.mac === macFor(SECRET, l1.v, l1.op, l1.args, l1.nonce, l1.ts) && Object.keys(l1).sort().join(",") === "args,mac,nonce,op,ts,v");
  await cap.close();
  const rawSend = (line) => new Promise((res) => { const s = net.createConnection({ host: "127.0.0.1", port: portE }, () => s.write(line + "\n")); let b = ""; s.setEncoding("utf8"); s.on("data", (d) => { b += d; }); s.on("end", () => res(JSON.parse(b))); s.on("error", () => res(null)); });
  const r1 = await rawSend(cap.lines[0]); const r2 = await rawSend(cap.lines[0]);
  ok("replayed caller envelope: first accepted, second 'replayed' (accepted transport contract)", r1 && r1.ok === true && r2 && r2.ok === false && r2.code === "replayed");
  const bad = async (payload, over = {}) => { const s = await scriptedServer((sock) => { if (payload !== null) sock.end(payload); }); const r = await gwFor(s.port, over).observe("dormant"); await s.close(); return r; };
  ok("garbage response -> bad_response", (await bad("not json\n")).code === "bad_response");
  ok("unknown wire failure code -> bad_response", (await bad(JSON.stringify({ ok: false, code: "please_retry_with_sql" }) + "\n")).code === "bad_response");
  ok("success envelope with extra field -> bad_response", (await bad(JSON.stringify({ ok: true, message: okE.message, debug: "x" }) + "\n")).code === "bad_response");
  ok("message failing the accepted outward guard -> bad_response", (await bad(JSON.stringify({ ok: true, message: { ...okE.message, pgService: "postgres://x" } }) + "\n")).code === "bad_response");
  ok("phase mismatch -> bad_response", (await bad(JSON.stringify({ ok: true, message: okE.message }) + "\n")).code === "bad_response");
  ok("oversized response -> response_too_large", (await bad("x".repeat(70000))).code === "response_too_large");
  ok("silent reader -> bounded deadline_exceeded", (await bad(null, { totalTimeoutMs: 300 })).code === "deadline_exceeded");
  await se.ctrl.stop();
  const unreach = await gwFor(portE).observe("dormant");
  ok("private reader unavailable -> reader_unreachable (no retry)", unreach.ok === false && unreach.code === "reader_unreachable");

  // ───────────────────────────────────────────────────────────────
  console.log("F. Accepted source preservation + boundaries");
  const H = (p) => createHash("sha256").update(readFileSync(resolve(L03B, p))).digest("hex");
  const ACCEPTED = {
    "private-reader-host-runtime-offline-01/AUTHORITY-BOUNDARY.md": "a1a9411a75012523fbac7f3a1ff651e59d8ab45f71dc8b325581547fefeffe80",
    "private-reader-host-runtime-offline-01/CORRECTION-SUMMARY.md": "1b8ec9b038f43c3ddd7cdec584040edf19ba96dd63573992e4cd73677df9f6ff",
    "private-reader-host-runtime-offline-01/DEPLOYMENT-CONFIG.md": "3b04f3ea2d7321ff793fae9f95aec627c9874248c4adb5b74f02b73716214cfc",
    "private-reader-host-runtime-offline-01/EVIDENCE-MANIFEST.json": "fef0533972f115d5b88be18eefb0e2851afc53857a15f8d11ba8c1dda8d0dab7",
    "private-reader-host-runtime-offline-01/README.md": "d48579005878abef5698f4692dbfc04af734a52a0dd0ba27791f55172473ab84",
    "private-reader-host-runtime-offline-01/observation-transport.mjs": "06c01348d20c3e8b118b74aae086e24de8945e7ab043df4d4715eff21b4f6ca3",
    "private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs": "629540c525c9d52894d5236fa37baad5682c09c1216dd278ea755eed5ed9c459",
    "private-reader-host-runtime-offline-01/reader-only-authority.mjs": "ff38a8cc18184281e153dee0bd1b38d620015cc98ba281c7a241b39437efd3f8",
    "private-reader-host-runtime-offline-01/runtime-config.mjs": "4843ecb038f9d91b9f5725f9476838a95ae4e4e49a99ec82fbd846a5a846c62e",
    "private-reader-host-runtime-offline-01/tests/independent-client.mjs": "465efb1cab8825260484c71d7102394b5229657bd5b9c59227c8d1d922e6642d",
    "private-reader-host-runtime-offline-01/tests/runtime.test.mjs": "9631a1f0653ac2cedf88d5150fe8c0ed94775ad6c08eef7311923c3a3cabc1e8",
  };
  const FROZEN = {
    "private-reader-host-offline-01/private-reader-host.mjs": "3f25bcd3975318cca5c6619beb016e6159ba06c263eb32f11d8873e650723525",
    "private-reader-host-offline-01/ACCESS-CONTROL-SPEC.md": "c9b7aabc55258690f2f2daf20c0a126497a3ef7b859996f91b70673961953748",
    "private-reader-host-offline-01/tests/private-reader-host.test.mjs": "ddda185096ce08696cf90bb6fc4c83c88b3fabd0d53ceedad722c472c4ed9d44",
    "private-reader-host-offline-01/README.md": "86c0a08b5441b7ed47c0f1e8bd55a79c3b4e49c7abe274468156a1e0b8493e86",
    "private-reader-host-offline-01/EVIDENCE-MANIFEST.json": "11ef6eee49409941fc28c55ce34fbf475647886cfd476b83cb4e2accd7da0220",
    "trusted-executor-runtime-01/trusted-read-adapter.mjs": "12f9c439371b2cb11728fde821ac29208553797e72fb7be5d0db561e476d660b",
    "trusted-executor-runtime-01/db-target-binding.mjs": "c1fec8b68fe79ec2d7615ff9b401034d8f96a7e8b82ab342a5b53f1c6fbdd0ea",
    "trusted-executor-runtime-01/canonical-timestamp.mjs": "d0c48f3af5e8e802ff129d178ed6064eff99b49877db5616f257f928ec810e8e",
    "trusted-executor-runtime-01/production-authority.mjs": "6da4a3a98b98bf84d74955ddceb65ab073069f84f1852e48141976e6020890f6",
    "trusted-executor-runtime-01/runtime-config.mjs": "c0035996b6fcf3a36a402d220ac1559bdcb8cdf2f943d72deaa714c72ec197ae",
    "trusted-activation-boundary-01/pricing-approval-contract.mjs": "59ef03ea3b0532100cf59c19a7f4f174543a4dea0e688359ced858e974312ad3",
    "trusted-activation-boundary-01/approval-verify.mjs": "88212feed6e30a08069a12e1e0c1999f7df07487b3c52e035f5e5b1486fb29f3",
    "trusted-runtime-live-binding-offline-01/production-read-queries.mjs": "42ddf87d268183183d3851a91e9df57b8e9e2a1c3d629412a24a489e9646ed0c",
    "trusted-runtime-live-binding-offline-01/production-authority-composition.mjs": "a0e84399bd3c858b61a3a57b3590ff8115335ea5942a78685ad753403b651f69",
  };
  ok("all 11 accepted runtime files byte-unchanged", Object.entries(ACCEPTED).every(([p, h]) => H(p) === h));
  ok("frozen predecessors byte-unchanged (14 files)", Object.entries(FROZEN).every(([p, h]) => H(p) === h));
  const PROD = ["reader-attestation.mjs", "reader-session.mjs", "production-reader-authority.mjs", "gateway-observation-caller.mjs", "integration-config.mjs", "production-entrypoint.mjs", "attestation-source-channel.mjs"];
  const stripComments = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const src = Object.fromEntries(PROD.map((f) => [f, stripComments(readFileSync(join(ROOT, f), "utf8"))]));
  const all = Object.values(src).join("\n");
  ok("production modules never import test fixtures", !/tests\/|fixtures\//.test(all));
  ok("no signing key / signing code in any production module", !/generateKeyPair|privateKey|\bsign\s*\(|createSign/.test(all));
  ok("no executor client constructed anywhere in the integration", !/executorDbClient\s*:/.test(all) && !/EXECUTOR_DB_URL"?\s*\]/.test(src["production-reader-authority.mjs"]));
  ok("gateway caller holds no DB client / credential path", !/readerDbClient|reader-session|production-reader-authority|pg"|DB_URL/.test(src["gateway-observation-caller.mjs"]));
  ok("gateway caller uses the ACCEPTED outward guard + accepted transport constants", /assertOutwardMessage\(m\)/.test(src["gateway-observation-caller.mjs"]) && /from "\.\.\/private-reader-host-runtime-offline-01\/observation-transport\.mjs"/.test(src["gateway-observation-caller.mjs"]));
  ok("no HTTP / fetch / child_process / e.message / stack in production modules", !/from\s+["'](node:)?(http|https|http2)["']/.test(all) && !/\bfetch\s*\(/.test(all) && !/child_process/.test(all) && !/\be\.message\b/.test(all) && !/\.stack\b/.test(all));
  ok("real pg driver imported lazily only inside open()", /await import\("pg"\)/.test(src["reader-session.mjs"]) && !/^import .* from "pg"/m.test(all));
  ok("entrypoint uses the accepted startServingRuntime (no parallel runtime)", /startServingRuntime\(\{ acquireReaderAuthority/.test(src["production-entrypoint.mjs"]) && !/net\.createServer/.test(all));
  ok("integration directory contains no secret-looking material", readdirSync(ROOT).every((f) => !/\.(pem|key|env)$/.test(f)) && !/BEGIN .*PRIVATE KEY/.test(all));

  // ───────────────────────────────────────────────────────────────
  console.log("G. Integrated offline path (evidence -> proof -> reader binding -> timeout -> accepted runtime -> gateway -> result -> expiry/reconnect/shutdown)");
  clock.t = NOW;
  const wg = world(); const portG = await freePort();
  let fatal = 0;
  const sg = await startSvc(wg, portG, { renewAfterMs: 120000, onFatal: () => { fatal++; } });
  ok("service started only after verified authority + verified timeout", sg.ctrl.started === true && sg.ctrl.phase() === "serving" && sg.ctrl.ready() === true && wg.db.lifecycleQueries >= 5 && wg.att.ctl.issued === 1);
  ok("logs carry no secret / credential", !sg.logs.some(leaked));
  const gG = gwFor(portG);
  const oD = await gG.observe("dormant"), oA = await gG.observe("armed"), oC = await gG.observe("ceilings");
  ok("gateway -> approved observations -> validated bounded results (all three)", oD.ok && oA.ok && oC.ok && oD.message.observation.counts.sessions === 0 && oA.message.observation.armedState.one_call_policy_digest === FIXED.one_call_policy_digest && oC.message.observation.oneCallPolicy.session_money_ceiling_micros === 89536);
  clock.t = NOW + 125000;
  await sg.ctrl.tick();
  ok("supervisor renews before expiry (fresh attestation, still serving)", wg.att.ctl.issued === 2 && sg.ctrl.phase() === "serving" && sg.ctrl.ready() === true);
  // stale readiness: the clock passes expiry with NO call in between (attester unavailable, so the
  // supervisor cannot immediately re-establish) — readiness is recomputed live, never cached
  wg.att.ctl.fail = true;
  clock.t = NOW + 125000 + 300001;
  ok("stale readiness cannot report READY: ready()=false at the first check after expiry", sg.ctrl.ready() === false);
  await sleep(20);
  const qx = wg.db.obsQueries; const blocked = await gG.observe("dormant");
  ok("expiry -> supervisor suspends immediately: listener closed, ZERO queries issued", sg.ctrl.phase() === "suspended" && blocked.code === "reader_unreachable" && wg.db.obsQueries === qx);
  await sg.ctrl.tick();
  ok("failed renewal/recovery keeps serving blocked (no fallback to the expired proof)", sg.ctrl.phase() === "suspended" && sg.ctrl.lastReason() === "attestation_unavailable" && (await gG.observe("dormant")).code === "reader_unreachable");
  wg.att.ctl.fail = false;
  const opensBeforeRec = wg.db.opens;
  await sg.ctrl.tick();
  ok("recovery requires a NEW connection + renewed checks, then serves again", sg.ctrl.phase() === "serving" && wg.db.opens === opensBeforeRec + 1 && sg.ctrl.ready() === true && (await gG.observe("armed")).ok === true);
  // mid-flight expiry: a result obtained across expiry is discarded; no further query begins
  const T1 = clock.t; wg.db.delayMs = 150; const qm = wg.db.obsQueries; wg.att.ctl.fail = true;
  const pending = gG.observe("ceilings"); await sleep(40); clock.t = T1 + 300001;
  const mid = await pending; wg.db.delayMs = 0; await sleep(20);
  ok("statement in flight across expiry: result NOT delivered, exactly one statement issued, service suspended", mid.ok === false && wg.db.obsQueries === qm + 1 && sg.ctrl.phase() === "suspended");
  wg.att.ctl.fail = false;
  await sg.ctrl.tick();
  ok("re-established after mid-flight expiry", sg.ctrl.phase() === "serving" && (await gG.observe("dormant")).ok === true);
  // connection loss: immediate invalidation -> listener closed -> re-established on a NEW connection
  const opensBeforeLoss = wg.db.opens;
  wg.db.killAll(); await sleep(30);
  ok("connection loss -> immediate suspension + automatic re-establish on a NEW connection with renewed checks", sg.ctrl.lastReason() === "connection_lost" && wg.db.opens === opensBeforeLoss + 1 && sg.ctrl.phase() === "serving" && sg.ctrl.ready() === true);
  ok("serves on the new connection", (await gG.observe("dormant")).ok === true);
  // drift -> revocation; persistent drift -> bounded recovery -> failed (fatal)
  wg.db.privileges.forbiddenObjectAccessible = true; clock.t += 130000;
  await sg.ctrl.tick();
  ok("privilege drift detected at renewal -> revoked + suspended", sg.ctrl.phase() === "suspended" && sg.ctrl.lastReason() === "drift_forbidden_object_accessible");
  await sg.ctrl.tick(); await sg.ctrl.tick(); await sg.ctrl.tick();
  ok("persistent drift: bounded recovery exhausted -> failed, fatal signalled once, no listener", sg.ctrl.phase() === "failed" && fatal === 1 && (await gG.observe("dormant")).code === "reader_unreachable" && wg.db.liveSessions() === 0);
  await sg.ctrl.stop();
  // clean shutdown of a healthy service
  const wz = world(); const portZ = await freePort(); const sz = await startSvc(wz, portZ);
  ok("healthy service serves", (await gwFor(portZ).observe("ceilings")).ok === true);
  await sz.ctrl.stop();
  ok("clean shutdown: not ready, listener closed, DB session closed", sz.ctrl.ready() === false && (await gwFor(portZ).observe("ceilings")).code === "reader_unreachable" && wz.db.liveSessions() === 0);

  await sectionH();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed, 0 skipped  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exit(1); }
  console.log("OFFLINE PRODUCTION-INTEGRATION VERIFICATION: PASS");
  console.log("SCOPE: synthetic PostgreSQL session fixture + offline TEST-ONLY reference attester + real local loopback sockets through the ACCEPTED serving runtime — NOT live AI-STAGING privileges, hosted statement_timeout, Railway isolation, or a deployed/connected gateway.");
  process.exit(0);
}
// ─────────────────────────────────────────────────────────────────────────────
// H. The ACTUAL production entrypoint composes the approved attestation source from validated deployment
// configuration. Test-harness-only simulation: the "pg" specifier is mapped to a synthetic driver (module
// hook), the private attester DNS name resolves to a local SIMULATED attester (dns.lookup patch), and the
// attester signs with an in-memory fixture key. The production code path itself receives ONLY `env`.
// Simulated signed attestations are NOT genuine live attestations.
async function waitFor(cond, timeoutMs) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (await cond()) return true; await sleep(100); } return !!(await cond()); }
async function sectionH() {
  console.log("H. Production attestation-source composition through the ACTUAL production entrypoint");
  register(new URL("./fixtures/pg-hook.mjs", import.meta.url));
  const ATT_NAME = "reader-attester.railway.internal", DOWN_NAME = "attester-down.railway.internal";
  const downPort = await freePort();
  const origLookup = dns.lookup;
  dns.lookup = (h, o, cb) => { if (typeof o === "function") { cb = o; o = {}; } if (h === ATT_NAME || h === DOWN_NAME) return o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4); return origLookup(h, o, cb); };
  const db = makeSyntheticPg(); globalThis.__LAI03B_SYNTH_PG__ = db;
  const att = await startSimulatedAttester({ db, channelSecret: CHANNEL_SECRET });
  const listenPort = await freePort();
  const envFor = (a, port, over = {}) => ({ [ENV.readerDbUrl]: SENTINEL_URL, [ENV.attesterIssuer]: a.trustRootConfig.issuer, [ENV.attesterPublicKeyDerB64]: a.trustRootConfig.publicKeyDerB64,
    [ENV.attesterFingerprint]: a.trustRootConfig.fingerprint, [ENV.attesterHost]: ATT_NAME, [ENV.attesterPort]: String(a.port), [ENV.attesterChannelSecret]: CHANNEL_SECRET,
    LIVE_AI_03B_READER_TRANSPORT_SECRET: SECRET, LIVE_AI_03B_READER_LISTEN_MODE: "loopback-tcp", LIVE_AI_03B_READER_BIND_HOST: "127.0.0.1", LIVE_AI_03B_READER_PORT: String(port), ...over });
  const prodEnv = (over) => envFor(att, listenPort, over);
  const gwP = (port) => createGatewayObservationCaller({ destination: { host: "127.0.0.1", port }, secret: SECRET, offlineTestBoundary: true }); // expects mode "production"
  const allLogs = []; const reasons = [];

  // ── positive: full composition through the actual production entrypoint ──
  const auth0 = db.driverConnects || 0;
  const p1 = await startProductionReaderService({ env: prodEnv(), log: (l) => allLogs.push(l) });
  ok("ACTUAL production entrypoint (env only) composes the approved source and reaches SERVING", p1.started === true && p1.phase() === "serving" && p1.ready() === true);
  ok("signed envelope obtained over the AUTHENTICATED configured channel (simulated attester)", att.ctl.authenticated === 1 && att.ctl.rejectedAuth === 0 && att.ctl.issued === 1);
  ok("reader connection via the REAL pg factory (synthetic driver) with verified timeout + read-only", (db.driverConnects || 0) === auth0 + 1 && db.lifecycleQueries >= 5);
  const g1 = gwP(listenPort);
  const pD = await g1.observe("dormant"), pA = await g1.observe("armed"), pC = await g1.observe("ceilings");
  ok("authenticated gateway observations through the accepted transport (all three)", pD.ok && pA.ok && pC.ok && pC.message.observation.oneCallPolicy.session_money_ceiling_micros === 89536);
  ok("accepted runtime ran in PRODUCTION mode (messages mode:'production'; trusted provenance derived only from the verified signature)", [pD, pA, pC].every((r) => r.message.mode === "production"));
  await p1.stop();
  ok("production stop: listener closed, reader session closed", (await g1.observe("dormant")).code === "reader_unreachable" && db.liveSessions() === 0);

  const neg = async (env, extraOpts = {}) => { const logs = []; const r = await startProductionReaderService({ env, log: (l) => logs.push(l), ...extraOpts }); allLogs.push(...logs); if (r.reason) reasons.push(r.reason); if (r.started) await r.stop(); return r; };
  const dc = () => db.driverConnects || 0;
  // A. missing source configuration
  let before = dc(); const missing = [ENV.attesterHost, ENV.attesterPort, ENV.attesterChannelSecret];
  const mres = []; for (const k of missing) { const e = prodEnv(); delete e[k]; mres.push(await neg(e)); }
  ok("A missing source host / port / channel secret -> fail closed BEFORE any DB connection", mres.every((r) => r.started === false && r.reason === "integration_config_incomplete") && dc() === before);
  // B. invalid destination
  before = dc();
  const bURL = await neg(prodEnv({ [ENV.attesterHost]: "http://reader-attester.railway.internal" }));
  const bPub = await neg(prodEnv({ [ENV.attesterHost]: "8.8.8.8" }));
  const bExt = await neg(prodEnv({ [ENV.attesterHost]: "attester.example.com" }));
  const bLoop = await neg(prodEnv({ [ENV.attesterHost]: "127.0.0.1" }));
  const bPort = await neg(prodEnv({ [ENV.attesterPort]: "0" })), bPort2 = await neg(prodEnv({ [ENV.attesterPort]: "7444/x" }));
  ok("B invalid destination (URL / public IP / external name / loopback / bad port) -> fail closed before DB", bURL.reason === "attester_destination_host" && bPub.reason === "attester_destination_not_private" && bExt.reason === "attester_destination_not_private_dns" && bLoop.reason === "attester_destination_loopback" && bPort.reason === "attester_destination_port" && bPort2.reason === "attester_destination_port" && dc() === before);
  // C. approved source unavailable
  const cDown = await neg(prodEnv({ [ENV.attesterHost]: DOWN_NAME, [ENV.attesterPort]: String(downPort) }));
  ok("C approved source unreachable -> fail closed, reader session closed, no listener", cDown.started === false && cDown.reason === "attester_unreachable" && db.liveSessions() === 0);
  att.ctl.mode = "unavailable"; const cUn = await neg(prodEnv()); att.ctl.mode = "ok";
  ok("C approved source answers 'unavailable' -> fail closed", cUn.started === false && cUn.reason === "attester_rejected");
  // D. channel authentication
  const rej0 = att.ctl.rejectedAuth;
  const dWrong = await neg(prodEnv({ [ENV.attesterChannelSecret]: "a-different-synthetic-channel-secret-000000000" }));
  ok("D wrong channel secret -> attester refuses (unauthenticated) -> fail closed, no envelope", dWrong.started === false && dWrong.reason === "attester_rejected" && att.ctl.rejectedAuth === rej0 + 1);
  before = dc();
  const dShort = await neg(prodEnv({ [ENV.attesterChannelSecret]: "too-short" }));
  const dReuse = await neg(prodEnv({ [ENV.attesterChannelSecret]: SECRET }));
  ok("D short / reused (== transport secret) channel secret -> refused before DB", dShort.reason === "attester_channel_secret_invalid" && dReuse.reason === "attester_channel_secret_reused" && dc() === before);
  // E. malformed / oversized / unexpected / silent responses
  const withMode = async (m, over) => { att.ctl.mode = m; const r = await neg(prodEnv(over)); att.ctl.mode = "ok"; return r; };
  const eG = await withMode("garbage"), eO = await withMode("oversize"), eU = await withMode("unexpected");
  ok("E malformed / oversized / unexpected-envelope response -> fail closed", eG.reason === "attester_bad_response" && eO.reason === "attester_response_too_large" && eU.reason === "attester_bad_response");
  const t0 = Date.now(); const eS = await withMode("silent"); const elS = Date.now() - t0;
  ok("E silent attester -> bounded deadline (no hang, no retry)", eS.reason === "attester_deadline_exceeded" && elS < 8000);
  // F. unsigned / forged
  const fU = await withMode("unsigned"), fF = await withMode("forged");
  ok("F unsigned / forged envelope -> signature verification fails", ["attestation_signature_invalid", "attestation_signature_malformed"].includes(fU.reason) && fF.reason === "attestation_signature_invalid");
  // G. untrusted issuer / wrong verification key
  const gI = await withMode("wrongIssuer");
  const otherPub = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const gK = await neg(prodEnv({ [ENV.attesterPublicKeyDerB64]: otherPub, [ENV.attesterFingerprint]: publicKeyFingerprintFromDerB64(otherPub) }));
  ok("G untrusted issuer / wrong pinned verification key -> fail closed", gI.reason === "attestation_issuer_untrusted" && gK.reason === "attestation_key_untrusted");
  // H. expired / future-dated
  const hE = await withMode("expired"), hF = await withMode("future");
  ok("H expired / future-dated proof -> fail closed", hE.reason === "attestation_expired" && hF.reason === "attestation_future_dated");
  // I. wrong target / wrong connection token
  const iT = await withMode("wrongTarget"), iK = await withMode("wrongToken");
  ok("I wrong target / wrong connection token -> fail closed", iT.reason === "drift_target_not_ai_staging" && iK.reason === "attestation_connection_mismatch" && db.liveSessions() === 0);
  // J. production caller cannot substitute a source object
  const req0 = att.ctl.requests;
  const jS = await neg(prodEnv(), { attestationSource: { obtain: async () => ({}) } });
  const jC = await neg(prodEnv(), { attesterChannel: { host: "127.0.0.1", port: 1 } });
  const jB = await neg(prodEnv(), { offlineTestBoundary: true });
  ok("J production refuses any caller-supplied source / channel / test boundary option (nothing contacted)", [jS, jC, jB].every((r) => r.started === false && r.reason === "test_injection_refused_in_production") && att.ctl.requests === req0 && PRODUCTION_OPTION_KEYS.join(",") === "mode,env,log,onFatal,onDegraded");
  // K. test fixture source cannot be enabled via production configuration
  const kT = await neg(prodEnv({ [ENV.attesterIssuer]: "TEST-ONLY-reference-attester" }));
  const kC = composeProductionAttestationSource(prodEnv({ [ENV.attesterHost]: "127.0.0.1" }), { ok: true, attesterChannel: { host: "127.0.0.1", port: att.port, channelSecretEnvName: ENV.attesterChannelSecret } });
  ok("K TEST-ONLY issuer and loopback (test-harness) destination refused by production composition", kT.reason === "trust_root_test_issuer_refused" && kC.ok === false && kC.reason === "attester_destination_loopback");
  ok("K production composition exposes only obtain() of the versioned channel", (() => { const c = createAttestationSourceChannel({ host: ATT_NAME, port: 7444, channelSecret: CHANNEL_SECRET }); return c.ok && Object.keys(c.source).sort().join(",") === "destination,obtain,version" && c.source.version === ATTESTATION_CHANNEL_VERSION; })());
  // L / M
  const pe = prodEnv();
  ok("L reader host config holds only the attester PUBLIC key (no private/signing key material)", Object.values(pe).every((v) => !/PRIVATE KEY/.test(v)) && !Object.keys(pe).some((k) => /PRIVATE|SIGNING/.test(k)) && (() => { try { createPrivateKey({ key: Buffer.from(pe[ENV.attesterPublicKeyDerB64], "base64"), format: "der", type: "pkcs8" }); return false; } catch { return true; } })());
  before = dc();
  const mX = await neg(prodEnv({ LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "postgres://sentinel_exec:x@127.0.0.1:9/x" }));
  ok("M executor credential in the reader environment -> refused before DB", mX.reason === "executor_credential_present" && dc() === before);
  // N. no leakage
  ok("N source failures produce fixed codes only; no secret / URL / raw error in logs or results", !allLogs.some(leaked) && reasons.every((r) => /^[a-z_]+$/.test(r)) && !leaked(reasons));
  ok("N channel failure codes are a fixed set", CHANNEL_FAILURE_CODES.every((c) => /^attester_[a-z_]+$/.test(c)));

  // O / P / Q — renewal, source failure during renewal, recovery (real production timers; short-lived proofs)
  const att2 = await startSimulatedAttester({ db, channelSecret: CHANNEL_SECRET, lifetimeMs: 2000 });
  const port2 = await freePort(); const logs2 = [];
  const p2 = await startProductionReaderService({ env: envFor(att2, port2), log: (l) => logs2.push(l) });
  const g2 = gwP(port2);
  ok("O service up on a short-lived (2 s) proof from the configured source", p2.started === true && p2.phase() === "serving" && att2.ctl.issued === 1);
  const renewed = await waitFor(() => att2.ctl.issued >= 3, 5000);
  ok("O proof renewal continues through the SAME approved configured source (half-life renewal), still serving", renewed && p2.phase() === "serving" && (await g2.observe("dormant")).ok === true && att2.ctl.rejectedAuth === 0);
  att2.ctl.mode = "unavailable";
  const suspended = await waitFor(() => p2.phase() === "suspended" && p2.lastReason() === "attester_rejected", 6000);
  ok("P source failure during renewal -> proof kept only until expiry, then suspended (listener closed, no fallback)", suspended && p2.ready() === false && (await g2.observe("dormant")).code === "reader_unreachable");
  att2.ctl.mode = "wrongTarget";
  const q1 = await waitFor(() => p2.lastReason() === "drift_target_not_ai_staging", 8000);
  ok("Q recovery through the source cannot bypass fresh target validation (stays suspended)", q1 && p2.phase() === "suspended" && (await g2.observe("armed")).code === "reader_unreachable");
  att2.ctl.mode = "ok"; const opensQ = db.opens;
  const q2 = await waitFor(() => p2.phase() === "serving", 8000);
  ok("Q recovery with a fresh valid proof on a NEW connection -> serving again", q2 && db.opens > opensQ && p2.ready() === true && (await g2.observe("ceilings")).ok === true);
  await p2.stop();
  ok("O/P/Q logs carry no secret / URL / raw error", !logs2.some(leaked));
  await att2.close(); await att.close();
  dns.lookup = origLookup;

  // the REAL process entrypoint main() in a child process (harness preload simulates the deployment env)
  const childPort = await freePort();
  const childEnv = { PATH: process.env.PATH, [ENV.readerDbUrl]: SENTINEL_URL, [ENV.attesterHost]: ATT_NAME, [ENV.attesterChannelSecret]: CHANNEL_SECRET,
    LIVE_AI_03B_READER_TRANSPORT_SECRET: SECRET, LIVE_AI_03B_READER_LISTEN_MODE: "loopback-tcp", LIVE_AI_03B_READER_BIND_HOST: "127.0.0.1", LIVE_AI_03B_READER_PORT: String(childPort) };
  const child = spawn(process.execPath, ["--import", join(HERE, "fixtures", "production-harness-preload.mjs"), join(ROOT, "production-entrypoint.mjs")], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", () => {});
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  const up = await waitFor(() => /"status":"serving"/.test(out), 10000);
  const cObs = up ? await gwP(childPort).observe("armed") : { ok: false };
  ok("REAL process entrypoint main(): composes source from env, serves; separate gateway process observes (production mode)", up && cObs.ok === true && cObs.message.mode === "production");
  child.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(5000).then(() => "timeout")]);
  ok("REAL process entrypoint: clean SIGTERM shutdown (exit 0), output leaks nothing", code === 0 && !leaked(out));
}

run().catch(async (e) => { for (const c of openCtrls) { try { await c.stop(); } catch {} } console.log("HARNESS ERROR:", e && e.stack); process.exit(1); });
