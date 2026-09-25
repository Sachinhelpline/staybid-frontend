// OFFLINE genuine-attester integration tests. Synthetic PostgreSQL cluster fixture + in-memory Ed25519
// fixture keys + real local loopback sockets. Connects to NOTHING external (no Railway / Postgres /
// Supabase / CORE-PROD / provider / internet). The "pg" driver is mapped to a synthetic driver via a
// module resolve hook (node:module register) so the REAL production code paths — the attester's observer
// connection AND the accepted reader-host's reader connection — run unmodified against a SHARED synthetic
// cluster. Node built-ins only. Synthetic fixtures are NOT evidence about live AI-STAGING.
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import net from "node:net";
import process from "node:process";

import { ATTESTER_ID, ENV as A_ENV, loadAttesterConfig, validateAttesterListen } from "../attester-config.mjs";
import { createSigningAdapter } from "../signing-adapter.mjs";
import { parseDeploymentAnchor, resolveTarget, clusterFingerprint, ANCHOR_CONTRACT, ANCHOR_DOMAIN } from "../target-binding.mjs";
import { establishObserverSession, parsePgDurationMs, OBSERVER_MAX_ACTIVE, OBSERVER_MAX_QUEUED } from "../observer-connection.mjs";
import { observeReaderEvidence, evidenceIsAttestable, EXPECTED_SELECT_GRANT_COUNT } from "../evidence-evaluator.mjs";
import { Q, READER_ROLE, PERMITTED_SELECT_OBJECTS, isPermittedEvidenceSql } from "../evidence-queries.mjs";
import { startAttestationServer, ATTESTER_MAX_CONCURRENT } from "../attestation-server.mjs";
import { startAttesterService, EXIT as A_EXIT, PRODUCTION_OPTION_KEYS as A_OPTS } from "../attester-entrypoint.mjs";
import { makeSyntheticCluster } from "./fixtures/synthetic-cluster.mjs";

