// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 AI-STAGING VERIFIED-SCHEMA production read-query bindings.
// OFFLINE. Node built-ins only. Performs NO database connection.
//
// TASK A (CONSOLIDATED-MATERIAL-REMEDIATION-01, Finding 1) — the four immutable reviewed
// read queries (dormantPolicyControl / armedPolicyControl / ceilings / zeroExposureCounts),
// now bound to the EXACT accepted public-schema objects, policy identities, digests and
// GLOBAL policy cardinality recovered from accepted source ONLY:
//   migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql          (table columns)
//   migrations/2026-09-16-live-ai-budget-01-dormant-control-policy-seed.sql (dormant predecessor)
//   migrations/2026-09-18-live-ai-budget-01-inactive-price-catalog-seed.sql (catalog/exposure)
//   scripts/live-ai-03b/first-text-probe-activation-01/one-call-policy-activation.sql (armed policy)
//   scripts/live-ai-03b/first-text-probe-activation-01/control-activation.sql          (armed control)
//   scripts/live-ai-03b/first-text-probe-activation-01/first-probe-preflight-postflight.mjs (EXPECT)
// Exact identifiers are recovered from accepted source, NOT guessed and NOT from a live DB.
//
// Binding invariants enforced by the SQL bytes themselves (not by a fixture):
//   • EVERY foundation relation is schema-qualified `public.` (no search_path resolution).
//   • Phase-A absence of active policy is measured GLOBALLY (no project filter), so a wildcard
//     ('*') or foreign-project active policy is visible and rejects the dormant predecessor.
//   • Phase-A dormant_policy_present is bound to the EXACT accepted dormant policy id + project +
//     inactive status + policy_digest AND to the accepted single-policy-row cardinality, so an
//     arbitrary/duplicate/wrong-digest inactive policy is NOT accepted as the dormant predecessor.
//   • Phase-B one_call_policy_digest is bound to the EXACT accepted one-call policy id + project +
//     active status AND to exactly-one-globally-active-policy; any extra/duplicate/foreign active
//     policy collapses the digest to NULL ⇒ the frozen predecessorArmedState check rejects. (The
//     frozen read adapter DISCARDS an armed active_policy_count field, so cardinality is enforced
//     inside the CONSUMED digest field, never a discarded one.)
//   • ceilings are read from the SAME exact accepted active policy identity AND digest.
// Each query is fixed, read-only, project-scoped, invokes no application / SECURITY DEFINER
// function, and returns exactly one aggregated row whose column aliases are the exact observation
// fields the FROZEN read adapter consumes.
//
// This is a SEPARATE candidate registry with an explicit FUTURE integration boundary. It does NOT
// modify the frozen 19+14 files and does NOT make the frozen production entrypoint reachable; the
// frozen production authority remains UNPROVISIONED. Hosted-PostgreSQL dialect/catalog behavior
// (scalar-subquery cardinality, boolean/int coercion, NULL-on-missing-row) remains a FUTURE LIVE
// verification gate — see future-live-gates.json.
// ─────────────────────────────────────────────────────────────────────────

