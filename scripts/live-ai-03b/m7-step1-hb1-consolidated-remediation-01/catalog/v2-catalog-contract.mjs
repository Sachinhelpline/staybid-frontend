// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 1 — V2 catalog CONTRACT / successor preflight + digest verifier.
// OFFLINE, PURE. Given observed catalog rows (e.g. from a trusted read-only capability, or the
// seed SQL literals), recompute the canonical catalog payload FROM THE ROWS and require it to equal
// the reviewed inactive/active digest, and require the exact three-rate HB-1 shape. Used by the
// offline suite (regressions 3–19, §16 E/F/G) and as the reference contract for a later executor
// Phase-A preflight. A candidate missing the cache_write row, carrying a cache_write rate below
// 2,500,000, a malformed rate, an extra/duplicate entry, a wrong id/provider/model/currency/unit,
// a tampered source digest, a stale/future window — is REJECTED before any provider authority.
// ─────────────────────────────────────────────────────────────────────────

import * as G from "./v2-digest-gen.mjs";

const RFC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const fail = (reason) => ({ ok: false, reason });
const VERSION_KEYS = ["catalog_digest", "created_at", "effective_from", "effective_until", "id", "status"];
const ENTRY_KEYS = ["billing_dimension", "catalog_version_id", "created_at", "currency_code", "effective_from", "effective_until", "id",
  "model", "provider", "rate_micros", "service_tier", "source_digest", "source_id", "status", "unit_size", "verification_expires_at", "verified_at"];
const same = (o, ks) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join(",") === [...ks].sort().join(",");

/** @param {object} version  row of budget_price_catalog_versions (timestamps as RFC3339 'Z' strings)
 *  @param {object[]} entries rows of budget_price_catalog_entries for that version
 *  @param {"inactive"|"active"} expectStatus
 *  @param {string} nowIso  RFC3339 UTC (freshness is evaluated at this instant) */
