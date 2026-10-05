// TEST-ONLY — synthetic dual-client environment for the Step6/7 verifier. OFFLINE: loopback only, no real DB.
// Runs the REAL accepted executor-attester server (executor-attestation-channel-v1) and the REAL accepted v2
// clock-gated reader attestation server, each over the ACCEPTED synthetic clusters, with TEST-ONLY Ed25519 keys
// generated in memory per run (never written). Every secret-like value here is synthetic and per-run random.
import { generateKeyPairSync, randomBytes, sign as edSign, createPrivateKey } from "node:crypto";
import { canonicalize, publicKeyFingerprintFromDerB64 } from "../../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { cleanState, syntheticPhysical } from "../../../m7-v2-executor-attester-issuer-offline-01/tests/fixtures/synthetic-executor-cluster.mjs";
import { makeSyntheticCluster } from "../../../private-reader-attester-offline-01/tests/fixtures/synthetic-cluster.mjs";
import { startExecutorAttestationServer } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-server.mjs";
import { createExecutorSigningAdapter } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-signing-adapter.mjs";
import { establishExecutorObserverSession } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-observer.mjs";
import { executorClusterFingerprint, parseExecutorDeploymentAnchor, EXECUTOR_ANCHOR_CONTRACT, EXECUTOR_ANCHOR_DOMAIN, AI_STAGING } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-target-binding.mjs";
import { createExecutorAttestationSourceChannel } from "../../../m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs";
import { startV2AttestationServer } from "../../../private-reader-bootstrap-clock-peer-offline-01/attestation-channel-v2.mjs";
import { createSigningAdapter } from "../../../private-reader-attester-offline-01/signing-adapter.mjs";
import { establishObserverSession } from "../../../private-reader-attester-offline-01/observer-connection.mjs";
import { parseDeploymentAnchor, clusterFingerprint } from "../../../private-reader-attester-offline-01/target-binding.mjs";
import { DB_CLOCK_QUERY } from "../../../private-reader-bootstrap-clock-peer-offline-01/db-clock-probe.mjs";
import { EXECUTOR_LIFECYCLE_SQL } from "../../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { makeTestClock } from "../../../m7-v2-production-authority-provisioning-offline-01/src/trusted-clock.mjs";
import { loadStep67Config } from "../../src/step67-config.mjs";
import { acquireReaderV2Attestation } from "../../src/reader-v2-attestation-source.mjs";
import { AUTHORITY_EXECUTOR_ATTESTER_ENV as EX, AUTHORITY_READER_ATTESTER_ENV as RD, AUTHORITY_ANCHOR_ENV, DB_ENV } from "../../src/constants.mjs";

export const EX_ISSUER = "TEST-ONLY-step67-executor-attester", RD_ISSUER = "TEST-ONLY-step67-authority-reader-attester";
export function kp() {
  const k = generateKeyPairSync("ed25519"); const der = k.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { pk8: k.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), der, fp: publicKeyFingerprintFromDerB64(der) };
}
/** Sign an arbitrary attestation payload with a TEST key (to model "validly signed but drifted/stale" proofs). */
export function signPayload(payload, pk8) {
  const key = createPrivateKey({ key: Buffer.from(pk8, "base64"), format: "der", type: "pkcs8" });
  return { payload, signatureB64: edSign(null, Buffer.from(canonicalize(payload), "utf8"), key).toString("base64") };
}

/** Executor CLIENT physical over the synthetic executor cluster: answers ONLY the accepted executor lifecycle SQL. */
function executorClientPhysical(session, ctl) {
  let dead = false; let timeout = null;
  const log = [];
  return Object.freeze({
    applicationName: session.application_name, log,
    async query(sql, params) {
      log.push(sql);
      if (dead) throw new Error("connection terminated");
      if (sql === EXECUTOR_LIFECYCLE_SQL.setStatementTimeout) { timeout = params[0]; return { rows: [{ v: params[0] }] }; }
      if (sql === EXECUTOR_LIFECYCLE_SQL.readStatementTimeout) return { rows: [{ v: timeout }] };
      if (sql === EXECUTOR_LIFECYCLE_SQL.readIdentity) {
        const id = ctl.identityOverride ? ctl.identityOverride() : session;
        return { rows: [{ current_user: id.usename || session.usename, session_user: id.usename || session.usename, pid: id.pid, backend_start: id.backend_start, application_name: id.application_name }] };
      }
      if (sql === EXECUTOR_LIFECYCLE_SQL.readDbClockMs) return { rows: [{ ms: String(Date.now() + (ctl.dbSkewMs || 0)) }] };
      throw new Error("executor client: SQL outside the accepted lifecycle set");
    },
    isDead() { return dead; }, kill() { dead = true; }, async close() { dead = true; },
  });
}

