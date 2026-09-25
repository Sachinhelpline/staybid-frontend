// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — ATTESTER: RAILWAY TARGET BINDING via a DEPLOYMENT ANCHOR (OFFLINE). Node built-ins only.
//
// HONEST BOUNDARY. The accepted payload asserts a Railway target {projectId, environmentId, pgServiceId}.
// Nothing inside PostgreSQL knows a Railway service id, and nothing in the attester's own environment can
// prove which Railway service a database endpoint belongs to:
//   • DATABASE_URL, the database name "railway", postgres.railway.internal, DNS/TCP reachability and the
//     attester's own RAILWAY_* variables are all self-declaration about the ATTESTER, not about the DB;
//   • so none of them is accepted here as target evidence.
// Instead the attester requires a DEPLOYMENT ANCHOR: an Owner-issued, independently verified statement
// that a specific observable cluster fingerprint IS the intended AI-STAGING PostgreSQL service. The
// attester recomputes the fingerprint from its own observation and refuses to sign unless it matches.
// The anchor's ISSUANCE (an Owner verifying the fingerprint against Railway service b7362594-…) is a
// future live gate; absent or mismatched ⇒ fail closed, no signature.
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { canonicalize } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { AI_STAGING } from "./attester-config.mjs";

export const ANCHOR_CONTRACT = "AiStagingDeploymentAnchorV1";
export const ANCHOR_DOMAIN = "staybid.live-ai-03b.deployment-anchor.v1";
const ANCHOR_KEYS = ["clusterFingerprint", "contract", "domain", "environmentId", "issuedAtMs", "pgServiceId", "projectId", "verifiedBy"].sort();

function fail(reason) { return { ok: false, reason }; }

/** Deterministic fingerprint of the observed cluster+database (no secret, no row data). */
export function clusterFingerprint(cluster) {
  return createHash("sha256").update(canonicalize({
    domain: ANCHOR_DOMAIN, datname: cluster.datname, databaseOid: cluster.databaseOid,
    readerRoleOid: cluster.readerRoleOid, encoding: cluster.encoding === null ? "null" : cluster.encoding,
  })).digest("hex");
}

/** Parse + validate the Owner-issued anchor supplied as attester configuration (JSON). */
export function parseDeploymentAnchor(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return fail("anchor_absent");
  let a; try { a = JSON.parse(raw); } catch { return fail("anchor_malformed"); }
  if (!a || typeof a !== "object" || Array.isArray(a)) return fail("anchor_malformed");
  if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(ANCHOR_KEYS)) return fail("anchor_malformed");
  if (a.contract !== ANCHOR_CONTRACT || a.domain !== ANCHOR_DOMAIN) return fail("anchor_contract_mismatch");
  if (typeof a.clusterFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(a.clusterFingerprint)) return fail("anchor_fingerprint_malformed");
  if (typeof a.verifiedBy !== "string" || a.verifiedBy.length < 3 || a.verifiedBy.length > 128) return fail("anchor_malformed");
  if (!Number.isInteger(a.issuedAtMs)) return fail("anchor_malformed");
  // CORE-PROD can never be anchored; the target must be exactly the accepted AI-STAGING identity.
  if (a.projectId === AI_STAGING.excludedProjectId || a.pgServiceId === AI_STAGING.excludedPgServiceId) return fail("anchor_targets_core_prod");
  if (a.projectId !== AI_STAGING.projectId || a.environmentId !== AI_STAGING.environmentId || a.pgServiceId !== AI_STAGING.pgServiceId) return fail("anchor_target_not_ai_staging");
  return { ok: true, anchor: Object.freeze({ ...a }) };
}

/** Bind the observed cluster to the anchored Railway target, or fail closed. */
export function resolveTarget(anchor, cluster) {
  if (!anchor) return fail("anchor_absent");
  const fp = clusterFingerprint(cluster);
  if (fp !== anchor.clusterFingerprint) return fail("anchor_cluster_mismatch"); // a different/swapped database
  return { ok: true, target: Object.freeze({ projectId: anchor.projectId, environmentId: anchor.environmentId, pgServiceId: anchor.pgServiceId }), fingerprint: fp };
}
