// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — independent EXECUTOR privilege/identity attestation.
// OFFLINE candidate. VERIFICATION ONLY (no signing key, no signing code).
//
// The executor-role analogue of the accepted AiStagingReaderAttestationV1: an Ed25519-signed attestation issued
// by an independent, Owner-controlled attester (never the executor process, never the caller) about ONE actual
// executor connection (bound to its connection token + a fresh request nonce). It carries the attester's OWN
// observation of the connection's target and of the executor role's EFFECTIVE privileges. The accepted
// primitives are reused (canonicalize / verifyEnvelopeSignature — the same ones the reader attestation uses) and
// the trust root comes from the accepted makeAttesterTrustRoot (deployment config only, never the envelope).
//
// ⚠ No deployed issuer produces this contract yet (the accepted M5 attester issues reader attestations only).
//   Until an independently reviewed issuer exists, production acquisition of an executor attestation source is
//   UNPROVISIONED (see production-entrypoint.mjs) and the authority fails closed.
// ─────────────────────────────────────────────────────────────────────────
import { FIXED, canonicalize, verifyEnvelopeSignature } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { ATTESTATION_MAX_LIFETIME_MS, ATTESTATION_FORWARD_TOLERANCE_MS } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { EXECUTOR_ROLE } from "./executor-session.mjs";

export const EXECUTOR_ATTESTATION_CONTRACT = "AiStagingExecutorAttestationV1";
export const EXECUTOR_ATTESTATION_DOMAIN = "staybid.live-ai-03b.executor-authority-attestation.v1";
export { ATTESTATION_MAX_LIFETIME_MS, ATTESTATION_FORWARD_TOLERANCE_MS };

/** The EXACT accepted executor privilege set after M6 + Step-1 01/02 (PRIVILEGE-MATRIX.json of Step 1). */
export const EXPECTED_EXECUTOR_PRIVILEGES = Object.freeze({
  trustedSchemaUsage: Object.freeze(["live_ai_03b_trusted", "live_ai_03b_trusted_v2"]),
  executableRoutines: Object.freeze([
    "live_ai_03b_trusted.activate_catalog(jsonb,text)",               // M6, V1-bound and expired ⇒ fails closed inside
    "live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)",       // M6
    "live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)",         // Step-1 02 successor
    "live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)", // Step-1 02 successor
  ]),
});

const PAYLOAD_KEYS = ["connection", "contract", "domain", "expiresAtMs", "issuedAtMs", "issuer", "keyId", "privileges", "requestNonce", "target"].sort();
const TARGET_KEYS = ["environmentId", "pgServiceId", "projectId"].sort();
const CONNECTION_KEYS = ["role", "token"].sort();
export const EXECUTOR_PRIVILEGE_KEYS = Object.freeze(["budgetTablePrivilegeCount", "currentUser", "executableRoutines", "ledgerPrivilegeCount",
  "publicOrDefaultPrivilegeWidening", "rolbypassrls", "rolcreatedb", "rolcreaterole", "rolreplication", "rolsuper", "roleMemberships",
  "schemaCreate", "sessionUser", "trustedSchemaUsage", "unapprovedRoutineExecute"].sort());

const fail = (reason) => ({ ok: false, reason });
const exactKeys = (o, keys) => !!o && typeof o === "object" && !Array.isArray(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);
const isInt = (n) => Number.isInteger(n);
const sameList = (a, b) => Array.isArray(a) && a.every((x) => typeof x === "string") && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()) && new Set(a).size === a.length;

/**
 * Verify a signed executor attestation `{ payload, signatureB64 }` against the PINNED executor-attester trust root
 * and the EXPECTED binding (this provisioner's own executor connection token + the nonce it sent). Any key material
 * inside the envelope is ignored. Returns { ok:true, attestation } or { ok:false, reason } (fixed codes).
 */
