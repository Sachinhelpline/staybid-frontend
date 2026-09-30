// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — AI-STAGING target binding via an EXECUTOR deployment anchor.
// OFFLINE candidate. Node built-ins + the accepted canonicalize primitive only.
//
// Same honest boundary as the accepted reader attester (private-reader-attester-offline-01/target-binding.mjs): no
// PostgreSQL value names a Railway service, and nothing in the attester's own environment proves which Railway
// service a database endpoint belongs to. So the signed target is taken ONLY from an Owner-issued, independently
// verified anchor that names the AI-STAGING target AND the observable cluster fingerprint; the attester recomputes
// that fingerprint from its OWN observation and refuses to sign on any mismatch.
//
// The executor anchor is a DISTINCT contract + domain (AiStagingExecutorDeploymentAnchorV1), and its fingerprint
// covers the EXECUTOR role oid, so a reader-attester anchor can never be replayed into this issuer (and vice versa).
// CORE-PROD can never be anchored. A TEST-ONLY anchor (verifiedBy "TEST-ONLY-…") is refused outside the offline test
// boundary.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { FIXED, canonicalize } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";

export const EXECUTOR_ANCHOR_CONTRACT = "AiStagingExecutorDeploymentAnchorV1";
export const EXECUTOR_ANCHOR_DOMAIN = "staybid.live-ai-03b.executor-deployment-anchor.v1";
export const AI_STAGING = Object.freeze({
  projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment, pgServiceId: FIXED.ai_staging_postgres,
  excludedProjectId: FIXED.core_excluded_project, excludedPgServiceId: FIXED.core_excluded_postgres,
});
const ANCHOR_KEYS = ["clusterFingerprint", "contract", "domain", "environmentId", "issuedAtMs", "pgServiceId", "projectId", "verifiedBy"].sort();
const fail = (reason) => ({ ok: false, reason });

/** Deterministic fingerprint of the observed cluster + database + EXECUTOR role (no secret, no row data). */
export function executorClusterFingerprint(cluster) {
  return createHash("sha256").update(canonicalize({
    domain: EXECUTOR_ANCHOR_DOMAIN, datname: cluster.datname, databaseOid: cluster.databaseOid,
    executorRoleOid: cluster.executorRoleOid, encoding: cluster.encoding === null ? "null" : cluster.encoding,
  })).digest("hex");
}

/** Parse + validate the Owner-issued executor anchor (JSON string from deployment configuration). */
export function parseExecutorDeploymentAnchor(raw, { offlineTestBoundary = false } = {}) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return fail("anchor_absent");
  let a; try { a = JSON.parse(raw); } catch { return fail("anchor_malformed"); }
  if (!a || typeof a !== "object" || Array.isArray(a)) return fail("anchor_malformed");
  if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(ANCHOR_KEYS)) return fail("anchor_malformed");
  if (a.contract !== EXECUTOR_ANCHOR_CONTRACT || a.domain !== EXECUTOR_ANCHOR_DOMAIN) return fail("anchor_contract_mismatch");
  if (typeof a.clusterFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(a.clusterFingerprint)) return fail("anchor_fingerprint_malformed");
  if (typeof a.verifiedBy !== "string" || a.verifiedBy.length < 3 || a.verifiedBy.length > 128) return fail("anchor_malformed");
  if (!offlineTestBoundary && a.verifiedBy.startsWith("TEST-ONLY-")) return fail("anchor_test_only_refused");
  if (!Number.isInteger(a.issuedAtMs)) return fail("anchor_malformed");
  if (a.projectId === AI_STAGING.excludedProjectId || a.pgServiceId === AI_STAGING.excludedPgServiceId) return fail("anchor_targets_core_prod");
  if (a.projectId !== AI_STAGING.projectId || a.environmentId !== AI_STAGING.environmentId || a.pgServiceId !== AI_STAGING.pgServiceId) return fail("anchor_target_not_ai_staging");
  return { ok: true, anchor: Object.freeze({ ...a }) };
}

/** Bind the OBSERVED cluster to the anchored AI-STAGING target, or fail closed. */
export function resolveExecutorTarget(anchor, cluster) {
  if (!anchor) return fail("anchor_absent");
  if (!cluster) return fail("cluster_unobserved");
  if (executorClusterFingerprint(cluster) !== anchor.clusterFingerprint) return fail("anchor_cluster_mismatch");
  return { ok: true, target: Object.freeze({ projectId: anchor.projectId, environmentId: anchor.environmentId, pgServiceId: anchor.pgServiceId }) };
}
