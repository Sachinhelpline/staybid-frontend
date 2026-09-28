// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 trusted, READ-ONLY DB observation adapter. OFFLINE wiring only.
//
// Successor of trusted-executor-runtime-01/trusted-read-adapter.mjs (V1, frozen: catalog queries
// parameterised by the V1 catalog id; V1 armed/ceiling registry). This adapter:
//   • runs ONLY the eight queries of the content-verified V2 registry (assertSuppliedRegistryV2 —
//     REQUIRED in production AND test; there is no "registry-less" mode);
//   • DERIVES every observation from its own reads and CONSTRUCTS the trusted provenance /
//     dbIdentity / committed markers itself — never from a caller;
//   • converts values STRICTLY (a NULL / missing / non-integer never becomes 0; booleans only on
//     `=== true`), so a missing row can never masquerade as a dormant/zero value;
//   • uses V2-specific read-state provenance strings, so a V1 read capability can never be handed
//     to the V2 executor (and vice versa).
// ─────────────────────────────────────────────────────────────────────────

import { TRUSTED_LEDGER_PROVENANCE, TEST_LEDGER_PROVENANCE } from "../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs";
import { assertCanonicalConsumedAt } from "../../trusted-executor-runtime-01/canonical-timestamp.mjs";
import { assertSuppliedRegistryV2, V2_REGISTRY_DIGEST } from "./v2-query-registry.mjs";

export const TRUSTED_READSTATE_PROVENANCE_V2 = "trusted-approved-readonly-capability-v2";
export const TEST_READSTATE_PROVENANCE_V2 = "TEST-ONLY-readonly-capability-v2";

function fail(reason) { return { ok: false, reason }; }
/** strict integer: JS integer, or a pg BIGINT decimal string; anything else (null/undefined/float/"") ⇒ NaN. */
export function toInt(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : NaN;
  if (typeof v === "string" && /^-?[0-9]{1,18}$/.test(v)) { const n = Number(v); return Number.isSafeInteger(n) ? n : NaN; }
  return NaN;
}
const toBool = (v) => v === true;
const toStr = (v) => (typeof v === "string" ? v : null);

const CATALOG_FIELDS = (row) => ({
  catalog_version_count: toInt(row.catalog_version_count), catalog_entry_count: toInt(row.catalog_entry_count),
  active_catalog_count: toInt(row.active_catalog_count), active_catalog_entry_count: toInt(row.active_catalog_entry_count),
  v1_inactive_digest: toStr(row.v1_inactive_digest), v1_inactive_entry_count: toInt(row.v1_inactive_entry_count),
  v1_expiry_is_historical: toBool(row.v1_expiry_is_historical),
  v2_entry_count: toInt(row.v2_entry_count),
  v2_input_rate_micros: toInt(row.v2_input_rate_micros), v2_cache_write_rate_micros: toInt(row.v2_cache_write_rate_micros),
  v2_output_rate_micros: toInt(row.v2_output_rate_micros),
});
const POLICY_FIELDS = (row) => ({
  active_policy_count: toInt(row.active_policy_count), policy_version_count: toInt(row.policy_version_count),
  dormant_policy_present: toBool(row.dormant_policy_present), obsolete_v1_policy_present: toBool(row.obsolete_v1_policy_present),
  wildcard_policy_present: toBool(row.wildcard_policy_present),
});
const COUNT_FIELDS = (cnt) => ({
  envelopes: toInt(cnt.envelopes), provider_reservations: toInt(cnt.provider_reservations), provider_settlements: toInt(cnt.provider_settlements),
  execution_consumptions: toInt(cnt.execution_consumptions), decisions: toInt(cnt.decisions), reconciliations: toInt(cnt.reconciliations),
  scope_counters: toInt(cnt.scope_counters), sessions: toInt(cnt.sessions),
});
const CONTROL_FIELDS = (row) => ({
  control_row_count: toInt(row.control_row_count),
  global_control_epoch: toInt(row.global_control_epoch), project_control_epoch: toInt(row.project_control_epoch),
  global_control_enabled: toBool(row.global_control_enabled), project_control_enabled: toBool(row.project_control_enabled),
  global_control_killed: toBool(row.global_control_killed), project_control_killed: toBool(row.project_control_killed),
  control_global_digest: toStr(row.control_global_digest), control_project_digest: toStr(row.control_project_digest),
});

/**
 * @param opts.dbClient read-only client query(text, params) -> { rows }. Production rejects a __testFixture.
 * @param opts.targetBinding verified binding (ok===true) — supplies the trusted dbIdentity.
 * @param opts.registry the SUPPLIED V2 registry (validated by content here; required in every mode).
 * @param opts.mode 'production' | 'test'.
 */