import { sha256hex, canonicalize, FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import {
  LEDGER_COMMITTED_QUERY, CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY,
  CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
} from "../trusted-executor-runtime-01/trusted-read-adapter.mjs";

// immutable LIVE-AI scope literals + accepted policy identities/digests (recovered from accepted
// source; never caller-chosen). scope_key_digest values 'global'/'live-ai-03b' are the accepted
// literals (dormant seed + one-call/control activation + first-probe evidence manifest).
export const LIVE_AI_PROJECT_ID = "live-ai-03b";
export const GLOBAL_SCOPE_KEY_DIGEST = "global";
export const PROJECT_SCOPE_KEY_DIGEST = "live-ai-03b";
export const CATALOG_VERSION_ID = FIXED.catalog_version_id; // openai-gpt-5-6-terra-standard-short-v1
// dormant predecessor policy (2026-09-16-...-dormant-control-policy-seed.sql, row 3):
export const DORMANT_POLICY_ID = "live-ai-03b-policy-v1-dormant";
export const DORMANT_POLICY_DIGEST = "cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4";
// armed one-call policy (one-call-policy-activation.sql; digest == FIXED.one_call_policy_digest):
export const ONE_CALL_POLICY_ID = "live-ai-03b-policy-oneprobe-v1";
export const ONE_CALL_POLICY_DIGEST = FIXED.one_call_policy_digest; // 9927a920...

// ── the four immutable reviewed read queries (exact fixed SQL bytes) ──

// dormantPolicyControl — the Phase-A dormant predecessor policy+control observation.
//   active_policy_count      : GLOBAL active-policy count (no project filter) ⇒ a wildcard/foreign
//                              active policy is visible; the frozen preActivationDormantPredecessor
//                              requires it === 0.
//   dormant_policy_present   : true ONLY when the accepted single dormant policy (exact id/project/
//                              inactive/digest) is the SOLE policy row (accepted cardinality).
export const DORMANT_POLICY_CONTROL_QUERY =
  "SELECT "
  + "(SELECT count(*)::int FROM public.budget_policy_versions WHERE status='active') AS active_policy_count, "
  + "((SELECT count(*)::int FROM public.budget_policy_versions) = 1 AND EXISTS("
  + "SELECT 1 FROM public.budget_policy_versions WHERE id='live-ai-03b-policy-v1-dormant' "
  + "AND project_id='live-ai-03b' AND status='inactive' "
  + "AND policy_digest='cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4')) AS dormant_policy_present, "
  + "(SELECT control_epoch FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS global_control_epoch, "
  + "(SELECT control_epoch FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS project_control_epoch, "
  + "(SELECT enabled FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS global_control_enabled, "
  + "(SELECT enabled FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS project_control_enabled, "
  + "(SELECT killed FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS global_control_killed, "
  + "(SELECT killed FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS project_control_killed";

// armedPolicyControl — the Phase-B armed policy+control digest observation (reads the STORED
// policy_digest / record_digest columns the accepted activation SQLs commit). one_call_policy_digest
// is bound to the EXACT accepted one-call policy id/project/active AND to exactly-one-globally-active
// policy: an extra/duplicate/foreign active policy ⇒ the inner cardinality guard fails ⇒ NULL ⇒ the
// frozen predecessorArmedState rejects. (active_policy_count is intentionally NOT emitted here — the
// frozen adapter discards it; cardinality is enforced inside the CONSUMED digest field.)
export const ARMED_POLICY_CONTROL_QUERY =
  "SELECT "
  + "(SELECT policy_digest FROM public.budget_policy_versions WHERE status='active' "
  + "AND id='live-ai-03b-policy-oneprobe-v1' AND project_id='live-ai-03b' "
  + "AND (SELECT count(*) FROM public.budget_policy_versions WHERE status='active') = 1) AS one_call_policy_digest, "
  + "(SELECT record_digest FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS control_global_digest, "
  + "(SELECT record_digest FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS control_project_digest, "
  + "(SELECT control_epoch FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS global_control_epoch, "
  + "(SELECT control_epoch FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS project_control_epoch, "
  + "(SELECT enabled FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS global_control_enabled, "
  + "(SELECT enabled FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS project_control_enabled, "
  + "(SELECT killed FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global') AS global_control_killed, "
  + "(SELECT killed FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b') AS project_control_killed";

// ceilings — the seven one-call ceilings read from the SAME EXACT accepted active one-call policy
// (id + project + active + policy_digest). A missing/wrong-identity/wrong-digest policy ⇒ zero rows
// ⇒ the frozen observeCeilings fails closed; the frozen oneCallCeilingsExact enforces the values.
export const CEILINGS_QUERY =
  "SELECT session_money_ceiling_micros, session_provider_calls, session_execution_admissions, "
  + "subject_day_money_ceiling_micros, project_day_money_ceiling_micros, project_month_money_ceiling_micros, "
  + "global_day_money_ceiling_micros "
  + "FROM public.budget_policy_versions "
  + "WHERE id='live-ai-03b-policy-oneprobe-v1' AND project_id='live-ai-03b' AND status='active' "
  + "AND policy_digest='9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c'";

// zeroExposureCounts — zero prior provider/accounting exposure across the 8 accounting tables.
export const ZERO_EXPOSURE_COUNTS_QUERY =
  "SELECT "
  + "(SELECT count(*)::int FROM public.budget_envelopes) AS envelopes, "
  + "(SELECT count(*)::int FROM public.budget_provider_reservations) AS provider_reservations, "
  + "(SELECT count(*)::int FROM public.budget_provider_settlements) AS provider_settlements, "
  + "(SELECT count(*)::int FROM public.budget_execution_consumptions) AS execution_consumptions, "
  + "(SELECT count(*)::int FROM public.budget_decisions) AS decisions, "
  + "(SELECT count(*)::int FROM public.budget_reconciliations) AS reconciliations, "
  + "(SELECT count(*)::int FROM public.budget_scope_counters) AS scope_counters, "
  + "(SELECT count(*)::int FROM public.budget_sessions) AS sessions";

// per-query reviewed metadata (params / output fields / cardinality / rejection).
export const QUERY_META = Object.freeze({
  dormantPolicyControl: { params: [], cardinality: "exactly-one-row", outputs: ["active_policy_count", "dormant_policy_present", "global_control_epoch", "project_control_epoch", "global_control_enabled", "project_control_enabled", "global_control_killed", "project_control_killed"], reject: "GLOBAL active_policy_count>0 (wildcard/foreign/project active policy) ⇒ preActivationDormantPredecessor rejects; missing/wrong-id/wrong-digest/duplicate dormant policy ⇒ dormant_policy_present=false ⇒ rejects; missing/duplicate control row ⇒ NULL/NaN ⇒ rejects" },
  armedPolicyControl: { params: [], cardinality: "exactly-one-row", outputs: ["one_call_policy_digest", "control_global_digest", "control_project_digest", "global_control_epoch", "project_control_epoch", "global_control_enabled", "project_control_enabled", "global_control_killed", "project_control_killed"], reject: "extra/duplicate/foreign globally-active policy ⇒ one_call_policy_digest=NULL ⇒ predecessorArmedState rejects; missing one-call policy ⇒ NULL ⇒ rejects; wrong digest/epoch ⇒ rejects" },
  ceilings: { params: [], cardinality: "exactly-one-row (exact accepted active one-call policy)", outputs: ["session_money_ceiling_micros", "session_provider_calls", "session_execution_admissions", "subject_day_money_ceiling_micros", "project_day_money_ceiling_micros", "project_month_money_ceiling_micros", "global_day_money_ceiling_micros"], reject: "missing/wrong-identity/wrong-digest active policy ⇒ zero rows ⇒ observeCeilings fails closed; any mismatched ceiling ⇒ oneCallCeilingsExact rejects" },
  zeroExposureCounts: { params: [], cardinality: "exactly-one-row", outputs: ["envelopes", "provider_reservations", "provider_settlements", "execution_consumptions", "decisions", "reconciliations", "scope_counters", "sessions"], reject: "any nonzero ⇒ zeroPriorProbeExposure rejects" },
});

// the reviewed-state query keys (the deployment artifact map the frozen read adapter reads).
export const REVIEWED_STATE_KEYS = Object.freeze(["dormantPolicyControl", "armedPolicyControl", "ceilings", "zeroExposureCounts"]);

// the complete candidate registry: the four NEW reviewed-state queries + the frozen known
// catalog/ledger queries (re-exported from the accepted read adapter, unchanged).
export const CANDIDATE_QUERY_REGISTRY = Object.freeze({
  // reviewed-state queries consumed by the accepted read adapter's reviewedStateQueries:
  dormantPolicyControl: DORMANT_POLICY_CONTROL_QUERY,
  armedPolicyControl: ARMED_POLICY_CONTROL_QUERY,
  ceilings: CEILINGS_QUERY,
  zeroExposureCounts: ZERO_EXPOSURE_COUNTS_QUERY,
  // known-schema queries already frozen in the accepted read adapter (for completeness):
  ledgerCommitted: LEDGER_COMMITTED_QUERY,
  catalogActiveCount: CATALOG_ACTIVE_COUNT_QUERY,
  catalogActiveDigest: CATALOG_ACTIVE_DIGEST_QUERY,
  catalogInactiveVersion: CATALOG_INACTIVE_VERSION_QUERY,
  catalogInactiveEntryCount: CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
});

// deterministic registry digest (tamper-evident identity; a caller cannot substitute SQL).
export const CANDIDATE_REGISTRY_DIGEST = sha256hex(canonicalize(CANDIDATE_QUERY_REGISTRY));

/** The four reviewed-state queries for the accepted read adapter, marked with the registry
 *  digest so the adapter's production guard accepts them ONLY as the immutable registry. */
export function buildReviewedStateQueries() {
  return {
    __registryDigest: CANDIDATE_REGISTRY_DIGEST,
    dormantPolicyControl: DORMANT_POLICY_CONTROL_QUERY,
    armedPolicyControl: ARMED_POLICY_CONTROL_QUERY,
    ceilings: CEILINGS_QUERY,
    zeroExposureCounts: ZERO_EXPOSURE_COUNTS_QUERY,
  };
}

/** Fail-closed integrity check over the module-DEFAULT registry: the registry bytes must hash to
 *  the pinned digest and every reviewed query must be a fixed SELECT with no DML/DDL/multi-statement
 *  surface. (This checks THIS module's own registry; validation of a SUPPLIED query map is done by
 *  assertSuppliedRegistry — the Finding-2 authority check.) */
export function assertRegistryIntegrity(reg = CANDIDATE_QUERY_REGISTRY) {
  if (sha256hex(canonicalize(reg)) !== CANDIDATE_REGISTRY_DIGEST) return { ok: false, reason: "registry_digest_mismatch" };
  for (const k of REVIEWED_STATE_KEYS) {
    const q = reg[k];
    const bad = badQueryShape(q, k);
    if (bad) return { ok: false, reason: bad };
  }
  return { ok: true, digest: CANDIDATE_REGISTRY_DIGEST };
}

function badQueryShape(q, k) {
  if (typeof q !== "string" || q.length === 0) return `missing_query:${k}`;
  if (!/^SELECT\b/i.test(q.trim())) return `not_select:${k}`;
  if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(q)) return `dml_or_ddl_in_query:${k}`;
  if (q.includes(";")) return `multi_statement:${k}`;
  return null;
}

