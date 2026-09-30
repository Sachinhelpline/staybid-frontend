// Focused OFFLINE suite — M7 V2 EXECUTOR ATTESTATION ISSUER. Synthetic observer (no real DB), loopback-only channel,
// network/secret-logging counters. Real-PostgreSQL semantics are covered separately by tests/localpg.
import net from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── network + console guards (installed before anything else) ──
const NET = { connects: [], fetch: 0 };
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { const o = Array.isArray(a[0]) ? a[0][0] : a[0]; NET.connects.push(typeof o === "object" && o ? (o.path ? "unix" : String(o.host)) : String(a[1] || a[0])); return origConnect.apply(this, a); };
globalThis.fetch = async () => { NET.fetch++; throw new Error("network forbidden in offline tests"); };
const CAPTURED = [];
for (const k of ["log", "error", "warn", "info"]) console[k] = (...a) => { CAPTURED.push(a.map(String).join(" ")); };
const out = (s) => process.stdout.write(s + "\n");

import { publicKeyFingerprintFromDerB64, canonicalize } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { verifyExecutorAttestation, EXECUTOR_PRIVILEGE_KEYS, ATTESTATION_MAX_LIFETIME_MS } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { bindExecutorConnection } from "../../m7-v2-production-authority-provisioning-offline-01/src/role-binding.mjs";
import { acquireExecutorAttestationSourceV2 } from "../../m7-v2-production-authority-provisioning-offline-01/src/production-entrypoint.mjs";
import { EXECUTOR_ATTESTER_ENV as AUTH_ENV, loadProvisioningConfig } from "../../m7-v2-production-authority-provisioning-offline-01/src/provisioning-config.mjs";
import { makeAttesterTrustRoot, verifyReaderAttestation } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { createAttestationSourceChannel, ATTESTATION_CHANNEL_VERSION as READER_CHANNEL_VERSION } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { startAttestationServer as startReaderAttestationServer } from "../../private-reader-attester-offline-01/attestation-server.mjs";

import { loadExecutorAttesterConfig, ENV, FORBIDDEN_ENV_NAMES, SECRET_ENV_NAMES } from "../src/executor-attester-config.mjs";
import { executorClusterFingerprint, parseExecutorDeploymentAnchor, resolveExecutorTarget, EXECUTOR_ANCHOR_CONTRACT, EXECUTOR_ANCHOR_DOMAIN, AI_STAGING } from "../src/executor-target-binding.mjs";
import { XQ, ALLOWED_EXECUTOR_SQL, isPermittedExecutorSql } from "../src/executor-evidence-queries.mjs";
import { observeExecutorEvidence, executorEvidenceIsAttestable } from "../src/executor-evidence-evaluator.mjs";
import { establishExecutorObserverSession, createExecutorObserverCoordinator } from "../src/executor-observer.mjs";
import { createExecutorSigningAdapter } from "../src/executor-signing-adapter.mjs";
import { startExecutorAttestationServer, EXECUTOR_CHANNEL_VERSION, EXECUTOR_CHANNEL_OP, executorChannelMac } from "../src/executor-attestation-server.mjs";
import { createExecutorAttestationSourceChannel } from "../src/executor-attestation-channel.mjs";
import { startExecutorAttesterService } from "../src/executor-attester-entrypoint.mjs";
import { cleanState, syntheticPhysical, syntheticFactory, tokenOf, EX } from "./fixtures/synthetic-executor-cluster.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const REPO = resolve(PKG, "../../..");
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; out("  PASS " + n); } else { fail++; out("  FAIL " + n + (d !== undefined ? "  :: " + JSON.stringify(d).slice(0, 400) : "")); } };
const LIST = process.env.M7EA_LIST === "1";

// ── identities (TEST-ONLY, generated in memory per run, never written) ──
const kp = () => { const k = generateKeyPairSync("ed25519"); const der = k.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { pk8: k.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), der, fp: publicKeyFingerprintFromDerB64(der) }; };
const EXK = kp(), RDK = kp(), OTHER = kp();
const TEST_ISSUER = "TEST-ONLY-executor-attester-01", PROD_ISSUER = "owner-executor-attester-01";
const CH_SECRET = randomBytes(24).toString("hex"), READER_CH_SECRET = randomBytes(24).toString("hex");
const OBS_URL = "postgresql://observer:" + randomBytes(12).toString("hex") + "@10.9.9.9:5432/railway";   // never opened
const fpOfState = (s) => executorClusterFingerprint({ datname: s.cluster.datname, databaseOid: s.cluster.database_oid, executorRoleOid: s.cluster.executor_role_oid, encoding: s.cluster.encoding });
const anchorFor = (s, over = {}) => ({ contract: EXECUTOR_ANCHOR_CONTRACT, domain: EXECUTOR_ANCHOR_DOMAIN, projectId: AI_STAGING.projectId, environmentId: AI_STAGING.environmentId,
  pgServiceId: AI_STAGING.pgServiceId, clusterFingerprint: fpOfState(s), issuedAtMs: 1759140000000, verifiedBy: "owner-verification-2026-09", ...over });
const baseEnv = (s, over = {}) => ({
  [ENV.issuer]: PROD_ISSUER, [ENV.publicKeyDerB64]: EXK.der, [ENV.fingerprint]: EXK.fp, [ENV.port]: "8551", [ENV.channelSecret]: CH_SECRET,
  [ENV.signingKeyPkcs8B64]: EXK.pk8, [ENV.observerDbUrl]: OBS_URL, [ENV.bindHost]: "10.20.3.4", [ENV.allowedPeerCidrs]: "10.20.3.0/24",
  [ENV.deploymentAnchor]: JSON.stringify(anchorFor(s)), [ENV.readerAttesterIssuer]: "owner-reader-attester-01", [ENV.readerAttesterFingerprint]: RDK.fp, ...over });
const testEnv = (s, over = {}) => baseEnv(s, { [ENV.issuer]: TEST_ISSUER, [ENV.deploymentAnchor]: JSON.stringify(anchorFor(s, { verifiedBy: "TEST-ONLY-offline" })), ...over });
const signer = (over = {}) => createExecutorSigningAdapter({ issuer: TEST_ISSUER, privateKeyPkcs8B64: EXK.pk8, expectedPublicKeyDerB64: EXK.der, expectedFingerprint: EXK.fp,
  readerAttesterFingerprint: RDK.fp, proofLifetimeMs: 120000, offlineTestBoundary: true, ...over });
const TR = makeAttesterTrustRoot({ issuer: TEST_ISSUER, publicKeyDerB64: EXK.der, fingerprint: EXK.fp }, { allowTestIssuer: true }).trustRoot;
const nonce32 = () => randomBytes(16).toString("hex");

async function measure(state, token) {
  const es = await establishExecutorObserverSession(syntheticPhysical(state));
  if (!es.ok) return { refused: es.reason };
  const e = await observeExecutorEvidence(es.observer, token === undefined ? tokenOf(state.sessions[0]) : token, { nowProvider: state.now });
  if (!e.ok) return { refused: e.reason };
  const a = executorEvidenceIsAttestable(e.evidence);
  return a.ok ? { clean: true, ev: e.evidence } : { refused: a.reason, ev: e.evidence };
}