export function checkV2Catalog(version, entries, expectStatus, nowIso) {
  if (!same(version, VERSION_KEYS)) return fail("version_row_shape");
  if (!Array.isArray(entries)) return fail("entries_absent");
  if (version.id !== G.V2_ID) return fail("catalog_id_mismatch");
  if (version.status !== expectStatus) return fail("version_status_mismatch");
  if (entries.length !== 3) return fail(entries.length < 3 ? "entry_missing" : "entry_extra_or_duplicate");
  const ids = entries.map((e) => (e && e.id)).sort();
  if (new Set(ids).size !== ids.length) return fail("duplicate_entry_id");
  if (ids.join(",") !== [...G.V2_ENTRY_IDS].sort().join(",")) return fail("entry_id_mismatch");
  for (const e of entries) {
    if (!same(e, ENTRY_KEYS)) return fail("entry_row_shape");
    if (e.catalog_version_id !== G.V2_ID) return fail("entry_catalog_id_mismatch");
    if (e.provider !== "openai") return fail("provider_mismatch");
    if (e.model !== "gpt-5.6-terra") return fail("model_mismatch");
    if (e.currency_code !== "USD") return fail("currency_mismatch");
    if (!Number.isSafeInteger(e.unit_size) || !Number.isSafeInteger(e.rate_micros)) return fail("rate_or_unit_malformed");
    if (e.unit_size !== 1000000) return fail("unit_size_mismatch");
    if (e.status !== expectStatus) return fail("entry_status_mismatch");
    if (e.source_id !== G.SOURCE_ID) return fail("source_id_mismatch");
    if (e.source_digest !== G.SOURCE_DIGEST_V2) return fail("source_digest_mismatch");
    if (e.verified_at !== G.T0 || e.effective_from !== G.T0 || e.created_at !== G.T0) return fail("entry_t0_mismatch");
    if (e.verification_expires_at !== G.T0_PLUS_7_DAYS) return fail("verification_expiry_mismatch");
    if (e.effective_until !== null) return fail("effective_until_not_open");
  }
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  const [IN, CW, OUT] = G.V2_ENTRY_IDS;
  const want = { [IN]: ["reasoning_input_token", null, 2000000], [CW]: ["reasoning_input_token", "cache_write", 2500000], [OUT]: ["reasoning_output_token", null, 12000000] };
  for (const id of G.V2_ENTRY_IDS) {
    const e = byId[id]; const [dim, tier, rate] = want[id];
    if (e.billing_dimension !== dim || e.service_tier !== tier) return fail("entry_dimension_or_tier_mismatch");
    if (id === CW && e.rate_micros < 2500000) return fail("cache_write_rate_below_published");
    if (e.rate_micros !== rate) return fail(id === IN ? "input_rate_mismatch" : id === CW ? "cache_write_rate_mismatch" : "output_rate_mismatch");
  }
  if (version.effective_from !== G.T0 || version.created_at !== G.T0 || version.effective_until !== null) return fail("version_t0_mismatch");
  // recompute the canonical catalog payload FROM THE ROWS (never trust the stored digest column alone).
  const rebuilt = G.digestOf({
    catalog_version: { id: version.id, status: version.status, effective_from: version.effective_from, effective_until: version.effective_until, created_at: version.created_at },
    domain: G.CATALOG_DOMAIN,
    entries: entries.map((e) => ({ ...e })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }).digest;
  const reviewed = expectStatus === "active" ? G.v2Active.digest : G.v2Inactive.digest;
  if (rebuilt !== reviewed) return fail("catalog_digest_rebuild_mismatch");
  if (version.catalog_digest !== reviewed) return fail("stored_catalog_digest_mismatch");
  // freshness
  if (!RFC.test(String(nowIso))) return fail("now_malformed");
  const now = Date.parse(nowIso);
  if (now < Date.parse(G.T0)) return fail("verified_at_in_future");
  if (now >= Date.parse(G.T0_PLUS_7_DAYS)) return fail("verification_stale");
  // the reservation this catalog yields must be the reviewed worst case.
  if (G.worstCaseMicros(entries.map((e) => ({ billing_dimension: e.billing_dimension, service_tier: e.service_tier, rate_micros: e.rate_micros, unit_size: e.unit_size }))) !== G.V2_CEILING_MICROS) return fail("worst_case_not_105920");
  return { ok: true, digest: rebuilt };
}

/** the reviewed V2 rows exactly as the seed inserts them (status parameterised). */
export function reviewedV2Rows(status) {
  const version = { id: G.V2_ID, status, effective_from: G.T0, effective_until: null, catalog_digest: status === "active" ? G.v2Active.digest : G.v2Inactive.digest, created_at: G.T0 };
  const entries = G.entryRows(G.V2_ID, G.V2_RATES, G.T0, G.T0_PLUS_7_DAYS, G.SOURCE_DIGEST_V2, status);
  return { version, entries };
}

/** source-digest verifier: recompute from the canonical evidence payload. */
export function verifySourceDigest(payload, expectDigest) {
  try { return G.digestOf(payload).digest === expectDigest; } catch { return false; }
}

const POLICY_KEYS = ["created_at", "effective_from", "effective_until", "global_day_money_ceiling_micros", "id", "policy_digest",
  "project_day_money_ceiling_micros", "project_id", "project_month_money_ceiling_micros", "session_execution_admissions",
  "session_money_ceiling_micros", "session_provider_calls", "status", "subject_day_money_ceiling_micros"];
/** successor one-call policy contract: EXACT identity + FIVE money ceilings = 105,920 + TWO counts = 1,
 *  stored digest == reviewed == digest recomputed FROM THE ROW (a tampered ceiling can't hide behind an
 *  unchanged stored digest). The obsolete 89,536 policy is always rejected. */
export function checkSuccessorPolicy(row, expectStatus = "active") {
  if (!same(row, POLICY_KEYS)) return fail("policy_row_shape");
  if (row.id === G.ONECALL_V1.id || row.session_money_ceiling_micros === G.ONECALL_V1.ceiling) return fail("obsolete_89536_policy");
  if (row.id !== G.V2_POLICY_ID) return fail("policy_id_mismatch");
  if (row.project_id !== G.PROJECT_ID) return fail("policy_project_mismatch");
  if (row.status !== expectStatus) return fail("policy_status_mismatch");
  if (row.effective_from !== G.T0 || row.created_at !== G.T0 || row.effective_until !== null) return fail("policy_interval_mismatch");
  for (const k of ["session_money_ceiling_micros", "subject_day_money_ceiling_micros", "project_day_money_ceiling_micros", "project_month_money_ceiling_micros", "global_day_money_ceiling_micros"])
    if (row[k] !== G.V2_CEILING_MICROS) return fail("money_ceiling_not_exact:" + k);
  if (row.session_provider_calls !== 1) return fail("provider_calls_not_one");
  if (row.session_execution_admissions !== 1) return fail("execution_admissions_not_one");
  const reviewed = expectStatus === "active" ? G.v2PolicyActive.digest : G.v2PolicyRestored.digest;
  const rebuilt = G.digestOf(G.policyPayload(row.id, row.status, row.effective_from, row)).digest;
  if (rebuilt !== reviewed) return fail("policy_digest_rebuild_mismatch");
  if (row.policy_digest !== reviewed) return fail("stored_policy_digest_mismatch");
  return { ok: true };
}
export function reviewedPolicyRow(status = "active") {
  return { id: G.V2_POLICY_ID, project_id: G.PROJECT_ID, status, effective_from: G.T0, effective_until: null, ...G.V2_CEILINGS,
    policy_digest: status === "active" ? G.v2PolicyActive.digest : G.v2PolicyRestored.digest, created_at: G.T0 };
}
