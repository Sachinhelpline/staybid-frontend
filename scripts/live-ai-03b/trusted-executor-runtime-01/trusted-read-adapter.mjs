// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (Implementation C + D) — trusted,
// read-only DB observation adapter. OFFLINE wiring only. It DERIVES observations
// from its OWN restricted read boundary and CONSTRUCTS the trusted provenance /
// dbIdentity / committed markers ITSELF — it never accepts those from a caller.
//
// Concrete, known-schema reads (columns recovered from the accepted SQL artifact):
//   • committed approval-consumption ledger (Phase-B core):
//       live_ai_03b_trusted.approval_consumption(approval_id, execution_id,
//         content_digest, active_catalog_digest, action, consumed_at)
//   • catalog version/entry state:
//       public.budget_price_catalog_versions(id, status, catalog_digest)
//       public.budget_price_catalog_entries(catalog_version_id, status)
//
// The exact columns of the one-call POLICY / CONTROL epoch / seven-CEILING and the
// zero-exposure count tables are NOT present in the accepted 19 artifacts, so they
// are read through reviewedStateQueries — a DEPLOYMENT-supplied, reviewed, fixed
// query map whose column→field aliasing is confirmed against the APPLIED schema.
// That mapping is a documented FUTURE LIVE SCHEMA-CONFIRMATION GATE (see the
// future-live-preflight spec); it is NEVER runtime caller data, and its absence
// fails closed. No arbitrary SQL is ever accepted.
// ─────────────────────────────────────────────────────────────────────────

import { FIXED, RECEIPT_ACTION } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { TRUSTED_LEDGER_PROVENANCE, TEST_LEDGER_PROVENANCE } from "../trusted-activation-boundary-01/approval-verify.mjs";
import { CANONICAL_CONSUMED_AT_SQL, assertCanonicalConsumedAt } from "./canonical-timestamp.mjs";

// The executor's Phase-A read-state provenance (recovered from the accepted
// trusted-activation-executor.mjs, line 69 — module-private there, so mirrored here
// as a recovered contract constant, NOT reconstructed from memory).
export const TRUSTED_READSTATE_PROVENANCE = "trusted-approved-readonly-capability";
export const TEST_READSTATE_PROVENANCE = "TEST-ONLY-readonly-capability";

// Fixed, known-schema queries. consumed_at uses the SAME canonicalizer as the frozen
// receipt so the two strings are byte-identical (Implementation E, no client drift).
export const LEDGER_COMMITTED_QUERY =
  "SELECT approval_id, execution_id, content_digest, active_catalog_digest, action, "
  + CANONICAL_CONSUMED_AT_SQL + " AS consumed_at "
  + "FROM live_ai_03b_trusted.approval_consumption WHERE approval_id=$1 AND execution_id=$2 AND action='activate'";
export const CATALOG_ACTIVE_COUNT_QUERY =
  "SELECT count(*)::int AS n FROM public.budget_price_catalog_versions WHERE status='active'";
export const CATALOG_ACTIVE_DIGEST_QUERY =
  "SELECT catalog_digest FROM public.budget_price_catalog_versions WHERE id=$1 AND status='active'";
export const CATALOG_INACTIVE_VERSION_QUERY =
  "SELECT count(*)::int AS n, max(catalog_digest) AS digest FROM public.budget_price_catalog_versions WHERE id=$1 AND status='inactive'";
export const CATALOG_INACTIVE_ENTRY_COUNT_QUERY =
  "SELECT count(*)::int AS n FROM public.budget_price_catalog_entries WHERE catalog_version_id=$1 AND status='inactive'";

// The reviewed deployment query names whose exact SQL/columns are the future live gate.
export const REVIEWED_STATE_QUERY_NAMES = Object.freeze(["dormantPolicyControl", "armedPolicyControl", "ceilings", "zeroExposureCounts"]);

function fail(reason) { return { ok: false, reason }; }
async function one(dbClient, sql, params) { const r = await dbClient.query(sql, params); return r && r.rows && r.rows[0] ? r.rows[0] : undefined; }