// ═══════════ A — exact contract compatibility with the PRESERVED verifier (positive) ═══════════
{
  const s = cleanState(); const m = await measure(s);
  ok("A01 synthetic clean accepted state measures CLEAN", m.clean === true, m.refused);
  const tgt = resolveExecutorTarget(parseExecutorDeploymentAnchor(JSON.stringify(anchorFor(s))).anchor, m.ev.cluster);
  const n = nonce32(); const sg = signer();
  const iss = sg.signer.issue({ requestNonce: n, target: tgt.target, connection: m.ev.connection, privileges: m.ev.privileges });
  const env = iss.envelope;
  ok("A02 envelope shape is exactly { payload, signatureB64 }", JSON.stringify(Object.keys(env).sort()) === '["payload","signatureB64"]');
  ok("A03 payload top-level keys are exactly the accepted 10", JSON.stringify(Object.keys(env.payload).sort()) === JSON.stringify(["connection", "contract", "domain", "expiresAtMs", "issuedAtMs", "issuer", "keyId", "privileges", "requestNonce", "target"]));
  ok("A04 contract/domain exact", env.payload.contract === "AiStagingExecutorAttestationV1" && env.payload.domain === "staybid.live-ai-03b.executor-authority-attestation.v1");
  ok("A05 target keys exact + AI-STAGING ids", JSON.stringify(Object.keys(env.payload.target).sort()) === '["environmentId","pgServiceId","projectId"]'
    && env.payload.target.projectId === "4ad1abb3-823a-4acf-b889-6d34ae46d7f9" && env.payload.target.environmentId === "aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc" && env.payload.target.pgServiceId === "b7362594-a01b-4623-a982-394707a6cec2");
  ok("A06 connection keys exact, role live_ai_03b_executor", JSON.stringify(Object.keys(env.payload.connection).sort()) === '["role","token"]' && env.payload.connection.role === EX);
  ok("A07 privilege keys == the preserved EXECUTOR_PRIVILEGE_KEYS", JSON.stringify(Object.keys(env.payload.privileges).sort()) === JSON.stringify(EXECUTOR_PRIVILEGE_KEYS));
  ok("A08 lifetime ≤ ATTESTATION_MAX_LIFETIME_MS; canonical bytes computable", env.payload.expiresAtMs - env.payload.issuedAtMs <= ATTESTATION_MAX_LIFETIME_MS && typeof canonicalize(env.payload) === "string");
  const v = verifyExecutorAttestation(env, { trustRoot: TR, expectedConnectionToken: tokenOf(s.sessions[0]), expectedRequestNonce: n, now: Date.now() });
  ok("A09 issuer envelope → PRESERVED verifyExecutorAttestation → PASS (verifier unmodified)", v.ok === true, v.reason);
  const sess = { identity: { role: EX, pid: s.sessions[0].pid, applicationName: s.sessions[0].application_name, backendStart: s.sessions[0].backend_start }, token: tokenOf(s.sessions[0]) };
  const b = bindExecutorConnection({ session: sess, envelope: env, trustRoot: TR, requestNonce: n, nowMs: Date.now(), testBoundary: true });
  ok("A10 PRESERVED bindExecutorConnection (identity proof + verifyConnectionTargetBinding) → PASS", b.ok === true, b.reason);
  ok("A11 the PRESERVED READER verifier refuses the executor envelope (no cross-contract acceptance)", verifyReaderAttestation(env, { trustRoot: TR, expectedConnectionToken: tokenOf(s.sessions[0]), expectedRequestNonce: n, now: Date.now() }).ok === false);
  ok("A12 preserved authority acquisition is STILL unprovisioned (not bound by this candidate)", (await acquireExecutorAttestationSourceV2()).available === false && (await acquireExecutorAttestationSourceV2()).reason === "executor_attestation_source_unprovisioned");
  // freshness / binding / trust — PRESERVED verifier on issuer output
  const at = (t) => signer({ nowProvider: () => t }).signer.issue({ requestNonce: n, target: tgt.target, connection: m.ev.connection, privileges: m.ev.privileges }).envelope;
  const V = (e, o = {}) => verifyExecutorAttestation(e, { trustRoot: TR, expectedConnectionToken: tokenOf(s.sessions[0]), expectedRequestNonce: n, now: Date.now(), ...o }).reason;
  ok("A13 future-dated proof (issuer clock +10 s) → executor_attestation_future_dated", V(at(Date.now() + 10000)) === "executor_attestation_future_dated");
  ok("A14 stale proof (issued 301 s ago) → executor_attestation_stale", V(at(Date.now() - 301000)) === "executor_attestation_stale");
  ok("A15 expired proof (issued 121 s ago, 120 s lifetime) → executor_attestation_expired", V(at(Date.now() - 121000)) === "executor_attestation_expired");
  ok("A16 nonce mismatch → executor_attestation_request_nonce_mismatch", V(env, { expectedRequestNonce: nonce32() }) === "executor_attestation_request_nonce_mismatch");
  ok("A17 token mismatch → executor_attestation_connection_mismatch", V(env, { expectedConnectionToken: "e".repeat(64) }) === "executor_attestation_connection_mismatch");
  const wrongIssuer = makeAttesterTrustRoot({ issuer: "TEST-ONLY-someone-else", publicKeyDerB64: EXK.der, fingerprint: EXK.fp }, { allowTestIssuer: true }).trustRoot;
  ok("A18 wrong issuer pinned → executor_attestation_issuer_untrusted", V(env, { trustRoot: wrongIssuer }) === "executor_attestation_issuer_untrusted");
  const wrongKey = makeAttesterTrustRoot({ issuer: TEST_ISSUER, publicKeyDerB64: OTHER.der, fingerprint: OTHER.fp }, { allowTestIssuer: true }).trustRoot;
  ok("A19 wrong key/fingerprint pinned → executor_attestation_key_untrusted", V(env, { trustRoot: wrongKey }) === "executor_attestation_key_untrusted");
  const tampered = { ...env, payload: { ...env.payload, privileges: { ...env.payload.privileges, budgetTablePrivilegeCount: 0, rolsuper: false } , target: { ...env.payload.target } } };
  tampered.payload.target.projectId = "04c8b523-5b15-4d81-af06-8c2aa1a83499";
  ok("A20 a caller-edited payload (CORE-PROD target) fails the signature", V(tampered) === "executor_attestation_signature_invalid");
}

