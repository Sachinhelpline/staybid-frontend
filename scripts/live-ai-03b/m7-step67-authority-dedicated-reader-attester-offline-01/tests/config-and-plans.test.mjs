// TEST-ONLY — Authority Step6/7 config, dedicated-attester plan → ACCEPTED loader, reference plans, identity generation,
// receipt guard, one-shot guards, entrypoint fail-closed, phase plan. OFFLINE; synthetic values only.
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { test, eq, ok, match, run } from "./_harness.mjs";
import { makeDualEnv, kp } from "./fixtures/dual-env.mjs";
import { loadStep67Config } from "../src/step67-config.mjs";
import { runStep67Verification } from "../src/step67-verifier.mjs";
import { acquireReaderV2Attestation } from "../src/reader-v2-attestation-source.mjs";
import { runStep67Production, parseArgs } from "../src/step67-verification-entrypoint.mjs";
import { buildReceipt, assertReceiptSafe, holdMarker } from "../src/receipt.mjs";
import { acquireDeploymentAttemptLock, beginOwnerAttempt, writeOwnerReceiptOnce } from "../src/one-shot-guard.mjs";
import { standbyStatus } from "../src/authority-standby-entrypoint.mjs";
import { reportAuthorityPeerIdentity } from "../src/authority-peer-identity.mjs";
import { AUTHORITY_PLAN, DEDICATED_PLAN, validatePlans, simulateResolution, authorityWrites, parseReference } from "../controller/reference-plan.mjs";
import { generateDedicatedIdentity, dedicatedWrites } from "../controller/dedicated-attester-provisioning.mjs";
import { validatePhasePlan, PHASES } from "../controller/future-live-phase-plan.mjs";
import { loadAttesterProductionConfig } from "../../private-reader-bootstrap-clock-peer-offline-01/production-config.mjs";
import { createSigningAdapter } from "../../private-reader-attester-offline-01/signing-adapter.mjs";
import { makeTestClock } from "../../m7-v2-production-authority-provisioning-offline-01/src/trusted-clock.mjs";
import { makeSyntheticCluster } from "../../private-reader-attester-offline-01/tests/fixtures/synthetic-cluster.mjs";
import { SERVICES, DB_ENV, AUTHORITY_EXECUTOR_ATTESTER_ENV as EX, AUTHORITY_READER_ATTESTER_ENV as RD, DEDICATED_ATTESTER_ENV as DA,
  DEDICATED_PUBLIC_CUSTODY_ENV as DP, DEDICATED_READER_ATTESTER_ISSUER, TARGET } from "../src/constants.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = (p) => mkdtempSync(join(tmpdir(), "s67-" + p + "-"));
async function cfgWith(envOver, pinsOver) {
  const E = await makeDualEnv({ envOver, pinsOver });
  try { return loadStep67Config(E.env, E.pins, { testBoundary: true }); } finally { await E.close(); }
}

// ── production-shaped resolution of BOTH plans (what Railway would materialize) ──
function productionSources() {
  const exk = kp(), m5 = kp();
  const g = generateDedicatedIdentity({ forbiddenFingerprints: [m5.fp, exk.fp] });
  if (!g.ok) throw new Error(g.reason);
  const cl = makeSyntheticCluster({ scenario: "base" });
  const anchorJson = cl.goodAnchorJson();
  const dedicatedLiterals = {};
  for (const w of dedicatedWrites(g.identity).writes) dedicatedLiterals[w.name] = w.stdinValue;
  const m5Vars = { [DA.observerDbUrl]: "postgresql://synthetic-observer:" + randomBytes(9).toString("hex") + "@db.example.test:5432/railway", [DA.anchorJson]: anchorJson };
  const authorityProvided = { RAILWAY_PRIVATE_DOMAIN: SERVICES.authority.name + ".railway.internal" };
  const dedicatedEnv = simulateResolution(DEDICATED_PLAN, { [SERVICES.m5ReaderAttester.name]: m5Vars, [SERVICES.authority.name]: authorityProvided }, dedicatedLiterals);
  const exVars = { LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER: "staybid-live-ai-03b-executor-attester-synthetic", LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64: exk.der,
    LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT: exk.fp, LIVE_AI_03B_EXECUTOR_ATTESTER_PORT: "8562", LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET: randomBytes(36).toString("base64url"),
    RAILWAY_PRIVATE_DOMAIN: SERVICES.executorAttester.name + ".railway.internal" };
  const dedVarsForAuthority = { ...dedicatedEnv, RAILWAY_PRIVATE_DOMAIN: SERVICES.dedicatedReaderAttester.name + ".railway.internal" };
  const authorityEnv = simulateResolution(AUTHORITY_PLAN, { [SERVICES.executorAttester.name]: exVars, [SERVICES.dedicatedReaderAttester.name]: dedVarsForAuthority,
    [SERVICES.m5ReaderAttester.name]: m5Vars }, { [DB_ENV.executorDbUrl]: "postgresql://synthetic-executor:" + randomBytes(9).toString("hex") + "@db.example.test:5432/railway",
    [DB_ENV.readerDbUrl]: "postgresql://synthetic-reader:" + randomBytes(9).toString("hex") + "@db.example.test:5432/railway" });
  const pins = { expectedExecutorAttesterFingerprint: exk.fp, expectedReaderAttesterFingerprint: g.identity.fingerprint, forbiddenReaderAttesterFingerprint: m5.fp };
  return { g, exk, m5, dedicatedEnv, authorityEnv, pins };
}

