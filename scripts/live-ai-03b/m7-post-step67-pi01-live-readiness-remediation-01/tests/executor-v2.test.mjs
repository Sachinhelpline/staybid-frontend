// OFFLINE tests — deployable Executor Attester V2 (config, service, channel, V1 rejection, drift matrix, Authority
// end-to-end verification). Synthetic PostgreSQL stand-in only (the frozen V1 issuer fixture, V3-shaped), loopback
// listener under the explicit offline test boundary. No real DB, no external network.
import net from "node:net";
import { randomBytes, sign as edSign } from "node:crypto";
import { counter, edKey, hexSecret, authorityEnv, netCounter } from "./_h.mjs";
import { cleanState, syntheticFactory, syntheticPhysical, tokenOf } from "../../m7-v2-executor-attester-issuer-offline-01/tests/fixtures/synthetic-executor-cluster.mjs";
import { executorClusterFingerprint, EXECUTOR_ANCHOR_CONTRACT, EXECUTOR_ANCHOR_DOMAIN, AI_STAGING } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-target-binding.mjs";
import { observeExecutorEvidence, executorEvidenceIsAttestable } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-evidence-evaluator.mjs";
import { createExecutorAttestationSourceChannel as createV1Client } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs";
import { createExecutorSigningAdapter as createV1Signer } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-signing-adapter.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT as V1_CONTRACT } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { EXPECTED_EXECUTOR_PRIVILEGES_V2, EXECUTOR_ATTESTATION_ISSUER_V2, verifyExecutorAttestationV2 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { evaluateObservedExecutorEvidenceV2 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-evidence-policy-v2.mjs";
import { validateV3ProductionExecutorAuthority } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-production-integration.mjs";
import { canonicalize } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs";
import { PINNED_RUNTIME_BINDING, PINNED_SUCCESSOR_RUNTIME_PIN_REF } from "../../m7-post-step67-production-integration-01-runtime-01/src/runtime-preservation-binding.mjs";
import { ENV } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-attester-config.mjs";
import { startExecutorAttesterServiceV2, loadExecutorAttesterV2Config } from "../src/executor-attester-v2-entrypoint.mjs";
import { createExecutorAttestationSourceChannelV2, executorChannelMacV2, EXECUTOR_CHANNEL_VERSION_V2, EXECUTOR_CHANNEL_OP_V2 } from "../src/executor-attestation-channel-v2.mjs";
import { measureExecutorEvidenceV2, toPolicyEvidenceV2 } from "../src/executor-evidence-evaluator-v2.mjs";
import { establishExecutorObserverSessionV2 } from "../src/executor-observer-v2.mjs";
import { loadAuthorityV3Config, EXECUTOR_ATTESTER_ENV } from "../src/authority-v3-config.mjs";

globalThis.fetch = async () => { throw new Error("network forbidden in offline tests"); };
const { ok, done } = counter("executor-v2");
const V3_SCHEMAS = ["live_ai_03b_trusted", "live_ai_03b_trusted_v2", "live_ai_03b_trusted_v3"];
const V3_ROUTINES = [...EXPECTED_EXECUTOR_PRIVILEGES_V2.executableRoutines];
function v3State(over = {}) {
  const s = cleanState({
    schemas: [...V3_SCHEMAS.map((n) => ({ nspname: n, usage: true, create: false, owner: false })), { nspname: "public", usage: true, create: false, owner: false }],
    routines: [...V3_ROUTINES],
    shdepend: [...V3_SCHEMAS.map((name, i) => ({ dbid: "16384", cls: "pg_namespace", objid: String(16653 + i), objsubid: 0, deptype: "a", this_db: true, name })),
      ...V3_ROUTINES.map((name, i) => ({ dbid: "16384", cls: "pg_proc", objid: String(16665 + i), objsubid: 0, deptype: "a", this_db: true, name }))],
  });
  return Object.assign(s, over);
}
const clusterOf = (s) => ({ datname: s.cluster.datname, databaseOid: s.cluster.database_oid, executorRoleOid: s.cluster.executor_role_oid, encoding: s.cluster.encoding });
const anchorFor = (s, over = {}) => ({ clusterFingerprint: executorClusterFingerprint(clusterOf(s)), contract: EXECUTOR_ANCHOR_CONTRACT, domain: EXECUTOR_ANCHOR_DOMAIN,
  environmentId: AI_STAGING.environmentId, issuedAtMs: 1791300000000, pgServiceId: AI_STAGING.pgServiceId, projectId: AI_STAGING.projectId, verifiedBy: "owner-verified-synthetic", ...over });
const EXK = edKey(), RDK = edKey();
const CH = hexSecret(), RCH = hexSecret();
const baseEnv = (s, over = {}) => ({ [ENV.issuer]: EXECUTOR_ATTESTATION_ISSUER_V2, [ENV.publicKeyDerB64]: EXK.der, [ENV.fingerprint]: EXK.fp, [ENV.port]: "8551",
  [ENV.channelSecret]: CH, [ENV.signingKeyPkcs8B64]: EXK.pk8, [ENV.observerDbUrl]: "postgresql://synthetic-observer@db.invalid/x", [ENV.bindHost]: "10.20.3.4",
  [ENV.allowedPeerCidrs]: "10.20.3.0/24", [ENV.deploymentAnchor]: JSON.stringify(anchorFor(s)), [ENV.readerAttesterIssuer]: "owner-dedicated-reader-attester-synthetic",
  [ENV.readerAttesterFingerprint]: RDK.fp, ...over });
const trustRootV2 = { issuer: EXECUTOR_ATTESTATION_ISSUER_V2, publicKeyDerB64: EXK.der, fingerprint: EXK.fp };
async function freePort() { return await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); }); }
async function startSvc(state, extra = {}) {
  const port = await freePort();
  const svc = await startExecutorAttesterServiceV2({ mode: "offline-test", offlineTestBoundary: true, env: baseEnv(state, extra.env || {}), observerFactory: extra.factory || syntheticFactory(state, extra.log),
    testListen: { bindHost: "127.0.0.1", port, allowedPeerCidrs: ["127.0.0.1/32"] }, log: () => {}, ...(extra.opts || {}) });
  return { svc, port };
}
const client = (port, over = {}) => createExecutorAttestationSourceChannelV2({ host: "127.0.0.1", port, channelSecret: CH, readerChannelSecret: RCH, ...over }, { offlineTestBoundary: true });
const req = (token, nonce = randomBytes(16).toString("hex"), over = {}) => ({ contract: "AiStagingExecutorAttestationV2", connectionToken: token, requestNonce: nonce, role: "live_ai_03b_executor", ...over });
async function rawExchange(port, obj) {
  return await new Promise((resolve) => { let buf = ""; const s = net.createConnection({ host: "127.0.0.1", port }, () => s.write(JSON.stringify(obj) + "\n"));
    s.on("data", (d) => { buf += d; }); s.on("end", () => { try { resolve(JSON.parse(buf.trim())); } catch { resolve({ raw: buf }); } }); s.on("error", () => resolve({ err: true })); });
}
function frame(args, { v = EXECUTOR_CHANNEL_VERSION_V2, op = EXECUTOR_CHANNEL_OP_V2, secret = CH, ts = Date.now(), nonce = randomBytes(16).toString("hex") } = {}) {
  return { v, op, args, nonce, ts, mac: executorChannelMacV2(secret, v, op, args, nonce, ts) };
}