/**
 * @param {object} opts
 *  - dbClient: read-only client query(text,params)->{rows}. Production rejects a test fixture.
 *  - targetBinding: verified binding (ok===true) — supplies the trusted dbIdentity.
 *  - reviewedStateQueries: map of the 4 reviewed fixed queries (deployment artifact). Required
 *      for dormant/armed/ceiling observations; absence fails those closed (future live gate).
 *  - mode: 'production' | 'test'.
 */
export function makeTrustedReadAdapter(opts) {
  const { dbClient, targetBinding, reviewedStateQueries, mode } = opts || {};
  if (mode !== "production" && mode !== "test") throw new Error("read_adapter_mode_invalid");
  if (!targetBinding || targetBinding.ok !== true) throw new Error("read_adapter_target_unverified");
  if (!dbClient || typeof dbClient.query !== "function") throw new Error("read_adapter_db_client_absent");
  if (mode === "production" && dbClient.__testFixture === true) throw new Error("read_adapter_refuses_test_fixture_in_production");
  // Correction C/E — in production the reviewed-state queries must come from the immutable,
  // digest-bound production query registry (marked with __registryDigest), NEVER arbitrary caller
  // SQL strings. (Offline production is already blocked earlier by an incomplete registry; this is
  // defense-in-depth so a registry-less query map can never be used in production.)
  if (mode === "production" && (!reviewedStateQueries || typeof reviewedStateQueries.__registryDigest !== "string")) {
    throw new Error("read_adapter_refuses_unregistered_queries_in_production");
  }
  const dbIdentity = targetBinding.verifiedServiceId;
  const ledgerProvenance = mode === "test" ? TEST_LEDGER_PROVENANCE : TRUSTED_LEDGER_PROVENANCE;
  const readStateProvenance = mode === "test" ? TEST_READSTATE_PROVENANCE : TRUSTED_READSTATE_PROVENANCE;

  async function reviewed(name, params) {
    if (!REVIEWED_STATE_QUERY_NAMES.includes(name)) throw new Error("reviewed_query_unknown:" + name);
    const sql = reviewedStateQueries ? reviewedStateQueries[name] : undefined;
    if (typeof sql !== "string" || sql.trim() === "") return undefined; // future live gate: absent ⇒ fail closed
    return await one(dbClient, sql, params || []);
  }

  // ── catalog reads (known schema) ──
  async function catalogActiveCount() { const r = await one(dbClient, CATALOG_ACTIVE_COUNT_QUERY, []); return r ? Number(r.n) : NaN; }

  // ── Phase-A dormant predecessor observation (trusted, internally constructed) ──
  async function observeDormant() {
    const activeCount = await catalogActiveCount();
    const inactiveVer = await one(dbClient, CATALOG_INACTIVE_VERSION_QUERY, [FIXED.catalog_version_id]);
    const inactiveEntries = await one(dbClient, CATALOG_INACTIVE_ENTRY_COUNT_QUERY, [FIXED.catalog_version_id]);
    const pc = await reviewed("dormantPolicyControl", []);
    const counts = await reviewed("zeroExposureCounts", []);
    if (!inactiveVer || !inactiveEntries || !pc || !counts) return fail("dormant_state_unavailable");
    return {
      ok: true,
      dormantState: {
        active_catalog_count: Number(activeCount),
        inactive_catalog_version_count: Number(inactiveVer.n),
        inactive_catalog_entry_count: Number(inactiveEntries.n),
        inactive_catalog_digest: inactiveVer.digest,
        active_policy_count: Number(pc.active_policy_count),
        dormant_policy_present: pc.dormant_policy_present === true,
        global_control_epoch: Number(pc.global_control_epoch), project_control_epoch: Number(pc.project_control_epoch),
        global_control_enabled: pc.global_control_enabled === true, project_control_enabled: pc.project_control_enabled === true,
        global_control_killed: pc.global_control_killed === true, project_control_killed: pc.project_control_killed === true,
      },
      counts: {
        envelopes: Number(counts.envelopes), provider_reservations: Number(counts.provider_reservations),
        provider_settlements: Number(counts.provider_settlements), execution_consumptions: Number(counts.execution_consumptions),
        decisions: Number(counts.decisions), reconciliations: Number(counts.reconciliations),
        scope_counters: Number(counts.scope_counters), sessions: Number(counts.sessions),
      },
    };
  }

  // ── Phase-A: authoritative approval-not-consumed (ledger) ──
  async function isApprovalConsumed(approvalId, executionId) {
    const r = await dbClient.query(LEDGER_COMMITTED_QUERY, [approvalId, executionId]);
    return !!(r && r.rows && r.rows.length > 0);
  }

  // ── Phase-B: authoritative POST-COMMIT committed-ledger observation. Constructed here;
  //    provenance/dbIdentity/committed are set by the adapter, NEVER by a caller. Each row's
  //    consumed_at is asserted already canonical (the fixed query emits the canonical form). ──
  async function observeCommittedLedger({ approvalId, executionId }) {
    if (typeof approvalId !== "string" || typeof executionId !== "string") return fail("ledger_observe_bad_args");
    let r;
    try { r = await dbClient.query(LEDGER_COMMITTED_QUERY, [approvalId, executionId]); }
    catch { return fail("ledger_read_error"); }
    const rows = (r && Array.isArray(r.rows)) ? r.rows : null;
    if (!rows) return fail("ledger_read_no_rows_field");
    for (const row of rows) {
      try { assertCanonicalConsumedAt(row.consumed_at); } catch { return fail("ledger_consumed_at_not_canonical"); }
    }
    // committed:true is asserted only because this is a real read of the committed ledger AFTER
    // the activation transaction; the caller cannot set it.
    return {
      ok: true,
      observation: {
        provenance: ledgerProvenance, dbIdentity, committed: true,
        records: rows.map((x) => ({
          approval_id: x.approval_id, execution_id: x.execution_id, content_digest: x.content_digest,
          active_catalog_digest: x.active_catalog_digest, action: x.action, consumed_at: x.consumed_at,
        })),
      },
    };
  }

  // ── Phase-B armed state + seven ceilings (catalog known; policy/control/ceilings reviewed gate) ──
  async function observeArmed() {
    const activeDigestRow = await one(dbClient, CATALOG_ACTIVE_DIGEST_QUERY, [FIXED.catalog_version_id]);
    const pc = await reviewed("armedPolicyControl", []);
    if (!activeDigestRow || !pc) return fail("armed_state_unavailable");
    return {
      ok: true,
      armedState: {
        active_catalog_digest: activeDigestRow.catalog_digest,
        one_call_policy_digest: pc.one_call_policy_digest,
        control_global_digest: pc.control_global_digest, control_project_digest: pc.control_project_digest,
        global_control_epoch: Number(pc.global_control_epoch), project_control_epoch: Number(pc.project_control_epoch),
        global_control_enabled: pc.global_control_enabled === true, project_control_enabled: pc.project_control_enabled === true,
        global_control_killed: pc.global_control_killed === true, project_control_killed: pc.project_control_killed === true,
      },
    };
  }
  async function observeCeilings() {
    const c = await reviewed("ceilings", []);
    if (!c) return fail("ceilings_unavailable");
    return {
      ok: true,
      oneCallPolicy: {
        session_money_ceiling_micros: Number(c.session_money_ceiling_micros),
        session_provider_calls: Number(c.session_provider_calls),
        session_execution_admissions: Number(c.session_execution_admissions),
        subject_day_money_ceiling_micros: Number(c.subject_day_money_ceiling_micros),
        project_day_money_ceiling_micros: Number(c.project_day_money_ceiling_micros),
        project_month_money_ceiling_micros: Number(c.project_month_money_ceiling_micros),
        global_day_money_ceiling_micros: Number(c.global_day_money_ceiling_micros),
      },
    };
  }

  return { dbIdentity, readStateProvenance, observeDormant, isApprovalConsumed, observeCommittedLedger, observeArmed, observeCeilings };
}
