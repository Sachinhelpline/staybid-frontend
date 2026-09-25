// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §M1-R2 — PRODUCTION COMPOSITION / CONFIG / ENTRYPOINTS (OFFLINE). Node built-ins only.
// Proves the production composition roots are REAL fail-closed composition (not permanent stubs): config
// validation + AI-STAGING anchoring + executor/foreign-credential refusal + production option-key rejection; the
// composition progresses PAST config to the real adapter stage and then fails closed offline (no live infra); and
// the offline-test boundary composes to a running bootstrap with synthetic approved deps (reader WAITING_FOR_
// ATTESTER, attester BOOTSTRAP_LISTENING) without opening the gateway serving listener or signing pre-clock.
// No live DB/DNS is reachable here; the production positive path is proven only structurally.
// ─────────────────────────────────────────────────────────────────────────
import { createSigningAdapter } from "../../private-reader-attester-offline-01/signing-adapter.mjs";
import { makeSyntheticCluster } from "../../private-reader-attester-offline-01/tests/fixtures/synthetic-cluster.mjs";
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { REQUIRED_ENV_NAMES as EXEC_ENV } from "../../trusted-executor-runtime-01/runtime-config.mjs";
import { READER_ENV, ATTESTER_ENV, loadReaderProductionConfig, loadAttesterProductionConfig, rejectTestInjection } from "../production-config.mjs";
import { composeReaderProduction } from "../production-reader.mjs";
import { composeAttesterProduction } from "../production-attester.mjs";
import { makeBootstrapEnv, edKeyPair } from "./fixtures/synthetic-env.mjs";
import { STATES } from "../bootstrap-state.mjs";

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };

// a real signer → issuer + public key + fingerprint for a valid trust root, and a matching signing key
const key = edKeyPair();
const sig = createSigningAdapter({ issuer: "owner-prod-1", privateKeyPkcs8B64: key.privateKeyPkcs8B64, proofLifetimeMs: 60000 });
const cl = makeSyntheticCluster({ scenario: "base" });
const ANCHOR_JSON = cl.goodAnchorJson();          // a valid AI-STAGING anchor (targets FIXED project/env/pg)

function readerEnv(over = {}) {
  return {
    [READER_ENV.readerDbUrl]: "postgresql://reader@db/ai_staging",
    [READER_ENV.aiStagingProjectId]: FIXED.ai_staging_project,
    [READER_ENV.aiStagingEnvironmentId]: FIXED.ai_staging_environment,
    [READER_ENV.aiStagingPgServiceId]: FIXED.ai_staging_postgres,
    [READER_ENV.attesterServiceName]: "attester-svc.railway.internal",
    [READER_ENV.attesterPort]: "8443",
    [READER_ENV.channelSecret]: "c".repeat(48),
    [READER_ENV.attesterIssuer]: sig.signer.issuer,
    [READER_ENV.attesterPublicKeyDerB64]: sig.signer.publicKeyDerB64,
    [READER_ENV.attesterFingerprint]: sig.signer.keyId,
    [READER_ENV.anchorJson]: ANCHOR_JSON,
    ...over,
  };
}
function attesterEnv(over = {}) {
  return {
    [ATTESTER_ENV.observerDbUrl]: "postgresql://observer@db/ai_staging",
    [ATTESTER_ENV.signingKeyPkcs8B64]: key.privateKeyPkcs8B64,
    [ATTESTER_ENV.issuer]: "owner-prod-1",
    [ATTESTER_ENV.anchorJson]: ANCHOR_JSON,
    [ATTESTER_ENV.channelSecret]: "c".repeat(48),
    [ATTESTER_ENV.readerServiceName]: "reader-svc.railway.internal",
    [ATTESTER_ENV.bindHost]: "::",
    [ATTESTER_ENV.port]: "8443",
    [ATTESTER_ENV.aiStagingProjectId]: FIXED.ai_staging_project,
    [ATTESTER_ENV.aiStagingEnvironmentId]: FIXED.ai_staging_environment,
    [ATTESTER_ENV.aiStagingPgServiceId]: FIXED.ai_staging_postgres,
    ...over,
  };
}
const rReason = (over) => loadReaderProductionConfig(readerEnv(over)).reason;
const aReason = (over) => loadAttesterProductionConfig(attesterEnv(over)).reason;
const del = (env, k) => { const e = { ...env }; delete e[k]; return e; };