import { startProductionReaderService, PRODUCTION_OPTION_KEYS as R_OPTS } from "../../private-reader-production-integration-offline-01/production-entrypoint.mjs";
import { ENV as R_ENV } from "../../private-reader-production-integration-offline-01/integration-config.mjs";
import { verifyReaderAttestation, makeAttesterTrustRoot, ATTESTATION_MAX_LIFETIME_MS } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { createAttestationSourceChannel } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { createGatewayObservationCaller } from "../../private-reader-production-integration-offline-01/gateway-observation-caller.mjs";
import { publicKeyFingerprintFromDerB64, FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const L03B = resolve(ROOT, "..");
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const NOW = 1750000000000;
const clock = { t: NOW }; const nowP = () => clock.t;
const CHANNEL_SECRET = "synthetic-reader-attester-channel-secret-xyz1"; // synthetic (>=32); NOT a real secret
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaked = (x, priv) => { const s = JSON.stringify(x === undefined ? null : x); return s.includes("sentinel") || s.includes(CHANNEL_SECRET) || (priv && s.includes(priv)) || s.includes("BEGIN PRIVATE KEY") || /postgres:\/\//.test(s); };
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const openThings = [];

// Non-throwing channel call: returns { ok:true, envelope } or { ok:false, code } (the attester's code).
async function obtain(port, req, clientOpts = {}) {
  const c = createAttestationSourceChannel({ host: "127.0.0.1", port, channelSecret: clientOpts.channelSecret || CHANNEL_SECRET }, { offlineTestBoundary: true, nowProvider: clientOpts.nowProvider || nowP });
  if (!c.ok) return { ok: false, code: c.reason };
  try { const env = await c.source.obtain(req); return { ok: true, envelope: env }; }
  catch (e) { return { ok: false, code: e.attesterCode || e.code || "error" }; }
}
async function readerToken(cl) {
  const rp = await cl.readerFactory.open({});
  const idRow = (await import("../../private-reader-production-integration-offline-01/reader-session.mjs")).LIFECYCLE_SQL.readIdentity;
  const idr = await rp.query(idRow, []);
  return { token: cl.tokenFor({ pid: idr.rows[0].pid, backendStart: idr.rows[0].backend_start, applicationName: idr.rows[0].application_name }), readerPhys: rp };
}
const rn = (seed) => createHash("sha256").update(String(seed)).digest("hex").slice(0, 32);


function edKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKeyDerB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKeyPkcs8B64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}

async function run() {
  console.log("A. Attester configuration (fail closed; no foreign credential; no TEST-ONLY issuer in production)");
  const key1 = edKeyPair();
  const baseEnv = () => ({
    [A_ENV.observerDbUrl]: "postgres://obs:pw@127.0.0.1:9/railway", [A_ENV.signingKeyPkcs8B64]: key1.privateKeyPkcs8B64,
    [A_ENV.issuer]: "owner-reader-attester-01", [A_ENV.bindHost]: "10.20.3.4", [A_ENV.port]: "8551",
    [A_ENV.allowedPeerCidrs]: "10.20.0.0/16", [A_ENV.channelSecret]: CHANNEL_SECRET,
  });
  ok("empty env -> unprovisioned (config incomplete)", loadAttesterConfig({}).reason === "attester_config_incomplete");
  const withExec = { ...baseEnv(), LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL: "x" };
  ok("executor credential present -> foreign_credential_present", loadAttesterConfig(withExec).reason === "foreign_credential_present");
  const withReaderCred = { ...baseEnv(), LIVE_AI_03B_TRUSTED_READER_DB_URL: "x" };
  ok("reader-host credential present in attester env -> foreign_credential_present", loadAttesterConfig(withReaderCred).reason === "foreign_credential_present");
  const withTransport = { ...baseEnv(), LIVE_AI_03B_READER_TRANSPORT_SECRET: "x" };
  ok("gateway transport secret present in attester env -> foreign_credential_present", loadAttesterConfig(withTransport).reason === "foreign_credential_present");
  ok("TEST-ONLY issuer refused outside test boundary", loadAttesterConfig({ ...baseEnv(), [A_ENV.issuer]: "TEST-ONLY-x" }).reason === "issuer_test_only_refused");
  ok("TEST-ONLY issuer accepted only under offline test boundary", loadAttesterConfig({ ...baseEnv(), [A_ENV.issuer]: "TEST-ONLY-x" }, { offlineTestBoundary: true }).ok === true);
  ok("channel secret shorter than 32 chars refused", loadAttesterConfig({ ...baseEnv(), [A_ENV.channelSecret]: "short-but-present-not-32-chars" }).reason === "channel_secret_invalid");
  ok("loopback bind refused (accepted private-network listener contract)", loadAttesterConfig({ ...baseEnv(), [A_ENV.bindHost]: "127.0.0.1" }).reason === "listen_private_mode_rejects_loopback");
  ok("public IP bind refused", loadAttesterConfig({ ...baseEnv(), [A_ENV.bindHost]: "8.8.8.8" }).reason === "listen_bind_not_private");
  ok("hostname bind refused (literal private IP or acknowledged wildcard only)", loadAttesterConfig({ ...baseEnv(), [A_ENV.bindHost]: "attester.railway.internal" }).reason === "listen_bind_host_not_literal_ip");
  ok("loopback / any-address / public peer CIDR refused", loadAttesterConfig({ ...baseEnv(), [A_ENV.allowedPeerCidrs]: "127.0.0.1/32" }).reason === "listen_peer_cidr_not_private" && loadAttesterConfig({ ...baseEnv(), [A_ENV.allowedPeerCidrs]: "0.0.0.0/0" }).reason === "listen_peer_cidr_not_private");
  ok("missing peer allowlist refused", (() => { const e = baseEnv(); delete e[A_ENV.allowedPeerCidrs]; return loadAttesterConfig(e).reason === "attester_config_incomplete"; })());
  ok("wildcard bind without acknowledgement refused", loadAttesterConfig({ ...baseEnv(), [A_ENV.bindHost]: "::", [A_ENV.allowedPeerCidrs]: "fd12::/32" }).reason === "listen_wildcard_bind_not_acknowledged");
  ok("wildcard bind WITH acknowledgement + peer allowlist accepted", validateAttesterListen({ bindHost: "::", port: 8551, allowWildcardBind: true, allowedPeerCidrs: ["fd12::/32"] }).ok === true);
  ok("valid production config returns names/values but never the signing key or observer URL", (() => { const c = loadAttesterConfig(baseEnv()); return c.ok === true && !leaked(c, key1.privateKeyPkcs8B64) && c.secretRefs.signingKeyEnvName === A_ENV.signingKeyPkcs8B64; })());
  ok("proof lifetime above accepted 5-minute max refused", loadAttesterConfig({ ...baseEnv(), [A_ENV.proofLifetimeMs]: "600000" }).reason === "proof_lifetime_invalid");
  const clean = spawnSyncCheck();
  ok("process entrypoint with clean env: exit 70, unprovisioned, no listener", clean.status === A_EXIT.unprovisioned && /"status":"unprovisioned"/.test(clean.stdout) && !/serving/.test(clean.stdout));
  const a1 = await startAttesterService({ env: {}, physicalityShouldBeIgnored: 1, log: () => {} });
  ok("production entrypoint refuses ANY key outside the option allowlist", a1.started === false && a1.reason === "test_injection_refused_in_production" && A_OPTS.join(",") === "mode,env,log,onFatal");
  const a2 = await startAttesterService({ mode: "offline-test", log: () => {} });
  ok("offline-test mode without explicit boundary refused", a2.started === false && a2.reason === "offline_test_boundary_required");

  console.log("B. Deployment anchor (Railway target binding — honest boundary)");
  const cl0 = makeSyntheticCluster();
  const goodAnchor = cl0.goodAnchorJson();
  ok("valid anchor parses and matches the observed cluster fingerprint", (() => { const p = parseDeploymentAnchor(goodAnchor); if (!p.ok) return false; const rt = resolveTarget(p.anchor, { datname: cl0.state.datname, databaseOid: cl0.state.databaseOid, readerRoleOid: cl0.state.readerRoleOid, encoding: cl0.state.encoding }); return rt.ok === true && rt.target.pgServiceId === FIXED.ai_staging_postgres; })());
  ok("absent anchor -> anchor_absent", parseDeploymentAnchor(undefined).reason === "anchor_absent");
  ok("malformed JSON anchor -> anchor_malformed", parseDeploymentAnchor("{not json").reason === "anchor_malformed");
  ok("extra field in anchor -> anchor_malformed (exact key set)", parseDeploymentAnchor(JSON.stringify({ ...JSON.parse(goodAnchor), extra: 1 })).reason === "anchor_malformed");
  ok("wrong contract/domain -> anchor_contract_mismatch", parseDeploymentAnchor(JSON.stringify({ ...JSON.parse(goodAnchor), contract: "Other" })).reason === "anchor_contract_mismatch");
  ok("CORE-PROD anchor target -> anchor_targets_core_prod", parseDeploymentAnchor(JSON.stringify({ ...JSON.parse(goodAnchor), pgServiceId: FIXED.core_excluded_postgres, projectId: FIXED.core_excluded_project })).reason === "anchor_targets_core_prod");
  ok("non-AI-STAGING target -> anchor_target_not_ai_staging", parseDeploymentAnchor(JSON.stringify({ ...JSON.parse(goodAnchor), environmentId: "00000000-0000-0000-0000-000000000000" })).reason === "anchor_target_not_ai_staging");
  const wrongFpAnchor = JSON.stringify({ ...JSON.parse(goodAnchor), clusterFingerprint: "a".repeat(64) });
  const pw = parseDeploymentAnchor(wrongFpAnchor);
  ok("valid anchor shape but WRONG fingerprint -> resolveTarget rejects (swapped/wrong database)", pw.ok === true && resolveTarget(pw.anchor, { datname: cl0.state.datname, databaseOid: cl0.state.databaseOid, readerRoleOid: cl0.state.readerRoleOid, encoding: cl0.state.encoding }).reason === "anchor_cluster_mismatch");
  ok("target-binding.mjs reads no env var and performs no DB/DNS lookup (target comes ONLY from the anchor)", !/process\.env|env\[/.test(readFileSync(join(ROOT, "target-binding.mjs"), "utf8")));

  console.log("C. Observer connection (statement_timeout + read-only enforcement; capability self-check)");
  const clC = makeSyntheticCluster();
  const obsPhys = await clC.observerFactory.open();
  const es1 = await establishObserverSession(obsPhys, { statementTimeoutMs: 2000 });
  ok("observer session: timeout set + read back + read-only verified", es1.ok === true && es1.observer.effectiveStatementTimeoutMs === 2000);
  ok("parsePgDurationMs handles PostgreSQL units", parsePgDurationMs("2s") === 2000 && Number.isNaN(parsePgDurationMs("nonsense")));
  ok("observer above 5000ms bound refused", (await establishObserverSession(await clC.observerFactory.open(), { statementTimeoutMs: 6000 })).reason === "observer_timeout_config_invalid");
  let refusedNonRegistry = false; try { await es1.observer.evidence("SELECT 1", []); } catch { refusedNonRegistry = true; }
  ok("observer refuses ANY SQL outside the fixed evidence registry", refusedNonRegistry === true);
  ok("isPermittedEvidenceSql rejects arbitrary text", isPermittedEvidenceSql("DROP TABLE x") === false && isPermittedEvidenceSql(Q.readerRole) === true);
  await es1.observer.close();

  console.log("D. Independent evidence evaluation (measured, not inferred)");
  async function evidenceFor(scenario, { sessionOpts } = {}) {
    const cl = makeSyntheticCluster({ scenario });
    const readerPhys = await cl.readerFactory.open(sessionOpts || {});
    // derive the actual reader identity the same way reader-session.mjs does
    const idRow = (await import("../../private-reader-production-integration-offline-01/reader-session.mjs")).LIFECYCLE_SQL.readIdentity;
    const idr = await readerPhys.query(idRow, []);
    const identity = { pid: idr.rows[0].pid, backendStart: idr.rows[0].backend_start, applicationName: idr.rows[0].application_name };
    const realToken = cl.tokenFor(identity);
    const obsPhys2 = await cl.observerFactory.open();
    const es = await establishObserverSession(obsPhys2, { statementTimeoutMs: 1500 });
    if (!es.ok) return { setupFail: es.reason, cl };
    const result = await observeReaderEvidence(es.observer, realToken, { nowProvider: nowP });
    await es.observer.close(); await readerPhys.close();
    return { result, cl, realToken };
  }
  const dBase = await evidenceFor("base");
  ok("clean base scenario: evidence observed and attestable", dBase.result.ok === true && evidenceIsAttestable(dBase.result.evidence).ok === true && dBase.result.evidence.privileges.selectGrantCount === EXPECTED_SELECT_GRANT_COUNT);
  ok("evidence privileges shape matches the accepted attestation payload contract exactly", JSON.stringify(Object.keys(dBase.result.evidence.privileges).sort()) === JSON.stringify(["currentUser", "effectiveSelectOnly", "forbiddenObjectAccessible", "ownerOrExecutorAuthority", "selectGrantCount", "unapprovedRoleMembership", "unapprovedRoutineAuthority", "writePrivilegeCount"].sort()));
  const badTokCl = makeSyntheticCluster({ scenario: "base" });
  const badTokReaderPhys = await badTokCl.readerFactory.open({});
  const badTokenResult = await (async () => { const es = await establishObserverSession(await badTokCl.observerFactory.open(), { statementTimeoutMs: 1500 }); const r = await observeReaderEvidence(es.observer, "f".repeat(64), { nowProvider: nowP }); await es.observer.close(); return r; })();
  ok("fabricated connection token (no matching session) -> no_such_session; claimed token is NEVER trusted as evidence", badTokenResult.ok === false && badTokenResult.reason === "no_such_session");
  await badTokReaderPhys.close();
  const dWrongRole = await evidenceFor("wrong_role");
  ok("session under a different role -> no matching reader session observed", dWrongRole.result.ok === false && dWrongRole.result.reason === "no_reader_session_observed");
  const dMember = await evidenceFor("extra_membership");
  ok("extra role membership (even NOINHERIT) -> unapprovedRoleMembership true, not attestable", dMember.result.ok === true && dMember.result.evidence.privileges.unapprovedRoleMembership === true && evidenceIsAttestable(dMember.result.evidence).reason === "drift_role_membership");
  const dWrite = await evidenceFor("write_privilege");
  ok("unexpected write privilege on a permitted object -> not attestable", dWrite.result.ok === true && dWrite.result.evidence.privileges.writePrivilegeCount > 0 && evidenceIsAttestable(dWrite.result.evidence).reason === "drift_write_privilege");
  const dForbidden = await evidenceFor("forbidden_object_accessible");
  ok("SELECT on the forbidden object -> forbiddenObjectAccessible true, not attestable", dForbidden.result.ok === true && dForbidden.result.evidence.privileges.forbiddenObjectAccessible === true && evidenceIsAttestable(dForbidden.result.evidence).reason === "drift_forbidden_object_accessible");
  const dMissing = await evidenceFor("missing_object");
  ok("a permitted object missing from the schema -> fail closed (schema drift), no signature", dMissing.result.ok === false && dMissing.result.reason === "permitted_object_absent");
  const dPublic = await evidenceFor("public_grant_unexpected");
  ok("PUBLIC grant on an unreviewed object changes effective privilege result -> ownerOrExecutorAuthority true, not attestable", dPublic.result.ok === true && dPublic.result.evidence.privileges.ownerOrExecutorAuthority === true && evidenceIsAttestable(dPublic.result.evidence).ok === false);
  const dRoutine = await evidenceFor("routine_execute");
  ok("routine EXECUTE authority -> unapprovedRoutineAuthority true, not attestable", dRoutine.result.ok === true && dRoutine.result.evidence.privileges.unapprovedRoutineAuthority === true && evidenceIsAttestable(dRoutine.result.evidence).reason === "drift_routine_authority");
  const dSchema = await evidenceFor("schema_create");
  ok("CREATE on a reviewed schema -> ownerOrExecutorAuthority true, not attestable", dSchema.result.ok === true && dSchema.result.evidence.privileges.ownerOrExecutorAuthority === true);
  const dSeq = await evidenceFor("sequence_usage");
  ok("sequence USAGE (nextval = write) -> writePrivilegeCount > 0, not attestable", dSeq.result.ok === true && dSeq.result.evidence.privileges.writePrivilegeCount > 0 && evidenceIsAttestable(dSeq.result.evidence).ok === false);
  const dDb = await evidenceFor("database_create");
  ok("database-level CREATE -> write authority, not attestable", dDb.result.ok === true && dDb.result.evidence.privileges.writePrivilegeCount > 0 && evidenceIsAttestable(dDb.result.evidence).ok === false);
  const dMaint = await evidenceFor("maintain_pg17");
  ok("PostgreSQL 17+ MAINTAIN on a table -> unexpected authority, not attestable (live AI-STAGING is PG 18)", dMaint.result.ok === true && dMaint.result.evidence.privileges.ownerOrExecutorAuthority === true && evidenceIsAttestable(dMaint.result.evidence).ok === false);
  const dNoStats = await evidenceFor("observer_no_stats");
  ok("observer lacking pg_read_all_stats -> fail closed (cannot see backend_start; no session evidence at all)", dNoStats.result.ok === false && dNoStats.result.reason === "observer_lacks_session_visibility");
  const dSuper = await evidenceFor("observer_is_superuser");
  ok("observer holding superuser -> fail closed (least-privilege violated)", dSuper.result.ok === false && dSuper.result.reason === "observer_is_superuser");
  const dSelf = await evidenceFor("observer_is_reader");
  ok("observer identity == reader role -> fail closed (not independent)", dSelf.result.ok === false && dSelf.result.reason === "observer_is_reader");
  ok("negative privilege claims are never inferred from absent GRANT rows alone (memberships are separately enumerated)", /readerMemberships/.test(readFileSync(join(ROOT, "evidence-evaluator.mjs"), "utf8")) && /WITH RECURSIVE/.test(readFileSync(join(ROOT, "evidence-queries.mjs"), "utf8")));

  console.log("E. Ed25519 signing adapter (issues only from measured evidence; no caller-supplied payload)");
  const key2 = edKeyPair();
  const sig1 = createSigningAdapter({ issuer: "owner-attester-e", privateKeyPkcs8B64: key2.privateKeyPkcs8B64, proofLifetimeMs: 120000, nowProvider: nowP });
  ok("signing adapter constructs from a valid Ed25519 PKCS8 key", sig1.ok === true && sig1.signer.keyId === publicKeyFingerprintFromDerB64(key2.publicKeyDerB64));
  const nonEd = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  ok("non-Ed25519 key refused", createSigningAdapter({ issuer: "owner-x", privateKeyPkcs8B64: nonEd, proofLifetimeMs: 1000, nowProvider: nowP }).reason === "signing_key_not_ed25519");
  ok("malformed key material refused", createSigningAdapter({ issuer: "owner-x", privateKeyPkcs8B64: "not-a-key", proofLifetimeMs: 1000, nowProvider: nowP }).reason === "signing_key_invalid");
  ok("proof lifetime out of bounds refused at construction", createSigningAdapter({ issuer: "owner-x", privateKeyPkcs8B64: key2.privateKeyPkcs8B64, proofLifetimeMs: 999999, nowProvider: nowP }).reason === "proof_lifetime_invalid");
  const goodEv = dBase.result.evidence;
  const target1 = { projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment, pgServiceId: FIXED.ai_staging_postgres };
  const issued1 = sig1.signer.issue({ requestNonce: "0123456789abcdef0123456789abcdef", target: target1, connection: goodEv.connection, privileges: goodEv.privileges });
  ok("signer issues an envelope from measured evidence", issued1.ok === true);
  const trustRoot1 = makeAttesterTrustRoot({ issuer: sig1.signer.issuer, publicKeyDerB64: sig1.signer.publicKeyDerB64, fingerprint: sig1.signer.keyId });
  const verified1 = verifyReaderAttestation(issued1.envelope, { trustRoot: trustRoot1.trustRoot, expectedConnectionToken: goodEv.connection.token, expectedRequestNonce: "0123456789abcdef0123456789abcdef", now: clock.t });
  ok("the ACCEPTED reader-host verifier (unmodified) accepts the real attester's signature", verified1.ok === true);
  ok("malformed request nonce refused before signing", sig1.signer.issue({ requestNonce: "short", target: target1, connection: goodEv.connection, privileges: goodEv.privileges }).reason === "request_nonce_invalid");
  ok("missing evidence fields refused before signing (no unsigned/partial fallback)", sig1.signer.issue({ requestNonce: "0123456789abcdef0123456789abcdef", target: null, connection: goodEv.connection, privileges: goodEv.privileges }).reason === "evidence_incomplete");
  const tampered = JSON.parse(JSON.stringify(issued1.envelope)); tampered.payload.privileges.writePrivilegeCount = 1;
  ok("tampering the signed payload after issuance invalidates the signature (accepted verifier)", verifyReaderAttestation(tampered, { trustRoot: trustRoot1.trustRoot, expectedConnectionToken: goodEv.connection.token, expectedRequestNonce: "0123456789abcdef0123456789abcdef", now: clock.t }).reason === "attestation_signature_invalid");
  ok("no signing key text anywhere in the produced envelope", !leaked(issued1.envelope, key2.privateKeyPkcs8B64) && !JSON.stringify(issued1.envelope).includes("PRIVATE"));

  console.log("F. Authenticated attestation channel (real server + real reader-host-side client)");
  async function startServer(scenario, over = {}) {
    const cl = makeSyntheticCluster({ scenario });
    const key = edKeyPair();
    const sig = createSigningAdapter({ issuer: over.issuer || "owner-attester-f", privateKeyPkcs8B64: key.privateKeyPkcs8B64, proofLifetimeMs: over.proofLifetimeMs || 120000, nowProvider: over.nowProvider || nowP });
    const anchor = parseDeploymentAnchor(over.anchorJson || cl.goodAnchorJson()).anchor;
    let observerCallCount = 0;
    const provider = over.observerProvider || (async () => { observerCallCount++; const p = await cl.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); });
    const port = over.port || await freePort();
    const server = await startAttestationServer({ channelSecret: over.channelSecret || CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port, allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: provider, signer: sig.signer, anchor, nowProvider: over.nowProvider || nowP, log: () => {}, offlineTestBoundary: true });
    openThings.push(server);
    return { server, cl, sig, anchor };
  }
  const f1 = await startServer("base");
  const t1 = await readerToken(f1.cl);
  const pF = f1.server.address.port;
  const trustF = makeAttesterTrustRoot({ issuer: f1.sig.signer.issuer, publicKeyDerB64: f1.sig.signer.publicKeyDerB64, fingerprint: f1.sig.signer.keyId }).trustRoot;
  const baseReq = (nonce, token = t1.token) => ({ contract: "AiStagingReaderAttestationV1", connectionToken: token, role: READER_ROLE, requestNonce: nonce });
  const nOk = rn("ok1");
  const good = await obtain(pF, baseReq(nOk));
  ok("valid authenticated request over the REAL reader-host channel client -> genuine signed envelope, verified by the ACCEPTED verifier", good.ok === true && verifyReaderAttestation(good.envelope, { trustRoot: trustF, expectedConnectionToken: t1.token, expectedRequestNonce: nOk, now: clock.t }).ok === true);
  ok("B. wrong channel secret -> attester answers unauthenticated (HMAC failure)", (await obtain(pF, baseReq(rn("wrongsecret")), { channelSecret: "a-different-synthetic-secret-000000000000" })).code === "unauthenticated");
  ok("C. stale request timestamp -> stale", (await obtain(pF, baseReq(rn("stale")), { nowProvider: () => clock.t - 60000 })).code === "stale");
  // A replay is a byte-identical resend of an authenticated wire line (the real client never reuses a nonce).
  function rawSendLine(port, line) { return new Promise((res) => { const sk = net.createConnection({ host: "127.0.0.1", port }, () => sk.write(line)); let b = ""; sk.setEncoding("utf8"); sk.on("data", (d) => { b += d; }); sk.on("end", () => { try { res(JSON.parse(b)); } catch { res(null); } }); sk.on("error", () => res(null)); }); }
  const { createHmac: hm } = await import("node:crypto");
  const rArgs = baseReq(rn("replay")); const rNonce = "replaynonce000000001"; const rTs = clock.t;
  const rMac = hm("sha256", CHANNEL_SECRET).update(["reader-attestation-channel-v1", "attest", JSON.stringify(rArgs), rNonce, String(rTs)].join("\n")).digest("hex");
  const rLine = JSON.stringify({ v: "reader-attestation-channel-v1", op: "attest", args: rArgs, nonce: rNonce, ts: rTs, mac: rMac }) + "\n";
  const rep1 = await rawSendLine(pF, rLine); const rep2 = await rawSendLine(pF, rLine);
  ok("C. byte-identical replay of an authenticated request -> first signed, second 'replayed'", rep1 && rep1.ok === true && rep2 && rep2.ok === false && rep2.code === "replayed");
  // raw-protocol probes (accepted wire framing) for arbitrary op / extra caller-selected fields
  function rawSend(port, obj) { return new Promise((res) => { const sk = net.createConnection({ host: "127.0.0.1", port }, () => sk.write(JSON.stringify(obj) + "\n")); let b = ""; sk.setEncoding("utf8"); sk.on("data", (d) => { b += d; }); sk.on("end", () => { try { res(JSON.parse(b)); } catch { res(null); } }); sk.on("error", () => res(null)); }); }
  const { createHmac } = await import("node:crypto");
  const macRaw = (v, op, args, nonce, ts) => createHmac("sha256", CHANNEL_SECRET).update([v, op, JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex");
  const V = "reader-attestation-channel-v1";
  const opArgs = { ...baseReq(rn("op")), sql: "DROP TABLE x" };
  const badOp = { v: V, op: "select_sql", args: opArgs, nonce: "unknownop00000001", ts: clock.t };
  const badOpRes = await rawSend(pF, { ...badOp, mac: macRaw(V, "select_sql", badOp.args, badOp.nonce, badOp.ts) });
  ok("D. arbitrary operation with an SQL-like field -> unknown_op, never executed", badOpRes && badOpRes.ok === false && badOpRes.code === "unknown_op");
  const exArgs = { ...baseReq(rn("extra")), table: "budget_decisions" };
  const ex = { v: V, op: "attest", args: exArgs, nonce: "extrafield0000001", ts: clock.t };
  const exRes = await rawSend(pF, { ...ex, mac: macRaw(V, "attest", ex.args, ex.nonce, ex.ts) });
  ok("D. caller-selected extra field in args -> bad_request (exact args only; no table/SQL selection)", exRes && exRes.ok === false && exRes.code === "bad_request");
  const selfKeyArgs = { ...baseReq(rn("selfkey")), publicKeyDerB64: "AAAA" };
  const sk2 = { v: V, op: "attest", args: selfKeyArgs, nonce: "selfkeyfield00001", ts: clock.t };
  const skRes = await rawSend(pF, { ...sk2, mac: macRaw(V, "attest", sk2.args, sk2.nonce, sk2.ts) });
  ok("D. caller-supplied key in args -> bad_request (no caller-selected trust root)", skRes && skRes.ok === false && skRes.code === "bad_request");
  await f1.server.close(); await t1.readerPhys.close();

  // E. wrong AI-STAGING target — the server refuses to even START bound to it (stronger than per-request)
  const fE = await startServer("base");
  const badAnchorParsed = parseDeploymentAnchor(JSON.stringify({ ...JSON.parse(fE.cl.goodAnchorJson()), environmentId: "00000000-0000-0000-0000-000000000000" }));
  let eThrew = false;
  try { await startAttestationServer({ channelSecret: CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port: await freePort(), allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: async () => establishObserverSession(await fE.cl.observerFactory.open(), { statementTimeoutMs: 1500 }), signer: fE.sig.signer, anchor: badAnchorParsed.anchor, nowProvider: nowP, log: () => {}, offlineTestBoundary: true }); }
  catch { eThrew = true; }
  ok("E. wrong AI-STAGING target anchor -> anchor_target_not_ai_staging; no server can start bound to it", badAnchorParsed.ok === false && badAnchorParsed.reason === "anchor_target_not_ai_staging" && eThrew === true);
  await fE.server.close();

  // E2. correct target, but the anchor names a DIFFERENT cluster than the one actually observed
  const fE2 = await startServer("base", { anchorJson: JSON.stringify({ ...JSON.parse(makeSyntheticCluster().goodAnchorJson()), clusterFingerprint: "b".repeat(64) }) });
  const tE2 = await readerToken(fE2.cl);
  ok("E. anchor bound to a different cluster than observed -> refused per request (no signature)", (await obtain(fE2.server.address.port, baseReq(rn("e2"), tE2.token))).code === "unavailable");
  await fE2.server.close(); await tE2.readerPhys.close();

  async function scenarioCode(scenario, tokenOverride) {
    const f = await startServer(scenario);
    const t = await readerToken(f.cl);
    const r = await obtain(f.server.address.port, baseReq(rn(scenario), tokenOverride || t.token));
    await f.server.close(); await t.readerPhys.close();
    return r;
  }
  ok("F. session under a different role -> no_such_session (no attestable reader session)", (await scenarioCode("wrong_role")).code === "no_such_session");
  ok("G. fabricated/incorrect connection token -> no_such_session (claimed token never trusted)", (await scenarioCode("base", "0".repeat(64))).code === "no_such_session");
  ok("H. forbidden-object access -> refused, no signature", (await scenarioCode("forbidden_object_accessible")).code === "unavailable");
  ok("H. unexpected write privilege -> refused, no signature", (await scenarioCode("write_privilege")).code === "unavailable");
  ok("I. PUBLIC grant on an unreviewed object -> refused, no signature", (await scenarioCode("public_grant_unexpected")).code === "unavailable");
  ok("I. inherited/extra role membership -> refused, no signature", (await scenarioCode("extra_membership")).code === "unavailable");
  ok("J. observer lacking pg_read_all_stats visibility -> refused, no signature", (await scenarioCode("observer_no_stats")).code === "unavailable");
  ok("K. schema drift (permitted object missing) -> refused, no signature", (await scenarioCode("missing_object")).code === "unavailable");

  console.log("N. Observer connection loss / source unavailability (bounded recovery, no fallback)");
  const clN = makeSyntheticCluster({ scenario: "base" });
  let attempts = 0;
  const flakyProvider = async () => { attempts++; try { const p = await clN.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); } catch { return { ok: false, reason: "observer_connection_failed" }; } };
  const keyN = edKeyPair();
  const sigN = createSigningAdapter({ issuer: "owner-attester-n", privateKeyPkcs8B64: keyN.privateKeyPkcs8B64, proofLifetimeMs: 120000, nowProvider: nowP });
  const serverN = await startAttestationServer({ channelSecret: CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port: await freePort(), allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: flakyProvider, signer: sigN.signer, anchor: parseDeploymentAnchor(clN.goodAnchorJson()).anchor, nowProvider: nowP, log: () => {}, offlineTestBoundary: true });
  openThings.push(serverN);
  const tN = await readerToken(clN);
  clN.state.failObserverOpens = 1;
  const nFail = await obtain(serverN.address.port, baseReq(rn("nfail"), tN.token));
  ok("N. observer unavailable at request time -> unavailable (fixed code, no crash, no signature)", nFail.ok === false && nFail.code === "unavailable" && attempts >= 1);
  const nRec = await obtain(serverN.address.port, baseReq(rn("nrec"), tN.token));
  ok("N. recovers when the observer is available again (fresh measurement, new signature)", nRec.ok === true);
  await serverN.close(); await tN.readerPhys.close();

  console.log("O. Signing failure never yields an unsigned/partial envelope");
  const clO = makeSyntheticCluster({ scenario: "base" });
  const brokenSigner = Object.freeze({ issuer: "owner-attester-o", keyId: "0".repeat(64), publicKeyDerB64: "AAAA", issue: () => ({ ok: false, reason: "signing_failed" }) });
  const serverO = await startAttestationServer({ channelSecret: CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port: await freePort(), allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: async () => establishObserverSession(await clO.observerFactory.open(), { statementTimeoutMs: 1500 }), signer: brokenSigner, anchor: parseDeploymentAnchor(clO.goodAnchorJson()).anchor, nowProvider: nowP, log: () => {}, offlineTestBoundary: true });
  openThings.push(serverO);
  const tO = await readerToken(clO);
  const oRes = await obtain(serverO.address.port, baseReq(rn("o"), tO.token));
  ok("O. signing failure -> fixed 'internal' code, no envelope returned", oRes.ok === false && oRes.code === "internal");
  await serverO.close(); await tO.readerPhys.close();

  console.log("S. Bounded channel concurrency + serialized observer work + clean shutdown");
  const clS = makeSyntheticCluster({ scenario: "base" });
  let held = 0; let peakHeld = 0; let release; const gate = new Promise((r) => { release = r; });
  // The provider blocks on a gate so we can observe how many are admitted at once. With the bounded
  // coordinator, observer work is SERIALIZED behind the single physical connection: only ONE provider() runs
  // concurrently even though the channel admits up to MAX_CONCURRENT requests.
  const slowProvider = async () => { held++; peakHeld = Math.max(peakHeld, held); await gate; held--; const p = await clS.observerFactory.open(); return establishObserverSession(p, { statementTimeoutMs: 1500 }); };
  const keyS = edKeyPair();
  const sigS = createSigningAdapter({ issuer: "owner-attester-s", privateKeyPkcs8B64: keyS.privateKeyPkcs8B64, proofLifetimeMs: 120000, nowProvider: nowP });
  const serverS = await startAttestationServer({ channelSecret: CHANNEL_SECRET, listen: { bindHost: "127.0.0.1", port: await freePort(), allowedPeerCidrs: ["127.0.0.1/32"] }, observerProvider: slowProvider, signer: sigS.signer, anchor: parseDeploymentAnchor(clS.goodAnchorJson()).anchor, nowProvider: nowP, log: () => {}, offlineTestBoundary: true });
  openThings.push(serverS);
  const tS = await readerToken(clS);
  const pS = serverS.address.port;
  const inflightReqs = [];
  for (let i = 0; i < ATTESTER_MAX_CONCURRENT; i++) inflightReqs.push(obtain(pS, baseReq(rn("s" + i), tS.token)));
  await sleep(150);
  const over = await obtain(pS, baseReq(rn("sover"), tS.token));
  const stS = serverS.stats();
  ok("S. channel admits up to MAX_CONCURRENT; a further request is 'busy'", over.ok === false && over.code === "busy");
  ok("S. observer work is SERIALIZED (one active, others queued — NOT four concurrent DB operations behind one connection)", peakHeld === OBSERVER_MAX_ACTIVE && stS.observer.activeEvidence <= OBSERVER_MAX_ACTIVE && stS.observer.queuedEvidence <= OBSERVER_MAX_QUEUED);
  release();
  const done = await Promise.all(inflightReqs);
  ok("S. all admitted requests complete once evidence is available (serialized, none dropped)", done.every((r) => r.ok === true));
  const t0 = Date.now(); await serverS.close(); const elS = Date.now() - t0;
  ok("S. clean shutdown is prompt (listener closed, coordinator drained)", elS < 2000);
  await tS.readerPhys.close();

  console.log("P. No production-mode fixture injection (attester + reader host)");
  ok("P. attester production refuses an injected observer factory", (await startAttesterService({ env: {}, observerFactory: clS.observerFactory, log: () => {} })).reason === "test_injection_refused_in_production");
  ok("P. attester production refuses an injected clock", (await startAttesterService({ env: {}, nowProvider: nowP, log: () => {} })).reason === "test_injection_refused_in_production");
  ok("P. reader host production still refuses injected sources (accepted allowlist unchanged)", R_OPTS.join(",") === "mode,env,log,onFatal,onDegraded");

  console.log("G. FULL production composition: real attester entrypoint + accepted reader-host entrypoint + gateway");
  const g1 = generateKeyPairSync("ed25519");
  const gPub = g1.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const gPriv = g1.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  const gIssuer = "owner-reader-attester-live-01";
  const clG = makeSyntheticCluster({ scenario: "base" });
  const ATT_NAME = "reader-attester.railway.internal", READER_TRANSPORT_SECRET = "synthetic-reader-gateway-transport-secret-9";
  register(new URL("./fixtures/pg-hook.mjs", import.meta.url));
  globalThis.__LAI03B_SYNTH_CLUSTER__ = clG;
  const dns = await import("node:dns");
  const origLookup = dns.default.lookup;
  const attPortG = await freePort(); const readerListenPortG = await freePort();
  dns.default.lookup = (h, o, cb) => { if (typeof o === "function") { cb = o; o = {}; } if (h === ATT_NAME) return o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4); return origLookup(h, o, cb); };

  // TEST HARNESS ONLY: simulate the Railway private-network SOURCE address of the reader host. In-process the
  // reader connects from 127.0.0.1; the harness presents that peer as 10.77.0.2 so the attester runs its REAL
  // production listener contract (private peer allowlist) unmodified. Never part of any production path.
  const origCreateServer = net.createServer;
  net.createServer = function (...args) {
    const i = args.findIndex((a) => typeof a === "function");
    if (i >= 0) { const l = args[i]; args[i] = function (sock) { const v = sock.remoteAddress; if (v === "127.0.0.1" || v === "::ffff:127.0.0.1") Object.defineProperty(sock, "remoteAddress", { value: "10.77.0.2", configurable: true }); return l.call(this, sock); }; }
    return origCreateServer.apply(this, args);
  };
  const attEnvG = { [A_ENV.observerDbUrl]: "postgres://attester_observer:pw@127.0.0.1:9/railway", [A_ENV.signingKeyPkcs8B64]: gPriv, [A_ENV.issuer]: gIssuer,
    [A_ENV.bindHost]: "0.0.0.0", [A_ENV.allowWildcardBind]: "true", [A_ENV.port]: String(attPortG), [A_ENV.allowedPeerCidrs]: "10.77.0.0/24", [A_ENV.channelSecret]: CHANNEL_SECRET,
    [A_ENV.deploymentAnchorRef]: clG.goodAnchorJson() };
  const attLogsG = []; const attCtrl = await startAttesterService({ env: attEnvG, log: (l) => attLogsG.push(l) });
  ok("REAL attester production entrypoint composes fully from env and serves", attCtrl.started === true && attCtrl.ready() === true && attCtrl.issuer === gIssuer);

  const readerEnvG = { [R_ENV.readerDbUrl]: "postgres://sentinel_reader:pw@127.0.0.1:9/railway", [R_ENV.attesterIssuer]: gIssuer, [R_ENV.attesterPublicKeyDerB64]: gPub, [R_ENV.attesterFingerprint]: publicKeyFingerprintFromDerB64(gPub),
    [R_ENV.attesterHost]: ATT_NAME, [R_ENV.attesterPort]: String(attPortG), [R_ENV.attesterChannelSecret]: CHANNEL_SECRET,
    LIVE_AI_03B_READER_TRANSPORT_SECRET: READER_TRANSPORT_SECRET, LIVE_AI_03B_READER_LISTEN_MODE: "loopback-tcp", LIVE_AI_03B_READER_BIND_HOST: "127.0.0.1", LIVE_AI_03B_READER_PORT: String(readerListenPortG) };
  const readerLogsG = []; const readerCtrl = await startProductionReaderService({ env: readerEnvG, log: (l) => readerLogsG.push(l) });
  ok("ACCEPTED reader-host production entrypoint composes its channel against the REAL attester and serves", readerCtrl.started === true && readerCtrl.phase() === "serving" && readerCtrl.ready() === true);

  const gwG = createGatewayObservationCaller({ destination: { host: "127.0.0.1", port: readerListenPortG }, secret: READER_TRANSPORT_SECRET, offlineTestBoundary: true, expectedMode: "production" }); // real clock: both services run in production mode
  const oD = await gwG.observe("dormant"), oA = await gwG.observe("armed"), oC = await gwG.observe("ceilings");
  ok("FULL CHAIN: simulated observer -> real attester composition -> authenticated attestation -> fresh evidence -> accepted connection-token verification -> accepted signed proof -> accepted reader-host entrypoint -> reader-only authority -> accepted serving runtime -> authenticated gateway observation (all three)",
    oD.ok && oA.ok && oC.ok && oD.message.mode === "production" && attCtrl.stats().signed >= 1);
  ok("no signing key / channel secret / DB URL leaked anywhere in either service's logs", !attLogsG.some((l) => leaked(l, gPriv)) && !readerLogsG.some((l) => leaked(l, gPriv)));
  ok("Q. the reader host holds ONLY the attester's PUBLIC key (no private/signing key material in its configuration)", !Object.values(readerEnvG).some((v) => v === gPriv || /PRIVATE KEY/.test(v)) && !Object.keys(readerEnvG).some((k) => /SIGNING|PRIVATE|PKCS8/.test(k)));
  ok("Q. the gateway caller holds no DB credential and no signing key", !JSON.stringify(gwG).includes(gPriv) && Object.keys(gwG).sort().join(",") === "available,destination,observe,version");

  console.log("M. Reader reconnection -> fresh attestation required (old token invalid for the new session)");
  const waitFor = async (cond, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(50); } return !!(await cond()); };
  const oldIds = clG.liveReaderIdentities();
  const oldTok = oldIds.length === 1 ? clG.tokenFor(oldIds[0]) : null;
  const signedBefore = attCtrl.stats().signed; const opensBefore = clG.state.opensReader;
  clG.killAllReaderSessions();
  const reconnected = await waitFor(() => readerCtrl.phase() === "serving" && clG.state.opensReader > opensBefore && attCtrl.stats().signed > signedBefore, 6000);
  const newIds = clG.liveReaderIdentities();
  const newTok = newIds.length === 1 ? clG.tokenFor(newIds[0]) : null;
  ok("M. reader connection loss -> accepted host re-establishes on a NEW connection and obtains a FRESH signature from the real attester", reconnected === true && !!oldTok && !!newTok && newTok !== oldTok);
  ok("M. serving resumes on the new connection", (await gwG.observe("ceilings")).ok === true);
  const stale = await obtain(attPortG, { contract: "AiStagingReaderAttestationV1", connectionToken: oldTok, role: READER_ROLE, requestNonce: rn("oldtok") }, { nowProvider: Date.now });
  ok("M. the previous connection's token is no longer attestable (no_such_session)", stale.ok === false && stale.code === "no_such_session");

  if (readerCtrl.started) await readerCtrl.stop();
  if (attCtrl.started) await attCtrl.stop();
  dns.default.lookup = origLookup;
  net.createServer = origCreateServer;
  ok("Q. no secret leaked anywhere across the whole full-chain run (logs + observations)", ![...attLogsG, ...readerLogsG].some((l) => leaked(l, gPriv)));

  console.log("I. Accepted/frozen source preservation + new-attester source boundaries");
  const H = (p) => createHash("sha256").update(readFileSync(resolve(L03B, p))).digest("hex");
  // All 17 accepted production-integration files, verified transitively through the accepted manifest
  // (manifest pinned by its accepted hash; every file it lists must still match).
  const ACC_MANIFEST = "private-reader-production-integration-offline-01/EVIDENCE-MANIFEST.json";
  const manOk = H(ACC_MANIFEST) === "771329d604e8652f7536869763389946519db0dac5fd9b8e3831b1d86966a4b8";
  const man = JSON.parse(readFileSync(resolve(L03B, ACC_MANIFEST), "utf8"));
  const listed = man.files.map((f) => ["private-reader-production-integration-offline-01/" + f.path, f.sha256]);
  const allMatch = listed.every(([p, h]) => H(p) === h);
  ok("all 17 accepted production-integration files byte-unchanged (manifest pinned + 16 listed files verified)", manOk && listed.length === 16 && allMatch);
  const RUNTIME11 = {
    "private-reader-host-runtime-offline-01/observation-transport.mjs": "06c01348d20c3e8b118b74aae086e24de8945e7ab043df4d4715eff21b4f6ca3",
    "private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs": "629540c525c9d52894d5236fa37baad5682c09c1216dd278ea755eed5ed9c459",
    "private-reader-host-runtime-offline-01/reader-only-authority.mjs": "ff38a8cc18184281e153dee0bd1b38d620015cc98ba281c7a241b39437efd3f8",
    "private-reader-host-runtime-offline-01/runtime-config.mjs": "4843ecb038f9d91b9f5725f9476838a95ae4e4e49a99ec82fbd846a5a846c62e",
  };
  ok("accepted serving-runtime files byte-unchanged", Object.entries(RUNTIME11).every(([p, h]) => H(p) === h));
  const FROZEN = {
    "private-reader-host-offline-01/private-reader-host.mjs": "3f25bcd3975318cca5c6619beb016e6159ba06c263eb32f11d8873e650723525",
    "trusted-executor-runtime-01/db-target-binding.mjs": "c1fec8b68fe79ec2d7615ff9b401034d8f96a7e8b82ab342a5b53f1c6fbdd0ea",
    "trusted-activation-boundary-01/pricing-approval-contract.mjs": "59ef03ea3b0532100cf59c19a7f4f174543a4dea0e688359ced858e974312ad3",
    "trusted-runtime-live-binding-offline-01/production-read-queries.mjs": "42ddf87d268183183d3851a91e9df57b8e9e2a1c3d629412a24a489e9646ed0c",
  };
  ok("frozen predecessor files byte-unchanged", Object.entries(FROZEN).every(([p, h]) => H(p) === h));
  const NEW_SRC = ["attester-config.mjs", "evidence-queries.mjs", "observer-connection.mjs", "evidence-evaluator.mjs", "target-binding.mjs", "signing-adapter.mjs", "attestation-server.mjs", "attester-entrypoint.mjs"];
  const srcAll = NEW_SRC.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
  ok("no PEM private-key material anywhere in new source", !/BEGIN (RSA |EC |ENCRYPTED )?PRIVATE KEY/.test(srcAll));
  ok("no hardcoded PKCS8/base64 key blob in source (heuristic: no long base64 run outside comments)", !srcAll.split("\n").some((line) => !line.trim().startsWith("//") && /[0-9A-Za-z+/]{100,}={0,2}/.test(line)));
  ok("no executor client / executor credential referenced in new source", !/executorDbClient/.test(srcAll) && !/TRUSTED_EXECUTOR_DB_URL"?\s*[,:)\]]/.test(srcAll.replace(/FORBIDDEN_ENV[\s\S]{0,300}/, "")));
  ok("production modules never import test fixtures", !NEW_SRC.some((f) => /tests\/|fixtures\//.test(readFileSync(join(ROOT, f), "utf8"))));
  ok("no HTTP/fetch/child_process in the attester source", !/from\s+["'](node:)?(http|https|http2)["']/.test(srcAll) && !/\bfetch\s*\(/.test(srcAll) && !/child_process/.test(srcAll));
  ok("reader-host verifier (reader-attestation.mjs) was NOT modified or duplicated by the attester", !NEW_SRC.some((f) => readFileSync(join(ROOT, f), "utf8").includes("function verifyReaderAttestation")));

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed, 0 skipped  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE GENUINE-ATTESTER VERIFICATION: PASS");
  console.log("SCOPE: synthetic PostgreSQL cluster (shared reader+observer sessions) + in-memory Ed25519 fixture keys + real local loopback sockets through the REAL attester entrypoint AND the ACCEPTED reader-host production entrypoint — NOT live AI-STAGING privileges, a real deployment anchor, Railway isolation, or a deployed attester service.");
  process.exitCode = 0;
}

import { spawnSync } from "node:child_process";
function spawnSyncCheck() {
  return spawnSync(process.execPath, [join(ROOT, "attester-entrypoint.mjs")], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 20000 });
}

run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; }).finally(async () => {
  for (const s of openThings) { try { await s.close(); } catch {} }
});
