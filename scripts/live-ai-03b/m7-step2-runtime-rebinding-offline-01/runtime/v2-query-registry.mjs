// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — the IMMUTABLE V2 production READ-QUERY registry. OFFLINE.
// Node built-ins only. Performs NO database connection.
//
// Successor of trusted-runtime-live-binding-offline-01/production-read-queries.mjs (V1, frozen,
// bound to catalog V1 + policy oneprobe-v1 + 89,536). Every query here is:
//   • a fixed, parameter-free (except the ledger lookup) SELECT with NO DML/DDL and NO ';';
//   • schema-qualified — every relation is `public.budget_*` (the ledger is
//     `live_ai_03b_trusted.approval_consumption`, ledger query only) — no search_path resolution;
//   • bound to the EXACT V2 identities as SQL literals (catalog / entry ids / digests / policy id +
//     digest / control digests), so the SQL bytes themselves are the reviewed identity;
//   • aggregated to exactly one row whose aliases are the exact observation fields.
// The seven ceilings are bound to the policy ROW IDENTITY (id + project + active + digest + sole
// active) AND to the seven VALUES — a tampered ceiling yields ZERO rows (fail closed) and the JS
// check (ceilingsExactV2) re-verifies the values.
// The registry digest is computed over the CONTENT; a supplied map is validated by content
// (assertSuppliedRegistryV2) — never by a copied digest marker.
// ─────────────────────────────────────────────────────────────────────────

import { canonicalize, sha256hex, CATALOG_V2, V1_HISTORICAL, POLICY_V2, DORMANT_V2_VIEW, OBSOLETE_ONECALL_V1, PROJECT_ID } from "../identity/v2-identity.mjs";
import { CANONICAL_CONSUMED_AT_SQL } from "../../trusted-executor-runtime-01/canonical-timestamp.mjs";

const V2 = CATALOG_V2.id, V1 = V1_HISTORICAL.id;
const V2_IDS = CATALOG_V2.entry_ids.map((x) => `'${x}'`).join(",");
const C = (scope) => (scope === "global" ? "scope_type='global' AND scope_key_digest='global'" : `scope_type='project' AND scope_key_digest='${PROJECT_ID}'`);
const ctl = (col, scope) => `(SELECT ${col} FROM public.budget_control_epochs WHERE ${C(scope)})`;
const CONTROL_COLUMNS =
  `(SELECT count(*)::int FROM public.budget_control_epochs) AS control_row_count, `
  + `${ctl("control_epoch", "global")} AS global_control_epoch, ${ctl("control_epoch", "project")} AS project_control_epoch, `
  + `${ctl("enabled", "global")} AS global_control_enabled, ${ctl("enabled", "project")} AS project_control_enabled, `
  + `${ctl("killed", "global")} AS global_control_killed, ${ctl("killed", "project")} AS project_control_killed, `
  + `${ctl("record_digest", "global")} AS control_global_digest, ${ctl("record_digest", "project")} AS control_project_digest`;
const V1_HISTORICAL_COLUMNS =
  `(SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id='${V1}' AND status='inactive') AS v1_inactive_digest, `
  + `(SELECT count(*)::int FROM public.budget_price_catalog_entries WHERE catalog_version_id='${V1}' AND status='inactive') AS v1_inactive_entry_count, `
  + `((SELECT count(*)::int FROM public.budget_price_catalog_entries WHERE catalog_version_id='${V1}') = 2 AND NOT EXISTS(`
  + `SELECT 1 FROM public.budget_price_catalog_entries WHERE catalog_version_id='${V1}' `
  + `AND verification_expires_at <> TIMESTAMPTZ '${V1_HISTORICAL.verification_expiry}')) AS v1_expiry_is_historical`;
const CATALOG_TOTAL_COLUMNS =
  `(SELECT count(*)::int FROM public.budget_price_catalog_versions) AS catalog_version_count, `
  + `(SELECT count(*)::int FROM public.budget_price_catalog_entries) AS catalog_entry_count, `
  + `(SELECT count(*)::int FROM public.budget_price_catalog_versions WHERE status<>'inactive') AS active_catalog_count, `
  + `(SELECT count(*)::int FROM public.budget_price_catalog_entries WHERE status<>'inactive') AS active_catalog_entry_count`;
