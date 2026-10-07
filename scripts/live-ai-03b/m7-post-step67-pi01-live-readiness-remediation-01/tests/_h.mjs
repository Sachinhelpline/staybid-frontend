// TEST-ONLY shared helpers (offline; synthetic, non-secret throwaway material generated per run).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import net from "node:net";
import { publicKeyFingerprintFromDerB64, FIXED_V3 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs";
import { EXECUTOR_ATTESTATION_ISSUER_V2 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { ANCHOR_CONTRACT, ANCHOR_DOMAIN } from "../../private-reader-attester-offline-01/target-binding.mjs";
import { EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV, DEPLOYMENT_ANCHOR_ENV, DB_ENV, V3_REQUIRED_ENV } from "../src/authority-v3-config.mjs";

export function counter(name) {
  let pass = 0, fail = 0; const fails = [];
  const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS " + n); } else { fail++; fails.push(n); console.log("  FAIL " + n + (d !== undefined ? "  :: " + JSON.stringify(d).slice(0, 400) : "")); } };
  const done = () => { console.log(`${name}: ${pass} passed, ${fail} failed`); if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exitCode = 1; } return { pass, fail }; };
  return { ok, done };
}
export function edKey() {
  const kp = generateKeyPairSync("ed25519");
  const der = kp.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { kp, der, pk8: kp.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), fp: publicKeyFingerprintFromDerB64(der) };
}
export const hexSecret = () => randomBytes(24).toString("hex");   // 48 chars ≥ 32
/** Network observation: counts every outbound socket connect attempt during a test window. */
export function netCounter() {
  const seen = []; const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...a) { const o = Array.isArray(a[0]) ? a[0][0] : a[0]; seen.push(typeof o === "object" && o ? (o.path ? "unix:" : "") + String(o.host ?? o.path) : String(o)); return orig.apply(this, a); };
  return { seen, restore() { net.Socket.prototype.connect = orig; } };
}
export const readerAnchor = (over = {}) => JSON.stringify({ clusterFingerprint: "c".repeat(64), contract: ANCHOR_CONTRACT, domain: ANCHOR_DOMAIN,
  environmentId: FIXED_V3.ai_staging_environment, issuedAtMs: 1791300000000, pgServiceId: FIXED_V3.ai_staging_postgres, projectId: FIXED_V3.ai_staging_project,
  verifiedBy: "owner-verified-synthetic", ...over });

/** A complete, synthetic V3 Authority environment (no real value anywhere). */
export function authorityEnv(over = {}) {
  const rev = edKey(), ex = edKey(), rd = edKey();
  const env = {
    [V3_REQUIRED_ENV.version]: "V3",
    [V3_REQUIRED_ENV.reviewerDer]: rev.der, [V3_REQUIRED_ENV.reviewerFp]: rev.fp,
    [V3_REQUIRED_ENV.project]: FIXED_V3.ai_staging_project, [V3_REQUIRED_ENV.environment]: FIXED_V3.ai_staging_environment,
    [V3_REQUIRED_ENV.pg]: FIXED_V3.ai_staging_postgres, [V3_REQUIRED_ENV.gateway]: FIXED_V3.ai_staging_gateway,
    [V3_REQUIRED_ENV.connectionRef]: EXECUTOR_ATTESTATION_ISSUER_V2,
    [DB_ENV.executorDbUrl]: "postgresql://synthetic-executor@db.invalid/x", [DB_ENV.readerDbUrl]: "postgresql://synthetic-reader@db.invalid/x",
    [DEPLOYMENT_ANCHOR_ENV]: readerAnchor(),
    [EXECUTOR_ATTESTER_ENV.issuer]: EXECUTOR_ATTESTATION_ISSUER_V2, [EXECUTOR_ATTESTER_ENV.publicKeyDerB64]: ex.der, [EXECUTOR_ATTESTER_ENV.fingerprint]: ex.fp,
    [EXECUTOR_ATTESTER_ENV.host]: "executor-attester.railway.internal", [EXECUTOR_ATTESTER_ENV.port]: "8551", [EXECUTOR_ATTESTER_ENV.channelSecret]: hexSecret(),
    [READER_ATTESTER_ENV.issuer]: "owner-dedicated-reader-attester-synthetic", [READER_ATTESTER_ENV.publicKeyDerB64]: rd.der, [READER_ATTESTER_ENV.fingerprint]: rd.fp,
    [READER_ATTESTER_ENV.host]: "reader-attester.railway.internal", [READER_ATTESTER_ENV.port]: "8552", [READER_ATTESTER_ENV.channelSecret]: hexSecret(),
  };
  return { env: { ...env, ...over }, keys: { rev, ex, rd } };
}
