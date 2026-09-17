// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-BUDGET-01 — durable BudgetStore contract + PG adapter.
//
// The DURABLE authority behind the DPBEL local lease. A store atomically ACQUIRES a
// pre-reserved budget ENVELOPE (money micros + provider calls + execution admissions)
// in ONE serializable transaction, so two replicas competing at a ceiling can never
// overspend; the caller then holds that envelope's balance in a bounded LOCAL lease
// and reconciles actuals back on teardown.
//
//   • deployment-neutral CONTRACT (`BudgetStore`) — DEPENDENCY INJECTION only;
//   • a transactional PostgreSQL adapter (`createPgBudgetStore`) that talks to an
//     INJECTED structural SQL executor (never imports a driver, never assumes a DSN):
//     SERIALIZABLE isolation, an explicit `SET LOCAL timezone TO 'UTC'` so day/month
//     period boundaries are UTC regardless of the server timezone, a DETERMINISTIC
//     lock/update order (global control → project control → session → stable scope
//     counters → child rows), store-authoritative time, and FAIL-CLOSED on
//     serialization/lock ambiguity;
//   • stable scope-period counters keyed WITHOUT policy/catalog version (§10), so a
//     policy or price rollover NEVER resets accounting;
//   • idempotent acquisition (same key + same canonical commitment ⇒ same envelope;
//     different commitment ⇒ conflict) and idempotent reconciliation.
//
// REMEDIATION-01 (BUDGET-IMP-P0-01/P0-02/P1-01/P1-03/P1-04/P1-05):
//   • an acquisition replay reconstructs the envelope EXACTLY from its PERSISTED
//     immutable issuance pins (never the current clock/policy/catalog/control), and
//     distinguishes a still-valid held issuance from terminal / forfeited / revoked /
//     expired / identity-conflict (P0-01);
//   • the trusted ownership tuple (gatewaySessionDigest, subjectDigest, projectId) is
//     IMMUTABLE — an existing session row is reusable ONLY on exact equality; any
//     mismatch fails closed before any counter/envelope mutation (P0-02);
//   • durable child idempotency tables (execution consumptions + provider reservations/
//     settlements) are written + hydrated for authoritative cross-restart replay (P1-01);
//   • effective-interval predicates on policy/catalog selects reject future/expired
//     records; a canonical collision-resistant acquisition commitment replaces the
//     delimiter-concatenated digest; a subject/day provider-spend ceiling is enforced;
//     reconciliation locks counters in a deterministic order (P1-04);
//   • a deterministic, idempotent, concurrency-safe orphan reaper forfeits held
//     envelopes past their persisted expiry WITHOUT the dead process (P1-05).
//
// The PRODUCTION default is NO store (dormant) ⇒ no lease ⇒ fail closed. No DSN,
// migration apply, seed, or provider row is created here.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import type { BudgetClass, ProviderSpendClass } from "./live-ai-budget-pricing";
import { MAX_INT64, parseInt64 } from "./live-ai-budget-pricing";
import type { ControlSnapshot } from "./live-ai-budget-control";

// ═══════════════════════════ injected SQL executor (structural) ═══════════
/** A minimal structural SQL surface satisfied by `pg`'s Client/Pool WITHOUT importing
 *  the driver (no `@types/pg` at the gateway typecheck). Tests inject the real client. */
export interface SqlResult { readonly rows: ReadonlyArray<Record<string, unknown>>; readonly rowCount?: number | null; }
export interface SqlExecutor { query(text: string, params?: readonly unknown[]): Promise<SqlResult>; }
export interface SqlConnection extends SqlExecutor { release(): void; }
export interface SqlConnectionPool { connect(): Promise<SqlConnection>; }

// ═══════════════════════════ canonical acquisition commitment (§P1-04 E) ═══
/** A canonical, collision-resistant commitment over the acquisition's identity fields.
 *  Canonical serialization (sorted keys, length-prefixed values) + SHA-256 — NOT a
 *  delimiter-concatenated ambiguous string. Deterministic; no randomness, no secret. */
export function canonicalAcquisitionCommitment(fields: Readonly<Record<string, string>>): string {
  const keys = Object.keys(fields).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = String(fields[k]);
    parts.push(`${k.length}:${k}=${v.length}:${v}`); // length-prefixed ⇒ no delimiter ambiguity
  }
  return "acq256:" + createHash("sha256").update(parts.join("|")).digest("hex");
}

// ═══════════════════════════ acquisition request / result ═════════════════
export interface EnvelopeRequestAmounts {
  readonly moneyMicros: bigint;          // pre-reserved provider money (0 for execution admission)
  readonly providerCalls: bigint;        // pre-reserved provider calls (0 for execution admission)
  readonly executionAdmissions: bigint;  // pre-reserved execution admissions (0 for provider spend)
}

export interface EnvelopeAcquireRequest {
  readonly budgetClass: BudgetClass;
  readonly gatewaySessionDigest: string; // keyed digest of the GATEWAY-owned session authority (§5/§11)
  readonly subjectDigest: string;
  readonly projectId: string;
  /** create-once acquisition idempotency key (same key + same canonical commitment ⇒ same envelope). */
  readonly acquisitionKey: string;
  /** P0-01 frozen-lifecycle — the TRUSTED gateway-owned process/boot instance identifier. Pinned
   *  immutably at issuance; a replay from a DIFFERENT boot is refused (`envelope_previous_boot`), so
   *  a process restart can never resurrect old local allocation authority even when the durable
   *  revoke write never landed. Browser/model/provider can NEVER choose this value (injected by the
   *  trusted gateway runtime into the budget core). */
  readonly bootNonce: string;
  readonly amounts: EnvelopeRequestAmounts;
  /** the maximum control staleness this lease will tolerate (validated ≤ leaseTtlMs). */
  readonly maxControlStalenessMs: number;
  readonly leaseTtlMs: number;
}

export interface AcquiredEnvelope {
  readonly envelopeId: string;
  readonly budgetClass: BudgetClass;
  readonly amounts: EnvelopeRequestAmounts;
  readonly budgetSessionId: string;
  readonly gatewaySessionDigest: string;
  readonly subjectDigest: string;
  readonly projectId: string;
  readonly policyVersionId: string;
  readonly priceCatalogVersionId: string | null;
  // pinned control (the lease binds these) — reconstructed EXACTLY from durable pins on replay
  readonly globalControlEpoch: bigint;
  readonly projectControlEpoch: bigint;
  readonly controlVectorDigest: string;
  readonly maxControlStalenessMs: number;
  readonly leaseTtlMs: number;
  readonly leaseGeneration: bigint;
  readonly acquisitionCommitment: string;
  readonly bootNonce: string;            // P0-01 frozen-lifecycle — the pinned trusted boot instance
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  // legacy aliases (== issuedAtMs / expiresAtMs) kept for the authority core
  readonly leaseExpiryMs: number;
  readonly acquiredAtMs: number;
}

/** durable child replay state (P1-01) — hydrated into the local lease on an idempotent replay. */
export interface DurableExecutionChild { readonly executionId: string; readonly requestDigest: string; readonly admissionRef: string; }
export interface DurableProviderChild {
  readonly reservationRef: string; readonly providerSpendClass: ProviderSpendClass; readonly requestCommitment: string;
  readonly moneyMicros: bigint; readonly providerUnits: bigint; readonly state: "open" | "settled" | "revoked"; readonly chargedMicros: bigint;
}
export interface EnvelopeReplayState {
  readonly executions: readonly DurableExecutionChild[];
  readonly reservations: readonly DurableProviderChild[];
}