// ── A. static config ──
{ const s = v3State();
  ok("A01 V2 config with the exact R3 V2 issuer ⇒ ok", loadExecutorAttesterV2Config(baseEnv(s)).ok === true);
  ok("A02 V1-era issuer string ⇒ refused (no V1 mode)", loadExecutorAttesterV2Config(baseEnv(s, { [ENV.issuer]: "staybid.live-ai-03b.executor-attester.v1" })).reason === "executor_attester_issuer_not_v2");
  ok("A03 arbitrary owner issuer ⇒ refused", loadExecutorAttesterV2Config(baseEnv(s, { [ENV.issuer]: "owner-executor-attester-01" })).reason === "executor_attester_issuer_not_v2");
  ok("A04 frozen loader rules still apply: reader-attester observer credential present ⇒ refused", loadExecutorAttesterV2Config(baseEnv(s, { LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL: "x" })).reason === "foreign_credential_present");
  ok("A05 frozen loader rules: executor DB credential present ⇒ refused", loadExecutorAttesterV2Config(baseEnv(s, { LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "x" })).reason === "foreign_credential_present");
  ok("A06 frozen loader rules: CORE-PROD anchor ⇒ refused", loadExecutorAttesterV2Config(baseEnv(s, { [ENV.deploymentAnchor]: JSON.stringify(anchorFor(s, { projectId: AI_STAGING.excludedProjectId })) })).reason === "anchor_targets_core_prod");
  ok("A07 frozen loader rules: loopback bind in production ⇒ refused", loadExecutorAttesterV2Config(baseEnv(s, { [ENV.bindHost]: "127.0.0.1" })).ok === false);
  ok("A08 frozen loader rules: key == reader-attester key ⇒ refused", loadExecutorAttesterV2Config(baseEnv(s, { [ENV.readerAttesterFingerprint]: EXK.fp })).reason === "signing_key_not_distinct_from_reader_attester"); }

