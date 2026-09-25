// SYNTHETIC BOOTSTRAP ENV — TEST ONLY. A controllable shared DB clock + the ACCEPTED synthetic cluster (observer,
// reader token, anchor) + a real Ed25519 signer, so the v2 clock-gated server and the reader/attester bootstraps
// run their REAL code paths against synced synthetic clocks. Node built-ins only; no network beyond loopback.
import { generateKeyPairSync } from "node:crypto";
import { createSigningAdapter } from "../../../private-reader-attester-offline-01/signing-adapter.mjs";
import { parseDeploymentAnchor, clusterFingerprint } from "../../../private-reader-attester-offline-01/target-binding.mjs";
import { establishObserverSession } from "../../../private-reader-attester-offline-01/observer-connection.mjs";
import { makeAttesterTrustRoot } from "../../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { makeSyntheticCluster } from "../../../private-reader-attester-offline-01/tests/fixtures/synthetic-cluster.mjs";
import { LIFECYCLE_SQL } from "../../../private-reader-production-integration-offline-01/reader-session.mjs";
import { makeDbClockProbe } from "../../db-clock-probe.mjs";
import { takeSample } from "../../clock-interval.mjs";

export function edKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKeyDerB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKeyPkcs8B64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}

export async function makeBootstrapEnv({ rttUs = 2000, issuer = "owner-bootstrap-1" } = {}) {
  const cl = makeSyntheticCluster({ scenario: "base" });
  const key = edKeyPair();
  const sig = createSigningAdapter({ issuer, privateKeyPkcs8B64: key.privateKeyPkcs8B64, proofLifetimeMs: 120000, nowProvider: () => Date.now() });
  if (!sig.ok) throw new Error("signer_build_failed:" + sig.reason);
  const anchor = parseDeploymentAnchor(cl.goodAnchorJson()).anchor;
  const trustRoot = makeAttesterTrustRoot({ issuer: sig.signer.issuer, publicKeyDerB64: sig.signer.publicKeyDerB64, fingerprint: sig.signer.keyId }).trustRoot;
  const expectedFingerprint = clusterFingerprint({ datname: cl.state.datname, databaseOid: cl.state.databaseOid, readerRoleOid: cl.state.readerRoleOid, encoding: cl.state.encoding });

  // an observed reader session + its accepted connection token
  const rp = await cl.readerFactory.open({});
  const idr = await rp.query(LIFECYCLE_SQL.readIdentity, []);
  const connectionToken = cl.tokenFor({ pid: idr.rows[0].pid, backendStart: idr.rows[0].backend_start, applicationName: idr.rows[0].application_name });

  const observerProvider = async () => establishObserverSession(await cl.observerFactory.open(), { statementTimeoutMs: 1500 });

  const BASE = 1700000000000000;               // shared synthetic real time (µs)
  const S = { T: BASE };
  const ctrl = {
    rttUs, readerBroken: false, attesterBroken: false,
    advanceUs: (us) => { S.T += us; },          // advance shared time WITHOUT a probe (age the monitor)
    now: () => S.T,
  };
  const wallMs = () => Math.floor(S.T / 1000);
  const monoUs = () => (S.T - BASE);
  function clockQuery(isBroken) {
    return async () => {
      if (isBroken()) throw new Error("db_clock_unreachable");
      const dbAtSend = S.T; S.T += ctrl.rttUs;   // the round trip elapses on the shared clock
      const dbMid = dbAtSend + Math.floor(ctrl.rttUs / 2);
      return { rows: [{ db_micros: String(dbMid), datname: cl.state.datname, database_oid: cl.state.databaseOid, reader_role_oid: cl.state.readerRoleOid, encoding: cl.state.encoding }] };
    };
  }
  const readerProbe = makeDbClockProbe({ query: clockQuery(() => ctrl.readerBroken), expectedFingerprint });
  const attesterProbe = makeDbClockProbe({ query: clockQuery(() => ctrl.attesterBroken), expectedFingerprint });
  const readerTakeSample = () => takeSample({ wallNowMs: wallMs, monoNowUs: monoUs, probe: readerProbe });
  const attesterTakeSample = () => takeSample({ wallNowMs: wallMs, monoNowUs: monoUs, probe: attesterProbe });

  return {
    cl, rp, signer: sig.signer, signingKeyPriv: key.privateKeyPkcs8B64, anchor, trustRoot, expectedFingerprint,
    connectionToken, observerProvider, readerTakeSample, attesterTakeSample, monoNowUs: monoUs, wallMs, ctrl, S,
    peerCidrs: ["127.0.0.1/32"],
    async cleanup() { try { await rp.close(); } catch {} },
  };
}

/** A scripted takeSampleFn returning queued samples in order (for targeted failure injection). */
export function scriptedTakeSample(samples) {
  let i = 0;
  return async () => { const s = samples[Math.min(i, samples.length - 1)]; i++; return s; };
}