export type EnvelopeAcquireResult =
  | { readonly ok: true; readonly envelope: AcquiredEnvelope; readonly idempotentReplay: boolean; readonly replay?: EnvelopeReplayState }
  | { readonly ok: false; readonly reason: EnvelopeRefuseReason };

export type EnvelopeRefuseReason =
  | "no_store"
  | "unconfigured"
  | "no_policy"
  | "control_killed"
  | "control_disabled"
  | "control_unavailable"
  | "ceiling_exceeded"
  | "acquisition_conflict"
  | "ownership_conflict"
  | "envelope_terminal"
  | "envelope_forfeited"
  | "envelope_revoked"
  | "envelope_expired"
  | "envelope_open_child"
  | "envelope_previous_boot"   // P0-01 frozen-lifecycle — replay from a DIFFERENT trusted boot/process instance
  | "control_superseded"       // §9 — same-boot replay under an ADVANCED authoritative control epoch
  | "serialization_failure"
  | "invalid_request"
  | "store_error";

// ═══════════════════════════ child-record requests (P1-01) ═════════════════
export interface RecordExecutionRequest {
  readonly envelopeId: string; readonly gatewaySessionDigest: string;
  readonly executionId: string; readonly requestDigest: string; readonly admissionRef: string;
}
export interface RecordProviderReservationRequest {
  readonly envelopeId: string; readonly reservationRef: string; readonly providerSpendClass: ProviderSpendClass;
  readonly requestCommitment: string; readonly moneyMicros: bigint; readonly providerUnits: bigint;
}
export interface SettleProviderReservationRequest {
  readonly reservationRef: string; readonly chargedMicros: bigint; readonly releasedMicros: bigint;
  readonly actualUnits: bigint | null; readonly revoked: boolean;
  readonly overCap: boolean; readonly excessUnits: bigint | null; readonly incidentReason: string | null;
}
export type ChildRecordResult = { readonly ok: boolean; readonly reason?: string };

// ═══════════════════════════ reconciliation / reaper / revoke ══════════════
export interface ReconcileRequest {
  readonly envelopeId: string;
  readonly clean: boolean; // true = clean reconciliation with trusted actuals; false = crash/forfeit
  readonly moneyChargedMicros: bigint;
  readonly moneyReleasedMicros: bigint;
  readonly providerCallsCharged: bigint;
  readonly providerCallsReleased: bigint;
  readonly executionAdmissionsConsumed: bigint;
  readonly executionAdmissionsReleased: bigint;
  readonly reconciliationKey: string; // idempotency
}
export type ReconcileResult = { readonly ok: boolean; readonly reason?: string };

export interface ReapRequest { readonly nowMs: number; readonly maxBatch?: number; }
export type ReapResult = { readonly ok: boolean; readonly reaped: number; readonly reason?: string };

export interface RevokeEnvelopeRequest { readonly envelopeId: string; readonly reason: string; }

// ═══════════════════════════ the contract ═════════════════════════════════
export interface BudgetStore {
  readonly configured: boolean;
  acquireEnvelope(req: EnvelopeAcquireRequest): Promise<EnvelopeAcquireResult>;
  reconcile(req: ReconcileRequest): Promise<ReconcileResult>;
  /** durable execution-admission child (P1-01) — idempotent per executionId. */
  recordExecutionAdmission(req: RecordExecutionRequest): Promise<ChildRecordResult>;
  /** durable provider reservation child (P1-01) — idempotent per reservationRef (providerTurnId). */
  recordProviderReservation(req: RecordProviderReservationRequest): Promise<ChildRecordResult>;
  /** durable provider settlement (P1-01/P1-03) — idempotent per reservationRef. */
  settleProviderReservation(req: SettleProviderReservationRequest): Promise<ChildRecordResult>;
  /** durably mark an envelope revoked (P0-01 B) — idempotent; a later replay refuses it. */
  revokeEnvelope(req: RevokeEnvelopeRequest): Promise<ChildRecordResult>;
  /** deterministic, idempotent, concurrency-safe orphan reaper (P1-05 B). */
  reapOrphans(req: ReapRequest): Promise<ReapResult>;
  /** the current control snapshot for a project (feeds the async watcher). */
  readControl(projectId: string): Promise<ControlSnapshot | null>;
}

/** The PRODUCTION default — a dormant store. No binding ⇒ no lease ⇒ fail closed. */
export function createDormantBudgetStore(): BudgetStore {
  return Object.freeze({
    configured: false,
    async acquireEnvelope(): Promise<EnvelopeAcquireResult> { return { ok: false, reason: "no_store" }; },
    async reconcile(): Promise<ReconcileResult> { return { ok: false, reason: "no_store" }; },
    async recordExecutionAdmission(): Promise<ChildRecordResult> { return { ok: false, reason: "no_store" }; },
    async recordProviderReservation(): Promise<ChildRecordResult> { return { ok: false, reason: "no_store" }; },
    async settleProviderReservation(): Promise<ChildRecordResult> { return { ok: false, reason: "no_store" }; },
    async revokeEnvelope(): Promise<ChildRecordResult> { return { ok: false, reason: "no_store" }; },
    async reapOrphans(): Promise<ReapResult> { return { ok: false, reaped: 0, reason: "no_store" }; },
    async readControl(): Promise<ControlSnapshot | null> { return null; },
  });
}

// ═══════════════════════════ PostgreSQL adapter ═══════════════════════════
export interface PgBudgetStoreDeps {
  readonly pool: SqlConnectionPool;
  /** wall-clock ms (only for readControl.observedAtMs; period boundaries use SQL now()). */
  readonly nowMs: () => number;
  /** bounded pre-authority transaction retries on serialization failure (default 3). */
  readonly maxRetries?: number;
}

const SQL_SERIALIZATION_FAILURE = "40001";
const SQL_LOCK_NOT_AVAILABLE = "55P03";
const SQL_DEADLOCK = "40P01";

function isRetryable(err: unknown): boolean {
  const code = (err && typeof err === "object" && "code" in err) ? String((err as { code?: unknown }).code) : "";
  return code === SQL_SERIALIZATION_FAILURE || code === SQL_LOCK_NOT_AVAILABLE || code === SQL_DEADLOCK;
}

function validAmount(a: EnvelopeRequestAmounts): boolean {
  const ok = (v: unknown) => typeof v === "bigint" && v >= BigInt(0) && v <= MAX_INT64;
  return ok(a.moneyMicros) && ok(a.providerCalls) && ok(a.executionAdmissions);
}

/** The stable counter set touched by an acquisition — keyed WITHOUT policy/catalog
 *  version so a rollover never resets accounting (§10). PROVIDER_SPEND touches money
 *  (session / subject-day / project-day / project-month / global-day) + provider_calls
 *  (session); EXECUTION_ADMISSION touches execution_admissions (session) only. */