export function makeTrustedReadAdapterV2(opts) {
  const { dbClient, targetBinding, registry, mode } = opts || {};
  if (mode !== "production" && mode !== "test") throw new Error("read_adapter_v2_mode_invalid");
  if (!targetBinding || targetBinding.ok !== true) throw new Error("read_adapter_v2_target_unverified");
  if (!dbClient || typeof dbClient.query !== "function") throw new Error("read_adapter_v2_db_client_absent");
  if (mode === "production" && dbClient.__testFixture === true) throw new Error("read_adapter_v2_refuses_test_fixture_in_production");
  const reg = assertSuppliedRegistryV2(registry);
  if (!reg.ok || reg.digest !== V2_REGISTRY_DIGEST) throw new Error("read_adapter_v2_registry_not_content_verified");
  const Q = Object.freeze({ ...registry }); // content-verified byte-identical copy (no later caller mutation)
  const dbIdentity = targetBinding.verifiedServiceId;
  const ledgerProvenance = mode === "test" ? TEST_LEDGER_PROVENANCE : TRUSTED_LEDGER_PROVENANCE;
  const readStateProvenance = mode === "test" ? TEST_READSTATE_PROVENANCE_V2 : TRUSTED_READSTATE_PROVENANCE_V2;

  async function one(name, params) {
    const r = await dbClient.query(Q[name], params || []);
    const rows = r && Array.isArray(r.rows) ? r.rows : null;
    if (!rows || rows.length !== 1) return undefined; // exactly-one-row contract; zero/many ⇒ unavailable
    return rows[0];
  }
  async function guarded(fn, reason) { try { return await fn(); } catch { return fail(reason); } }

  const observePreActivation = () => guarded(async () => {
    const cat = await one("preActivationCatalog"), pc = await one("policyControl"), cnt = await one("zeroExposureCounts");
    if (!cat || !pc || !cnt) return fail("pre_activation_state_unavailable");
    return {
      ok: true,
      preActivationState: { ...CATALOG_FIELDS(cat), v2_inactive_digest: toStr(cat.v2_inactive_digest), v2_inactive_entry_count: toInt(cat.v2_inactive_entry_count),
        ...POLICY_FIELDS(pc), v2_policy_present: toBool(pc.v2_policy_present), ...CONTROL_FIELDS(pc) },
      counts: COUNT_FIELDS(cnt),
    };
  }, "pre_activation_observe_error");

  const observeExposureCounts = () => guarded(async () => {
    const cnt = await one("zeroExposureCounts");
    if (!cnt) return fail("exposure_counts_unavailable");
    return { ok: true, counts: COUNT_FIELDS(cnt) };
  }, "exposure_observe_error");

  async function isApprovalConsumed(approvalId, executionId) {
    const r = await dbClient.query(Q.ledgerCommitted, [approvalId, executionId]);
    return !!(r && Array.isArray(r.rows) && r.rows.length > 0);
  }

  // POST-COMMIT committed-ledger observation (provenance/dbIdentity/committed set HERE, never by a caller).
  async function observeCommittedLedger({ approvalId, executionId } = {}) {
    if (typeof approvalId !== "string" || typeof executionId !== "string") return fail("ledger_observe_bad_args");
    let r;
    try { r = await dbClient.query(Q.ledgerCommitted, [approvalId, executionId]); } catch { return fail("ledger_read_error"); }
    const rows = r && Array.isArray(r.rows) ? r.rows : null;
    if (!rows) return fail("ledger_read_no_rows_field");
    for (const row of rows) { try { assertCanonicalConsumedAt(row.consumed_at); } catch { return fail("ledger_consumed_at_not_canonical"); } }
    return {
      ok: true,
      observation: {
        provenance: ledgerProvenance, dbIdentity, committed: true,
        records: rows.map((x) => ({ approval_id: x.approval_id, execution_id: x.execution_id, content_digest: x.content_digest,
          active_catalog_digest: x.active_catalog_digest, action: x.action, consumed_at: x.consumed_at })),
      },
    };
  }

  const observeActivated = () => guarded(async () => {
    const cat = await one("activatedCatalog"), pc = await one("policyControl");
    if (!cat || !pc) return fail("activated_state_unavailable");
    return { ok: true, activatedState: { ...CATALOG_FIELDS(cat), v2_active_digest: toStr(cat.v2_active_digest), v2_active_entry_count: toInt(cat.v2_active_entry_count),
      ...POLICY_FIELDS(pc), v2_policy_present: toBool(pc.v2_policy_present), ...CONTROL_FIELDS(pc) } };
  }, "activated_observe_error");

  const observeArmed = () => guarded(async () => {
    const a = await one("armedState");
    if (!a) return fail("armed_state_unavailable");
    return { ok: true, armedState: { ...CATALOG_FIELDS(a), v2_active_digest: toStr(a.v2_active_digest), v2_active_entry_count: toInt(a.v2_active_entry_count),
      one_call_policy_digest: toStr(a.one_call_policy_digest), ...POLICY_FIELDS(a), ...CONTROL_FIELDS(a) } };
  }, "armed_observe_error");

  const observeCeilings = () => guarded(async () => {
    const c = await one("ceilings");
    if (!c) return fail("ceilings_unavailable");
    return { ok: true, oneCallPolicy: {
      session_money_ceiling_micros: toInt(c.session_money_ceiling_micros), session_provider_calls: toInt(c.session_provider_calls),
      session_execution_admissions: toInt(c.session_execution_admissions), subject_day_money_ceiling_micros: toInt(c.subject_day_money_ceiling_micros),
      project_day_money_ceiling_micros: toInt(c.project_day_money_ceiling_micros), project_month_money_ceiling_micros: toInt(c.project_month_money_ceiling_micros),
      global_day_money_ceiling_micros: toInt(c.global_day_money_ceiling_micros) } };
  }, "ceilings_observe_error");

  const observeRestored = () => guarded(async () => {
    const r = await one("restoredState");
    if (!r) return fail("restored_state_unavailable");
    return { ok: true, restoredState: { ...CATALOG_FIELDS(r), v2_inactive_digest: toStr(r.v2_inactive_digest), v2_inactive_entry_count: toInt(r.v2_inactive_entry_count),
      v2_policy_restored_present: toBool(r.v2_policy_restored_present), ...POLICY_FIELDS(r), ...CONTROL_FIELDS(r) } };
  }, "restored_observe_error");

  return Object.freeze({ dbIdentity, registryDigest: reg.digest, readStateProvenance,
    observePreActivation, observeExposureCounts, isApprovalConsumed, observeCommittedLedger, observeActivated, observeArmed, observeCeilings, observeRestored });
}