// ═══════════ B — static configuration (no I/O) ═══════════
{
  const s = cleanState();
  ok("B01 complete production config loads (names only; values of secrets not returned)", (() => { const c = loadExecutorAttesterConfig(baseEnv(s)); return c.ok === true && !JSON.stringify(c).includes(CH_SECRET) && !JSON.stringify(c).includes(EXK.pk8) && !JSON.stringify(c).includes(OBS_URL); })());
  ok("B02 names shared with the PRESERVED authority are identical (ISSUER/PUBKEY/FINGERPRINT/PORT/CHANNEL_SECRET)", ENV.issuer === AUTH_ENV.issuer && ENV.publicKeyDerB64 === AUTH_ENV.publicKeyDerB64
    && ENV.fingerprint === AUTH_ENV.fingerprint && ENV.port === AUTH_ENV.port && ENV.channelSecret === AUTH_ENV.channelSecret);
  for (const n of Object.values(ENV).filter((x) => ![ENV.allowWildcardBind, ENV.proofLifetimeMs].includes(x))) {
    const e = baseEnv(s); delete e[n];
    ok(`B03 missing ${n} ⇒ executor_attester_config_incomplete`, loadExecutorAttesterConfig(e).reason === "executor_attester_config_incomplete");
  }
  for (const n of FORBIDDEN_ENV_NAMES) ok(`B04 foreign credential present: ${n} ⇒ refused`, loadExecutorAttesterConfig(baseEnv(s, { [n]: "x" })).reason === "foreign_credential_present");
  for (const n of ["OPENAI_ORG_TOKEN", "CORE_READONLY_URL", "SOME_PRIVATE_KEY", "GATEWAY_SIGNING_SECRET", "ANTHROPIC_API_KEY"]) ok(`B05 forbidden pattern ${n} ⇒ refused`, loadExecutorAttesterConfig(baseEnv(s, { [n]: "x" })).reason === "foreign_credential_present");
  const R = (over) => loadExecutorAttesterConfig(baseEnv(s, over)).reason;
  ok("B06 TEST-ONLY issuer in production ⇒ refused", R({ [ENV.issuer]: TEST_ISSUER }) === "issuer_test_only_refused");
  ok("B07 issuer == the reader attester's issuer ⇒ refused", R({ [ENV.issuer]: "owner-reader-attester-01" }) === "issuer_not_distinct_from_reader_attester");
  ok("B08 issuer == reader attester id ⇒ refused", R({ [ENV.issuer]: "live-ai-03b-reader-attester" }) === "issuer_not_distinct_from_reader_attester");
  ok("B09 own fingerprint == reader attester fingerprint (key reuse) ⇒ refused", R({ [ENV.readerAttesterFingerprint]: EXK.fp }) === "signing_key_not_distinct_from_reader_attester");
  ok("B10 malformed fingerprint ⇒ refused", R({ [ENV.fingerprint]: "abc" }) === "fingerprint_malformed");
  ok("B11 short channel secret ⇒ refused", R({ [ENV.channelSecret]: "short" }) === "channel_secret_invalid");
  ok("B12 reader-attester channel secret present in env (reuse risk) ⇒ refused", R({ LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET: CH_SECRET }) === "foreign_credential_present");
  ok("B13 loopback bind in production ⇒ refused", R({ [ENV.bindHost]: "127.0.0.1" }) === "listen_private_mode_rejects_loopback");
  ok("B14 public bind ⇒ refused", R({ [ENV.bindHost]: "8.8.8.8" }) === "listen_bind_not_private");
  ok("B15 hostname bind ⇒ refused", R({ [ENV.bindHost]: "attester.railway.internal" }) === "listen_bind_host_not_literal_ip");
  ok("B16 wildcard bind without acknowledgement ⇒ refused", R({ [ENV.bindHost]: "::", [ENV.allowedPeerCidrs]: "fd12::/32" }) === "listen_wildcard_bind_not_acknowledged");
  ok("B17 invalid port ⇒ refused", R({ [ENV.port]: "99999" }) !== undefined && loadExecutorAttesterConfig(baseEnv(s, { [ENV.port]: "99999" })).ok === false);
  ok("B18 proof lifetime > max ⇒ refused", R({ [ENV.proofLifetimeMs]: String(ATTESTATION_MAX_LIFETIME_MS + 1) }) === "proof_lifetime_invalid");
  ok("B19 proof lifetime < 1 s ⇒ refused", R({ [ENV.proofLifetimeMs]: "500" }) === "proof_lifetime_invalid");
  const A = (a) => R({ [ENV.deploymentAnchor]: typeof a === "string" ? a : JSON.stringify(a) });
  ok("B20 anchor malformed ⇒ refused", A("{not json") === "anchor_malformed");
  ok("B21 READER deployment anchor contract replayed ⇒ refused", A({ ...anchorFor(s), contract: "AiStagingDeploymentAnchorV1", domain: "staybid.live-ai-03b.deployment-anchor.v1" }) === "anchor_contract_mismatch");
  ok("B22 anchor → CORE-PROD project ⇒ refused", A(anchorFor(s, { projectId: "04c8b523-5b15-4d81-af06-8c2aa1a83499" })) === "anchor_targets_core_prod");
  ok("B23 anchor → CORE-PROD Postgres ⇒ refused", A(anchorFor(s, { pgServiceId: "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b" })) === "anchor_targets_core_prod");
  ok("B24 anchor → wrong project ⇒ refused", A(anchorFor(s, { projectId: "00000000-0000-0000-0000-000000000000" })) === "anchor_target_not_ai_staging");
  ok("B25 anchor → wrong environment ⇒ refused", A(anchorFor(s, { environmentId: "00000000-0000-0000-0000-000000000000" })) === "anchor_target_not_ai_staging");
  ok("B26 anchor → wrong Postgres ⇒ refused", A(anchorFor(s, { pgServiceId: "00000000-0000-0000-0000-000000000000" })) === "anchor_target_not_ai_staging");
  ok("B27 TEST-ONLY anchor in production ⇒ refused", A(anchorFor(s, { verifiedBy: "TEST-ONLY-x" })) === "anchor_test_only_refused");
  ok("B28 anchor with an extra key ⇒ refused", A({ ...anchorFor(s), extra: 1 }) === "anchor_malformed");
  ok("B29 every SECRET name is a distinct executor-attester name (none reuses a reader-attester name)", SECRET_ENV_NAMES.every((n) => n.startsWith("LIVE_AI_03B_EXECUTOR_ATTESTER_")));
}

// ═══════════ C — signing adapter (no caller signing/public-key override) ═══════════
{
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  ok("C01 non-Ed25519 key ⇒ refused", signer({ privateKeyPkcs8B64: rsa }).reason === "signing_key_not_ed25519");
  ok("C02 undecodable key ⇒ refused", signer({ privateKeyPkcs8B64: "not-a-key" }).reason === "signing_key_invalid");
  ok("C03 key ≠ configured public identity (override attempt) ⇒ refused", signer({ expectedPublicKeyDerB64: OTHER.der, expectedFingerprint: OTHER.fp }).reason === "signing_key_not_configured_identity");
  ok("C04 key == reader attester key ⇒ refused", signer({ readerAttesterFingerprint: EXK.fp }).reason === "signing_key_not_distinct_from_reader_attester");
  ok("C05 TEST-ONLY issuer outside the test boundary ⇒ refused", signer({ offlineTestBoundary: false }).reason === "issuer_test_only_refused");
  ok("C06 lifetime > max ⇒ refused", signer({ proofLifetimeMs: ATTESTATION_MAX_LIFETIME_MS + 1 }).reason === "proof_lifetime_invalid");
  const s = cleanState(); const m = await measure(s); const sg = signer().signer;
  const tgt = { projectId: AI_STAGING.projectId, environmentId: AI_STAGING.environmentId, pgServiceId: AI_STAGING.pgServiceId };
  ok("C07 caller-supplied privilege claim key (restricted_role_proof_present) ⇒ refused", sg.issue({ requestNonce: nonce32(), target: tgt, connection: m.ev.connection, privileges: { ...m.ev.privileges, restricted_role_proof_present: true } }).reason === "evidence_incomplete");
  ok("C08 malformed request nonce ⇒ refused", sg.issue({ requestNonce: "xyz", target: tgt, connection: m.ev.connection, privileges: m.ev.privileges }).reason === "request_nonce_invalid");
  ok("C09 non-executor connection role ⇒ refused", sg.issue({ requestNonce: nonce32(), target: tgt, connection: { ...m.ev.connection, role: "live_ai_03b_reader" }, privileges: m.ev.privileges }).reason === "evidence_incomplete");
  ok("C10 signer exposes no private key material", !JSON.stringify(sg).includes(EXK.pk8) && Object.keys(sg).sort().join(",") === "issue,issuer,keyId,proofLifetimeMs,publicKeyDerB64,test");
}