interface CounterKey {
  scopeType: "gateway_session" | "subject" | "project" | "global";
  scopeKeyDigest: string;
  periodKind: "session" | "day" | "month" | "lifetime";
  budgetClass: BudgetClass;
  accountingDimension: "money_micros" | "provider_calls" | "execution_admissions";
  requested: bigint;
  ceilingColumn: string; // the policy column carrying this counter's ceiling
}

function counterKeys(req: EnvelopeAcquireRequest): CounterKey[] {
  const gs = req.gatewaySessionDigest, subj = req.subjectDigest, proj = req.projectId, glob = "global";
  if (req.budgetClass === "EXECUTION_ADMISSION") {
    return [{
      scopeType: "gateway_session", scopeKeyDigest: gs, periodKind: "session", budgetClass: "EXECUTION_ADMISSION",
      accountingDimension: "execution_admissions", requested: req.amounts.executionAdmissions, ceilingColumn: "session_execution_admissions",
    }];
  }
  return [
    { scopeType: "gateway_session", scopeKeyDigest: gs, periodKind: "session", budgetClass: "PROVIDER_SPEND", accountingDimension: "money_micros", requested: req.amounts.moneyMicros, ceilingColumn: "session_money_ceiling_micros" },
    { scopeType: "gateway_session", scopeKeyDigest: gs, periodKind: "session", budgetClass: "PROVIDER_SPEND", accountingDimension: "provider_calls", requested: req.amounts.providerCalls, ceilingColumn: "session_provider_calls" },
    // P1-04 A — the frozen SUBJECT/DAY provider-spend ceiling (same subject across sessions counts together).
    { scopeType: "subject", scopeKeyDigest: subj, periodKind: "day", budgetClass: "PROVIDER_SPEND", accountingDimension: "money_micros", requested: req.amounts.moneyMicros, ceilingColumn: "subject_day_money_ceiling_micros" },
    { scopeType: "project", scopeKeyDigest: proj, periodKind: "day", budgetClass: "PROVIDER_SPEND", accountingDimension: "money_micros", requested: req.amounts.moneyMicros, ceilingColumn: "project_day_money_ceiling_micros" },
    { scopeType: "project", scopeKeyDigest: proj, periodKind: "month", budgetClass: "PROVIDER_SPEND", accountingDimension: "money_micros", requested: req.amounts.moneyMicros, ceilingColumn: "project_month_money_ceiling_micros" },
    { scopeType: "global", scopeKeyDigest: glob, periodKind: "day", budgetClass: "PROVIDER_SPEND", accountingDimension: "money_micros", requested: req.amounts.moneyMicros, ceilingColumn: "global_day_money_ceiling_micros" },
  ];
}

/** DETERMINISTIC lock order (§18 / P1-04 C): control (global→project) is read first, then
 *  the scope counters ordered by (scopeType rank, scopeKeyDigest, periodKind, dimension). */
const SCOPE_RANK: Record<string, number> = { global: 0, project: 1, subject: 2, gateway_session: 3 };
function counterSortKey(k: CounterKey): string {
  return `${SCOPE_RANK[k.scopeType]}|${k.scopeKeyDigest}|${k.periodKind}|${k.accountingDimension}`;
}

/** the canonical acquisition commitment for a request (P1-04 E). */
function commitmentFor(req: EnvelopeAcquireRequest): string {
  return canonicalAcquisitionCommitment({
    budgetClass: req.budgetClass,
    gatewaySessionDigest: req.gatewaySessionDigest,
    subjectDigest: req.subjectDigest,
    projectId: req.projectId,
    acquisitionKey: req.acquisitionKey,
    moneyMicros: req.amounts.moneyMicros.toString(),
    providerCalls: req.amounts.providerCalls.toString(),
    executionAdmissions: req.amounts.executionAdmissions.toString(),
  });
}