test("C01", "config: executor / reader fingerprint not equal to the Owner pin ⇒ refused", async () => {
  const o = kp();
  match((await cfgWith({}, { expectedExecutorAttesterFingerprint: o.fp })).reason, /executor_attester_fingerprint_not_pinned_value/);
  match((await cfgWith({}, { expectedReaderAttesterFingerprint: o.fp })).reason, /reader_attester_fingerprint_not_pinned_value/);
});
test("C02", "config: dedicated reader key equal to the forbidden M5 pin ⇒ refused (no M5 key sharing)", async () => {
  const E = await makeDualEnv({});
  try { const r = loadStep67Config(E.env, { ...E.pins, forbiddenReaderAttesterFingerprint: E.pins.expectedReaderAttesterFingerprint }, { testBoundary: true });
    match(r.reason, /dedicated_reader_attester_reuses_m5_signing_key/); } finally { await E.close(); }
});
test("C03", "config: forbidden secret classes on the Authority (signing keys, observer credentials, PGPASSWORD, superuser) ⇒ refused", async () => {
  for (const n of [DA.signingKeyPkcs8B64, DA.observerDbUrl, "LIVE_AI_03B_EXECUTOR_ATTESTER_SIGNING_KEY_PKCS8_B64", "LIVE_AI_03B_EXECUTOR_ATTESTER_OBSERVER_DB_URL", "PGPASSWORD", "LIVE_AI_03B_SUPERUSER_DB_URL"]) {
    const r = await cfgWith({ [n]: "synthetic-value-xyz" });
    eq(r.ok, false, n); match(r.reason, /forbidden/, n);
  }
});
test("C04", "config: executor and reader DB credentials identical ⇒ refused", async () => {
  const E = await makeDualEnv({});
  try { const r = loadStep67Config({ ...E.env, [DB_ENV.readerDbUrl]: E.env[DB_ENV.executorDbUrl] }, E.pins, { testBoundary: true });
    match(r.reason, /executor_and_reader_share_a_credential/); } finally { await E.close(); }
});
test("C05", "config: same channel secret / same destination / same issuer across the two attesters ⇒ refused", async () => {
  const E = await makeDualEnv({});
  try {
    match(loadStep67Config({ ...E.env, [RD.channelSecret]: E.env[EX.channelSecret] }, E.pins, { testBoundary: true }).reason, /channel_secret|not_distinct/);
    match(loadStep67Config({ ...E.env, [RD.port]: E.env[EX.port] }, E.pins, { testBoundary: true }).reason, /destinations_not_distinct/);
    match(loadStep67Config({ ...E.env, [RD.issuer]: E.env[EX.issuer] }, E.pins, { testBoundary: true }).reason, /issuers_not_distinct/);
  } finally { await E.close(); }
});
test("C06", "config: any one of the 15 Authority names missing ⇒ authority_caller_config_incomplete", async () => {
  const E = await makeDualEnv({});
  try { for (const e of AUTHORITY_PLAN) { const env = { ...E.env }; delete env[e.dest];
    match(loadStep67Config(env, E.pins, { testBoundary: true }).reason, /authority_caller_config_incomplete/, e.dest); } } finally { await E.close(); }
});
test("C07", "Railway-resolved AUTHORITY plan satisfies the production (non-test) Step6/7 loader; loopback refused in production", async () => {
  const s = productionSources();
  const r = loadStep67Config(s.authorityEnv, s.pins, { testBoundary: false });
  eq(r.ok, true, "production config: " + r.reason);
  eq(r.readerAttester.host, SERVICES.dedicatedReaderAttester.name + ".railway.internal");
  eq(r.executorAttester.host, SERVICES.executorAttester.name + ".railway.internal");
  const lo = loadStep67Config({ ...s.authorityEnv, [RD.host]: "127.0.0.1" }, s.pins, { testBoundary: false });
  eq(lo.ok, false); match(lo.reason, /railway_internal/);
  ok(Object.keys(s.authorityEnv).every((n) => !/SIGNING_KEY|PKCS8|OBSERVER_DB_URL/.test(n)), "Authority receives no signing key / observer credential");
});
test("C08", "Railway-resolved DEDICATED plan satisfies the ACCEPTED, UNCHANGED loadAttesterProductionConfig; sole peer = Authority", async () => {
  const s = productionSources();
  const r = loadAttesterProductionConfig(s.dedicatedEnv);
  eq(r.ok, true, "accepted attester config: " + r.reason);
  eq(r.config.readerServiceName, SERVICES.authority.name + ".railway.internal");
  eq(r.config.issuer, DEDICATED_READER_ATTESTER_ISSUER);
  eq(r.config.port, 8563);
  const sig = createSigningAdapter({ issuer: r.config.issuer, privateKeyPkcs8B64: s.dedicatedEnv[DA.signingKeyPkcs8B64], proofLifetimeMs: 120000 });
  eq(sig.ok, true); eq(sig.signer.keyId, s.dedicatedEnv[DP.fingerprint], "public custody fingerprint == signer keyId");
  eq(sig.signer.publicKeyDerB64, s.dedicatedEnv[DP.publicKeyDerB64]);
  ok(s.dedicatedEnv[DA.channelSecret] !== s.authorityEnv[EX.channelSecret], "new channel secret distinct from executor secret");
  eq(s.authorityEnv[RD.channelSecret], s.dedicatedEnv[DA.channelSecret], "Authority reads the dedicated channel secret by reference");
});
test("C09", "reference plans: valid; every negative mutation is refused (signing key, observer, M5 non-anchor, chain, sharing, size)", async () => {
  eq(validatePlans().ok, true);
  eq(AUTHORITY_PLAN.length, 15); eq(authorityWrites().length, 13);
  ok(authorityWrites().every((w) => parseReference(w.stdinValue)), "every Authority write is a single-level reference expression");
  const A = AUTHORITY_PLAN.map((e) => ({ ...e })), D = DEDICATED_PLAN.map((e) => ({ ...e }));
  const bad = [
    [[...A.slice(0, 14), { dest: "LIVE_AI_03B_X", kind: "reference", service: SERVICES.dedicatedReaderAttester.name, variable: DA.signingKeyPkcs8B64 }], D, /forbidden_source|chain/],
    [[...A.slice(0, 14), { dest: DA.observerDbUrl, kind: "reference", service: SERVICES.m5ReaderAttester.name, variable: DA.observerDbUrl }], D, /forbidden_destination/],
    [[...A.slice(0, 14), { dest: "LIVE_AI_03B_Y", kind: "reference", service: SERVICES.m5ReaderAttester.name, variable: DA.issuer }], D, /m5_reference_not_anchor/],
    [[...A.slice(0, 14), { dest: "LIVE_AI_03B_Z", kind: "reference", service: SERVICES.dedicatedReaderAttester.name, variable: DA.observerDbUrl }], D, /forbidden_source|chain_or_unknown/],
    [A, D.map((e) => e.dest === DA.signingKeyPkcs8B64 ? { dest: e.dest, kind: "reference", service: SERVICES.m5ReaderAttester.name, variable: DA.signingKeyPkcs8B64 } : e), /m5|shares|chain_or_unknown/],
    [A, D.map((e) => e.dest === DA.channelSecret ? { dest: e.dest, kind: "reference", service: SERVICES.m5ReaderAttester.name, variable: DA.channelSecret } : e), /m5|shares|chain_or_unknown/],
    [A.slice(0, 14), D, /size_not_15/],
  ];
  for (const [a, d, re] of bad) match(validatePlans(a, d).reason, re);
  let threw = null; try { simulateResolution(AUTHORITY_PLAN.slice(2, 3), { [SERVICES.executorAttester.name]: { LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER: "${{x.Y_Z}}" } }); } catch (e) { threw = e.message; }
  eq(threw, "reference_chain_detected");
});
test("C10", "identity generation: accepted-signer self-check, NEW key + secret every call, malformed pins refused, secrets written last", async () => {
  const a = kp(), b = kp();
  const g1 = generateDedicatedIdentity({ forbiddenFingerprints: [a.fp, b.fp] }), g2 = generateDedicatedIdentity({ forbiddenFingerprints: [a.fp, b.fp] });
  eq(g1.ok, true); eq(g2.ok, true);
  ok(g1.identity.fingerprint !== g2.identity.fingerprint && g1.identity.channelSecret !== g2.identity.channelSecret, "fresh per call");
  ok(/^[A-Za-z0-9_-]{64}$/.test(g1.identity.channelSecret), "64-char base64url channel secret");
  eq(generateDedicatedIdentity({ forbiddenFingerprints: [a.fp] }).ok, false);
  eq(generateDedicatedIdentity({ forbiddenFingerprints: ["nothex", b.fp] }).ok, false);
  const w = dedicatedWrites(g1.identity).writes;
  eq(w.length, DEDICATED_PLAN.length);
  eq(w.slice(-2).map((x) => x.class).join(","), "secret_generated,secret_generated");
  ok(w.slice(0, -2).every((x) => x.class !== "secret_generated"));
});
test("C11", "verifier input contract: exact deps shape, distinct factories, unbound clock", async () => {
  const E = await makeDualEnv({});
  try {
    const d = E.deps();
    match((await runStep67Verification({ ...d, extra: 1 })).reason, /deps_shape_not_exact/);
    match((await runStep67Verification({ ...d, readerPhysicalFactory: d.executorPhysicalFactory })).reason, /physical_factories_not_distinct/);
    const c = makeTestClock(() => Date.now(), { testBoundary: true }); c.bindToDbClock(Date.now());
    match((await runStep67Verification({ ...d, clock: c })).reason, /prebound/);
    eq(E.opened.executor.length + E.opened.reader.length, 0, "no connection opened on refused inputs");
  } finally { await E.close(); }
});
test("C12", "reader v2 source: test seams refused outside the test boundary; non-v2 / bad inputs refused before any I/O", async () => {
  match((await acquireReaderV2Attestation({ seams: { resolver: async () => [] } })).reason, /test_seam_outside_test_boundary/);
  match((await acquireReaderV2Attestation({ testBoundary: true, seams: { evil: 1 } })).reason, /unknown_seam/);
  match((await acquireReaderV2Attestation({})).reason, /session_absent/);
});
test("C13", "production entrypoint: rejects injection, exact argv, one attempt per deployment lifetime", async () => {
  match((await runStep67Production({ env: {}, argv: [], executorSource: {} })).reason, /rejects_injection/);
  eq(parseArgs(["--run-id", "x"]).ok, false);
  eq(parseArgs(["--run-id", "run-0001", "--expected-executor-attester-fingerprint", "a".repeat(64), "--expected-reader-attester-fingerprint", "b".repeat(64),
    "--forbidden-reader-attester-fingerprint", "c".repeat(64)]).ok, true);
  const d = tmp("lock");
  eq(acquireDeploymentAttemptLock("run-0001", d).ok, true);
  match(acquireDeploymentAttemptLock("run-0002", d).reason, /already_attempted/);
});
test("C14", "entrypoint process: no args ⇒ exit 64; empty env ⇒ exit 3 with a leak-safe HOLD receipt, before the one-shot lock", async () => {
  const ep = resolve(HERE, "../src/step67-verification-entrypoint.mjs");
  const u = spawnSync(process.execPath, [ep], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  eq(u.status, 64);
  const lockDir = tmp("eplock");
  const r = spawnSync(process.execPath, [ep, "--run-id", "run-empty-01", "--expected-executor-attester-fingerprint", "a".repeat(64),
    "--expected-reader-attester-fingerprint", "b".repeat(64), "--forbidden-reader-attester-fingerprint", "c".repeat(64)], { env: { PATH: process.env.PATH, TMPDIR: lockDir }, encoding: "utf8" });
  eq(r.status, 3);
  const line = r.stdout.split("\n").find((l) => l.startsWith("STEP67_RECEIPT "));
  const rec = JSON.parse(line.slice(15));
  eq(assertReceiptSafe(rec).ok, true); eq(rec.outcome, "HOLD"); match(rec.reason, /authority_caller_config_incomplete/);
  ok(!existsSync(join(lockDir, "lai03b-step67", "step67-attempt.lock")), "config failure consumes no attempt");
});
test("C15", "receipt guard: refuses tokens, DB URLs, signatures, long hex outside the fingerprint/commit fields", async () => {
  const z = { expectedExecutorAttesterFingerprint: "a".repeat(64), expectedReaderAttesterFingerprint: "b".repeat(64), forbiddenReaderAttesterFingerprint: "c".repeat(64) };
  const b = buildReceipt({ runId: "run-0001", startedUtc: "2026-10-05T00:00:00.000Z", finishedUtc: "2026-10-05T00:00:01.000Z", result: { ok: false, reason: "x", stage: "S1_executor_connection" }, pins: z });
  eq(b.ok, true); eq(b.receipt.outcome, "HOLD"); eq(b.receipt.liveAuthorization, "THIS_RECEIPT_GRANTS_NO_AUTHORIZATION");
  for (const v of ["postgresql://u:p@h/db", "d".repeat(64), ["ey", "JhbGciOiJIUzI1NiJ9.", "ey", "JzdWIiOiIxIn0.sig"].join(""), ["MC4C", "AQAw", "BQYD", "K2Vw", "BCIE", "I"].join("") + "A".repeat(20), "Ab3dEf9GhQ2kLmN7pRsT0vWxY4zB", "S7_reader_v2_Kx9Qm2Zp7Lw4Rt8Yb"])
    eq(assertReceiptSafe({ ...b.receipt, reason: v }).ok, false, v.slice(0, 12));
  eq(assertReceiptSafe({ ...b.receipt, pins: { ...z, expectedReaderAttesterFingerprint: "not-hex" } }).ok, false);
  match(holdMarker("a b/c"), /^HOLD_M7_STEP6_7_AUTHORITY_HOST_A_B_C$/);
  for (const st of ["S7_reader_v2_attestation", "S11_post_binding_liveness", "S10_distinctness"]) eq(assertReceiptSafe({ ...b.receipt, stage: st }).ok, true, st);
});
test("C16", "Owner one-shot: attempt marker before any call; prior marker (ambiguous) or receipt ⇒ refused; receipt never overwritten", async () => {
  const d = tmp("owner");
  eq(beginOwnerAttempt(d, "P3", "run-0001").ok, true);
  match(beginOwnerAttempt(d, "P3", "run-0002").reason, /prior_attempt_exists/);
  eq(writeOwnerReceiptOnce(d, "P3", "{}").ok, true);
  match(writeOwnerReceiptOnce(d, "P3", "{}").reason, /no_overwrite/);
  match(beginOwnerAttempt(d, "P3", "run-0003").reason, /receipt_exists/);
});
test("C17", "standby + peer-identity helpers: names-only standby; peer identity accepts only the Authority's exact private name/hosts", async () => {
  const st = standbyStatus({});
  ok(st && typeof st === "object", "standby status object");
  match((await reportAuthorityPeerIdentity({ env: { RAILWAY_PRIVATE_DOMAIN: "live-ai-03b-reader-attester.railway.internal" } })).reason, /not_authority/);
  const good = await reportAuthorityPeerIdentity({ env: { RAILWAY_PRIVATE_DOMAIN: SERVICES.authority.name + ".railway.internal" }, resolver: async () => [{ address: "fd12:3456:789a::5", family: 6 }] });
  eq(good.ok, true); eq(good.cidrs.join(","), "fd12:3456:789a::5/128");
  match((await reportAuthorityPeerIdentity({ env: { RAILWAY_PRIVATE_DOMAIN: SERVICES.authority.name + ".railway.internal" }, resolver: async () => [{ address: "8.8.8.8", family: 4 }] })).reason, /public/);
});
test("C18", "phase plan: P0–P9, every mutation phase needs Owner authorization, Authority deploys before the dedicated attester, no M5/CORE-PROD target", async () => {
  eq(validatePhasePlan().ok, true);
  eq(PHASES.map((p) => p.phase).join(""), "P0P1P2P3P4P5P6P7P8P9");
  ok(PHASES.filter((p) => p.mutationClass !== "READ_ONLY").every((p) => p.requiresOwnerAuthorization));
  ok(PHASES.every((p) => p.targets.projectId === TARGET.projectId));
  match(validatePhasePlan([...PHASES.slice(0, 5), PHASES[6], PHASES[5], ...PHASES.slice(7)]).reason, /authority_must_deploy_before/);
  match(validatePhasePlan([{ ...PHASES[3], requiresOwnerAuthorization: false }]).reason, /mutation_without_owner_authorization/);
});

await run("config-and-plans.test.mjs");