// ═══════════ D — evidence evaluation (session identity, observer, privilege drift) ═══════════
{
  const R = async (over, token) => (await measure(cleanState(over), token)).refused;
  const s0 = cleanState();
  ok("D01 no observed executor session ⇒ refused", await R({ sessions: [] }, tokenOf(s0.sessions[0])) === "no_executor_session_observed");
  ok("D02 token of no observed session (mismatch) ⇒ no_such_session", await R({}, "a".repeat(64)) === "no_such_session");
  { const s = cleanState(); s.sessions.push({ ...s.sessions[0] }); ok("D03 two sessions re-deriving the same token ⇒ ambiguous_session", (await measure(s)).refused === "ambiguous_session"); }
  { const s = cleanState(); s.sessions[0] = { ...s.sessions[0], usename: "live_ai_03b_reader" }; ok("D04 session of the WRONG role (reader) is never attested", (await measure(s, tokenOf(s.sessions[0]))).refused === "no_executor_session_observed"); }
  { const s = cleanState(); s.sessions[0].backend_start = null; ok("D05 backend_start not visible ⇒ refused", (await measure(s)).refused === "session_start_not_visible"); }
  { const s = cleanState(); s.sessions[0].application_name = ""; ok("D06 empty application name ⇒ never matched", (await measure(s, tokenOf({ ...s.sessions[0], application_name: "" }))).refused === "no_executor_session_observed"); }
  { const s = cleanState(); s.sessions[0].application_name = "lai03b-reader:abc"; ok("D07 application name not the executor prefix ⇒ refused", (await measure(s)).refused === "session_application_name_not_executor"); }
  { const s = cleanState(); s.sessions[0].datname = "otherdb"; ok("D08 session in a different database ⇒ refused", (await measure(s)).refused === "session_database_mismatch"); }
  ok("D09 observer is superuser ⇒ refused", await R({ observer: { is_superuser: true } }) === "observer_is_superuser");
  ok("D10 observer IS the executor ⇒ refused", await R({ observer: { current_user: EX, session_user: EX } }) === "observer_is_executor");
  ok("D11 observer IS the reader ⇒ refused", await R({ observer: { current_user: "live_ai_03b_reader", session_user: "live_ai_03b_reader" } }) === "observer_is_reader");
  ok("D12 observer member of the executor ⇒ refused", await R({ observer: { member_of_executor: true } }) === "observer_holds_executor_authority");
  ok("D13 observer member of the reader ⇒ refused", await R({ observer: { member_of_reader: true } }) === "observer_holds_reader_authority");
  ok("D14 observer without pg_read_all_stats ⇒ refused", await R({ observer: { has_read_all_stats: false } }) === "observer_lacks_session_visibility");
  ok("D15 observer extra membership ⇒ refused", await R({ observerMemberships: ["pg_read_all_stats", "pg_monitor"] }) === "observer_membership_not_least_privilege");
  ok("D16 observer CREATEROLE ⇒ refused", await R({ observer: { createrole: true } }) === "observer_overprivileged");
  ok("D17 observer SET ROLE'd (current ≠ session) ⇒ refused", await R({ observer: { session_user: "someone" } }) === "observer_identity_ambiguous");
  ok("D18 host/DB clock skew > 5 s ⇒ refused", await R({ dbSkewMs: 6000 }) === "attester_clock_skew");
  const DR = [
    ["executor superuser", { role: { rolsuper: true } }, "drift_superuser"], ["CREATEROLE", { role: { rolcreaterole: true } }, "drift_createrole"],
    ["CREATEDB", { role: { rolcreatedb: true } }, "drift_createdb"], ["REPLICATION", { role: { rolreplication: true } }, "drift_replication"],
    ["BYPASSRLS", { role: { rolbypassrls: true } }, "drift_bypassrls"], ["role membership", { memberships: ["live_ai_03b_reader"] }, "drift_role_membership"],
    ["prohibited role reachable", { prohibitedReachable: ["pg_write_all_data"] }, "drift_role_membership"],
    ["schema CREATE", { schemas: [...cleanState().schemas.slice(0, 2), { nspname: "public", usage: true, create: true, owner: false }] }, "drift_schema_create"],
    ["budget-table privilege", { relations: [{ nsp: "public", obj: "public.budget_decisions", sel: true }] }, "drift_budget_table_privilege"],
    ["budget sequence USAGE", { sequences: [{ nsp: "public", seq: "public.s", usage: true, upd: false, sel: false }] }, "drift_budget_table_privilege"],
    ["MAINTAIN (PG17+)", { maintain: [{ nsp: "public", obj: "public.budget_decisions" }] }, "drift_budget_table_privilege"],
    ["ledger privilege", { relations: [{ nsp: "live_ai_03b_trusted", obj: LEDGER(), ins: true }] }, "drift_ledger_privilege"],
    ["missing trusted-schema USAGE", { schemas: [{ nspname: "live_ai_03b_trusted", usage: true, create: false, owner: false }, { nspname: "public", usage: true, create: false, owner: false }] }, "drift_trusted_schema_usage"],
    ["extra trusted-schema USAGE", { schemas: [...cleanState().schemas, { nspname: "live_ai_03b_extra", usage: true, create: false, owner: false }] }, "drift_trusted_schema_usage"],
    ["unexpected schema USAGE", { schemas: [...cleanState().schemas, { nspname: "other", usage: true, create: false, owner: false }] }, "drift_unexpected_schema_usage"],
    ["missing expected routine", { routines: cleanState().routines.slice(1) }, "drift_routine_execute"],
    ["extra routine EXECUTE", { routines: [...cleanState().routines, "public.anything()"] }, "drift_routine_execute"],
    ["PUBLIC relation grant", { publicRelationGrants: [{ obj: "public.x", privilege_type: "SELECT" }] }, "drift_public_or_default_widening"],
    ["PUBLIC schema grant", { publicSchemaGrants: [{ nspname: "live_ai_03b_trusted", privilege_type: "USAGE" }] }, "drift_public_or_default_widening"],
    ["PUBLIC trusted routine", { publicTrustedRoutines: [{ routine: "live_ai_03b_trusted.activate_catalog" }] }, "drift_public_or_default_widening"],
    ["default ACL widening", { defaultAcl: [{ objtype: "r", nsp: "public", privilege_type: "SELECT", to_public: true }] }, "drift_public_or_default_widening"],
    ["database CREATE", { database: { create: true } }, "drift_owner_or_database_authority"], ["database owner", { database: { owner: true } }, "drift_owner_or_database_authority"],
    ["schema owner", { schemas: cleanState().schemas.map((x) => x.nspname === "public" ? { ...x, owner: true } : x) }, "drift_owner_or_database_authority"],
    ["owns objects", { owned: 2 }, "drift_owner_or_database_authority"],
    ["reviewed object absent", { objects: new Set() }, "reviewed_object_absent"],
    ["measurement incomplete (null attribute)", { role: { rolcreatedb: null } }, "privilege_measurement_incomplete"],
    ["executor role absent", { role: null }, "executor_role_absent"],
    ["executor cannot login", { role: { rolcanlogin: false } }, "executor_role_cannot_login"],
    ["evidence query failure", { failOn: "executorRoutines" }, "evidence_unavailable"],
  ];
  function LEDGER() { return "live_ai_03b_trusted.approval_consumption"; }
  for (const [label, over, want] of DR) { const s = cleanState(over); if (over.role === null) s.role = null; const r = (await measure(s)).refused; ok(`D drift — ${label} ⇒ ${want}`, r === want, r); }
  // ── R1: catch-all fail-closed mechanics (version / reviewed class set / unknown dependency) ──
  const R1C = async (over) => { const m = await measure(cleanState(over)); return { r: m.refused, ext: m.ev ? m.ev.context.extendedFindings : [], ev: m.ev }; };
  ok("DR01 PostgreSQL 17 (untested major) ⇒ server_version_unsupported", (await R1C({ serverVersionNum: 170005 })).r === "server_version_unsupported");
  ok("DR02 PostgreSQL 15 ⇒ server_version_unsupported", (await R1C({ serverVersionNum: 150010 })).r === "server_version_unsupported");
  ok("DR03 PostgreSQL 16 accepted (clean)", (await measure(cleanState({ serverVersionNum: 160013 }))).clean === true);
  ok("DR04 an UNREVIEWED ACL-bearing catalog column appears ⇒ privilege_class_coverage_incomplete (never skipped)",
    (await R1C({ aclCatalogs: [...cleanState().aclCatalogs, "pg_future_object.futacl"] })).r === "privilege_class_coverage_incomplete");
  ok("DR05 a reviewed ACL catalog missing ⇒ privilege_class_coverage_incomplete", (await R1C({ aclCatalogs: cleanState().aclCatalogs.slice(1) })).r === "privilege_class_coverage_incomplete");
  const sh = (extra) => cleanState({ shdepend: [...cleanState().shdepend, extra] });
  const SH = [
    ["unknown object class", { dbid: "16384", cls: "pg_future_object", objid: "1", objsubid: 0, deptype: "a", this_db: true, name: null }, /shdepend:a:pg_future_object/],
    ["ownership of anything ('o')", { dbid: "16384", cls: "pg_class", objid: "99", objsubid: 0, deptype: "o", this_db: true, name: null }, /shdepend:o:pg_class/],
    ["an object in ANOTHER database", { dbid: "5", cls: "pg_class", objid: "99", objsubid: 0, deptype: "a", this_db: false, name: null }, /other-db-or-shared/],
    ["a routine outside the reviewed 4", { dbid: "16384", cls: "pg_proc", objid: "77", objsubid: 0, deptype: "a", this_db: true, name: "public.x()" }, /shdepend:a:pg_proc:public\.x\(\)/],
    ["a policy naming the executor ('r')", { dbid: "16384", cls: "pg_policy", objid: "5", objsubid: 0, deptype: "r", this_db: true, name: null }, /shdepend:r:pg_policy/],
    ["an init-privilege entry ('i')", { dbid: "16384", cls: "pg_proc", objid: "6", objsubid: 0, deptype: "i", this_db: true, name: "live_ai_03b_trusted.activate_catalog(jsonb,text)" }, /shdepend:i:pg_proc/],
  ];
  for (const [label, extra, re] of SH) { const x = await R1C({ shdepend: sh(extra).shdepend }); ok(`DR shdepend catch-all — ${label} ⇒ refused as widening`, x.r === "drift_public_or_default_widening" && x.ext.some((f) => re.test(f)), x); }
  { const x = await R1C({ shdepend: [...cleanState().shdepend, { dbid: "0", cls: "pg_database", objid: "16384", objsubid: 0, deptype: "a", this_db: false, name: "railway" }], databaseGrants: [{ datname: "railway", privilege_type: "CONNECT" }] });
    ok("DR12 explicit CONNECT grant on THIS database is reviewed (clean)", x.r === undefined, x); }
  { const x = await R1C({ shdepend: [...cleanState().shdepend, { dbid: "0", cls: "pg_database", objid: "16384", objsubid: 0, deptype: "a", this_db: false, name: "railway" }], databaseGrants: [{ datname: "railway", privilege_type: "CREATE" }] });
    ok("DR13 explicit CREATE grant on THIS database ⇒ refused", x.r === "drift_public_or_default_widening" && x.ext.some((f) => /database-grant:railway:CREATE/.test(f)), x); }
  { const x = await R1C({ extendedEffective: ["tablespace-create:x"] }); const e = x.ev;
    const f = signer().signer.issue({ requestNonce: "0".repeat(32), target: { projectId: AI_STAGING.projectId, environmentId: AI_STAGING.environmentId, pgServiceId: AI_STAGING.pgServiceId }, connection: e.connection, privileges: e.privileges });
    const v = verifyExecutorAttestation(f.envelope, { trustRoot: TR, expectedConnectionToken: e.connection.token, expectedRequestNonce: "0".repeat(32), now: Date.now() });
    ok("DR14 every extended finding is folded into the SIGNED field ⇒ a force-signed copy fails the PRESERVED verifier", e.privileges.publicOrDefaultPrivilegeWidening === true && v.reason === "executor_drift_public_or_default_widening", v); }
  const obs = (await establishExecutorObserverSession(syntheticPhysical(cleanState()))).observer;
  let threw = null; try { await obs.evidence("SELECT * FROM public.budget_decisions", []); } catch (e) { threw = e.message; }
  ok("D30 arbitrary SQL through the observer ⇒ refused before reaching the driver", threw === "evidence_sql_not_permitted");
  threw = null; try { await obs.evidence(XQ.executorRole, ["x".repeat(200)]); } catch (e) { threw = e.message; }
  ok("D31 oversize/unbounded parameter ⇒ refused", threw === "evidence_params_invalid");
  { const s = cleanState(); s.setup.readOnly = "off"; const p = syntheticPhysical(s); const q = p.query.bind(p);
    const bad = { ...p, query: (sql, pr) => sql.includes("default_transaction_read_only') AS v") && sql.startsWith("SELECT current_setting") ? Promise.resolve({ rows: [{ v: "off" }] }) : q(sql, pr) };
    ok("D32 observer session not read-only (read back) ⇒ refused", (await establishExecutorObserverSession(bad)).reason === "observer_read_only_unverified"); }
}