/** Reader physical wrapper: delegates the accepted lifecycle SQL to the synthetic cluster session; answers the accepted
 *  fixed DB clock probe from a REAL-time emulated PostgreSQL clock (+ configurable skew). Any other SQL is refused. */
function readerClockWrappedPhysical(inner, cl, ctl) {
  const log = [];
  return Object.freeze({
    applicationName: inner.applicationName, log,
    isDead: () => inner.isDead(), onDead: (cb) => inner.onDead(cb), kill: () => { void inner.close(); },
    async close() { return inner.close(); },
    async query(sql, params) {
      log.push(sql);
      if (sql === DB_CLOCK_QUERY) {
        if (inner.isDead()) throw new Error("connection terminated");
        const us = Date.now() * 1000 + (ctl.readerDbSkewUs || 0);
        return { rows: [{ db_micros: String(us), datname: cl.state.datname, database_oid: cl.state.databaseOid, reader_role_oid: cl.state.readerRoleOid, encoding: cl.state.encoding }] };
      }
      return inner.query(sql, params);
    },
  });
}

/**
 * Build a full dual environment. `over` tweaks: executorState(state), readerScenario, attesterIntervalUs, readerDbSkewUs,
 * exPeerCidrs, rdPeerCidrs, exServerSecret, rdServerSecret, pinsOver, envOver, sharePid, shareAppName.
 */