/**
 * FINDING 2 — validate a SUPPLIED reviewed-state query map against the immutable pinned registry
 * by its ACTUAL CONTENT, never a copied digest marker. Steps:
 *   1. exact key set: __registryDigest + exactly the four reviewed keys (no missing / no extra).
 *   2. each supplied reviewed query is a fixed SELECT-only string (no DML/DDL/multi-statement).
 *   3. reconstruct the FULL registry from the SUPPLIED reviewed SQL + the frozen catalog/ledger
 *      queries, recompute the canonical digest, and require it to equal the pinned
 *      CANDIDATE_REGISTRY_DIGEST — so altered/missing/extra/reordered supplied SQL fails closed
 *      even when accompanied by a correct-looking digest marker.
 *   4. the supplied __registryDigest marker must equal the RECOMPUTED digest (never a bare copy).
 *   5. defense-in-depth: each supplied reviewed query must be byte-identical to the pinned constant.
 * A copied correct digest + substituted SQL (the reproduced WORK attack) is rejected at step 3/5.
 */
export function assertSuppliedRegistry(supplied) {
  if (!supplied || typeof supplied !== "object") return { ok: false, reason: "supplied_registry_absent" };
  const keys = Object.keys(supplied).sort();
  const expectedKeys = ["__registryDigest", ...REVIEWED_STATE_KEYS].sort();
  if (keys.length !== expectedKeys.length || !keys.every((k, i) => k === expectedKeys[i])) {
    return { ok: false, reason: "supplied_registry_key_set_mismatch" };
  }
  for (const k of REVIEWED_STATE_KEYS) {
    const bad = badQueryShape(supplied[k], k);
    if (bad) return { ok: false, reason: "supplied_" + bad };
  }
  // reconstruct the full registry from the SUPPLIED reviewed SQL + the frozen catalog/ledger queries.
  const reconstructed = {
    dormantPolicyControl: supplied.dormantPolicyControl,
    armedPolicyControl: supplied.armedPolicyControl,
    ceilings: supplied.ceilings,
    zeroExposureCounts: supplied.zeroExposureCounts,
    ledgerCommitted: LEDGER_COMMITTED_QUERY,
    catalogActiveCount: CATALOG_ACTIVE_COUNT_QUERY,
    catalogActiveDigest: CATALOG_ACTIVE_DIGEST_QUERY,
    catalogInactiveVersion: CATALOG_INACTIVE_VERSION_QUERY,
    catalogInactiveEntryCount: CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
  };
  const recomputed = sha256hex(canonicalize(reconstructed));
  if (recomputed !== CANDIDATE_REGISTRY_DIGEST) return { ok: false, reason: "supplied_registry_content_digest_mismatch" };
  if (supplied.__registryDigest !== recomputed) return { ok: false, reason: "supplied_registry_marker_not_content_bound" };
  // defense-in-depth: exact byte identity to the pinned constants.
  if (supplied.dormantPolicyControl !== DORMANT_POLICY_CONTROL_QUERY) return { ok: false, reason: "supplied_dormant_bytes_mismatch" };
  if (supplied.armedPolicyControl !== ARMED_POLICY_CONTROL_QUERY) return { ok: false, reason: "supplied_armed_bytes_mismatch" };
  if (supplied.ceilings !== CEILINGS_QUERY) return { ok: false, reason: "supplied_ceilings_bytes_mismatch" };
  if (supplied.zeroExposureCounts !== ZERO_EXPOSURE_COUNTS_QUERY) return { ok: false, reason: "supplied_zero_bytes_mismatch" };
  return { ok: true, digest: recomputed };
}