export function createPgBudgetStore(deps: PgBudgetStoreDeps): BudgetStore {
  const maxRetries = deps.maxRetries && deps.maxRetries > 0 ? deps.maxRetries : 3;

  async function withConn<T>(fn: (conn: SqlConnection) => Promise<T>, onErr: () => T): Promise<T> {
    let conn: SqlConnection | null = null;
    try { conn = await deps.pool.connect(); return await fn(conn); }
    catch { return onErr(); }
    finally { if (conn) try { conn.release(); } catch { /* no-op */ } }
  }

  async function readControl(projectId: string): Promise<ControlSnapshot | null> {
    return withConn(async (conn) => {
      const g = await conn.query(
        `SELECT control_epoch, enabled, killed, record_digest FROM budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global' LIMIT 1`,
      );
      const p = await conn.query(
        `SELECT control_epoch, enabled, killed, record_digest FROM budget_control_epochs WHERE scope_type='project' AND scope_key_digest=$1 LIMIT 1`,
        [projectId],
      );
      if (g.rows.length === 0 || p.rows.length === 0) return null;
      const ge = parseInt64(g.rows[0].control_epoch); const pe = parseInt64(p.rows[0].control_epoch);
      if (ge === null || pe === null) return null;
      const killed = Boolean(g.rows[0].killed) || Boolean(p.rows[0].killed);
      const enabled = Boolean(g.rows[0].enabled) && Boolean(p.rows[0].enabled);
      const vector = `${g.rows[0].record_digest}:${p.rows[0].record_digest}`;
      return Object.freeze({ globalEpoch: ge, projectEpoch: pe, controlVectorDigest: vector, enabled, killed, observedAtMs: deps.nowMs() });
    }, () => null);
  }

  /** reconstruct the AcquiredEnvelope from a durable envelope row EXACTLY (P0-01 C). */
  function reconstructFromRow(e: Record<string, unknown>): AcquiredEnvelope | null {
    const gE = parseInt64(e.global_control_epoch); const pE = parseInt64(e.project_control_epoch);
    const moneyHeld = parseInt64(e.money_held_micros); const callsHeld = parseInt64(e.provider_calls_held); const execHeld = parseInt64(e.execution_admissions_held);
    const ttl = parseInt64(e.lease_ttl_ms); const stale = parseInt64(e.max_control_staleness_ms); const gen = parseInt64(e.lease_generation);
    const issued = parseInt64(e.issued_at_ms); const expires = parseInt64(e.expires_at_ms);
    if (gE === null || pE === null || moneyHeld === null || callsHeld === null || execHeld === null || ttl === null || stale === null || gen === null || issued === null || expires === null) return null;
    return Object.freeze({
      envelopeId: String(e.id), budgetClass: String(e.budget_class) as BudgetClass,
      amounts: { moneyMicros: moneyHeld, providerCalls: callsHeld, executionAdmissions: execHeld },
      budgetSessionId: String(e.budget_session_id), gatewaySessionDigest: String(e.gateway_session_digest),
      subjectDigest: String(e.subject_digest), projectId: String(e.project_id),
      policyVersionId: String(e.policy_version_id), priceCatalogVersionId: e.price_catalog_version_id === null || e.price_catalog_version_id === undefined ? null : String(e.price_catalog_version_id),
      globalControlEpoch: gE, projectControlEpoch: pE, controlVectorDigest: String(e.control_vector_digest),
      maxControlStalenessMs: Number(stale), leaseTtlMs: Number(ttl), leaseGeneration: gen, acquisitionCommitment: String(e.acquisition_commitment),
      bootNonce: String(e.boot_nonce),
      issuedAtMs: Number(issued), expiresAtMs: Number(expires), leaseExpiryMs: Number(expires), acquiredAtMs: Number(issued),
    });
  }

  /** load the durable child replay state for an envelope (P1-01 hydration). */
  async function loadReplayState(conn: SqlConnection, envelopeId: string): Promise<EnvelopeReplayState> {
    const ex = await conn.query(
      `SELECT execution_id, request_digest, admission_ref FROM budget_execution_consumptions WHERE envelope_id=$1 ORDER BY execution_id`,
      [envelopeId],
    );
    const rs = await conn.query(
      `SELECT r.reservation_ref, r.provider_spend_class, r.request_commitment, r.money_micros, r.provider_units, r.state,
              COALESCE((SELECT SUM(s.charged_micros) FROM budget_provider_settlements s WHERE s.reservation_id=r.id),0) AS charged
         FROM budget_provider_reservations r WHERE r.envelope_id=$1 ORDER BY r.reservation_ref`,
      [envelopeId],
    );
    const executions: DurableExecutionChild[] = ex.rows.map((r) => ({ executionId: String(r.execution_id), requestDigest: String(r.request_digest), admissionRef: String(r.admission_ref) }));
    const reservations: DurableProviderChild[] = rs.rows.map((r) => ({
      reservationRef: String(r.reservation_ref), providerSpendClass: String(r.provider_spend_class) as ProviderSpendClass,
      requestCommitment: String(r.request_commitment), moneyMicros: parseInt64(r.money_micros) ?? BigInt(0), providerUnits: parseInt64(r.provider_units) ?? BigInt(0),
      state: String(r.state) as "open" | "settled" | "revoked", chargedMicros: parseInt64(r.charged) ?? BigInt(0),
    }));
    return { executions, reservations };
  }

  async function acquireOnce(conn: SqlConnection, req: EnvelopeAcquireRequest): Promise<EnvelopeAcquireResult> {
    await conn.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      // P1-04 B — day/month period boundaries are UTC regardless of the server timezone.
      await conn.query("SET LOCAL timezone TO 'UTC'");
      const nowRes = await conn.query("SELECT extract(epoch from now())*1000 AS now_ms");
      const nowMs = Number(nowRes.rows[0].now_ms);
      const commitment = commitmentFor(req);

      // ── idempotency: an existing envelope for this acquisition key (P0-01 B) ──
      const existing = await conn.query(
        `SELECT id, budget_session_id, request_digest, acquisition_commitment, gateway_session_digest, subject_digest, project_id,
                budget_class, policy_version_id, price_catalog_version_id, global_control_epoch, project_control_epoch,
                control_vector_digest, lease_ttl_ms, max_control_staleness_ms, lease_generation, issued_at_ms, expires_at_ms,
                money_held_micros, provider_calls_held, execution_admissions_held, state, revoked_at, boot_nonce
           FROM budget_envelopes WHERE acquisition_key=$1 FOR UPDATE`,
        [req.acquisitionKey],
      );
      if (existing.rows.length > 0) {
        const e = existing.rows[0];
        // identity conflict — a different canonical commitment under the same key.
        if (String(e.acquisition_commitment) !== commitment) { await conn.query("ROLLBACK"); return { ok: false, reason: "acquisition_conflict" }; }
        // trusted-ownership conflict (P0-02 / P0-01 B.6).
        if (String(e.gateway_session_digest) !== req.gatewaySessionDigest || String(e.subject_digest) !== req.subjectDigest || String(e.project_id) !== req.projectId) {
          await conn.query("ROLLBACK"); return { ok: false, reason: "ownership_conflict" };
        }
        // §8 — a SUCCESSFUL durable revoke refuses replay regardless of boot identity.
        if (e.revoked_at !== null && e.revoked_at !== undefined) { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_revoked" }; }
        // P0-01 FROZEN-LIFECYCLE — trusted boot/process-instance anti-resurrection boundary.
        // A replay whose pinned boot nonce differs from the current trusted boot nonce is a NEW
        // process/boot instance: it must NOT reconstruct old local allocation authority (even
        // when a prior durable revoke write never landed). The envelope is left to the existing
        // conservative recovery / orphan reaper / forfeit lifecycle — never resurrected here.
        if (String(e.boot_nonce) !== req.bootNonce) { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_previous_boot" }; }
        const state = String(e.state);
        if (state === "reconciled") { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_terminal" }; }
        if (state === "forfeited") { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_forfeited" }; }
        const expires = parseInt64(e.expires_at_ms);
        if (expires === null) { await conn.query("ROLLBACK"); return { ok: false, reason: "store_error" }; }
        if (Number(expires) <= nowMs) { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_expired" }; }
        // P0-01 §5 — crash ambiguity: an UNRESOLVED durable OPEN provider child proves a prior
        // process may have died in the provider-call settlement window. The envelope is NOT
        // replayable for fresh provider authority until reconciliation / the orphan reaper
        // forfeits it conservatively. Never charge the old child full and reissue the remainder.
        const openChild = await conn.query(`SELECT 1 FROM budget_provider_reservations WHERE envelope_id=$1 AND state='open' LIMIT 1`, [String(e.id)]);
        if (openChild.rows.length > 0) { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_open_child" }; }
        // §9 — CONTROL REVALIDATION on a SAME-boot replay: boot binding alone cannot cover the
        // same-boot recovery case, so a replay must never mint authority from a stale pinned
        // control state. Re-read the authoritative control (deterministic order: global then
        // project, FOR SHARE) and refuse a currently killed / disabled / ADVANCED-epoch control.
        const rgctl = await conn.query(
          `SELECT control_epoch, enabled, killed FROM budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global' FOR SHARE`,
        );
        const rpctl = await conn.query(
          `SELECT control_epoch, enabled, killed FROM budget_control_epochs WHERE scope_type='project' AND scope_key_digest=$1 FOR SHARE`,
          [String(e.project_id)],
        );
        if (rgctl.rows.length === 0 || rpctl.rows.length === 0) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_unavailable" }; }
        const curG = parseInt64(rgctl.rows[0].control_epoch); const curP = parseInt64(rpctl.rows[0].control_epoch);
        const pinG = parseInt64(e.global_control_epoch); const pinP = parseInt64(e.project_control_epoch);
        if (curG === null || curP === null || pinG === null || pinP === null) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_unavailable" }; }
        if (Boolean(rgctl.rows[0].killed) || Boolean(rpctl.rows[0].killed)) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_killed" }; }
        if (!(Boolean(rgctl.rows[0].enabled) && Boolean(rpctl.rows[0].enabled))) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_disabled" }; }
        if (curG > pinG || curP > pinP) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_superseded" }; } // advanced epoch ⇒ stale pinned authority
        const envelope = reconstructFromRow(e); // EXACT reconstruction from durable pins — never current clock/policy/catalog/control
        if (!envelope) { await conn.query("ROLLBACK"); return { ok: false, reason: "store_error" }; }
        const replay = await loadReplayState(conn, envelope.envelopeId);
        await conn.query("COMMIT");
        return { ok: true, idempotentReplay: true, envelope, replay };
      }

      // ── active policy (latest active for the project; else global default), effective NOW (P1-04 D) ──
      const pol = await conn.query(
        `SELECT * FROM budget_policy_versions
           WHERE status='active' AND (project_id=$1 OR project_id='*')
             AND effective_from <= now() AND (effective_until IS NULL OR now() < effective_until)
           ORDER BY (project_id=$1) DESC, effective_from DESC LIMIT 1`,
        [req.projectId],
      );
      if (pol.rows.length === 0) { await conn.query("ROLLBACK"); return { ok: false, reason: "no_policy" }; }
      const policy = pol.rows[0];
      const policyVersionId = String(policy.id);
      // ── active price catalog version, effective NOW (P1-04 D) ──
      const cat = await conn.query(
        `SELECT id FROM budget_price_catalog_versions
           WHERE status='active' AND effective_from <= now() AND (effective_until IS NULL OR now() < effective_until)
           ORDER BY effective_from DESC LIMIT 1`,
      );
      const priceCatalogVersionId = cat.rows.length > 0 ? String(cat.rows[0].id) : null;
      // ── control state (deterministic order: global then project), locked FOR SHARE ──
      const gctl = await conn.query(
        `SELECT control_epoch, enabled, killed, record_digest FROM budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global' FOR SHARE`,
      );
      const pctl = await conn.query(
        `SELECT control_epoch, enabled, killed, record_digest FROM budget_control_epochs WHERE scope_type='project' AND scope_key_digest=$1 FOR SHARE`,
        [req.projectId],
      );
      if (gctl.rows.length === 0 || pctl.rows.length === 0) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_unavailable" }; }
      const gEpoch = parseInt64(gctl.rows[0].control_epoch); const pEpoch = parseInt64(pctl.rows[0].control_epoch);
      if (gEpoch === null || pEpoch === null) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_unavailable" }; }
      const killed = Boolean(gctl.rows[0].killed) || Boolean(pctl.rows[0].killed);
      const enabled = Boolean(gctl.rows[0].enabled) && Boolean(pctl.rows[0].enabled);
      if (killed) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_killed" }; }
      if (!enabled) { await conn.query("ROLLBACK"); return { ok: false, reason: "control_disabled" }; }
      const controlVectorDigest = `${gctl.rows[0].record_digest}:${pctl.rows[0].record_digest}`;

      // ── get-or-create the gateway-session scope row; IMMUTABLE trusted ownership (P0-02) ──
      const sessRow = await conn.query(
        `SELECT id, subject_digest, project_id FROM budget_sessions WHERE gateway_session_digest=$1 FOR UPDATE`,
        [req.gatewaySessionDigest],
      );
      let budgetSessionId: string;
      if (sessRow.rows.length > 0) {
        const s = sessRow.rows[0];
        if (String(s.subject_digest) !== req.subjectDigest || String(s.project_id) !== req.projectId) {
          await conn.query("ROLLBACK"); return { ok: false, reason: "ownership_conflict" }; // never silently rebind subject/project
        }
        budgetSessionId = String(s.id);
      } else {
        const ins = await conn.query(
          `INSERT INTO budget_sessions (id, gateway_session_digest, subject_digest, project_id, created_at)
             VALUES ($1, $2, $3, $4, now()) RETURNING id`,
          [`bs_${req.gatewaySessionDigest}`, req.gatewaySessionDigest, req.subjectDigest, req.projectId],
        );
        budgetSessionId = String(ins.rows[0].id);
      }

      // ── lock + read the stable counters in deterministic order; compute exposure; check headroom ──
      const keys = counterKeys(req).sort((a, b) => counterSortKey(a).localeCompare(counterSortKey(b)));
      const touched: Array<{ id: string; key: CounterKey }> = [];
      for (const k of keys) {
        if (k.requested === BigInt(0)) continue; // nothing to reserve on this dimension
        const ceilingMicros = parseInt64(policy[k.ceilingColumn]);
        if (ceilingMicros === null) { await conn.query("ROLLBACK"); return { ok: false, reason: "no_policy" }; }
        // Build the period-start expression + params per period kind so EVERY parameter is
        // referenced (an unreferenced $5 makes Postgres reject "could not determine data type").
        // With SET LOCAL timezone TO 'UTC' above, date_trunc(now()) is UTC (P1-04 B).
        let periodStartExpr: string; let cParams: unknown[]; let dimParam: string;
        if (k.periodKind === "session") {
          periodStartExpr = "(SELECT created_at FROM budget_sessions WHERE gateway_session_digest=$5)";
          cParams = [k.scopeType, k.scopeKeyDigest, k.periodKind, k.budgetClass, req.gatewaySessionDigest, k.accountingDimension];
          dimParam = "$6";
        } else {
          periodStartExpr = k.periodKind === "day" ? "date_trunc('day', now())" : (k.periodKind === "month" ? "date_trunc('month', now())" : "'epoch'::timestamptz");
          cParams = [k.scopeType, k.scopeKeyDigest, k.periodKind, k.budgetClass, k.accountingDimension];
          dimParam = "$5";
        }
        // upsert-lock the counter row (stable key: NO policy/catalog version)
        const cRes = await conn.query(
          `INSERT INTO budget_scope_counters
             (id, scope_type, scope_key_digest, period_kind, period_start_utc, budget_class, accounting_dimension, currency_code,
              held, charged, consumed, released)
           VALUES (gen_random_uuid()::text, $1, $2, $3, ${periodStartExpr}, $4, ${dimParam}, 'USD', 0, 0, 0, 0)
           ON CONFLICT (scope_type, scope_key_digest, period_kind, period_start_utc, budget_class, accounting_dimension, currency_code)
             DO UPDATE SET scope_type=EXCLUDED.scope_type
           RETURNING id, held, charged, consumed`,
          cParams,
        );
        const row = cRes.rows[0];
        const held = parseInt64(row.held) ?? BigInt(0); const charged = parseInt64(row.charged) ?? BigInt(0); const consumed = parseInt64(row.consumed) ?? BigInt(0);
        const exposure = held + charged + consumed;
        if (exposure + k.requested > ceilingMicros) {
          await recordDecision(conn, req, policyVersionId, priceCatalogVersionId, "REFUSED", `ceiling:${k.accountingDimension}:${k.scopeType}:${k.periodKind}`);
          await conn.query("COMMIT");
          return { ok: false, reason: "ceiling_exceeded" };
        }
        touched.push({ id: String(row.id), key: k });
      }

      // ── atomically increment HELD on every touched counter (deterministic order) ──
      for (const t of touched) {
        await conn.query(`UPDATE budget_scope_counters SET held = held + $1, updated_at = now() WHERE id=$2`, [t.key.requested.toString(), t.id]);
      }
      // ── insert the envelope (with ALL immutable issuance pins) + allocations + decision ──
      const issuedAtMs = Math.trunc(nowMs);
      const expiresAtMs = Math.trunc(nowMs + req.leaseTtlMs);
      const envRes = await conn.query(
        `INSERT INTO budget_envelopes
           (id, acquisition_key, request_digest, acquisition_commitment, budget_class, budget_session_id, gateway_session_digest, subject_digest, project_id,
            policy_version_id, price_catalog_version_id, global_control_epoch, project_control_epoch, control_vector_digest,
            lease_ttl_ms, max_control_staleness_ms, lease_generation, issued_at_ms, expires_at_ms,
            money_held_micros, provider_calls_held, execution_admissions_held,
            money_charged_micros, money_released_micros, provider_calls_charged, provider_calls_released,
            execution_admissions_consumed, execution_admissions_released, state, acquired_at, acquired_at_ms, boot_nonce)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16, $17, $18, $19, $20, 0, 0, 0, 0, 0, 0, 'held', now(), $16, $21)
         RETURNING id`,
        [req.acquisitionKey, commitment /* legacy request_digest = commitment */, commitment, req.budgetClass, budgetSessionId, req.gatewaySessionDigest, req.subjectDigest, req.projectId,
         policyVersionId, priceCatalogVersionId, gEpoch.toString(), pEpoch.toString(), controlVectorDigest,
         req.leaseTtlMs.toString(), req.maxControlStalenessMs.toString(), issuedAtMs, expiresAtMs,
         req.amounts.moneyMicros.toString(), req.amounts.providerCalls.toString(), req.amounts.executionAdmissions.toString(), req.bootNonce],
      );
      const envelopeId = String(envRes.rows[0].id);
      for (const t of touched) {
        await conn.query(
          `INSERT INTO budget_envelope_allocations (id, envelope_id, scope_counter_id, accounting_dimension, held_amount)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
          [envelopeId, t.id, t.key.accountingDimension, t.key.requested.toString()],
        );
      }
      await recordDecision(conn, req, policyVersionId, priceCatalogVersionId, "ADMITTED", envelopeId);
      await conn.query("COMMIT");
      return {
        ok: true, idempotentReplay: false,
        envelope: Object.freeze({
          envelopeId, budgetClass: req.budgetClass, amounts: req.amounts, budgetSessionId, gatewaySessionDigest: req.gatewaySessionDigest,
          subjectDigest: req.subjectDigest, projectId: req.projectId, policyVersionId, priceCatalogVersionId,
          globalControlEpoch: gEpoch, projectControlEpoch: pEpoch, controlVectorDigest,
          maxControlStalenessMs: req.maxControlStalenessMs, leaseTtlMs: req.leaseTtlMs, leaseGeneration: BigInt(1), acquisitionCommitment: commitment,
          bootNonce: req.bootNonce,
          issuedAtMs, expiresAtMs, leaseExpiryMs: expiresAtMs, acquiredAtMs: issuedAtMs,
        }),
      };
    } catch (err) {
      try { await conn.query("ROLLBACK"); } catch { /* no-op */ }
      throw err;
    }
  }

  async function recordDecision(conn: SqlConnection, req: EnvelopeAcquireRequest, policyVersionId: string, catId: string | null, decision: string, detail: string): Promise<void> {
    await conn.query(
      `INSERT INTO budget_decisions (id, acquisition_key, budget_class, gateway_session_digest, project_id, policy_version_id, price_catalog_version_id, decision, detail, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [req.acquisitionKey, req.budgetClass, req.gatewaySessionDigest, req.projectId, policyVersionId, catId, decision, detail],
    );
  }

  async function acquireEnvelope(req: EnvelopeAcquireRequest): Promise<EnvelopeAcquireResult> {
    if (!req || typeof req !== "object") return { ok: false, reason: "invalid_request" };
    if (!validAmount(req.amounts)) return { ok: false, reason: "invalid_request" };
    if (!(req.leaseTtlMs > 0) || !(req.maxControlStalenessMs > 0) || !(req.maxControlStalenessMs <= req.leaseTtlMs)) return { ok: false, reason: "invalid_request" };
    if (!req.acquisitionKey || !req.gatewaySessionDigest || !req.projectId || !req.subjectDigest) return { ok: false, reason: "invalid_request" };
    // P0-01 frozen-lifecycle — a trusted boot/process-instance identifier is MANDATORY at issuance.
    if (typeof req.bootNonce !== "string" || req.bootNonce.length === 0) return { ok: false, reason: "invalid_request" };
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let conn: SqlConnection | null = null;
      try {
        conn = await deps.pool.connect();
        return await acquireOnce(conn, req); // SAME acquisitionKey reused across retries — idempotent-safe
      } catch (err) {
        if (!isRetryable(err)) { return { ok: false, reason: "store_error" }; }
      } finally { if (conn) try { conn.release(); } catch { /* no-op */ } }
    }
    return { ok: false, reason: "serialization_failure" };
  }

  /** shared forfeit of ALL remaining held on an envelope's counters (crash / reaper). */
  async function forfeitCounters(conn: SqlConnection, envelopeId: string, heldMoney: bigint, heldCalls: bigint, heldExec: bigint): Promise<void> {
    const allocs = await conn.query(
      `SELECT scope_counter_id, accounting_dimension, held_amount FROM budget_envelope_allocations WHERE envelope_id=$1 ORDER BY scope_counter_id`,
      [envelopeId],
    );
    for (const a of allocs.rows) {
      const held = parseInt64(a.held_amount) ?? BigInt(0);
      const dim = String(a.accounting_dimension);
      const charged = dim === "money_micros" || dim === "provider_calls" ? held : BigInt(0);
      const consumed = dim === "execution_admissions" ? held : BigInt(0);
      await conn.query(
        `UPDATE budget_scope_counters SET held = held - $1, charged = charged + $2, consumed = consumed + $3, updated_at = now() WHERE id=$4`,
        [held.toString(), charged.toString(), consumed.toString(), String(a.scope_counter_id)],
      );
    }
    void heldMoney; void heldCalls; void heldExec; // held is derived per-allocation above
  }

  async function reconcile(req: ReconcileRequest): Promise<ReconcileResult> {
    if (!req || !req.envelopeId || !req.reconciliationKey) return { ok: false, reason: "invalid_request" };
    let conn: SqlConnection | null = null;
    try {
      conn = await deps.pool.connect();
      await conn.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await conn.query("SET LOCAL timezone TO 'UTC'");
      try {
        // idempotent: a reconciliation for this key already recorded ⇒ no-op success
        const done = await conn.query(`SELECT 1 FROM budget_reconciliations WHERE reconciliation_key=$1 LIMIT 1`, [req.reconciliationKey]);
        if (done.rows.length > 0) { await conn.query("COMMIT"); return { ok: true }; }
        const env = await conn.query(
          `SELECT id, state, money_held_micros, provider_calls_held, execution_admissions_held FROM budget_envelopes WHERE id=$1 FOR UPDATE`,
          [req.envelopeId],
        );
        if (env.rows.length === 0) { await conn.query("ROLLBACK"); return { ok: false, reason: "envelope_not_found" }; }
        const e = env.rows[0];
        if (String(e.state) !== "held") { await conn.query("COMMIT"); return { ok: true }; } // already reconciled/forfeited
        const heldMoney = parseInt64(e.money_held_micros) ?? BigInt(0);
        const heldCalls = parseInt64(e.provider_calls_held) ?? BigInt(0);
        const heldExec = parseInt64(e.execution_admissions_held) ?? BigInt(0);
        // clamp: never charge/consume more than held; a crash forfeits ALL remaining held
        let chargeMoney: bigint, releaseMoney: bigint, chargeCalls: bigint, releaseCalls: bigint, consumeExec: bigint, releaseExec: bigint;
        if (req.clean) {
          chargeMoney = clamp(req.moneyChargedMicros, BigInt(0), heldMoney);
          releaseMoney = heldMoney - chargeMoney; // any not charged is released
          chargeCalls = clamp(req.providerCallsCharged, BigInt(0), heldCalls);
          releaseCalls = heldCalls - chargeCalls;
          consumeExec = clamp(req.executionAdmissionsConsumed, BigInt(0), heldExec);
          releaseExec = heldExec - consumeExec;
        } else {
          chargeMoney = heldMoney; releaseMoney = BigInt(0); chargeCalls = heldCalls; releaseCalls = BigInt(0); consumeExec = heldExec; releaseExec = BigInt(0);
        }
        // move counters held → charged/consumed/released (DETERMINISTIC order: scope_counter_id) — P1-04 C
        const allocs = await conn.query(`SELECT scope_counter_id, accounting_dimension, held_amount FROM budget_envelope_allocations WHERE envelope_id=$1 ORDER BY scope_counter_id`, [req.envelopeId]);
        for (const a of allocs.rows) {
          const dim = String(a.accounting_dimension);
          const held = parseInt64(a.held_amount) ?? BigInt(0);
          let charged = BigInt(0), released = BigInt(0), consumed = BigInt(0);
          if (dim === "money_micros") { const ratioCharged = heldMoney === BigInt(0) ? BigInt(0) : (held * chargeMoney) / heldMoney; charged = ratioCharged; released = held - charged; }
          else if (dim === "provider_calls") { const c = heldCalls === BigInt(0) ? BigInt(0) : (held * chargeCalls) / heldCalls; charged = c; released = held - c; }
          else if (dim === "execution_admissions") { const c = heldExec === BigInt(0) ? BigInt(0) : (held * consumeExec) / heldExec; consumed = c; released = held - c; }
          await conn.query(
            `UPDATE budget_scope_counters SET held = held - $1, charged = charged + $2, consumed = consumed + $3, released = released + $4, updated_at = now() WHERE id=$5`,
            [held.toString(), charged.toString(), consumed.toString(), released.toString(), String(a.scope_counter_id)],
          );
        }
        await conn.query(
          `UPDATE budget_envelopes SET state=$1, money_charged_micros=$2, money_released_micros=$3, provider_calls_charged=$4, provider_calls_released=$5, execution_admissions_consumed=$6, execution_admissions_released=$7, reconciled_at=now() WHERE id=$8`,
          [req.clean ? "reconciled" : "forfeited", chargeMoney.toString(), releaseMoney.toString(), chargeCalls.toString(), releaseCalls.toString(), consumeExec.toString(), releaseExec.toString(), req.envelopeId],
        );
        await conn.query(
          `INSERT INTO budget_reconciliations (id, reconciliation_key, envelope_id, clean, crash_forfeit, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())`,
          [req.reconciliationKey, req.envelopeId, req.clean, !req.clean],
        );
        await conn.query("COMMIT");
        return { ok: true };
      } catch (err) { try { await conn.query("ROLLBACK"); } catch { /* no-op */ } return { ok: false, reason: errCode(err) || "store_error" }; }
    } catch { return { ok: false, reason: "store_error" }; } finally { if (conn) try { conn.release(); } catch { /* no-op */ } }
  }

  // ── durable child idempotency (P1-01) ──────────────────────────────────────
  async function recordExecutionAdmission(req: RecordExecutionRequest): Promise<ChildRecordResult> {
    if (!req || !req.envelopeId || !req.executionId || !req.requestDigest || !req.admissionRef) return { ok: false, reason: "invalid_request" };
    return withConn(async (conn) => {
      const cur = await conn.query(`SELECT request_digest FROM budget_execution_consumptions WHERE execution_id=$1 LIMIT 1`, [req.executionId]);
      if (cur.rows.length > 0) return String(cur.rows[0].request_digest) === req.requestDigest ? { ok: true } : { ok: false, reason: "conflict" };
      try {
        await conn.query(
          `INSERT INTO budget_execution_consumptions (id, envelope_id, gateway_session_digest, execution_id, request_digest, admission_ref, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, now())`,
          [req.envelopeId, req.gatewaySessionDigest, req.executionId, req.requestDigest, req.admissionRef],
        );
        return { ok: true };
      } catch (err) {
        if (errCode(err) === "23505") { // unique race — re-read
          const re = await conn.query(`SELECT request_digest FROM budget_execution_consumptions WHERE execution_id=$1 LIMIT 1`, [req.executionId]);
          if (re.rows.length > 0) return String(re.rows[0].request_digest) === req.requestDigest ? { ok: true } : { ok: false, reason: "conflict" };
        }
        return { ok: false, reason: "store_error" };
      }
    }, () => ({ ok: false, reason: "store_error" }));
  }

  async function recordProviderReservation(req: RecordProviderReservationRequest): Promise<ChildRecordResult> {
    if (!req || !req.envelopeId || !req.reservationRef || !req.requestCommitment) return { ok: false, reason: "invalid_request" };
    return withConn(async (conn) => {
      const cur = await conn.query(`SELECT request_commitment FROM budget_provider_reservations WHERE reservation_ref=$1 LIMIT 1`, [req.reservationRef]);
      if (cur.rows.length > 0) return String(cur.rows[0].request_commitment) === req.requestCommitment ? { ok: true } : { ok: false, reason: "conflict" };
      try {
        await conn.query(
          `INSERT INTO budget_provider_reservations (id, envelope_id, reservation_ref, provider_spend_class, request_commitment, money_micros, provider_units, state, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'open', now())`,
          [req.envelopeId, req.reservationRef, req.providerSpendClass, req.requestCommitment, req.moneyMicros.toString(), req.providerUnits.toString()],
        );
        return { ok: true };
      } catch (err) {
        if (errCode(err) === "23505") {
          const re = await conn.query(`SELECT request_commitment FROM budget_provider_reservations WHERE reservation_ref=$1 LIMIT 1`, [req.reservationRef]);
          if (re.rows.length > 0) return String(re.rows[0].request_commitment) === req.requestCommitment ? { ok: true } : { ok: false, reason: "conflict" };
        }
        return { ok: false, reason: "store_error" };
      }
    }, () => ({ ok: false, reason: "store_error" }));
  }

  async function settleProviderReservation(req: SettleProviderReservationRequest): Promise<ChildRecordResult> {
    if (!req || !req.reservationRef) return { ok: false, reason: "invalid_request" };
    let conn: SqlConnection | null = null;
    try {
      conn = await deps.pool.connect();
      await conn.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const r = await conn.query(`SELECT id, state FROM budget_provider_reservations WHERE reservation_ref=$1 FOR UPDATE`, [req.reservationRef]);
        if (r.rows.length === 0) { await conn.query("ROLLBACK"); return { ok: false, reason: "reservation_not_found" }; }
        const rid = String(r.rows[0].id);
        if (String(r.rows[0].state) !== "open") {
          // P1-01 §6 — already terminal: an EXACT-duplicate is inert success ONLY when the FULL
          // authoritative settlement tuple matches (chargedMicros, releasedMicros, actualUnits,
          // revoked/terminal state, overCap, excessUnits, incidentReason — nulls compare exactly);
          // ANY changed authoritative field ⇒ settlement_conflict (fail closed).
          const prev = await conn.query(`SELECT charged_micros, released_micros, actual_units, over_cap, excess_units, incident_reason FROM budget_provider_settlements WHERE reservation_id=$1 ORDER BY created_at ASC LIMIT 1`, [rid]);
          if (prev.rows.length > 0) {
            const p = prev.rows[0];
            const eqInt = (raw: unknown, want: bigint) => (parseInt64(raw) ?? BigInt(-1)) === want;
            const eqOptInt = (raw: unknown, want: bigint | null) => { const pv = (raw === null || raw === undefined) ? null : parseInt64(raw); return (pv === null && want === null) || (pv !== null && want !== null && pv === want); };
            const eqOptStr = (raw: unknown, want: string | null) => ((raw === null || raw === undefined) ? null : String(raw)) === (want === null || want === undefined ? null : String(want));
            const sameState = String(r.rows[0].state) === (req.revoked ? "revoked" : "settled");
            const exact = eqInt(p.charged_micros, req.chargedMicros)
              && eqInt(p.released_micros, req.releasedMicros)
              && eqOptInt(p.actual_units, req.actualUnits)
              && Boolean(p.over_cap) === Boolean(req.overCap)
              && eqOptInt(p.excess_units, req.excessUnits)
              && eqOptStr(p.incident_reason, req.incidentReason)
              && sameState;
            if (exact) { await conn.query("COMMIT"); return { ok: true }; }
            await conn.query("ROLLBACK"); return { ok: false, reason: "settlement_conflict" };
          }
          // P1-01 §7 — a terminal reservation with NO settlement row: accepting an arbitrary new
          // settlement would create economic meaning after terminalization. Fail closed.
          await conn.query("ROLLBACK"); return { ok: false, reason: "terminal_conflict" };
        }
        await conn.query(
          `UPDATE budget_provider_reservations SET state=$1, over_cap=$2, excess_units=$3, incident_reason=$4 WHERE id=$5`,
          [req.revoked ? "revoked" : "settled", req.overCap, req.excessUnits === null ? null : req.excessUnits.toString(), req.incidentReason, rid],
        );
        await conn.query(
          `INSERT INTO budget_provider_settlements (id, reservation_id, charged_micros, released_micros, actual_units, over_cap, excess_units, incident_reason, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now())`,
          [rid, req.chargedMicros.toString(), req.releasedMicros.toString(), req.actualUnits === null ? null : req.actualUnits.toString(), req.overCap, req.excessUnits === null ? null : req.excessUnits.toString(), req.incidentReason],
        );
        // an over-cap incident records envelope-level excess debt (never minted as spend authority).
        if (req.overCap && req.excessUnits !== null) {
          await conn.query(
            `UPDATE budget_envelopes SET incident_reason=COALESCE(incident_reason,$2) WHERE id=(SELECT envelope_id FROM budget_provider_reservations WHERE id=$1)`,
            [rid, req.incidentReason || "provider_actual_over_reservation"],
          );
        }
        await conn.query("COMMIT");
        return { ok: true };
      } catch (err) { try { await conn.query("ROLLBACK"); } catch { /* no-op */ } return { ok: false, reason: errCode(err) || "store_error" }; }
    } catch { return { ok: false, reason: "store_error" }; } finally { if (conn) try { conn.release(); } catch { /* no-op */ } }
  }

  async function revokeEnvelope(req: RevokeEnvelopeRequest): Promise<ChildRecordResult> {
    if (!req || !req.envelopeId) return { ok: false, reason: "invalid_request" };
    return withConn<ChildRecordResult>(async (conn) => {
      await conn.query(
        `UPDATE budget_envelopes SET revoked_at=now(), revoked_reason=$2 WHERE id=$1 AND revoked_at IS NULL`,
        [req.envelopeId, req.reason || "revoked"],
      );
      return { ok: true }; // idempotent (no-op if already revoked)
    }, () => ({ ok: false, reason: "store_error" }));
  }

  // ── orphan reaper (P1-05 B/C/D) — deterministic, idempotent, concurrency-safe ──
  async function reapOrphans(req: ReapRequest): Promise<ReapResult> {
    if (!req || typeof req.nowMs !== "number" || !Number.isFinite(req.nowMs)) return { ok: false, reaped: 0, reason: "invalid_request" };
    const batch = req.maxBatch && req.maxBatch > 0 ? Math.min(req.maxBatch, 500) : 100;
    let conn: SqlConnection | null = null;
    try {
      conn = await deps.pool.connect();
      await conn.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        // FOR UPDATE SKIP LOCKED ⇒ two concurrent reapers never touch the same envelope.
        const orphans = await conn.query(
          `SELECT id, money_held_micros, provider_calls_held, execution_admissions_held
             FROM budget_envelopes
            WHERE state='held' AND expires_at_ms <= $1
            ORDER BY expires_at_ms ASC
            LIMIT $2 FOR UPDATE SKIP LOCKED`,
          [Math.trunc(req.nowMs), batch],
        );
        let reaped = 0;
        for (const e of orphans.rows) {
          const envelopeId = String(e.id);
          const reconKey = `reap_${envelopeId}`;
          const dup = await conn.query(`SELECT 1 FROM budget_reconciliations WHERE reconciliation_key=$1 LIMIT 1`, [reconKey]);
          if (dup.rows.length > 0) continue; // idempotent — already reaped
          const heldMoney = parseInt64(e.money_held_micros) ?? BigInt(0);
          const heldCalls = parseInt64(e.provider_calls_held) ?? BigInt(0);
          const heldExec = parseInt64(e.execution_admissions_held) ?? BigInt(0);
          await forfeitCounters(conn, envelopeId, heldMoney, heldCalls, heldExec);
          await conn.query(
            `UPDATE budget_envelopes SET state='forfeited', money_charged_micros=money_held_micros, provider_calls_charged=provider_calls_held, execution_admissions_consumed=execution_admissions_held, incident_reason=COALESCE(incident_reason,'orphan_reaped'), reconciled_at=now() WHERE id=$1 AND state='held'`,
            [envelopeId],
          );
          await conn.query(
            `INSERT INTO budget_reconciliations (id, reconciliation_key, envelope_id, clean, crash_forfeit, created_at) VALUES (gen_random_uuid()::text, $1, $2, FALSE, TRUE, now())`,
            [reconKey, envelopeId],
          );
          reaped += 1;
        }
        await conn.query("COMMIT");
        return { ok: true, reaped };
      } catch (err) { try { await conn.query("ROLLBACK"); } catch { /* no-op */ } return { ok: false, reaped: 0, reason: errCode(err) || "store_error" }; }
    } catch { return { ok: false, reaped: 0, reason: "store_error" }; } finally { if (conn) try { conn.release(); } catch { /* no-op */ } }
  }

  return Object.freeze({
    configured: true, acquireEnvelope, reconcile, recordExecutionAdmission, recordProviderReservation,
    settleProviderReservation, revokeEnvelope, reapOrphans, readControl,
  });
}

function errCode(err: unknown): string {
  return (err && typeof err === "object" && "code" in err) ? String((err as { code?: unknown }).code) : "";
}

function clamp(v: bigint, lo: bigint, hi: bigint): bigint {
  if (typeof v !== "bigint" || v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