export async function makeDualEnv(over = {}) {
  const ctl = { readerDbSkewUs: over.readerDbSkewUs || 0, dbSkewMs: 0, attesterIntervalUs: over.attesterIntervalUs || [-3000, 3000] };
  // keys
  const EXK = kp(), RDK = kp(), M5K = kp();
  const EX_SECRET = randomBytes(24).toString("hex"), RD_SECRET = randomBytes(24).toString("hex");
  // ── executor side ──
  const xs = cleanState();
  if (typeof over.executorState === "function") over.executorState(xs);
  const exSession = xs.sessions[0];
  const anchorX = parseExecutorDeploymentAnchor(JSON.stringify({ contract: EXECUTOR_ANCHOR_CONTRACT, domain: EXECUTOR_ANCHOR_DOMAIN, projectId: AI_STAGING.projectId,
    environmentId: AI_STAGING.environmentId, pgServiceId: AI_STAGING.pgServiceId,
    clusterFingerprint: executorClusterFingerprint({ datname: xs.cluster.datname, databaseOid: xs.cluster.database_oid, executorRoleOid: xs.cluster.executor_role_oid, encoding: xs.cluster.encoding }),
    issuedAtMs: 1759140000000, verifiedBy: "TEST-ONLY-step67" }), { offlineTestBoundary: true }).anchor;
  const exSigner = createExecutorSigningAdapter({ issuer: EX_ISSUER, privateKeyPkcs8B64: EXK.pk8, expectedPublicKeyDerB64: EXK.der, expectedFingerprint: EXK.fp,
    readerAttesterFingerprint: M5K.fp, proofLifetimeMs: 120000, offlineTestBoundary: true });   // live mirror: the executor attester only knows the M5 pin
  if (!exSigner.ok) throw new Error("ex signer " + exSigner.reason);
  const exSrv = await startExecutorAttestationServer({ channelSecret: over.exServerSecret || EX_SECRET, listen: { bindHost: "127.0.0.1", port: 0, allowedPeerCidrs: over.exPeerCidrs || ["127.0.0.1/32"] },
    signer: exSigner.signer, anchor: anchorX, nowProvider: () => Date.now(), log: () => {}, offlineTestBoundary: true,
    observerProvider: async () => establishExecutorObserverSession(syntheticPhysical(xs)) });
  // ── reader side ──
  const cl = makeSyntheticCluster({ scenario: over.readerScenario || "base" });
  const rdAnchorJson = cl.goodAnchorJson();
  const rdSigner = createSigningAdapter({ issuer: RD_ISSUER, privateKeyPkcs8B64: RDK.pk8, proofLifetimeMs: 120000 });
  if (!rdSigner.ok) throw new Error("rd signer " + rdSigner.reason);
  const rdSrv = await startV2AttestationServer({ channelSecret: over.rdServerSecret || RD_SECRET, listen: { bindHost: "127.0.0.1", port: 0 },
    observerProvider: async () => establishObserverSession(await cl.observerFactory.open(), { statementTimeoutMs: 1500 }),
    signer: rdSigner.signer, anchor: parseDeploymentAnchor(rdAnchorJson).anchor,
    attesterClockInterval: () => ({ L: ctl.attesterIntervalUs[0], U: ctl.attesterIntervalUs[1] }), signingEnabled: () => true,
    peerCidrs: over.rdPeerCidrs || ["127.0.0.1/32"], offlineTestBoundary: true, log: () => {} });
  // ── Authority env (synthetic values; DB URLs never opened — factories are injected) ──
  const env = {
    [DB_ENV.executorDbUrl]: "postgresql://synthetic-executor:" + randomBytes(9).toString("hex") + "@db.example.test:5432/railway",
    [DB_ENV.readerDbUrl]: "postgresql://synthetic-reader:" + randomBytes(9).toString("hex") + "@db.example.test:5432/railway",
    [EX.issuer]: EX_ISSUER, [EX.publicKeyDerB64]: EXK.der, [EX.fingerprint]: EXK.fp, [EX.host]: "127.0.0.1", [EX.port]: String(exSrv.address.port), [EX.channelSecret]: EX_SECRET,
    [RD.issuer]: RD_ISSUER, [RD.publicKeyDerB64]: RDK.der, [RD.fingerprint]: RDK.fp, [RD.host]: "127.0.0.1", [RD.port]: String(rdSrv.address.port), [RD.channelSecret]: RD_SECRET,
    [AUTHORITY_ANCHOR_ENV]: rdAnchorJson, ...(over.envOver || {}),
  };
  const pins = { expectedExecutorAttesterFingerprint: EXK.fp, expectedReaderAttesterFingerprint: RDK.fp, forbiddenReaderAttesterFingerprint: M5K.fp, ...(over.pinsOver || {}) };
  const opened = { executor: [], reader: [] };
  const executorPhysicalFactory = { async open() { const p = executorClientPhysical(exSession, ctl); opened.executor.push(p); return p; } };
  const readerPhysicalFactory = { async open(o) {
    const inner = await cl.readerFactory.open(over.shareAppName ? { applicationName: exSession.application_name } : (o || {}));
    const p = readerClockWrappedPhysical(inner, cl, ctl); opened.reader.push(p); return p; } };
  if (over.sharePid) {           // the next synthetic reader backend pid is predictable (accepted fixture starts at 51001)
    exSession.pid = 51001;
  }
  const expectedReaderFingerprint = clusterFingerprint({ datname: cl.state.datname, databaseOid: cl.state.databaseOid, readerRoleOid: cl.state.readerRoleOid, encoding: cl.state.encoding });
  function deps(extra = {}) {
    const cfg = loadStep67Config(env, pins, { testBoundary: true });
    if (!cfg.ok) return { cfgFail: cfg };
    const exSrc = createExecutorAttestationSourceChannel({ host: cfg.executorAttester.host, port: cfg.executorAttester.port, channelSecret: env[EX.channelSecret], readerChannelSecret: env[RD.channelSecret] }, { offlineTestBoundary: true });
    if (!exSrc.ok) return { cfgFail: exSrc };
    return {
      config: cfg, executorPhysicalFactory, readerPhysicalFactory, executorSource: exSrc.source, readerChannelSecret: env[RD.channelSecret],
      clock: makeTestClock(() => Date.now(), { testBoundary: true }),
      acquireReaderV2: (x) => acquireReaderV2Attestation({ ...x, testBoundary: true }),
      ...extra,
    };
  }
  return {
    env, pins, keys: { EXK, RDK, M5K }, secrets: { EX_SECRET, RD_SECRET }, xs, cl, ctl, exSrv, rdSrv, exSession, opened, deps,
    executorPhysicalFactory, readerPhysicalFactory, expectedReaderFingerprint,
    async close() { try { await exSrv.close(); } catch {} try { await rdSrv.close(); } catch {} },
  };
}