// ── B. startup fail-closed ──
{ const s = v3State();
  const r1 = await startExecutorAttesterServiceV2({ env: baseEnv(s), observerFactory: syntheticFactory(s) });
  ok("B01 production mode refuses any injection key before config is read", r1.started === false && r1.reason === "test_injection_refused_in_production");
  const e = baseEnv(s); delete e[ENV.signingKeyPkcs8B64];
  const r2 = await startExecutorAttesterServiceV2({ mode: "offline-test", offlineTestBoundary: true, env: e, observerFactory: syntheticFactory(s) });
  ok("B02 missing signing key ⇒ unprovisioned (no listener)", r2.started === false && r2.status === "unprovisioned");
  const r3 = await startExecutorAttesterServiceV2({ mode: "offline-test", offlineTestBoundary: true, env: baseEnv(s, { [ENV.signingKeyPkcs8B64]: RDK.pk8 }), observerFactory: syntheticFactory(s) });
  ok("B03 signing key ≠ configured public identity ⇒ unprovisioned", r3.started === false && r3.reason === "signing_key_not_configured_identity");
  const r4 = await startExecutorAttesterServiceV2({ mode: "offline-test", offlineTestBoundary: true, env: baseEnv(s), observerFactory: { async open() { throw new Error("x"); } } });
  ok("B04 observer connection failure ⇒ unprovisioned", r4.started === false && r4.reason === "observer_connection_failed");
  let destroyed = 0; const badPhys = { async query() { throw new Error("setup fails"); }, isDead: () => false, async destroy() { destroyed++; }, async close() { destroyed++; } };
  const r5 = await startExecutorAttesterServiceV2({ mode: "offline-test", offlineTestBoundary: true, env: baseEnv(s), observerFactory: { async open() { return badPhys; } } });
  ok("B05 observer SETUP failure ⇒ unprovisioned AND the physical is destroyed (leak-fix property)", r5.started === false && r5.reason === "observer_session_setup_failed" && destroyed === 1, { r5, destroyed });
  const r6 = await startExecutorAttesterServiceV2({ mode: "offline-test", env: baseEnv(s) });
  ok("B06 offline mode without explicit boundary ⇒ refused", r6.started === false && r6.reason === "offline_test_boundary_required"); }

