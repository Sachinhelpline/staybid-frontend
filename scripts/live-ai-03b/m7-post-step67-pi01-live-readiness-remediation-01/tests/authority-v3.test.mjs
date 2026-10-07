// OFFLINE tests — deployable Authority V3 (config, composition, binding, standby, catalog expiry). No network, no DB.
import { counter, authorityEnv, netCounter, readerAnchor, edKey, hexSecret } from "./_h.mjs";
import { loadAuthorityV3Config, REQUIRED_AUTHORITY_V3_NAMES, EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV, DEPLOYMENT_ANCHOR_ENV, DB_ENV, V3_REQUIRED_ENV } from "../src/authority-v3-config.mjs";
import { composeAuthorityV3, acquireReaderAttestationProviderV3 } from "../src/authority-v3-composition.mjs";
import { standbyStatusV3, catalogWindow, CATALOG_VERIFICATION_EXPIRY } from "../src/authority-v3-standby-entrypoint.mjs";
import { PINNED_RUNTIME_BINDING, PINNED_SUCCESSOR_RUNTIME_PIN_REF, checkPinnedRuntimeBinding } from "../../m7-post-step67-production-integration-01-runtime-01/src/runtime-preservation-binding.mjs";
import { createV3ProductionIntegrationCore } from "../../m7-post-step67-production-integration-01-runtime-01/src/v3-integration-core.mjs";
import { validateRuntimePreservationBinding } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-identity.mjs";
import { checkV3Catalog, reviewedV3Rows } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-catalog-contract.mjs";
import { FIXED_V3 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs";

const { ok, done } = counter("authority-v3");
const R = (over) => loadAuthorityV3Config(authorityEnv(over).env).reason;

// ── A. configuration validation ──
{ const { env } = authorityEnv(); const c = loadAuthorityV3Config(env);
  ok("A01 complete synthetic V3 env ⇒ config ok, executor trust root = R3 V2 issuer", c.ok === true && c.executorAttester.trustRoot.issuer === "staybid.live-ai-03b.executor-attester.v2", c.reason);
  ok("A02 23 required names (V3 runtime + DB refs + anchor + both attesters)", REQUIRED_AUTHORITY_V3_NAMES.length === 23, REQUIRED_AUTHORITY_V3_NAMES.length);
  ok("A03 config output carries NO secret value (DB URLs + channel secrets absent from JSON)", !JSON.stringify(c).includes(env[DB_ENV.executorDbUrl]) && !JSON.stringify(c).includes(env[EXECUTOR_ATTESTER_ENV.channelSecret]) && !JSON.stringify(c).includes(env[READER_ATTESTER_ENV.channelSecret])); }
for (const n of REQUIRED_AUTHORITY_V3_NAMES) {
  const { env } = authorityEnv(); delete env[n];
  const c = loadAuthorityV3Config(env);
  ok("A04 missing " + n + " ⇒ startup fail-closed", c.ok === false && c.reason === "authority_v3_config_incomplete" && c.missing.includes(n), c.reason);
}
ok("A05 runtime contract V2 ⇒ refused (V3 contract version refusal)", R({ [V3_REQUIRED_ENV.version]: "V2" }) === "runtime_config_v3_runtime_contract_not_v3");
ok("A06 runtime contract V1 ⇒ refused", R({ [V3_REQUIRED_ENV.version]: "V1" }) === "runtime_config_v3_runtime_contract_not_v3");
ok("A07 runtime contract lowercase v3 ⇒ refused", R({ [V3_REQUIRED_ENV.version]: "v3" }) === "runtime_config_v3_runtime_contract_not_v3");
ok("A08 connection identity proof ref = a V1-era issuer ⇒ refused", R({ [V3_REQUIRED_ENV.connectionRef]: "staybid.live-ai-03b.executor-attester.v1" }) === "runtime_config_v3_connection_identity_ref_not_executor_attester_v2");
ok("A09 executor attester issuer = V1-era string ⇒ refused (no V1 trust root)", R({ [EXECUTOR_ATTESTER_ENV.issuer]: "staybid.live-ai-03b.executor-attester.v1" }) === "executor_attester_issuer_not_v2");
ok("A10 executor attester issuer = arbitrary owner string ⇒ refused", R({ [EXECUTOR_ATTESTER_ENV.issuer]: "owner-executor-attester-01" }) === "executor_attester_issuer_not_v2");
ok("A11 TEST-ONLY executor issuer in production ⇒ refused", R({ [EXECUTOR_ATTESTER_ENV.issuer]: "TEST-ONLY-x" }) === "executor_trust_root_test_issuer_refused");
ok("A12 executor fingerprint ≠ key ⇒ refused", R({ [EXECUTOR_ATTESTER_ENV.fingerprint]: "0".repeat(64) }) === "executor_trust_root_fingerprint_mismatch");
ok("A13 executor attester literal private IP destination ⇒ refused (must be *.railway.internal)", R({ [EXECUTOR_ATTESTER_ENV.host]: "10.1.2.3" }) === "executor_attester_host_not_railway_internal");
ok("A14 executor attester loopback ⇒ refused in production", /^executor_/.test(R({ [EXECUTOR_ATTESTER_ENV.host]: "127.0.0.1" }) || ""));
ok("A15 executor attester public host ⇒ refused", /^executor_/.test(R({ [EXECUTOR_ATTESTER_ENV.host]: "example.com" }) || ""));
ok("A16 reader attester not railway internal ⇒ refused", R({ [READER_ATTESTER_ENV.host]: "10.9.9.9" }) === "reader_attester_host_not_railway_internal");
{ const { env } = authorityEnv(); env[DB_ENV.readerDbUrl] = env[DB_ENV.executorDbUrl]; ok("A17 executor and reader share a DB credential ⇒ refused", loadAuthorityV3Config(env).reason === "executor_and_reader_share_a_credential"); }
{ const { env } = authorityEnv(); env[READER_ATTESTER_ENV.channelSecret] = env[EXECUTOR_ATTESTER_ENV.channelSecret]; ok("A18 executor and reader channel secret reused ⇒ refused", loadAuthorityV3Config(env).reason === "attester_channel_secret_reused"); }
{ const { env } = authorityEnv(); env[READER_ATTESTER_ENV.publicKeyDerB64] = env[EXECUTOR_ATTESTER_ENV.publicKeyDerB64]; env[READER_ATTESTER_ENV.fingerprint] = env[EXECUTOR_ATTESTER_ENV.fingerprint];
  ok("A19 reader attester key == executor attester key ⇒ refused", loadAuthorityV3Config(env).reason === "reader_and_executor_attester_key_shared"); }
ok("A20 reader attester issuer == V2 executor issuer ⇒ refused", R({ [READER_ATTESTER_ENV.issuer]: "staybid.live-ai-03b.executor-attester.v2" }) === "reader_and_executor_attester_issuer_shared");
ok("A21 short executor channel secret ⇒ refused", /^executor_/.test(R({ [EXECUTOR_ATTESTER_ENV.channelSecret]: "short" }) || ""));
ok("A22 forbidden secret class present (OPENAI_API_KEY) ⇒ refused", R({ OPENAI_API_KEY: "x" }) === "forbidden_secret_class_present");
ok("A23 forbidden secret class present (CORE_DATABASE_URL) ⇒ refused", R({ CORE_DATABASE_URL: "x" }) === "forbidden_secret_class_present");
ok("A24 anchor targets CORE-PROD ⇒ refused", R({ [DEPLOYMENT_ANCHOR_ENV]: readerAnchor({ projectId: FIXED_V3.core_excluded_project }) }) === "reader_v2_anchor_targets_core_prod");
ok("A25 anchor wrong environment ⇒ refused", R({ [DEPLOYMENT_ANCHOR_ENV]: readerAnchor({ environmentId: "00000000-0000-0000-0000-000000000000" }) }) === "reader_v2_anchor_target_not_ai_staging");
ok("A26 AI-STAGING project id mismatch ⇒ refused", R({ [V3_REQUIRED_ENV.project]: FIXED_V3.core_excluded_project }) === "runtime_config_v3_target_mismatch:project");
ok("A27 gateway service id mismatch ⇒ refused", R({ [V3_REQUIRED_ENV.gateway]: "00000000-0000-0000-0000-000000000000" }) === "runtime_config_v3_target_mismatch:gateway");
ok("A28 reviewer fingerprint mismatch ⇒ refused", R({ [V3_REQUIRED_ENV.reviewerFp]: "0".repeat(64) }) === "runtime_config_v3_reviewer_fingerprint_mismatch");

// ── B. composition (no I/O, accepted PI01 boundary unchanged, never invoked) ──
{ const n = netCounter(); let c; try { c = composeAuthorityV3({ env: authorityEnv().env }); } finally { n.restore(); }
  ok("B01 composeAuthorityV3 ⇒ accepted PI01 boundary available, mode production", c.available === true && c.mode === "production", c.reason);
  ok("B02 successor runtime pin ref == accepted 78804a86…", c.successorRuntimePinRef === "78804a8648e684bcdfb7d52dd34463310dec43c592fb2530216be19a04bc203d");
  ok("B03 composition performed ZERO network connects", n.seen.length === 0, n.seen);
  ok("B04 the boundary is the accepted one-shot object (run is a function; not invoked)", typeof c.boundary.run === "function" && Object.isFrozen(c.boundary)); }
ok("B05 composeAuthorityV3 rejects injected dependencies", composeAuthorityV3({ env: authorityEnv().env, executorPhysicalFactory: {} }).reason === "authority_v3_rejects_injection");
ok("B06 composeAuthorityV3 with V2-era contract ⇒ unavailable (fail closed)", composeAuthorityV3({ env: authorityEnv({ [V3_REQUIRED_ENV.version]: "V2" }).env }).available === false);
ok("B07 composeAuthorityV3 with no env ⇒ unavailable", composeAuthorityV3({}).available === false);

// ── C. runtime preservation binding refusal (accepted PI01 + frozen R3) ──
ok("C01 pinned binding passes PI01 + R3 checks", checkPinnedRuntimeBinding(PINNED_RUNTIME_BINDING).ok === true && validateRuntimePreservationBinding(PINNED_RUNTIME_BINDING).ok === true);
for (const [k, v] of [["commit", "0".repeat(40)], ["tree", "1".repeat(40)], ["runtime_digest", "2".repeat(64)], ["parent", "3".repeat(40)], ["contract", "X"]]) {
  ok("C02 binding with altered " + k + " ⇒ refused", checkPinnedRuntimeBinding({ ...PINNED_RUNTIME_BINDING, [k]: v }).ok === false);
}
{ const deps = { clock: { bindToDbClock() {}, nowMs() {}, nowIso() {} }, env: {}, establishExecutorSession() {}, establishReaderSession() {}, executorAttestationSource: { obtain() {} },
    executorPhysicalFactory: { open() {} }, executorTrustRoot: {}, readerAttestationProvider: { obtain() {} }, readerPhysicalFactory: { open() {} }, readerTrustRoot: {},
    runtime: { validateRuntimePreservationBinding, runtimePinRef: () => PINNED_SUCCESSOR_RUNTIME_PIN_REF }, bindReaderConnection() {} };
  const c = createV3ProductionIntegrationCore({ ...deps, runtimePreservationBinding: { ...PINNED_RUNTIME_BINDING, commit: "0".repeat(40) } });
  ok("C03 accepted PI01 core refuses an altered runtime binding before any I/O", c.available === false && /runtime_binding_pin_mismatch:commit/.test(c.reason), c.reason); }

// ── D. standby (start command) — no activation on startup ──
{ const n = netCounter(); let s; try { s = standbyStatusV3(authorityEnv().env, { nowMs: Date.parse("2026-10-08T00:00:00Z") }); } finally { n.restore(); }
  ok("D01 standby composes the PI01 boundary under a complete env", s.composed === true && s.reason === null, s);
  ok("D02 standby never activates: activationInvoked=false, listener=false, dbConnections=0, attesterRequests=0",
    s.activationInvoked === false && s.listener === false && s.dbConnections === 0 && s.attesterRequests === 0);
  ok("D03 standby performed ZERO network connects", n.seen.length === 0, n.seen);
  ok("D04 standby reports V2-only executor contract, v1Fallback=false", s.executorAttestationContract === "AiStagingExecutorAttestationV2" && s.v1Fallback === false);
  ok("D05 standby status line contains no secret value", !/postgresql:\/\//.test(JSON.stringify(s))); }
{ const s = standbyStatusV3({}, { nowMs: Date.parse("2026-10-08T00:00:00Z") });
  ok("D06 standby with empty env ⇒ composed=false (fail-closed standby), still no activation", s.composed === false && s.reason === "authority_v3_config_incomplete" && s.activationInvoked === false); }

// ── E. catalog expiry fail-closed (frozen R3 2026-10-13T22:44:42Z, never regenerated) ──
ok("E01 frozen expiry constant == 2026-10-13T22:44:42Z", CATALOG_VERIFICATION_EXPIRY === "2026-10-13T22:44:42Z" && FIXED_V3.catalog_verification_expiry === CATALOG_VERIFICATION_EXPIRY);
ok("E02 one second before expiry ⇒ open (advisory)", catalogWindow(Date.parse("2026-10-13T22:44:41Z")) === "open_advisory");
ok("E03 AT expiry ⇒ expired_hold", catalogWindow(Date.parse("2026-10-13T22:44:42Z")) === "expired_hold");
ok("E04 after expiry ⇒ expired_hold", catalogWindow(Date.parse("2026-11-01T00:00:00Z")) === "expired_hold");
ok("E05 before T0 ⇒ hold", catalogWindow(Date.parse("2026-10-01T00:00:00Z")) === "before_t0_hold");
{ const s = standbyStatusV3(authorityEnv().env, { nowMs: Date.parse("2026-10-13T22:44:42Z") });
  ok("E06 standby at expiry ⇒ activationReadyAdvisory=false", s.activationReadyAdvisory === false && s.catalogWindow === "expired_hold"); }
{ const rows = reviewedV3Rows("inactive");
  ok("E07 frozen R3 catalog check (authoritative DB-clock path) refuses AT expiry: verification_stale", checkV3Catalog(rows.version, rows.entries, "inactive", "2026-10-13T22:44:42Z").reason === "verification_stale");
  ok("E08 frozen R3 catalog check passes inside the window", checkV3Catalog(rows.version, rows.entries, "inactive", "2026-10-08T00:00:00Z").ok === true); }

// ── F. reader provider (session invariants) ──
{ const { env } = authorityEnv(); const cfg = loadAuthorityV3Config(env); let seen = null;
  const p = acquireReaderAttestationProviderV3({ env, config: cfg }, { acquire: async (a) => { seen = a; return { ok: true, protocol: "reader-attestation-channel-v2", envelope: { payload: {}, signatureB64: "x" }, requestNonce: "a".repeat(32) }; } });
  const session = { physical: { query() {} }, token: "f".repeat(64) };
  const r = await p.provider.obtain({ session });
  ok("F01 reader provider passes the EXACT established session object to the frozen V2 acquisition (same physical)", r.ok === true && seen.session === session && seen.testBoundary === false);
  ok("F02 reader provider binds the anchored cluster fingerprint + pinned reader trust root", seen.anchorClusterFingerprint === "c".repeat(64) && seen.trustRoot === cfg.readerAttester.trustRoot);
  ok("F03 reader provider refuses extra args", (await p.provider.obtain({ session }, {})).reason === "reader_v2_provider_session_invalid");
  ok("F04 reader provider refuses session without physical", (await p.provider.obtain({ session: { token: "x" } })).reason === "reader_v2_provider_session_invalid");
  const p1 = acquireReaderAttestationProviderV3({ env, config: cfg }, { acquire: async () => ({ ok: true, protocol: "reader-attestation-channel-v1", envelope: {}, requestNonce: "a".repeat(32) }) });
  ok("F05 reader V1 protocol result ⇒ refused", (await p1.provider.obtain({ session })).reason === "reader_v2_protocol_mismatch");
  const p2 = acquireReaderAttestationProviderV3({ env, config: cfg }, { acquire: async () => { throw new Error("boom"); } });
  ok("F06 reader acquisition throw ⇒ bounded failure", (await p2.provider.obtain({ session })).reason === "reader_v2_acquisition_failed"); }

done();