const rate = (suffix, tier) => `(SELECT rate_micros FROM public.budget_price_catalog_entries WHERE id='${V2}${suffix}' AND catalog_version_id='${V2}' `
  + `AND ${tier === null ? "service_tier IS NULL" : `service_tier='${tier}'`} AND unit_size=1000000 AND currency_code='USD')`;
const V2_ENTRY_COLUMNS = (status) =>
  `(SELECT count(*)::int FROM public.budget_price_catalog_entries WHERE catalog_version_id='${V2}' AND status='${status}' AND id IN (${V2_IDS}) `
  + `AND verification_expires_at=TIMESTAMPTZ '${CATALOG_V2.verification_expiry}' AND source_digest='${CATALOG_V2.source_digest}') AS v2_${status}_entry_count, `
  + `(SELECT count(*)::int FROM public.budget_price_catalog_entries WHERE catalog_version_id='${V2}') AS v2_entry_count, `
  + `${rate("-reasoning-input-token-base", null)} AS v2_input_rate_micros, `
  + `${rate("-reasoning-input-token-cache-write", "cache_write")} AS v2_cache_write_rate_micros, `
  + `${rate("-reasoning-output-token-base", null)} AS v2_output_rate_micros`;
const POLICY_COLUMNS =
  `(SELECT count(*)::int FROM public.budget_policy_versions WHERE status='active') AS active_policy_count, `
  + `(SELECT count(*)::int FROM public.budget_policy_versions) AS policy_version_count, `
  + `EXISTS(SELECT 1 FROM public.budget_policy_versions WHERE id='${DORMANT_V2_VIEW.policy_id}' AND project_id='${PROJECT_ID}' `
  + `AND status='inactive' AND policy_digest='${DORMANT_V2_VIEW.policy_digest}') AS dormant_policy_present, `
  + `EXISTS(SELECT 1 FROM public.budget_policy_versions WHERE id='${OBSOLETE_ONECALL_V1.id}') AS obsolete_v1_policy_present, `
  + `EXISTS(SELECT 1 FROM public.budget_policy_versions WHERE project_id='*') AS wildcard_policy_present`;

// ── 1. pre-activation catalog (2 versions / 5 entries; V1 historical; V2 inactive; 0 active) ──
export const PRE_ACTIVATION_CATALOG_QUERY = "SELECT " + CATALOG_TOTAL_COLUMNS + ", " + V1_HISTORICAL_COLUMNS + ", "
  + `(SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id='${V2}' AND status='inactive') AS v2_inactive_digest, `
  + V2_ENTRY_COLUMNS("inactive");

// ── 2. policy + control state (used pre-activation AND activated: dormant policy, epoch-1 controls) ──
export const POLICY_CONTROL_QUERY = "SELECT " + POLICY_COLUMNS + ", "
  + `EXISTS(SELECT 1 FROM public.budget_policy_versions WHERE id='${POLICY_V2.id}') AS v2_policy_present, `
  + CONTROL_COLUMNS;

// ── 3. zero prior provider/accounting exposure (the 8 reader-visible accounting tables) ──
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

// ── 4. activated catalog (V2 SOLE active with the exact active digest; V1 still historical) ──
export const ACTIVATED_CATALOG_QUERY = "SELECT " + CATALOG_TOTAL_COLUMNS + ", " + V1_HISTORICAL_COLUMNS + ", "
  + `(SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id='${V2}' AND status='active' `
  + `AND (SELECT count(*) FROM public.budget_price_catalog_versions WHERE status<>'inactive') = 1) AS v2_active_digest, `
  + V2_ENTRY_COLUMNS("active");

// ── 5. armed state (catalog V2 sole active; policy-v2 SOLE active; controls epoch 2) ──
export const ARMED_STATE_QUERY = "SELECT " + CATALOG_TOTAL_COLUMNS + ", " + V1_HISTORICAL_COLUMNS + ", "
  + `(SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id='${V2}' AND status='active' `
  + `AND (SELECT count(*) FROM public.budget_price_catalog_versions WHERE status<>'inactive') = 1) AS v2_active_digest, `
  + `(SELECT policy_digest FROM public.budget_policy_versions WHERE id='${POLICY_V2.id}' AND project_id='${PROJECT_ID}' AND status='active' `
  + `AND (SELECT count(*) FROM public.budget_policy_versions WHERE status='active') = 1) AS one_call_policy_digest, `
  + V2_ENTRY_COLUMNS("active") + ", "
  + POLICY_COLUMNS + ", " + CONTROL_COLUMNS;