// ═══════════ E — channel protocol (loopback only, synthetic observer) ═══════════
const LOOP = { bindHost: "127.0.0.1", port: 0, allowedPeerCidrs: ["127.0.0.1/32"] };
async function withServer(state, fn, over = {}) {
  const sg = over.signer || signer({ nowProvider: state.now }).signer;
  const anchor = parseExecutorDeploymentAnchor(JSON.stringify(anchorFor(state, { verifiedBy: "TEST-ONLY-x" })), { offlineTestBoundary: true }).anchor;
  const srv = await startExecutorAttestationServer({ channelSecret: CH_SECRET, listen: over.listen || LOOP, signer: sg, anchor, nowProvider: state.now, log: over.log,
    observerProvider: async () => establishExecutorObserverSession(syntheticPhysical(state)), offlineTestBoundary: true, ...(over.requestBudgetMs ? { requestBudgetMs: over.requestBudgetMs } : {}) });
  try { return await fn(srv); } finally { await srv.close(); }
}
function raw(port, obj) {
  return new Promise((res) => { const sock = net.createConnection({ host: "127.0.0.1", port }); let b = "";
    sock.on("connect", () => sock.write((typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n")); sock.on("data", (d) => { b += d; }); sock.on("end", () => { try { res(JSON.parse(b)); } catch { res({ raw: b }); } }); sock.on("error", () => res({ err: true })); });
}
const req = (args, over = {}) => { const v = over.v || EXECUTOR_CHANNEL_VERSION, op = over.op || EXECUTOR_CHANNEL_OP, nonce = over.nonce || randomBytes(16).toString("hex"), ts = over.ts || Date.now();
  return { v, op, args, nonce, ts, mac: executorChannelMac(over.secret || CH_SECRET, v, op, args, nonce, ts), ...(over.extra || {}) }; };
{
  const s = cleanState(); const tok = tokenOf(s.sessions[0]);
  const goodArgs = () => ({ connectionToken: tok, contract: "AiStagingExecutorAttestationV1", requestNonce: nonce32(), role: EX });
  const LOGS = [];
  await withServer(s, async (srv) => {
    const port = srv.address.port;
    const ch = createExecutorAttestationSourceChannel({ host: "127.0.0.1", port, channelSecret: CH_SECRET }, { offlineTestBoundary: true });
    const n = nonce32(); const env = await ch.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: tok, role: EX, requestNonce: n });
    ok("E01 channel obtain() → envelope → PRESERVED verifier PASS", verifyExecutorAttestation(env, { trustRoot: TR, expectedConnectionToken: tok, expectedRequestNonce: n, now: Date.now() }).ok === true);
    const W = async (o) => (await raw(port, o)).code;
    ok("E02 malformed JSON ⇒ bad_request", await W("{nope") === "bad_request");
    ok("E03 extra top-level field ⇒ bad_request", await W(req(goodArgs(), { extra: { privileges: {} } })) === "bad_request");
    ok("E04 READER channel version ⇒ unsupported_version", await W(req(goodArgs(), { v: READER_CHANNEL_VERSION })) === "unsupported_version");
    ok("E05 unknown op ⇒ unknown_op", await W(req(goodArgs(), { op: "attest" })) === "unknown_op");
    ok("E06 stale ts (−60 s) ⇒ stale", await W(req(goodArgs(), { ts: Date.now() - 60000 })) === "stale");
    ok("E07 future ts (+60 s) ⇒ stale", await W(req(goodArgs(), { ts: Date.now() + 60000 })) === "stale");
    ok("E08 wrong channel secret ⇒ unauthenticated", await W(req(goodArgs(), { secret: "x".repeat(40) })) === "unauthenticated");
    ok("E09 READER channel secret ⇒ unauthenticated (no cross-plane secret)", await W(req(goodArgs(), { secret: READER_CH_SECRET })) === "unauthenticated");
    { const r1 = req(goodArgs()); await raw(port, r1); ok("E10 replayed channel nonce ⇒ replayed", await W(r1) === "replayed"); }
    for (const [k, v] of [["privileges", { rolsuper: false }], ["target", { projectId: AI_STAGING.projectId }], ["issuer", "TEST-ONLY-x"], ["publicKeyDerB64", OTHER.der],
      ["keyId", OTHER.fp], ["expiresAtMs", Date.now() + 999999], ["issuedAtMs", Date.now()], ["sql", "SELECT 1"], ["dbUrl", "postgresql://x@y/z"], ["expectedPrivileges", {}], ["signingKey", "k"]]) {
      ok(`E11 caller-supplied '${k}' in args ⇒ bad_request`, await W(req({ ...goodArgs(), [k]: v })) === "bad_request");
    }
    ok("E12 reader contract requested ⇒ bad_request", await W(req({ ...goodArgs(), contract: "AiStagingReaderAttestationV1" })) === "bad_request");
    ok("E13 reader role requested ⇒ bad_request", await W(req({ ...goodArgs(), role: "live_ai_03b_reader" })) === "bad_request");
    ok("E14 malformed token ⇒ bad_request", await W(req({ ...goodArgs(), connectionToken: "zz" })) === "bad_request");
    ok("E15 malformed request nonce ⇒ bad_request", await W(req({ ...goodArgs(), requestNonce: "zz" })) === "bad_request");
    ok("E16 oversize request ⇒ bad_request", await W(req({ ...goodArgs(), pad: "x".repeat(4000) })) === "bad_request");
    ok("E17 token of no session ⇒ no_such_session (no envelope)", await W(req({ ...goodArgs(), connectionToken: "b".repeat(64) })) === "no_such_session");
    ok("E18 server counters: signed == 2 (E01 + the first, valid E10 request), selfVerifyFailed == 0", srv.stats().signed === 2 && srv.stats().selfVerifyFailed === 0, srv.stats());
  }, { log: (l) => LOGS.push(l) });
  ok("E19 request log lines carry only {ok, code, ms} (no token, nonce, secret, envelope)", LOGS.length > 0 && LOGS.every((l) => { const o = JSON.parse(l); return Object.keys(o).every((k) => ["executorAttester", "ok", "code", "ms"].includes(k)); }));
  // drift during service
  { const s2 = cleanState({ relations: [{ nsp: "public", obj: "public.budget_decisions", sel: true }] });
    const r = await withServer(s2, async (srv) => raw(srv.address.port, req({ connectionToken: tokenOf(s2.sessions[0]), contract: "AiStagingExecutorAttestationV1", requestNonce: nonce32(), role: EX })));
    ok("E20 adverse state ⇒ unavailable, no envelope (never signed)", r.ok === false && r.code === "unavailable" && !("envelope" in r)); }
  { const s3 = cleanState(); s3.sessions.push({ ...s3.sessions[0] });
    const r = await withServer(s3, async (srv) => raw(srv.address.port, req({ connectionToken: tokenOf(s3.sessions[0]), contract: "AiStagingExecutorAttestationV1", requestNonce: nonce32(), role: EX })));
    ok("E21 ambiguous session ⇒ no_such_session", r.code === "no_such_session"); }
  { const s4 = cleanState({ stallOn: "executorRelations" });
    const r = await withServer(s4, async (srv) => { const x = await raw(srv.address.port, req({ connectionToken: tokenOf(s4.sessions[0]), contract: "AiStagingExecutorAttestationV1", requestNonce: nonce32(), role: EX })); return { x, st: srv.stats() }; }, { requestBudgetMs: 400 });
    ok("E22 stalled evidence ⇒ deadline, unavailable, signed == 0", r.x.code === "unavailable" && r.st.signed === 0, r); }
  { // CONFORMANCE GATE: a signer whose output the PRESERVED verifier rejects is never released
    const good = signer({ nowProvider: s.now }).signer;
    const evil = Object.freeze({ ...good, issue: (a) => { const e = good.issue(a); if (e.ok) e.envelope.payload.privileges.budgetTablePrivilegeCount = 5; return e; } });
    const r = await withServer(s, async (srv) => { const x = await raw(srv.address.port, req({ connectionToken: tok, contract: "AiStagingExecutorAttestationV1", requestNonce: nonce32(), role: EX })); return { x, st: srv.stats() }; }, { signer: evil });
    ok("E23 envelope the PRESERVED verifier rejects ⇒ internal, never released (conformance gate)", r.x.ok === false && r.x.code === "internal" && r.st.selfVerifyFailed === 1 && r.st.signed === 0, r); }
  { const r = await withServer(s, async (srv) => raw(srv.address.port, req({ connectionToken: tok, contract: "AiStagingExecutorAttestationV1", requestNonce: nonce32(), role: EX })), { listen: { bindHost: "127.0.0.1", port: 0, allowedPeerCidrs: ["10.20.3.0/24"] } });
    ok("E24 peer outside the allowlist ⇒ unauthenticated", r.code === "unauthenticated"); }
  let threw = null; try { await startExecutorAttestationServer({ channelSecret: CH_SECRET, listen: LOOP, signer: signer().signer, anchor: {}, observerProvider: async () => ({}), offlineTestBoundary: false }); } catch (e) { threw = e.message; }
  ok("E25 TEST-ONLY signer outside the test boundary ⇒ server refuses to start", threw === "executor_attester_test_signer_refused");
  // cross-plane: the ACCEPTED reader attester server refuses the executor protocol; the ACCEPTED reader client refuses the executor contract
  const rsrv = await startReaderAttestationServer({ channelSecret: READER_CH_SECRET, listen: LOOP, signer: { issue: () => ({ ok: false }) }, anchor: {}, observerProvider: async () => ({ ok: false, reason: "x" }), log: () => {}, offlineTestBoundary: true });
  try {
    const ch = createExecutorAttestationSourceChannel({ host: "127.0.0.1", port: rsrv.address.port, channelSecret: READER_CH_SECRET }, { offlineTestBoundary: true });
    let code = null; try { await ch.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: tok, role: EX, requestNonce: nonce32() }); } catch (e) { code = e.attesterCode; }
    ok("E26 ACCEPTED reader attester (unmodified) refuses the executor channel ⇒ unsupported_version", code === "unsupported_version");
  } finally { await rsrv.close(); }
  const rc = createAttestationSourceChannel({ host: "127.0.0.1", port: 1, channelSecret: READER_CH_SECRET }, { offlineTestBoundary: true });
  let rcode = null; try { await rc.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: tok, role: EX, requestNonce: nonce32() }); } catch (e) { rcode = e.code; }
  ok("E27 ACCEPTED reader channel client refuses an executor request (contract/role)", rcode === "attester_request_invalid");
  // client-side configuration
  const C = (cfg, o) => createExecutorAttestationSourceChannel(cfg, o).reason;
  ok("E28 client: public destination ⇒ refused", C({ host: "8.8.8.8", port: 8551, channelSecret: CH_SECRET }) !== undefined);
  ok("E29 client: loopback outside test boundary ⇒ refused", C({ host: "127.0.0.1", port: 8551, channelSecret: CH_SECRET }) !== undefined);
  ok("E30 client: short secret ⇒ refused", C({ host: "executor-attester.railway.internal", port: 8551, channelSecret: "short" }) === "executor_attester_channel_secret_invalid");
  ok("E31 client: channel secret == reader channel secret ⇒ refused", C({ host: "executor-attester.railway.internal", port: 8551, channelSecret: CH_SECRET, readerChannelSecret: CH_SECRET }) === "executor_attester_channel_secret_reuses_reader");
  const okc = createExecutorAttestationSourceChannel({ host: "executor-attester.railway.internal", port: 8551, channelSecret: CH_SECRET });
  let c2 = null; try { await okc.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: tok, role: EX, requestNonce: nonce32(), privileges: {} }); } catch (e) { c2 = e.code; }
  ok("E32 client: extra request field ⇒ refused before any connection", okc.ok === true && c2 === "executor_attester_request_invalid");
}