async function run() {
  // ── A. reader config: valid + fail-closed matrix ──
  ok("A0. valid reader config loads", loadReaderProductionConfig(readerEnv()).ok === true);
  ok("A1. missing reader DB url → incomplete", loadReaderProductionConfig(del(readerEnv(), READER_ENV.readerDbUrl)).reason === "reader_config_incomplete");
  ok("A2. executor credential present → fail closed", rReason({ [EXEC_ENV.executorDbUrl]: "postgresql://executor@db/x" }) === "executor_credential_present");
  ok("A3. wrong AI-STAGING project → mismatch", rReason({ [READER_ENV.aiStagingProjectId]: "00000000-0000-0000-0000-000000000000" }) === "ai_staging_project_id_mismatch");
  ok("A4. CORE-PROD project → rejected", rReason({ [READER_ENV.aiStagingProjectId]: FIXED.core_excluded_project, [READER_ENV.aiStagingPgServiceId]: FIXED.core_excluded_postgres }) !== undefined && ["ai_staging_project_id_mismatch", "config_targets_core_prod"].includes(rReason({ [READER_ENV.aiStagingProjectId]: FIXED.core_excluded_project })));
  ok("A5. non-railway.internal attester name → rejected", rReason({ [READER_ENV.attesterServiceName]: "attacker.example.com" }) === "attester_service_name_not_railway_internal");
  ok("A6. bad attester port → rejected", rReason({ [READER_ENV.attesterPort]: "99999" }) === "attester_port_invalid");
  ok("A7. short channel secret → rejected", rReason({ [READER_ENV.channelSecret]: "short" }) === "channel_secret_too_short");
  ok("A8. invalid trust root fingerprint → rejected", /^trust_root_/.test(rReason({ [READER_ENV.attesterFingerprint]: "deadbeef" })));
  ok("A9. malformed anchor → rejected", /^anchor_/.test(rReason({ [READER_ENV.anchorJson]: "{not-json" })));

  // ── B. attester config: valid + fail-closed matrix ──
  ok("B0. valid attester config loads", loadAttesterProductionConfig(attesterEnv()).ok === true);
  ok("B1. missing observer DB url → incomplete", loadAttesterProductionConfig(del(attesterEnv(), ATTESTER_ENV.observerDbUrl)).reason === "attester_config_incomplete");
  ok("B2. executor credential present → fail closed", aReason({ [EXEC_ENV.executorDbUrl]: "postgresql://executor@db/x" }) === "executor_credential_present");
  ok("B3. invalid anchor → rejected", /^anchor_/.test(aReason({ [ATTESTER_ENV.anchorJson]: "{bad" })));
  ok("B4. non-railway.internal reader name → rejected", aReason({ [ATTESTER_ENV.readerServiceName]: "reader.public.example" }) === "reader_service_name_not_railway_internal");
  ok("B5. short channel secret → rejected", aReason({ [ATTESTER_ENV.channelSecret]: "x" }) === "channel_secret_too_short");
  ok("B6. bad issuer → rejected", aReason({ [ATTESTER_ENV.issuer]: "a" }) === "issuer_invalid");
  ok("B7. wrong AI-STAGING pg service → mismatch", aReason({ [ATTESTER_ENV.aiStagingPgServiceId]: "11111111-1111-1111-1111-111111111111" }) === "ai_staging_pg_service_id_mismatch");

  // ── C. production option-key rejection (§18) ──
  ok("C1. reader production rejects a test-injection key", (await composeReaderProduction({ env: readerEnv(), signer: {} })).reason === "production_option_not_allowed:signer");
  ok("C2. attester production rejects a test-injection key", (await composeAttesterProduction({ env: attesterEnv(), takeSampleFn: () => {} })).reason === "production_option_not_allowed:takeSampleFn");
  ok("C3. rejectTestInjection passes env+log only", rejectTestInjection({ env: {}, log: () => {} }) === null && rejectTestInjection({ env: {}, trustRoot: {} }) === "trustRoot");

  // ── D. production composition fails closed on missing config, and PROGRESSES PAST config with valid config ──
  ok("D1. reader production, empty env → fail closed (config incomplete)", (await composeReaderProduction({ env: {} })).reason === "reader_config_incomplete");
  {
    const r = await composeReaderProduction({ env: readerEnv() });   // valid config → progresses to the real peer/DNS stage, then fails closed offline
    ok("D2. reader production progresses PAST config to adapter stage, then fails closed (no permanent stub)", r.started === false && /^attester_peer_/.test(r.reason));
  }
  ok("D3. attester production, empty env → fail closed (config incomplete)", (await composeAttesterProduction({ env: {} })).reason === "attester_config_incomplete");
  {
    const a = await composeAttesterProduction({ env: attesterEnv() });   // valid config + signer built → real peer/DNS stage → fail closed offline
    ok("D4. attester production progresses PAST config (signer built) to adapter stage, then fails closed", a.started === false && /^reader_peer_/.test(a.reason));
  }

  // ── E. offline-test boundary composition reaches a running bootstrap with synthetic approved deps ──
  {
    const env = await makeBootstrapEnv({ rttUs: 2000 });
    const att = await composeAttesterProduction({ offlineTest: true, offlineTestBoundary: true, inject: {
      takeSampleFn: env.attesterTakeSample, observerProvider: env.observerProvider, signer: env.signer, anchor: env.anchor,
      channelSecret: "c".repeat(48), listen: { bindHost: "127.0.0.1", port: 0 }, peerCidrs: env.peerCidrs,
      monoNowUs: env.monoNowUs, startMonitor: false,
    } });
    ok("E1. attester offline-test composition reaches BOOTSTRAP_LISTENING", att.started === true && att.status() === STATES.BOOTSTRAP_LISTENING);
    ok("E2. attester signs nothing before any request (no pre-clock signature)", att.stats().server.signed === 0);

    const reader = await composeReaderProduction({ offlineTest: true, offlineTestBoundary: true, inject: {
      takeSampleFn: env.readerTakeSample, connectionToken: env.connectionToken,
      attester: { host: att.address.host, port: att.address.port }, channelSecret: "c".repeat(48),
      trustRoot: env.trustRoot, monoNowUs: env.monoNowUs, startMonitor: false,
    } });
    ok("E3. reader offline-test composition reaches WAITING_FOR_ATTESTER", reader.started === true && reader.status() === STATES.WAITING_FOR_ATTESTER);
    ok("E4. reader composition never opens the gateway serving listener", reader.serving() === false);
    const acq = await reader.acquireAuthority();
    ok("E5. composed reader can acquire authority via the full bracket", acq.ok === true && reader.authorityReady() === true);
    ok("E6. reader STILL not serving after authority (gateway listener never opened)", reader.serving() === false);
    await reader.stop(); await att.stop(); await env.cleanup();
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE PRODUCTION COMPOSITION / CONFIG / ENTRYPOINTS (§M1-R2): PASS");
  console.log("SCOPE: config + composition wiring with synthetic approved deps + real loopback. NO live DB/DNS. NOT live AI-STAGING.");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