// ── 6. the seven ceilings — bound to ROW IDENTITY (id/project/active/digest/sole-active) AND VALUES ──
const M = POLICY_V2.ceilings;
export const CEILINGS_QUERY =
  "SELECT session_money_ceiling_micros, session_provider_calls, session_execution_admissions, "
  + "subject_day_money_ceiling_micros, project_day_money_ceiling_micros, project_month_money_ceiling_micros, "
  + "global_day_money_ceiling_micros "
  + "FROM public.budget_policy_versions "
  + `WHERE id='${POLICY_V2.id}' AND project_id='${PROJECT_ID}' AND status='active' AND policy_digest='${POLICY_V2.active_digest}' `
  + `AND session_money_ceiling_micros=${M.session_money_ceiling_micros} AND session_provider_calls=${M.session_provider_calls} `
  + `AND session_execution_admissions=${M.session_execution_admissions} AND subject_day_money_ceiling_micros=${M.subject_day_money_ceiling_micros} `
  + `AND project_day_money_ceiling_micros=${M.project_day_money_ceiling_micros} AND project_month_money_ceiling_micros=${M.project_month_money_ceiling_micros} `
  + `AND global_day_money_ceiling_micros=${M.global_day_money_ceiling_micros} `
  + "AND (SELECT count(*) FROM public.budget_policy_versions WHERE status='active') = 1";

// ── 7. restored state (V2 back to the exact inactive digest; policy-v2 restored; epoch 3; V1 never revived) ──
export const RESTORED_STATE_QUERY = "SELECT " + CATALOG_TOTAL_COLUMNS + ", " + V1_HISTORICAL_COLUMNS + ", "
  + `(SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id='${V2}' AND status='inactive') AS v2_inactive_digest, `
  + V2_ENTRY_COLUMNS("inactive") + ", "
  + `EXISTS(SELECT 1 FROM public.budget_policy_versions WHERE id='${POLICY_V2.id}' AND project_id='${PROJECT_ID}' AND status='inactive' `
  + `AND policy_digest='${POLICY_V2.restored_digest}') AS v2_policy_restored_present, `
  + POLICY_COLUMNS + ", " + CONTROL_COLUMNS;

// ── 8. committed approval-consumption ledger (executor-side Phase-B correlation; canonical consumed_at) ──
export const LEDGER_COMMITTED_QUERY_V2 =
  "SELECT approval_id, execution_id, content_digest, active_catalog_digest, action, "
  + CANONICAL_CONSUMED_AT_SQL + " AS consumed_at "
  + "FROM live_ai_03b_trusted.approval_consumption WHERE approval_id=$1 AND execution_id=$2 AND action='activate'";

// ── the registry (content = identity) ──
export const REGISTRY_KEYS = Object.freeze(["activatedCatalog", "armedState", "ceilings", "ledgerCommitted", "policyControl", "preActivationCatalog", "restoredState", "zeroExposureCounts"]);
export const V2_QUERY_REGISTRY = Object.freeze({
  activatedCatalog: ACTIVATED_CATALOG_QUERY,
  armedState: ARMED_STATE_QUERY,
  ceilings: CEILINGS_QUERY,
  ledgerCommitted: LEDGER_COMMITTED_QUERY_V2,
  policyControl: POLICY_CONTROL_QUERY,
  preActivationCatalog: PRE_ACTIVATION_CATALOG_QUERY,
  restoredState: RESTORED_STATE_QUERY,
  zeroExposureCounts: ZERO_EXPOSURE_COUNTS_QUERY,
});
export const V2_REGISTRY_DOMAIN = "staybid.live-ai.m7-step2.read-query-registry.v2";
export function registryDigestOf(reg) { return sha256hex(canonicalize({ domain: V2_REGISTRY_DOMAIN, queries: reg })); }
export const V2_REGISTRY_DIGEST = registryDigestOf(V2_QUERY_REGISTRY);
export const READER_QUERY_KEYS = Object.freeze(REGISTRY_KEYS.filter((k) => k !== "ledgerCommitted")); // reader host never needs the ledger