export function verifyExecutorAttestation(envelope, { trustRoot, expectedConnectionToken, expectedRequestNonce, now } = {}) {
  if (!trustRoot || typeof trustRoot.publicKeyDerB64 !== "string") return fail("executor_trust_root_absent");
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return fail("executor_attestation_absent");
  const { payload, signatureB64 } = envelope;
  if (Object.keys(envelope).sort().join(",") !== "payload,signatureB64") return fail("executor_attestation_malformed");
  if (!exactKeys(payload, PAYLOAD_KEYS)) return fail("executor_attestation_malformed");
  if (typeof signatureB64 !== "string" || signatureB64.length < 16 || signatureB64.length > 256) return fail("executor_attestation_signature_malformed");
  if (payload.contract !== EXECUTOR_ATTESTATION_CONTRACT || payload.domain !== EXECUTOR_ATTESTATION_DOMAIN) return fail("executor_attestation_contract_mismatch");
  if (!exactKeys(payload.target, TARGET_KEYS) || !exactKeys(payload.connection, CONNECTION_KEYS) || !exactKeys(payload.privileges, EXECUTOR_PRIVILEGE_KEYS)) return fail("executor_attestation_malformed");
  try { canonicalize(payload); } catch { return fail("executor_attestation_malformed"); }
  if (payload.issuer !== trustRoot.issuer) return fail("executor_attestation_issuer_untrusted");
  if (payload.keyId !== trustRoot.fingerprint) return fail("executor_attestation_key_untrusted");
  if (!verifyEnvelopeSignature(payload, signatureB64, trustRoot.publicKeyDerB64)) return fail("executor_attestation_signature_invalid");

  // freshness (≤ 5 min lifetime, not future-dated beyond 5 s, not expired) against the TRUSTED clock
  if (typeof now !== "number" || !Number.isFinite(now)) return fail("clock_absent");
  const { issuedAtMs, expiresAtMs } = payload;
  if (!isInt(issuedAtMs) || !isInt(expiresAtMs) || expiresAtMs <= issuedAtMs) return fail("executor_attestation_validity_malformed");
  if (expiresAtMs - issuedAtMs > ATTESTATION_MAX_LIFETIME_MS) return fail("executor_attestation_lifetime_too_long");
  if (issuedAtMs - now > ATTESTATION_FORWARD_TOLERANCE_MS) return fail("executor_attestation_future_dated");
  if (now - issuedAtMs > ATTESTATION_MAX_LIFETIME_MS) return fail("executor_attestation_stale");
  if (now >= expiresAtMs) return fail("executor_attestation_expired");

  // binding to THIS physical executor connection + THIS request
  if (typeof expectedConnectionToken !== "string" || expectedConnectionToken.length < 16) return fail("expected_executor_connection_token_absent");
  if (payload.connection.token !== expectedConnectionToken) return fail("executor_attestation_connection_mismatch");
  if (payload.connection.role !== EXECUTOR_ROLE) return fail("executor_attestation_role_mismatch");
  if (typeof expectedRequestNonce !== "string" || payload.requestNonce !== expectedRequestNonce) return fail("executor_attestation_request_nonce_mismatch");

  // independently observed target (AI-STAGING only; CORE-PROD refused)
  const t = payload.target;
  if (t.pgServiceId === FIXED.core_excluded_postgres || t.projectId === FIXED.core_excluded_project) return fail("executor_drift_target_is_core_prod");
  if (t.pgServiceId !== FIXED.ai_staging_postgres || t.projectId !== FIXED.ai_staging_project || t.environmentId !== FIXED.ai_staging_environment) return fail("executor_drift_target_not_ai_staging");

  // independently observed EFFECTIVE privileges of THIS executor role — exact accepted set, nothing wider
  const p = payload.privileges;
  if (p.currentUser !== EXECUTOR_ROLE || p.sessionUser !== EXECUTOR_ROLE) return fail("executor_drift_wrong_role");
  if (p.rolsuper !== false) return fail("executor_drift_superuser");
  if (p.rolcreaterole !== false) return fail("executor_drift_createrole");
  if (p.rolcreatedb !== false) return fail("executor_drift_createdb");
  if (p.rolreplication !== false) return fail("executor_drift_replication");
  if (p.rolbypassrls !== false) return fail("executor_drift_bypassrls");
  if (!Array.isArray(p.roleMemberships) || p.roleMemberships.length !== 0) return fail("executor_drift_role_membership");
  if (!Array.isArray(p.schemaCreate) || p.schemaCreate.length !== 0) return fail("executor_drift_schema_create");
  if (p.budgetTablePrivilegeCount !== 0) return fail("executor_drift_budget_table_privilege");
  if (p.ledgerPrivilegeCount !== 0) return fail("executor_drift_ledger_privilege");
  if (!sameList(p.trustedSchemaUsage, EXPECTED_EXECUTOR_PRIVILEGES.trustedSchemaUsage)) return fail("executor_drift_schema_usage");
  if (!sameList(p.executableRoutines, EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines)) return fail("executor_drift_routine_execute");
  if (p.unapprovedRoutineExecute !== false) return fail("executor_drift_unapproved_routine_execute");
  if (p.publicOrDefaultPrivilegeWidening !== false) return fail("executor_drift_public_or_default_widening");

  return { ok: true, attestation: Object.freeze({ ...payload, target: Object.freeze({ ...t }), connection: Object.freeze({ ...payload.connection }),
    privileges: Object.freeze({ ...p, roleMemberships: Object.freeze([...p.roleMemberships]), schemaCreate: Object.freeze([...p.schemaCreate]),
      trustedSchemaUsage: Object.freeze([...p.trustedSchemaUsage]), executableRoutines: Object.freeze([...p.executableRoutines]) }) }) };
}
