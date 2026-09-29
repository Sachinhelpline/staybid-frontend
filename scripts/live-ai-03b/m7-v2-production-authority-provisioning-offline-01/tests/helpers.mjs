// TEST-ONLY helpers for the V2 production-authority provisioning suite. Synthetic Ed25519 keys generated per run
// (never persisted), synthetic ids, TEST-ONLY issuers/provenances, in-memory "physical connections" that script
// the exact lifecycle SQL + the preserved runtime SQL. Never imported by any src/ module (static scan asserted).
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { publicKeyFingerprintFromDerB64 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import { ATTESTATION_CONTRACT as READER_ATT_CONTRACT, ATTESTATION_DOMAIN as READER_ATT_DOMAIN } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { LIFECYCLE_SQL as READER_LIFECYCLE_SQL } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { READER_ROLE, READER_EXPECTED_SELECT_GRANTS } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { TARGETS_V2, CATALOG_V2 } from "../../m7-step2-runtime-rebinding-offline-01/identity/v2-identity.mjs";
import { STEP2_BINDING_CONTRACT, STEP2_PIN_STATUS_PRESERVED, STEP2_TEST_PROVENANCE, measureRuntimeManifest, ACCEPTED_M5_CLOSURE, HISTORICAL_STEP2_PRESERVATION } from "../../m7-step2-runtime-rebinding-offline-01/identity/v2-source-identity.mjs";
import * as REG from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-query-registry.mjs";
import { ACTIVATE_SQL_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-restricted-activation-adapter.mjs";
import { STATES, testEnv } from "../../m7-step2-runtime-rebinding-offline-01/tests/helpers.mjs";
import { EXECUTOR_LIFECYCLE_SQL, EXECUTOR_ROLE, EXECUTOR_APPLICATION_NAME_PREFIX } from "../src/executor-session.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT, EXECUTOR_ATTESTATION_DOMAIN, EXPECTED_EXECUTOR_PRIVILEGES } from "../src/executor-attestation.mjs";
import { EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV } from "../src/provisioning-config.mjs";

export const clone = (x) => JSON.parse(JSON.stringify(x));

export function makeEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const pk8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"); // TEST-ONLY, in memory, never written
  return { der, pk8, fp: publicKeyFingerprintFromDerB64(der), sign: (payload) => sign(null, Buffer.from(canonicalize(payload), "utf8"), privateKey).toString("base64") };
}

/** The synthetic independent attester (TEST-ONLY issuer). Signs executor and reader attestations on request. */
export function makeTestAttester(issuer, over = {}) {
  const k = makeEd25519();
  const target = () => ({ pgServiceId: TARGETS_V2.postgres, projectId: TARGETS_V2.project, environmentId: TARGETS_V2.environment });
  return {
    issuer, key: k,
    envelope({ contract, connectionToken, role, requestNonce }, nowMs, mutate) {
      const executor = contract === EXECUTOR_ATTESTATION_CONTRACT;
      let payload = {
        contract, domain: executor ? EXECUTOR_ATTESTATION_DOMAIN : READER_ATT_DOMAIN, issuer, keyId: k.fp,
        issuedAtMs: nowMs - 1000, expiresAtMs: nowMs + 240000, requestNonce, target: target(),
        connection: { role, token: connectionToken },
        privileges: executor ? {
          currentUser: EXECUTOR_ROLE, sessionUser: EXECUTOR_ROLE, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false,
          roleMemberships: [], schemaCreate: [], budgetTablePrivilegeCount: 0, ledgerPrivilegeCount: 0,
          trustedSchemaUsage: [...EXPECTED_EXECUTOR_PRIVILEGES.trustedSchemaUsage], executableRoutines: [...EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines],
          unapprovedRoutineExecute: false, publicOrDefaultPrivilegeWidening: false,
        } : {
          currentUser: READER_ROLE, effectiveSelectOnly: true, writePrivilegeCount: 0, selectGrantCount: READER_EXPECTED_SELECT_GRANTS,
          forbiddenObjectAccessible: false, unapprovedRoleMembership: false, unapprovedRoutineAuthority: false, ownerOrExecutorAuthority: false,
        },
      };
      if (mutate) payload = mutate(clone(payload)) || payload;
      return { payload, signatureB64: (over.signer || k).sign(payload) };
    },
  };
}

/** Attestation source over a synthetic attester (records every request; optional per-call mutation / throw). */
export function makeTestSource(attester, clockMs, opts = {}) {
  const calls = [];
  return {
    calls,
    obtain: async (req) => { calls.push(req); if (opts.throwCode) { const e = new Error("x"); e.code = opts.throwCode; throw e; } return attester.envelope(req, clockMs(), opts.mutate); },
  };
}

/** In-memory physical connection that answers the lifecycle SQL of its role and the preserved runtime SQL. */
export function makeFakePhysical(role, o = {}) {
  const appName = o.applicationName || (role === EXECUTOR_ROLE ? EXECUTOR_APPLICATION_NAME_PREFIX : "lai03b-reader:") + (o.appSuffix || Math.random().toString(16).slice(2, 14));
  const state = o.state || { mode: "pre", ledger: [], activations: 0 };
  let timeout = "0", ro = "off", dead = false; const log = [];
  const L = role === EXECUTOR_ROLE ? EXECUTOR_LIFECYCLE_SQL : READER_LIFECYCLE_SQL;
  const row = () => ({ ...(state.mode === "pre" ? STATES.pre() : STATES.activated()), ...STATES.counts() });
  const phys = {
    applicationName: appName, log, state,
    isDead: () => dead, kill: () => { dead = true; }, onDead() {},
    async close() { dead = true; phys.closed = true; },
    async query(sql, params) {
      log.push(sql);
      if (sql === L.setStatementTimeout) { timeout = o.ignoreTimeout ? "0" : params[0]; return { rows: [{ v: timeout }] }; }
      if (sql === L.readStatementTimeout) return { rows: [{ v: timeout }] };
      if (L.setReadOnly && sql === L.setReadOnly) { ro = "on"; return { rows: [{ v: "on" }] }; }
      if (L.readReadOnly && sql === L.readReadOnly) return { rows: [{ v: ro }] };
      if (sql === L.readIdentity) return { rows: [{ current_user: o.currentUser || role, session_user: o.sessionUser || o.currentUser || role, pid: o.pid || (role === EXECUTOR_ROLE ? 4101 : 4202), backend_start: "2026-09-29T16:00:00.000000Z", application_name: o.reportAppName || appName }] };
      if (L.readDbClockMs && sql === L.readDbClockMs) return { rows: [{ ms: String(o.dbNowMs ? o.dbNowMs() : Date.now()) }] };
      // preserved runtime SQL
      if (role === EXECUTOR_ROLE && sql === ACTIVATE_SQL_V2) {
        state.activations++; const cl = JSON.parse(params[0]); const at = new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
        if (state.ledger.some((x) => x.approval_id === cl.approval_id)) throw Object.assign(new Error("replay"), { code: "P0001" });
        state.ledger.push({ approval_id: cl.approval_id, execution_id: params[1], content_digest: cl.content_digest, active_catalog_digest: CATALOG_V2.active_digest, action: "activate", consumed_at: at }); state.mode = "activated";
        return { rows: [{ receipt: { contract: "CatalogActivationReceiptV2", catalog_version_id: CATALOG_V2.id, approval_id: cl.approval_id, execution_id: params[1], content_digest: cl.content_digest, active_catalog_digest: CATALOG_V2.active_digest, action: "activate", consumed_at: at } }] };
      }
      if (role === READER_ROLE && sql === REG.LEDGER_COMMITTED_QUERY_V2) return { rows: state.ledger.filter((x) => x.approval_id === params[0] && x.execution_id === params[1]) };
      if (role === READER_ROLE && REG.REGISTRY_KEYS.some((k) => REG.V2_QUERY_REGISTRY[k] === sql)) return { rows: [row()] };
      throw new Error("unexpected sql for " + role);
    },
  };
  return phys;
}
export const factoryOf = (phys, spy) => ({ open: async () => { if (spy) spy.opens = (spy.opens || 0) + 1; if (phys instanceof Error) throw phys; return phys; } });

/** Synthetic provisioning env (TEST-ONLY issuers; loopback channel hosts only valid under the test boundary). */
export function testProvisioningEnv(reviewer, exAtt, rdAtt, over = {}) {
  // `reviewer` is the preserved Step-2 test reviewer (makeReviewer): { trustRoot, fp, sign }
  const base = testEnv(reviewer, { LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF: exAtt.issuer });
  return {
    ...base,
    [EXECUTOR_ATTESTER_ENV.issuer]: exAtt.issuer, [EXECUTOR_ATTESTER_ENV.publicKeyDerB64]: exAtt.key.der, [EXECUTOR_ATTESTER_ENV.fingerprint]: exAtt.key.fp,
    [EXECUTOR_ATTESTER_ENV.host]: "127.0.0.1", [EXECUTOR_ATTESTER_ENV.port]: "7101", [EXECUTOR_ATTESTER_ENV.channelSecret]: "synthetic-executor-channel-secret-0123456789",
    [READER_ATTESTER_ENV.issuer]: rdAtt.issuer, [READER_ATTESTER_ENV.publicKeyDerB64]: rdAtt.key.der, [READER_ATTESTER_ENV.fingerprint]: rdAtt.key.fp,
    [READER_ATTESTER_ENV.host]: "127.0.0.1", [READER_ATTESTER_ENV.port]: "7102", [READER_ATTESTER_ENV.channelSecret]: "synthetic-reader-channel-secret-0123456789",
    ...over,
  };
}

/** Synthetic TEST-provenance PIN C for the CORRECTED runtime (never a real commit). */
export function testPinC(over = {}) {
  return { contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_PRESERVED, provenance: STEP2_TEST_PROVENANCE,
    commit: "5e2c0de5e2c0de5e2c0de5e2c0de5e2c0de5e2c0", tree: "7ee57ee57ee57ee57ee57ee57ee57ee57ee57ee5",
    step2_dir_tree: "d12d12d12d12d12d12d12d12d12d12d12d12d12d", runtime_manifest_digest: measureRuntimeManifest().digest,
    correction_base: ACCEPTED_M5_CLOSURE.commit, historical_pin_c: HISTORICAL_STEP2_PRESERVATION.commit, ...over };
}

export function makeRunner(name) {
  let pass = 0, fail = 0; const fails = [];
  const ok = (id, cond, detail) => { if (process.env.M7AP_LIST === "1") console.log(`  ${cond ? "PASS" : "FAIL"} ${id}`); if (cond) pass++; else { fail++; fails.push(id); console.log(`  FAIL ${id}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); } };
  const done = () => { console.log(`${name}: ${pass} passed, ${fail} failed`); if (fail) { console.log("FAILED: " + fails.join(", ")); process.exitCode = 1; } return { pass, fail }; };
  return { ok, done };
}