// ── shape rules (applied to every query, by CONTENT) ──
const ALLOWED_RELATIONS = new Set([
  "public.budget_price_catalog_versions", "public.budget_price_catalog_entries", "public.budget_policy_versions",
  "public.budget_control_epochs", "public.budget_envelopes", "public.budget_provider_reservations",
  "public.budget_provider_settlements", "public.budget_execution_consumptions", "public.budget_decisions",
  "public.budget_reconciliations", "public.budget_scope_counters", "public.budget_sessions",
]);
export function badQueryShapeV2(q, k) {
  if (typeof q !== "string" || q.length === 0) return `missing_query:${k}`;
  if (!/^SELECT\b/.test(q)) return `not_select:${k}`;
  if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|PREPARE|SET|LOCK|VACUUM|ANALYZE|pg_sleep|dblink|lo_import)\b/i.test(q)) return `dml_ddl_or_side_effect_in_query:${k}`;
  if (q.includes(";") || q.includes("--") || q.includes("/*")) return `multi_statement_or_comment:${k}`;
  if (/\bFOR\s+(UPDATE|SHARE)\b/i.test(q)) return `locking_clause:${k}`;
  if (/budget_envelope_allocations/.test(q)) return `forbidden_object:${k}`;
  const rels = [...q.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_."]+)/gi)].map((m) => m[1]);
  if (rels.length === 0) return `no_relation:${k}`;
  for (const r of rels) {
    if (k === "ledgerCommitted" && r === "live_ai_03b_trusted.approval_consumption") continue;
    if (!ALLOWED_RELATIONS.has(r)) return `relation_not_public_qualified_or_not_allowed:${k}`;
  }
  if (k !== "ledgerCommitted" && /\$[0-9]/.test(q)) return `unexpected_parameter:${k}`;
  return null;
}

/** Integrity of THIS module's own registry (import-time, pure). */
export function assertRegistryIntegrityV2(reg = V2_QUERY_REGISTRY) {
  const keys = Object.keys(reg).sort();
  if (keys.join(",") !== REGISTRY_KEYS.join(",")) return { ok: false, reason: "registry_key_set_mismatch" };
  for (const k of REGISTRY_KEYS) { const b = badQueryShapeV2(reg[k], k); if (b) return { ok: false, reason: b }; }
  if (registryDigestOf(reg) !== V2_REGISTRY_DIGEST) return { ok: false, reason: "registry_digest_mismatch" };
  return { ok: true, digest: V2_REGISTRY_DIGEST };
}

/** The supplied-registry form a deployment authority hands the adapter: the full map + a marker. */
export function buildV2RegistrySupply() { return { __registryDigest: V2_REGISTRY_DIGEST, ...V2_QUERY_REGISTRY }; }

/**
 * Validate a SUPPLIED registry by its ACTUAL CONTENT (never a copied marker):
 *  1. exact key set (__registryDigest + the eight keys); 2. every query passes the shape rules;
 *  3. the canonical digest recomputed from the SUPPLIED SQL equals the pinned V2_REGISTRY_DIGEST;
 *  4. the marker equals the recomputed digest; 5. every query is byte-identical to the pinned constant.
 */
export function assertSuppliedRegistryV2(supplied) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return { ok: false, reason: "supplied_registry_absent" };
  const keys = Object.keys(supplied).sort();
  const want = ["__registryDigest", ...REGISTRY_KEYS].sort();
  if (keys.join(",") !== want.join(",")) return { ok: false, reason: "supplied_registry_key_set_mismatch" };
  const reg = {};
  for (const k of REGISTRY_KEYS) { const b = badQueryShapeV2(supplied[k], k); if (b) return { ok: false, reason: "supplied_" + b }; reg[k] = supplied[k]; }
  const recomputed = registryDigestOf(reg);
  if (recomputed !== V2_REGISTRY_DIGEST) return { ok: false, reason: "supplied_registry_content_digest_mismatch" };
  if (supplied.__registryDigest !== recomputed) return { ok: false, reason: "supplied_registry_marker_not_content_bound" };
  for (const k of REGISTRY_KEYS) if (supplied[k] !== V2_QUERY_REGISTRY[k]) return { ok: false, reason: "supplied_bytes_mismatch:" + k };
  return { ok: true, digest: recomputed };
}

export const REGISTRY_SELF_CHECK = assertRegistryIntegrityV2();