// ── C. positive: V2 service → V2 client → Authority-side frozen R3 verification ──
const S0 = v3State(); const TOK = tokenOf(S0.sessions[0]);
const { svc, port } = await startSvc(S0);
ok("C01 V2 service serving, issuer = R3 V2 issuer", svc.started === true && svc.issuer === EXECUTOR_ATTESTATION_ISSUER_V2, svc.reason);
const cl = client(port);
ok("C02 V2 client constructs (V2 protocol)", cl.ok === true && cl.source.version === "executor-attestation-channel-v2");
let ENVELOPE = null;
{ const nonce = randomBytes(16).toString("hex");
  const env = await cl.source.obtain(req(TOK, nonce)).catch((e) => ({ err: e.code, a: e.attesterCode }));
  ENVELOPE = env;
  ok("C03 obtain ⇒ envelope {payload, signatureB64}", env && env.payload && typeof env.signatureB64 === "string", env);
  ok("C04 payload is AiStagingExecutorAttestationV2 / issuer V2 / role executor / exact token+nonce", env.payload?.contract === "AiStagingExecutorAttestationV2" && env.payload?.issuer === EXECUTOR_ATTESTATION_ISSUER_V2
    && env.payload?.connection?.role === "live_ai_03b_executor" && env.payload?.connection?.token === TOK && env.payload?.requestNonce === nonce);
  ok("C05 signed privileges = exactly 3 trusted schemas + 6 routines", JSON.stringify(env.payload?.privileges?.trustedSchemaUsage) === JSON.stringify(V3_SCHEMAS) && JSON.stringify([...env.payload.privileges.executableRoutines].sort()) === JSON.stringify([...V3_ROUTINES].sort()));
  // Authority side: trust root exactly as the deployable Authority config would pin it
  const { env: aEnv } = authorityEnv({ [EXECUTOR_ATTESTER_ENV.publicKeyDerB64]: EXK.der, [EXECUTOR_ATTESTER_ENV.fingerprint]: EXK.fp });
  const acfg = loadAuthorityV3Config(aEnv);
  const v = validateV3ProductionExecutorAuthority({ executorAttestation: env, executorTrustRoot: acfg.executorAttester.trustRoot, expectedConnectionToken: TOK, expectedRequestNonce: nonce, now: Date.now(), runtimePreservationBinding: PINNED_RUNTIME_BINDING });
  ok("C06 frozen R3 validateV3ProductionExecutorAuthority accepts it under the Authority-pinned V2 trust root", v.ok === true && v.successorRuntimePinRef === PINNED_SUCCESSOR_RUNTIME_PIN_REF, v.reason);
  ok("C07 frozen R3 verifier refuses it for a different token (physical-session binding)", verifyExecutorAttestationV2(env, { trustRoot: trustRootV2, expectedConnectionToken: "e".repeat(64), expectedRequestNonce: nonce, now: Date.now() }).reason === "executor_attestation_connection_mismatch");
  ok("C08 frozen R3 verifier refuses it for a different nonce", verifyExecutorAttestationV2(env, { trustRoot: trustRootV2, expectedConnectionToken: TOK, expectedRequestNonce: "d".repeat(32), now: Date.now() }).reason === "executor_attestation_request_nonce_mismatch");
  ok("C09 conformance gate never failed; one signature issued", svc.stats().signed === 1 && svc.stats().selfVerifyFailed === 0, svc.stats()); }