// ═══════════ F — entrypoint: fail-closed startup, no test leakage, no secret logging ═══════════
{
  const s = cleanState();
  let opens = 0; const spyFactory = { kind: "spy", async open() { opens++; return syntheticPhysical(s); } };
  const L = []; const log = (l) => L.push(l);
  const P = (o) => startExecutorAttesterService({ env: baseEnv(s), log, ...o });
  for (const k of ["observerFactory", "nowProvider", "offlineTestBoundary", "testListen", "requestBudgetMs", "watchMs"]) {
    const r = await P({ [k]: k === "observerFactory" ? spyFactory : 1 });
    ok(`F01 production refuses test injection '${k}'`, r.started === false && r.reason === "test_injection_refused_in_production");
  }
  ok("F02 invalid mode ⇒ refused", (await P({ mode: "dev" })).reason === "mode_invalid");
  ok("F03 offline mode without explicit boundary ⇒ refused", (await startExecutorAttesterService({ mode: "offline-test", env: testEnv(s), log })).reason === "offline_test_boundary_required");
  const O = (env, o = {}) => startExecutorAttesterService({ mode: "offline-test", offlineTestBoundary: true, env, log, observerFactory: spyFactory, ...o });
  const F = [
    ["signing key absent", { [ENV.signingKeyPkcs8B64]: "" }, "executor_attester_config_incomplete"],
    ["observer credential absent", { [ENV.observerDbUrl]: "" }, "executor_attester_config_incomplete"],
    ["issuer invalid", { [ENV.issuer]: "bad issuer!" }, "issuer_invalid"],
    ["target anchor invalid (CORE-PROD)", { [ENV.deploymentAnchor]: JSON.stringify(anchorFor(s, { projectId: "04c8b523-5b15-4d81-af06-8c2aa1a83499" })) }, "anchor_targets_core_prod"],
    ["channel secret absent", { [ENV.channelSecret]: "" }, "executor_attester_config_incomplete"],
    ["bind policy invalid (public)", { [ENV.bindHost]: "8.8.8.8" }, "listen_bind_not_private"],
    ["foreign executor credential", { LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "postgresql://x" }, "foreign_credential_present"],
    ["foreign reader credential", { LIVE_AI_03B_TRUSTED_READER_DB_URL: "postgresql://x" }, "foreign_credential_present"],
    ["gateway-store credential", { LIVE_AI_03B_STAGING_DATABASE_URL: "postgresql://x" }, "foreign_credential_present"],
    ["provider key", { OPENAI_API_KEY: "sk-x" }, "foreign_credential_present"],
    ["CORE credential", { CORE_DATABASE_URL: "postgresql://x" }, "foreign_credential_present"],
    ["reviewer private key", { LIVE_AI_03B_REVIEWER_PRIVATE_KEY: "x" }, "foreign_credential_present"],
    ["reader-attester signing key", { LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64: RDK.pk8 }, "foreign_credential_present"],
    ["key ≠ configured identity", { [ENV.publicKeyDerB64]: OTHER.der, [ENV.fingerprint]: OTHER.fp }, "signing_key_not_configured_identity"],
  ];
  for (const [label, over, want] of F) { const before = opens; const r = await O(testEnv(s, over)); ok(`F04 fail closed — ${label} ⇒ ${want}, 0 observer connections`, r.started === false && r.reason === want && opens === before, r.reason); }
  ok("F05 production: TEST-ONLY issuer refused before any I/O", (await startExecutorAttesterService({ env: testEnv(s), log })).reason === "issuer_test_only_refused");
  const r = await O(testEnv(s), { testListen: { bindHost: "127.0.0.1", port: 0, allowedPeerCidrs: ["127.0.0.1/32"] }, requestLog: log });
  ok("F06 offline-test service starts with synthetic observer + loopback test listener", r.started === true, r.reason);
  if (r.started) {
    const ch = createExecutorAttestationSourceChannel({ host: "127.0.0.1", port: r.address.port, channelSecret: CH_SECRET }, { offlineTestBoundary: true });
    const n = nonce32(); const env = await ch.source.obtain({ contract: "AiStagingExecutorAttestationV1", connectionToken: tokenOf(s.sessions[0]), role: EX, requestNonce: n });
    ok("F07 service envelope → PRESERVED verifier PASS", verifyExecutorAttestation(env, { trustRoot: TR, expectedConnectionToken: tokenOf(s.sessions[0]), expectedRequestNonce: n, now: Date.now() }).ok === true);
    await r.stop();
  }
  ok("F08 non-loopback test listener refused even in offline mode", (await O(testEnv(s), { testListen: { bindHost: "0.0.0.0", port: 0, allowedPeerCidrs: ["127.0.0.1/32"] } })).reason === "test_listen_not_loopback");
  const cli = spawnSync(process.execPath, [join(PKG, "src/executor-attester-entrypoint.mjs")], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  ok("F09 CLI with no configuration ⇒ exit 70 (unprovisioned), no listener", cli.status === 70 && /"status":"unprovisioned"/.test(cli.stdout));
  const secrets = [CH_SECRET, EXK.pk8, OBS_URL, READER_CH_SECRET, RDK.pk8, OBS_URL.split("@")[0]];
  const all = [...L, ...CAPTURED, cli.stdout, cli.stderr].join("\n");
  ok("F10 no secret value (channel secret, signing key, observer URL/password) in any log line", secrets.every((x) => !all.includes(x)));
}

// ═══════════ G — static trust-boundary scans + frozen non-regression ═══════════
{
  const SRC = join(PKG, "src"); const files = readdirSync(SRC).filter((f) => f.endsWith(".mjs"));
  const imports = files.flatMap((f) => [...readFileSync(join(SRC, f), "utf8").matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => [f, m[1]]));
  ok("G01 src imports only node: builtins, ./ modules and frozen accepted packages (never tests/ or fixtures)", imports.every(([, p]) => p.startsWith("node:") || p.startsWith("./")
    || /^\.\.\/\.\.\/(trusted-activation-boundary-01|private-reader-production-integration-offline-01|private-reader-host-runtime-offline-01|private-reader-attester-offline-01|m7-v2-production-authority-provisioning-offline-01|m7-step2-runtime-rebinding-offline-01)\//.test(p)), imports.filter(([, p]) => !p.startsWith("node:") && !p.startsWith("./")).map((x) => x[1]));
  const srcAll = files.map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
  ok("G02 no eval / new Function / dynamic import other than the lazy pg driver", !/\beval\s*\(|new Function/.test(srcAll) && [...srcAll.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].every((m) => m[1] === "pg"));
  ok("G03 no network API in src (fetch/http/https/dgram)", !/\bfetch\s*\(|node:https?|node:dgram|node:tls/.test(srcAll));
  ok("G04 registry: every statement is a read-only SELECT/WITH (no DML/DDL/GRANT/SET ROLE)", ALLOWED_EXECUTOR_SQL.every((q) => /^(SELECT |WITH (RECURSIVE )?[a-z]+(\([a-z]+\))? AS \()/.test(q) && !/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|SET ROLE|COPY)\b/.test(q.replace(/'[^']*'/g, "''"))));
  ok("G05 registry never selects pg_stat_activity query text or client address", !ALLOWED_EXECUTOR_SQL.some((q) => /a\.query\b|client_addr/.test(q)));
  ok("G06 registry values are parameterised ($n); nothing is interpolated from a request", !/\$\{/.test(readFileSync(join(SRC, "executor-evidence-queries.mjs"), "utf8").replace(/const USER_NS[^\n]*/, "").replace(/" \+ USER_NS \+ "/g, "")));
  ok("G07 isPermittedExecutorSql refuses non-registry text", isPermittedExecutorSql("SELECT 1") === false && isPermittedExecutorSql(XQ.dbClock) === true);
  ok("G08 only the entrypoint reads process.env (default); secret values read only at point of use", files.filter((f) => /process\.env/.test(readFileSync(join(SRC, f), "utf8"))).join(",") === "executor-attester-entrypoint.mjs");
  ok("G09 src never logs env values (only issuer/keyId/port/reason)", !/log\w*\([^)]*env\[/.test(srcAll));
  const diff = spawnSync("git", ["-C", REPO, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
    .filter((l) => !l.includes("scripts/live-ai-03b/m7-v2-executor-attester-issuer-offline-01/"));
  ok("G10 no file outside the new package changed (reader attester, M5, integration, authority package, Step-2 all untouched)", diff.length === 0, diff.slice(0, 5));
  const head = spawnSync("git", ["-C", REPO, "rev-parse", "HEAD", "HEAD:scripts/live-ai-03b/m7-v2-production-authority-provisioning-offline-01", "HEAD:scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01"], { encoding: "utf8" }).stdout.split("\n");
  ok("G11 baseline dcab7c5b; authority package tree c22ca7cf; Step-2 tree bacac441", head[0] === "dcab7c5b8884db4826d3fc9188ae042a1ed298d6" && head[1] === "c22ca7cf4b67aaa374016e3da5827ca121d26726" && head[2] === "bacac441271856966c9b7983c4fa1625f7a6a2d2", head);
  ok("G12 PRESERVED authority config still refuses a shared reader/executor channel secret (compatibility unchanged)", typeof loadProvisioningConfig === "function");
}

// ═══════════ K — network counter ═══════════
ok("K01 zero non-loopback network: every socket connect was 127.0.0.1 and fetch was never called", NET.fetch === 0 && NET.connects.every((h) => h === "127.0.0.1"), { fetch: NET.fetch, hosts: [...new Set(NET.connects)] });
{ const lo = NET.connects.filter((h) => h === "127.0.0.1").length, ux = NET.connects.filter((h) => h === "unix").length;
  out(`  (network counters: loopback_socket_connects=${lo} unix_socket_connects=${ux} external_network_connects=${NET.connects.length - lo - ux} fetch_calls=${NET.fetch})`); }
out(`m7-v2-executor-attester: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