// ── D. explicit V1 rejection (no fallback, no translation) ──
{ const v1 = createV1Client({ host: "127.0.0.1", port, channelSecret: CH, readerChannelSecret: RCH }, { offlineTestBoundary: true });
  const r = await v1.source.obtain({ contract: V1_CONTRACT, connectionToken: TOK, requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor" }).catch((e) => ({ code: e.code, a: e.attesterCode }));
  ok("D01 frozen V1 client against the V2 server ⇒ unsupported_version", r.code === "executor_attester_rejected" && r.a === "unsupported_version", r);
  const r2 = await cl.source.obtain(req(TOK, undefined, { contract: "AiStagingExecutorAttestationV1" })).catch((e) => ({ code: e.code }));
  ok("D02 V2 client refuses a V1 contract request before any I/O", r2.code === "executor_attester_request_invalid");
  const r3 = await rawExchange(port, frame({ connectionToken: TOK, contract: V1_CONTRACT, requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor" }));
  ok("D03 correctly MAC'd V2 frame carrying the V1 contract ⇒ bad_request", r3.ok === false && r3.code === "bad_request", r3);
  const r4 = await rawExchange(port, frame({ connectionToken: TOK, contract: "AiStagingExecutorAttestationV2", requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor" }, { v: "executor-attestation-channel-v1", op: "attest-executor" }));
  ok("D04 V1 framing (v1 version + op) ⇒ unsupported_version", r4.ok === false && r4.code === "unsupported_version", r4);
  // a V1 envelope signed by the frozen V1 signer is not a V2 attestation
  const v1s = createV1Signer({ issuer: EXECUTOR_ATTESTATION_ISSUER_V2, privateKeyPkcs8B64: EXK.pk8, expectedPublicKeyDerB64: EXK.der, expectedFingerprint: EXK.fp, readerAttesterFingerprint: RDK.fp, proofLifetimeMs: 60000 });
  const p = ENVELOPE.payload.privileges;
  const v1env = v1s.signer.issue({ requestNonce: "a".repeat(32), target: ENVELOPE.payload.target, connection: { role: "live_ai_03b_executor", token: TOK },
    privileges: { ...p, executableRoutines: p.executableRoutines.slice(0, 4).filter((x) => !/_v3/.test(x)), trustedSchemaUsage: ["live_ai_03b_trusted", "live_ai_03b_trusted_v2"] } });
  const vv = validateV3ProductionExecutorAuthority({ executorAttestation: v1env.envelope, executorTrustRoot: trustRootV2, expectedConnectionToken: TOK, expectedRequestNonce: "a".repeat(32), now: Date.now(), runtimePreservationBinding: PINNED_RUNTIME_BINDING });
  ok("D05 a genuine V1 envelope (same key, V2 issuer string) ⇒ refused by the V3 path: contract mismatch", vv.ok === false && vv.reason === "executor_attestation_contract_mismatch", vv.reason);
  const resigned = { ...ENVELOPE.payload, contract: "AiStagingExecutorAttestationV1", domain: "staybid.live-ai-03b.executor-authority-attestation.v1" };
  const rs = { payload: resigned, signatureB64: edSign(null, Buffer.from(canonicalize(resigned), "utf8"), EXK.kp.privateKey).toString("base64") };
  ok("D06 V2 payload relabelled V1 and validly re-signed ⇒ refused (no translation)", verifyExecutorAttestationV2(rs, { trustRoot: trustRootV2, expectedConnectionToken: TOK, expectedRequestNonce: ENVELOPE.payload.requestNonce, now: Date.now() }).reason === "executor_attestation_contract_mismatch");
  ok("D07 V1 trust root (V1-era issuer) refused by the frozen R3 V2 verifier", verifyExecutorAttestationV2(ENVELOPE, { trustRoot: { ...trustRootV2, issuer: "staybid.live-ai-03b.executor-attester.v1" }, expectedConnectionToken: TOK, expectedRequestNonce: ENVELOPE.payload.requestNonce, now: Date.now() }).reason === "executor_trust_root_issuer_not_v2"); }

// ── E. channel authentication / replay ──
{ const f = frame({ connectionToken: TOK, contract: "AiStagingExecutorAttestationV2", requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor" }, { secret: hexSecret() });
  ok("E01 wrong channel secret ⇒ unauthenticated", (await rawExchange(port, f)).code === "unauthenticated");
  const st = frame({ connectionToken: TOK, contract: "AiStagingExecutorAttestationV2", requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor" }, { ts: Date.now() - 60000 });
  ok("E02 stale timestamp ⇒ stale", (await rawExchange(port, st)).code === "stale");
  const rp = frame({ connectionToken: TOK, contract: "AiStagingExecutorAttestationV2", requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor" });
  await rawExchange(port, rp);
  ok("E03 replayed channel nonce ⇒ replayed", (await rawExchange(port, rp)).code === "replayed");
  const ex = frame({ connectionToken: TOK, contract: "AiStagingExecutorAttestationV2", requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_executor", privileges: {} });
  ok("E04 extra arg (caller-supplied privileges) ⇒ bad_request", (await rawExchange(port, ex)).code === "bad_request");
  const wr = frame({ connectionToken: TOK, contract: "AiStagingExecutorAttestationV2", requestNonce: randomBytes(16).toString("hex"), role: "live_ai_03b_reader" });
  ok("E05 wrong role ⇒ bad_request", (await rawExchange(port, wr)).code === "bad_request");
  ok("E06 V2 client refuses reader channel secret reuse", client(port, { readerChannelSecret: CH }).reason === "executor_attester_channel_secret_reuses_reader");
  ok("E07 V2 client refuses an absent reader channel secret", client(port, { readerChannelSecret: "" }).reason === "executor_attester_reader_channel_secret_absent"); }
{ const r = await cl.source.obtain(req("9".repeat(64))).catch((e) => ({ code: e.code, a: e.attesterCode }));
  ok("E08 token of an unobserved session ⇒ no_such_session (requester token is a SELECTION key only)", r.a === "no_such_session", r); }
await svc.stop();

// ── F. drift matrix: the V2 issuer never signs an adverse/uncertain state ──
async function attempt(state, label, expectCode = "unavailable") {
  const { svc: s2, port: p2 } = await startSvc(state);
  if (!s2.started) { ok(label, false, s2.reason); return; }
  const r = await client(p2).source.obtain(req(tokenOf(state.sessions[0]))).catch((e) => ({ code: e.code, a: e.attesterCode }));
  ok(label, r.a === expectCode && s2.stats().signed === 0, { r, stats: s2.stats() });
  await s2.stop();
}
await attempt(v3State({ routines: [...V3_ROUTINES, "public.evil()"] }), "F01 extra executable routine ⇒ refused");
await attempt(v3State({ routines: V3_ROUTINES.filter((x) => !x.includes("activate_catalog_v3")) }), "F02 missing V3 activation routine ⇒ refused");
await attempt(v3State({ schemas: [{ nspname: "live_ai_03b_trusted", usage: true, create: false, owner: false }, { nspname: "live_ai_03b_trusted_v2", usage: true, create: false, owner: false }, { nspname: "public", usage: true, create: false, owner: false }] }), "F03 missing V3 schema usage (V1-era state) ⇒ refused");
await attempt(v3State({ schemas: [...V3_SCHEMAS.map((n) => ({ nspname: n, usage: true, create: n.endsWith("v3"), owner: false })), { nspname: "public", usage: true, create: false, owner: false }] }), "F04 schema CREATE on trusted_v3 ⇒ refused");
await attempt(v3State({ schemas: [...V3_SCHEMAS.map((n) => ({ nspname: n, usage: true, create: false, owner: false })), { nspname: "public", usage: true, create: false, owner: false }, { nspname: "live_ai_03b_extra", usage: true, create: false, owner: false }] }), "F05 extra trusted-prefix schema usage ⇒ refused");
await attempt(v3State({ memberships: ["postgres"] }), "F06 role membership ⇒ refused");
await attempt(v3State({ relations: [{ nsp: "public", sel: true }] }), "F07 direct budget relation privilege ⇒ refused");
await attempt(v3State({ relations: [{ nsp: "live_ai_03b_trusted", sel: true }] }), "F08 direct ledger privilege ⇒ refused");
await attempt(v3State({ extendedEffective: ["CREATE ON DATABASE railway"] }), "F09 extended authority finding ⇒ refused");
await attempt(v3State({ publicTrustedRoutines: [{ r: "x" }] }), "F10 PUBLIC execute on a trusted routine ⇒ refused");
await attempt(v3State({ role: { rolsuper: true } }), "F11 executor superuser ⇒ refused");
await attempt(v3State({ observer: { is_superuser: true } }), "F12 observer superuser (not independent) ⇒ refused");
await attempt(v3State({ observerMemberships: ["pg_read_all_stats", "live_ai_03b_executor"] }), "F13 observer holds extra membership ⇒ refused");
await attempt(v3State({ dbSkewMs: 60000 }), "F14 attester/DB clock skew ⇒ refused");
await attempt(v3State({ serverVersionNum: 150004 }), "F15 unsupported server major ⇒ refused");
{ const s = v3State(); const { svc: s3, port: p3 } = await startSvc(s, { env: { [ENV.deploymentAnchor]: JSON.stringify(anchorFor(s, { clusterFingerprint: "a".repeat(64) })) } });
  const r = await client(p3).source.obtain(req(tokenOf(s.sessions[0]))).catch((e) => ({ a: e.attesterCode }));
  ok("F16 anchor cluster fingerprint mismatch (swapped database) ⇒ refused, nothing signed", r.a === "unavailable" && s3.stats().signed === 0); await s3.stop(); }
{ const s = v3State({ sessions: [{ ...cleanState().sessions[0], application_name: "not-an-executor-app" }] });
  await attempt(s, "F17 session application name not executor-prefixed ⇒ refused"); }

// ── G. measurement necessity + exact policy shape ──
{ const s = v3State(); const es = await establishExecutorObserverSessionV2(syntheticPhysical(s));
  const v1 = await observeExecutorEvidence(es.observer, tokenOf(s.sessions[0]));
  const v1a = v1.ok ? executorEvidenceIsAttestable(v1.evidence) : v1;
  ok("G01 the frozen V1 evaluator CANNOT attest the accepted V3 state (proves the V2 measurement is required)", v1a.ok === false, v1a);
  const m = await measureExecutorEvidenceV2(es.observer, tokenOf(s.sessions[0]));
  const pe = toPolicyEvidenceV2(m.measured, JSON.parse(JSON.stringify(anchorFor(s))));
  const ev = evaluateObservedExecutorEvidenceV2(pe.evidence);
  ok("G02 V2 measurement of the same V3 state passes the frozen R3 V2 evidence policy", m.ok === true && pe.ok === true && ev.ok === true, ev.reason);
  ok("G03 V2 evidence has EXACTLY the R3 policy key sets", Object.keys(pe.evidence).sort().join(",") === "connection,context,dbNowMs,observedAtMs,privileges,target"
    && Object.keys(pe.evidence.context).sort().join(",") === "databaseCreate,databaseOwner,extendedFindings,observerIndependent,ownedCount,prohibitedReachable,schemaOwner,serverVersionMajor,unexpectedUsage"
    && Object.keys(pe.evidence.connection).sort().join(",") === "role,token");
  const bad = toPolicyEvidenceV2(m.measured, { ...anchorFor(s), clusterFingerprint: "b".repeat(64) });
  ok("G04 target is anchor-derived only: mismatched anchor ⇒ refused", bad.ok === false && bad.reason === "anchor_cluster_mismatch");
  await es.observer.close(); }
{ const log = []; const s = v3State(); const es = await establishExecutorObserverSessionV2(syntheticPhysical(s, log));
  await measureExecutorEvidenceV2(es.observer, tokenOf(s.sessions[0]));
  ok("G05 V2 measurement issued ONLY setup statements + the frozen fixed registry (synthetic DB throws on anything else)", log.length > 20); await es.observer.close(); }

done();
