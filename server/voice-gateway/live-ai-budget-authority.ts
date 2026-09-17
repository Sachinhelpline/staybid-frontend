// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-BUDGET-01 — the DPBEL budget core + two facades.
//
// ONE authoritative durable budget core (Durable Pre-reserved Budget Envelope with
// a bounded Local synchronous lease Ledger) exposing TWO typed, SYNCHRONOUS, I/O-FREE
// facades over the SAME gateway-owned budget-session authority:
//
//   A. EXECUTION_ADMISSION  — the released 03A `ExecutionBudgetGate` (admit()).
//        · consumes execution-admission quota ONLY;  · consumes ZERO provider money.
//   B. PROVIDER_SPEND       — the existing `BudgetAuthority` (reserve()/settle()).
//        · consumes provider-call quota + pre-reserved USD micros;
//        · is CALL-BOUND (the factory owns provider/model/class/session/turn/price/lease)
//          — a caller may NOT use reserve() to choose provider/model/price/class, and a
//          03A budgetAdmissionRef can NEVER authorize provider money.
//
// The durable envelope is acquired ASYNCHRONOUSLY (prepare*Lease → store). The sync
// facades then consume/release against the bounded LOCAL lease with NO DB/network I/O.
// Every sync admission/reserve checks ONLY local state (lease valid / not expired /
// not revoked / control epoch coherent / freshness deadline not passed / headroom / a
// MONOTONIC local clock that has not regressed). A stale control heartbeat FAILS CLOSED.
//
// REMEDIATION-01 (BUDGET-IMP-P0-01/P0-02/P1-01/P1-02/P1-03/P1-05):
//   • an acquisition replay NEVER overwrites a live local ledger nor replenishes consumed
//     balance: a re-prepare with a live lease is an idempotent no-op, a revoked local lease
//     refuses, and a durable replay HYDRATES the prior child state (no fresh authority) —
//     a crash-ambiguous (open, unsettled) durable child is treated as charged (P0-01/P1-01);
//   • each control watcher is bound to the EXACT (digest, kind, envelopeId, lease
//     generation) — a replaced lease is never refreshed by an old watcher and a
//     wrong-project heartbeat can never refresh another lease (P0-02);
//   • provider reserve idempotency is keyed by the TRUSTED providerTurnId on the LEASE
//     (survives facade recreation); an EMPTY provider-turn id is refused (P1-01/P1-02);
//   • provider monetary authority is USD-only; the lease is pinned to the envelope's
//     exact price-catalog version; settlement converts an actual UPWARD (never Math.trunc
//     downward) and an actual-above-reservation records an EXPLICIT excess incident and
//     revokes (never under-account, never mint) (P1-03);
//   • a local clock regression FAILS CLOSED; no lease TTL / control staleness / poll
//     interval is invented — they are supplied by approved config, else UNAVAILABLE (P1-05).
//
// PRODUCTION default (no store / no policy / no catalog) ⇒ no lease ⇒ FAIL CLOSED.
// ─────────────────────────────────────────────────────────────────────────

import type { BillingDimension, PriceCatalog, ProviderSpendClass } from "./live-ai-budget-pricing";
import { costMicros, isUsdCurrency, safeCeilUnits } from "./live-ai-budget-pricing";
import type { BudgetStore, EnvelopeRequestAmounts, EnvelopeReplayState } from "./live-ai-budget-store";
import { canonicalAcquisitionCommitment } from "./live-ai-budget-store";
import type { ControlSnapshot, ControlWatcher, ControlWatcherTimers, PinnedControl } from "./live-ai-budget-control";
import { createControlWatcher } from "./live-ai-budget-control";

export const BUDGET_AUTHORITY_VERSION = "staybid-budget-authority.dpbel.v1" as const;
export const EXECUTION_LEDGER_MAX = 512 as const;    // bounded local idempotency ledger
export const PROVIDER_LEDGER_MAX = 512 as const;

// The frozen provider/model identities per class (model NAMES, never rates). A price
// entry for the (provider, model, dimension) must exist in the pinned catalog for the
// class's provider-spend authority to be available.
export const BUDGET_PROVIDER = "openai" as const;
export const REASONING_MODEL = "gpt-5.6-terra" as const;
export const TRANSCRIPTION_MODEL = "gpt-live-transcribe" as const;
export const TTS_MODEL = "gpt-4o-mini-tts" as const;

// The frozen per-class reservation profiles — the request-CEILING native units per
// billing dimension (NOT rates). Reasoning reserves the worst case = max input at the
// input rate + max output at the output rate (no cached discount). Transcription
// reserves the full permitted capture (180 s). TTS has NO safe default native mapping
// (no char→token/audio guess), so its authority is UNAVAILABLE unless a complete
// reservation-bound rule is injected (§15).
interface ProfileDim { readonly dimension: BillingDimension; readonly units: bigint; readonly serviceTier: string | null; }
const REASONING_PROFILE: readonly ProfileDim[] = Object.freeze([
  Object.freeze({ dimension: "reasoning_input_token" as BillingDimension, units: BigInt(2000), serviceTier: null }),
  Object.freeze({ dimension: "reasoning_output_token" as BillingDimension, units: BigInt(2000), serviceTier: null }),
]);
const TRANSCRIPTION_PROFILE: readonly ProfileDim[] = Object.freeze([
  Object.freeze({ dimension: "realtime_audio_second" as BillingDimension, units: BigInt(180), serviceTier: null }),
]);

// ── LIVE-AI-03B — the accepted REASONING reservation ceiling for a 03B text turn.
// The 03B payload bound (≤32 KiB serialized) can drive up to ~32768 input tokens, so the
// 2000/2000 legacy REASONING_PROFILE is insufficient. This ADDITIVE 03B path reserves the
// 32768 input ceiling ONCE (at the HIGHEST usable input-tier rate — never triple-counted
// across the ordinary/cached/cache-write tiers) plus the 2000-token output ceiling. The
// legacy reserve()/settle()/REASONING_PROFILE path is UNCHANGED for existing consumers. ──
export const REASONING_03B_MAX_INPUT_TOKENS = BigInt(32768);
export const REASONING_03B_MAX_OUTPUT_TOKENS = BigInt(2000);
/** The service-tier vocabulary the 03B settlement recognises (base + cached + cache-write). */
export const REASONING_INPUT_TIER_CACHED = "cached" as const;
export const REASONING_INPUT_TIER_CACHE_WRITE = "cache_write" as const;

/** authoritative provider REASONING usage (Responses `usage.*`), for exact 03B settlement. */
export interface ReasoningUsageV1 {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

interface Reasoning03bRateTier { readonly rateMicros: bigint; readonly unitSize: bigint; }
interface Reasoning03bRates {
  readonly base: Reasoning03bRateTier;               // reasoning_input_token / tier null (REQUIRED)
  readonly cached: Reasoning03bRateTier | null;      // reasoning_input_token / tier cached (OPTIONAL)
  readonly cacheWrite: Reasoning03bRateTier | null;  // reasoning_input_token / tier cache_write (OPTIONAL)
  readonly out: Reasoning03bRateTier;                // reasoning_output_token / tier null (REQUIRED)
  readonly worstCaseMicros: bigint;                  // 32768 input (highest tier) + 2000 output
}

function classModel(cls: ProviderSpendClass): string {
  return cls === "REASONING" ? REASONING_MODEL : cls === "TRANSCRIPTION" ? TRANSCRIPTION_MODEL : TTS_MODEL;
}

// ═══════════════════════════ seam types (structural, no frozen-file edit) ══
export type BudgetDecisionValue = "ADMITTED" | "REFUSED" | "UNAVAILABLE";
export interface ExecutionBudgetInputLike {
  readonly dispatchId: string; readonly executionId: string; readonly capabilityId: string;
  readonly authorityClass: string; readonly requestDigest: string;
  readonly issuedAtMonotonicMs: number; readonly deadlineMonotonicMs: number;
}
export interface ExecutionBudgetOutcomeLike { readonly decision: BudgetDecisionValue; readonly budgetAdmissionRef?: string; }
export interface ExecutionBudgetGateLike { admit(input: ExecutionBudgetInputLike): ExecutionBudgetOutcomeLike; }
/** the existing provider-spend seam (byte-identical to live-ai-sessions.BudgetAuthority). */
export interface BudgetAuthorityLike {
  reserve(sessionKey: string, estimate: number): string | null;
  settle(reservationId: string, actualOrNull: number | null): void;
}

// ═══════════════════════════ local lease ═══════════════════════════════════
interface OpenProviderReservation {
  readonly id: string; readonly cls: ProviderSpendClass; readonly providerTurnId: string; readonly requestCommitment: string;
  readonly moneyMicros: bigint; readonly reservedUnits: bigint;
  readonly settleDim: { dimension: BillingDimension; rateMicros: bigint; unitSize: bigint; serviceTier: string | null } | null; // single-dim classes only
  /** LIVE-AI-03B — the frozen multi-tier reasoning rates + token ceilings for exact usage
   *  settlement (present ONLY on a reserveReasoning03b reservation). */
  readonly reasoning03b?: Reasoning03bRates | null;
  settled: boolean;
  /** P1-01 5B — a HYDRATED already-consumed/terminal provider child. A reserve() for its
   *  providerTurnId must NEVER authorize a second provider invocation (return null). */
  readonly terminal: boolean;
  // settlement outputs (for durable flush + audit)
  chargedMicros: bigint; releasedMicros: bigint; actualUnits: bigint | null;
  overCap: boolean; excessUnits: bigint | null; incidentReason: string | null; revoked: boolean;
  flushed: boolean; settleFlushed: boolean;
}
interface ExecEntry { readonly requestDigest: string; readonly ref: string; flushed: boolean; }
interface LocalLease {
  readonly envelopeId: string;
  readonly acquisitionKey: string;
  readonly leaseGeneration: bigint;
  /** P0-02 — the canonical immutable issuance/preparation commitment; the live-lease
   *  fast path re-validates the repeated request against this and fails closed on any
   *  material difference. */
  readonly issuanceCommitment: string;
  readonly gatewaySessionDigest: string;
  readonly projectId: string;
  readonly kind: "PROVIDER_SPEND" | "EXECUTION_ADMISSION";
  readonly pinned: PinnedControl;
  readonly pricedCatalog: PriceCatalog;              // catalog pinned at prepare (rollover-immune)
  readonly policyVersionId: string;
  readonly priceCatalogVersionId: string | null;
  lastFreshMs: number;
  revoked: boolean;
  revokedReason: string | null;
  // money accounting (PROVIDER_SPEND) — charged + open + free ALWAYS sum to envelope money
  chargedMoneyMicros: bigint; openReservedMoneyMicros: bigint; freeMoneyMicros: bigint;
  chargedCalls: bigint; openCalls: bigint; freeCalls: bigint;
  // execution accounting (EXECUTION_ADMISSION)
  consumedAdmissions: bigint; freeAdmissions: bigint;
  readonly openReservations: Map<string, OpenProviderReservation>;         // by reservationId
  readonly reservationsByTurn: Map<string, OpenProviderReservation>;       // by providerTurnId (idempotency)
  readonly admittedByExecution: Map<string, ExecEntry>;
  readonly admittedByDigest: Map<string, string>; // requestDigest → executionId
  readonly excessEvents: Array<{ reservationId: string; reason: string; excessUnits: string }>;
}

// ═══════════════════════════ core deps + public shape ═════════════════════
export interface BudgetCoreClock { nowMs(): number; }
export interface BudgetCoreDeps {
  readonly store: BudgetStore | null;                 // null ⇒ dormant (no lease)
  readonly catalog: PriceCatalog;                     // in-memory pricing (EMPTY default)
  readonly clock: BudgetCoreClock;
  readonly hashSession: (rawGatewaySessionId: string) => string;
  readonly mintRef: (kind: string, seq: number) => string;
  readonly ttsReservationRule?: { dimension: BillingDimension; units: bigint; serviceTier?: string | null } | null;
  readonly controlTimers?: ControlWatcherTimers;
  /** REQUIRED when a store is wired — no poll interval is invented (P1-05 F). */
  readonly controlIntervalMs?: number;
  /** P0-01 frozen-lifecycle — the TRUSTED gateway-owned process/boot instance identifier, generated
   *  once per gateway process boot by trusted runtime (never browser/model/provider-chosen). REQUIRED
   *  when a store is wired: it is pinned immutably onto every issued envelope, and a replay from a
   *  DIFFERENT boot is refused so a process restart can never resurrect old local allocation authority
   *  even if a prior durable revoke write never landed. Absent with a store wired ⇒ prepare FAILS CLOSED. */
  readonly bootNonce?: string;
}

export interface PrepareLeaseRequest {
  readonly gatewaySessionId: string;                  // RAW gateway session id (hashed internally)
  readonly subjectDigest: string;
  readonly projectId: string;
  readonly acquisitionKey: string;
  readonly maxControlStalenessMs: number;
  readonly leaseTtlMs: number;
  /** the envelope size to pre-reserve. Provider: {moneyMicros, providerCalls}. Execution: {executionAdmissions}. */
  readonly amounts: EnvelopeRequestAmounts;
}
export type PrepareResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ProviderCallBinding {
  readonly providerSpendClass: ProviderSpendClass;
  readonly gatewaySessionId: string;
  readonly providerTurnId: string;
}

export interface BudgetCore {
  prepareProviderLease(req: PrepareLeaseRequest): Promise<PrepareResult>;
  prepareExecutionLease(req: PrepareLeaseRequest): Promise<PrepareResult>;
  providerSpendAuthority(binding: ProviderCallBinding): BudgetAuthorityLike;
  executionAdmissionGate(gatewaySessionId: string): ExecutionBudgetGateLike;
  /** P1-01 — ASYNC flush of the live lease's child idempotency records to the durable
   *  store (execution admissions + provider reservations/settlements). NO sync facade
   *  performs I/O; this is the async hydration source for a future replay/restart. A
   *  durable conflict revokes the lease (fail closed). Dormant (no store) ⇒ no-op. */
  persistPending(gatewaySessionId: string): Promise<void>;
  /** P1-01 5A — the ASYNC persist barrier the gateway calls AFTER a successful local
   *  reserve and BEFORE the provider invocation. Durably persists the pending provider
   *  child; returns false (⇒ NO provider invocation, fail closed) on failure/conflict.
   *  Dormant (no store) ⇒ true (the dormant path never reaches a real provider). */
  persistProviderReservation(gatewaySessionId: string, providerTurnId: string): Promise<boolean>;
  /** P0-01B — the async POST-SETTLEMENT barrier: durably flush the provider settlement +
   *  any revocation AFTER the sync local settle; false ⇒ unresolved (local lease left
   *  fail-closed so no fresh provider authority). Dormant ⇒ true. */
  persistProviderSettlement(gatewaySessionId: string, providerTurnId: string): Promise<boolean>;
  /** LIVE-AI-03B — the accepted 03B REASONING worst-case reservation micros (32768 input at
   *  the highest usable input tier + 2000 output), resolved from the pinned catalog, or null
   *  when a required tier is missing/stale/non-USD (⇒ NO provider authority). Pure/sync/no I/O.
   *  The controller uses it to size the pre-reserved envelope BEFORE prepareProviderLease. */
  quoteReasoning03bWorstCaseMicros(): bigint | null;
  /** LIVE-AI-03B — reserve the accepted 32768-input-once + 2000-output REASONING worst case
   *  against the live local lease (sync, zero I/O). Returns the reservation id, or null (fail
   *  closed) on an invalid lease / missing rate tier / insufficient headroom / empty turn id. */
  reserveReasoning03b(gatewaySessionId: string, providerTurnId: string): string | null;
  /** LIVE-AI-03B — settle a 03B REASONING reservation from authoritative provider usage
   *  (multi-tier exact charge; reasoning tokens are part of output and NEVER double-charged).
   *  null/malformed/unsafe/incoherent/over-ceiling usage retains the FULL reservation; a
   *  provider actual above the authorized ceiling records an incident + revokes local
   *  authority (the durable revoke lands via persistProviderSettlement). Sync, zero I/O. */
  settleUsage(gatewaySessionId: string, providerTurnId: string, usage: ReasoningUsageV1 | null): void;
  reconcileSession(gatewaySessionId: string, opts?: { crash?: boolean }): Promise<void>;
  revokeSession(gatewaySessionId: string, reason: string): void;
  /** P0-01 — the AUTHORITATIVE async revocation: marks the local lease revoked AND durably
   *  revokes the matching envelope so a process-loss replay is refused. Fail-closed on a
   *  durable-revoke failure (the local lease stays revoked; authority is never restored). */
  revokeSessionDurable(gatewaySessionId: string, reason: string): Promise<void>;
  /** read-only lease introspection (tests / audit) — never mutates. */
  inspect(gatewaySessionId: string): { provider: LeaseView | null; execution: LeaseView | null };
  stop(): void;
}
export interface LeaseView {
  readonly envelopeId: string; readonly leaseGeneration: string; readonly revoked: boolean; readonly revokedReason: string | null;
  readonly freeMoneyMicros: string; readonly openReservedMoneyMicros: string; readonly chargedMoneyMicros: string;
  readonly freeCalls: string; readonly openCalls: string; readonly chargedCalls: string;
  readonly freeAdmissions: string; readonly consumedAdmissions: string;
  readonly excessCount: number;
  readonly lastFreshMs: number; readonly leaseExpiryMs: number;
}

export function createBudgetCore(deps: BudgetCoreDeps): BudgetCore {
  const providerLeases = new Map<string, LocalLease>(); // key: gatewaySessionDigest
  const executionLeases = new Map<string, LocalLease>();
  const watchers = new Map<string, { w: ControlWatcher; envelopeId: string; gen: bigint }>(); // key: `${digest}:${kind}`
  let seq = 0;
  const mint = (kind: string) => { seq += 1; return deps.mintRef(kind, seq); };
  const timers: ControlWatcherTimers = deps.controlTimers || { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  // P1-05 F — NO invented poll default. When a store is wired, the interval MUST be supplied.
  const controlIntervalMs = (typeof deps.controlIntervalMs === "number" && deps.controlIntervalMs > 0) ? deps.controlIntervalMs : 0;

  // ── monotonic local clock (P1-05) — ONE canonical guarded read for ALL authority
  //    reads (prepare baseline, admit, reserve, worst-case pricing, freshness, expiry).
  //    A regression LATCHES fail-closed AND revokes all local allocation authority. ──
  let lastMonotonicMs = Number.NEGATIVE_INFINITY;
  let clockRegressed = false;
  function latchRegression(): void {
    if (!clockRegressed) {
      clockRegressed = true;
      // P1-05 D — revoke all local allocation authority; a later-forward clock never resurrects.
      providerLeases.forEach((l) => { if (!l.revoked) { l.revoked = true; l.revokedReason = "clock_regressed"; } });
      executionLeases.forEach((l) => { if (!l.revoked) { l.revoked = true; l.revokedReason = "clock_regressed"; } });
    }
  }
  function monotonicNow(): number | null {
    if (clockRegressed) return null;
    const now = deps.clock.nowMs();
    if (!(typeof now === "number" && Number.isFinite(now))) { latchRegression(); return null; }
    if (now < lastMonotonicMs) { latchRegression(); return null; }        // regression ⇒ fail closed (latched)
    lastMonotonicMs = now;
    return now;
  }

  // ── local lease validity (SYNC, zero I/O) ─────────────────────────────────
  function leaseValid(lease: LocalLease | undefined | null): lease is LocalLease {
    if (!lease) return false;
    if (lease.revoked) return false;
    const now = monotonicNow();
    if (now === null) return false;                                      // clock regressed / non-finite → fail closed
    if (now >= lease.pinned.leaseExpiryMs) return false;
    if (now - lease.lastFreshMs > lease.pinned.maxControlStalenessMs) return false; // stale control heartbeat → fail closed
    return true;
  }

  function wkey(digest: string, kind: LocalLease["kind"]): string { return `${digest}:${kind}`; }

  /** P0-02 — the canonical, collision-resistant immutable issuance/preparation commitment
   *  over every material issuance-defining field (kind, session/subject/project, key,
   *  quota, and control timing bounds). The live-lease fast path compares against this. */
  function issuanceCommitmentFor(kind: LocalLease["kind"], digest: string, req: PrepareLeaseRequest): string {
    return canonicalAcquisitionCommitment({
      kind, gatewaySessionDigest: digest, subjectDigest: req.subjectDigest, projectId: req.projectId,
      acquisitionKey: req.acquisitionKey, moneyMicros: req.amounts.moneyMicros.toString(),
      providerCalls: req.amounts.providerCalls.toString(), executionAdmissions: req.amounts.executionAdmissions.toString(),
      maxControlStalenessMs: String(req.maxControlStalenessMs), leaseTtlMs: String(req.leaseTtlMs),
    });
  }

  function installWatcher(kind: LocalLease["kind"], digest: string, projectId: string, pinned: PinnedControl, envelopeId: string, gen: bigint): void {
    if (!deps.store || controlIntervalMs <= 0) return;
    const key = wkey(digest, kind);
    const prior = watchers.get(key); if (prior) { try { prior.w.stop(); } catch { /* no-op */ } }
    const source = { read: (): Promise<ControlSnapshot | null> => deps.store!.readControl(projectId) };
    const w = createControlWatcher({
      source, pinned, intervalMs: controlIntervalMs, timers,
      // P0-02 E/G/H — bind to the EXACT lease identity; a wrong-lease/wrong-project watcher does nothing.
      onFresh: (observedAtMs) => { markFresh(kind, digest, observedAtMs, envelopeId, gen); },
      // P0-01 A/B — an authoritative async revocation marks the local lease revoked (immediate,
      // sync) AND durably revokes the matching envelope. The promise is RETURNED so the watcher
      // poll AWAITS the durable revoke (P0-01A — never fire-and-forget).
      onRevoke: (reason) => onControlRevoke(kind, digest, `control_${reason}`, envelopeId, gen),
    });
    watchers.set(key, { w, envelopeId, gen });
    w.start();
  }
  function markFresh(kind: LocalLease["kind"], digest: string, observedAtMs: number, envelopeId: string, gen: bigint): void {
    const map = kind === "PROVIDER_SPEND" ? providerLeases : executionLeases;
    const l = map.get(digest);
    if (!l || l.revoked || l.envelopeId !== envelopeId || l.leaseGeneration !== gen) return; // only the matching active lease
    const nowMs = monotonicNow();                                       // P1-05 B — guarded; a regression never refreshes freshness
    if (nowMs === null) return;
    const stamp = Number.isFinite(observedAtMs) && observedAtMs <= nowMs ? observedAtMs : nowMs;
    l.lastFreshMs = Math.max(l.lastFreshMs, stamp);
  }
  /** P0-01 A/B/C/D — the authoritative async revocation for a control event. Binds to the
   *  EXACT (kind, digest, envelopeId, leaseGeneration): a stale/wrong-lease/wrong-project
   *  watcher is a no-op. Marks the local lease revoked (immediate, no I/O) then durably
   *  revokes the matching envelope so a process-loss replay is refused. A durable-revoke
   *  failure leaves the local lease revoked and NEVER restores authority (F). */
  async function onControlRevoke(kind: LocalLease["kind"], digest: string, reason: string, envelopeId: string, gen: bigint): Promise<void> {
    const map = kind === "PROVIDER_SPEND" ? providerLeases : executionLeases;
    const l = map.get(digest);
    if (!l || l.envelopeId !== envelopeId || l.leaseGeneration !== gen) return; // stale/wrong watcher
    if (!l.revoked) { l.revoked = true; l.revokedReason = reason; }
    if (deps.store) { try { await deps.store.revokeEnvelope({ envelopeId: l.envelopeId, reason }); } catch { /* local stays revoked; authority never restored (P0-01 F) */ } }
  }
  function revokeLeaseInMap(map: Map<string, LocalLease>, digest: string, reason: string): void {
    const l = map.get(digest); if (l && !l.revoked) { l.revoked = true; l.revokedReason = reason; }
  }

  // ── durable-child hydration on replay (P1-01) — never replenishes authority ─
  function hydrate(lease: LocalLease, replay: EnvelopeReplayState): void {
    try {
      // executions
      for (const ex of replay.executions) {
        lease.admittedByExecution.set(ex.executionId, { requestDigest: ex.requestDigest, ref: ex.admissionRef, flushed: true });
        lease.admittedByDigest.set(ex.requestDigest, ex.executionId);
        lease.consumedAdmissions += BigInt(1);
      }
      if (lease.consumedAdmissions > (lease.consumedAdmissions + lease.freeAdmissions)) { /* impossible */ }
      if (lease.consumedAdmissions > lease.freeAdmissions + lease.consumedAdmissions) { lease.revoked = true; lease.revokedReason = "hydrate_exec_overflow"; }
      // clamp free admissions to what remains (never negative)
      const totalExec = lease.freeAdmissions; // freeAdmissions was initialized = held
      if (lease.consumedAdmissions > totalExec) { lease.revoked = true; lease.revokedReason = "hydrate_exec_overflow"; lease.freeAdmissions = BigInt(0); }
      else lease.freeAdmissions = totalExec - lease.consumedAdmissions;

      // provider reservations
      for (const r of replay.reservations) {
        // a settled reservation charged its recorded amount; an OPEN (crash-ambiguous)
        // reservation is treated as CHARGED FULL (no fresh authority). A revoked one revokes.
        const charged = r.state === "settled" ? r.chargedMicros : r.moneyMicros; // open → full
        const entry: OpenProviderReservation = {
          id: mint("prov"), cls: r.providerSpendClass, providerTurnId: r.reservationRef, requestCommitment: r.requestCommitment,
          moneyMicros: r.moneyMicros, reservedUnits: r.providerUnits, settleDim: null,
          settled: true, terminal: true, // P1-01 5B — a hydrated child is terminal: it never authorizes a 2nd call
          chargedMicros: charged, releasedMicros: r.moneyMicros > charged ? (r.moneyMicros - charged) : BigInt(0),
          actualUnits: null, overCap: false, excessUnits: null, incidentReason: null, revoked: r.state === "revoked",
          flushed: true, settleFlushed: true,
        };
        lease.reservationsByTurn.set(r.reservationRef, entry);
        lease.chargedMoneyMicros += charged;
        lease.freeMoneyMicros = lease.freeMoneyMicros >= charged ? (lease.freeMoneyMicros - charged) : BigInt(0);
        lease.chargedCalls += BigInt(1);
        lease.freeCalls = lease.freeCalls > BigInt(0) ? (lease.freeCalls - BigInt(1)) : BigInt(0);
        if (r.state === "revoked") { lease.revoked = true; lease.revokedReason = "hydrate_revoked_reservation"; }
      }
      if (lease.chargedMoneyMicros > (lease.chargedMoneyMicros + lease.freeMoneyMicros + lease.openReservedMoneyMicros)) { /* impossible */ }
    } catch { lease.revoked = true; lease.revokedReason = "hydrate_error"; }
  }

  // ── async lease preparation (envelope acquisition) ────────────────────────
  async function prepare(kind: LocalLease["kind"], req: PrepareLeaseRequest): Promise<PrepareResult> {
    if (!deps.store || !deps.store.configured) return { ok: false, reason: "no_store" };
    if (!req || !req.gatewaySessionId || !req.projectId || !req.acquisitionKey || !req.subjectDigest) return { ok: false, reason: "invalid_request" };
    if (!(req.leaseTtlMs > 0) || !(req.maxControlStalenessMs > 0) || !(req.maxControlStalenessMs <= req.leaseTtlMs)) return { ok: false, reason: "invalid_control_bounds" };
    if (!(controlIntervalMs > 0)) return { ok: false, reason: "no_control_interval" };   // P1-05 F — no invented poll default
    // P0-01 frozen-lifecycle — a trusted boot/process-instance identifier is MANDATORY when a store
    // is wired (it pins the anti-resurrection boundary). No default is invented; absent ⇒ fail closed.
    const bootNonce = (typeof deps.bootNonce === "string" && deps.bootNonce.length > 0) ? deps.bootNonce : "";
    if (!bootNonce) return { ok: false, reason: "no_boot_nonce" };
    // P1-05 A — establish/advance the trusted monotonic baseline through the ONE guard.
    if (monotonicNow() === null) return { ok: false, reason: "clock_regressed" };
    const digest = deps.hashSession(req.gatewaySessionId);
    const target = kind === "PROVIDER_SPEND" ? providerLeases : executionLeases;
    // P0-02 — the canonical immutable issuance/preparation commitment for THIS request.
    const issuanceCommitment = issuanceCommitmentFor(kind, digest, req);

    // P0-01 C — a LIVE local lease is never overwritten / replenished by a replay.
    const existing = target.get(digest);
    if (existing) {
      if (existing.revoked) return { ok: false, reason: "lease_revoked" };               // cannot resurrect a revoked lease
      // P0-02 — the fast path re-validates the repeated request's IMMUTABLE identity; any
      // material difference fails closed WITHOUT touching the store/counters or the lease.
      if (existing.issuanceCommitment !== issuanceCommitment) return { ok: false, reason: "lease_request_mismatch" };
      return { ok: true };                                                               // idempotent re-prepare (keep local ledger)
    }

    const acq = await deps.store.acquireEnvelope({
      budgetClass: kind, gatewaySessionDigest: digest, subjectDigest: req.subjectDigest, projectId: req.projectId,
      acquisitionKey: req.acquisitionKey, amounts: req.amounts, maxControlStalenessMs: req.maxControlStalenessMs, leaseTtlMs: req.leaseTtlMs,
      bootNonce, // P0-01 frozen-lifecycle — pin the trusted boot instance onto the durable envelope
    });
    if (!acq.ok) return { ok: false, reason: acq.reason };
    const env = acq.envelope;
    // P1-03 B — a PROVIDER_SPEND lease binds to the envelope's EXACT price-catalog identity.
    if (kind === "PROVIDER_SPEND") {
      if (env.priceCatalogVersionId === null || deps.catalog.version !== env.priceCatalogVersionId) return { ok: false, reason: "catalog_version_mismatch" };
    }
    const pricedCatalog = deps.catalog;                                                   // pinned SNAPSHOT (rollover-immune)
    const pinned: PinnedControl = Object.freeze({
      globalEpoch: env.globalControlEpoch, projectEpoch: env.projectControlEpoch, controlVectorDigest: env.controlVectorDigest,
      maxControlStalenessMs: env.maxControlStalenessMs, leaseExpiryMs: env.leaseExpiryMs,
    });
    const lease: LocalLease = {
      envelopeId: env.envelopeId, acquisitionKey: req.acquisitionKey, leaseGeneration: env.leaseGeneration, issuanceCommitment,
      gatewaySessionDigest: digest, projectId: req.projectId, kind, pinned, pricedCatalog,
      policyVersionId: env.policyVersionId, priceCatalogVersionId: env.priceCatalogVersionId,
      lastFreshMs: env.acquiredAtMs, revoked: false, revokedReason: null,
      chargedMoneyMicros: BigInt(0), openReservedMoneyMicros: BigInt(0), freeMoneyMicros: env.amounts.moneyMicros,
      chargedCalls: BigInt(0), openCalls: BigInt(0), freeCalls: env.amounts.providerCalls,
      consumedAdmissions: BigInt(0), freeAdmissions: env.amounts.executionAdmissions,
      openReservations: new Map(), reservationsByTurn: new Map(), admittedByExecution: new Map(), admittedByDigest: new Map(), excessEvents: [],
    };
    if (acq.replay) hydrate(lease, acq.replay);                                           // P1-01 — no replenish
    target.set(digest, lease);
    installWatcher(kind, digest, req.projectId, pinned, env.envelopeId, env.leaseGeneration);
    return { ok: true };
  }
  const prepareProviderLease = (req: PrepareLeaseRequest) => prepare("PROVIDER_SPEND", req);
  const prepareExecutionLease = (req: PrepareLeaseRequest) => prepare("EXECUTION_ADMISSION", req);

  // ── worst-case provider-spend pricing against the PINNED catalog (sync, zero I/O) ──
  function worstCase(lease: LocalLease, cls: ProviderSpendClass, nowMs: number): { micros: bigint; settleDim: OpenProviderReservation["settleDim"] } | null {
    const model = classModel(cls);
    const resolveUsd = (dimension: BillingDimension, serviceTier: string | null) => {
      const e = lease.pricedCatalog.resolve({ provider: BUDGET_PROVIDER, model, dimension, serviceTier }, nowMs);
      if (!e) return null;
      if (!isUsdCurrency(e.currencyCode)) return null;                                     // P1-03 A — USD-only
      return e;
    };
    if (cls === "TTS") {
      const rule = deps.ttsReservationRule;
      if (!rule || typeof rule.units !== "bigint" || rule.units < BigInt(0)) return null;  // §15 — no complete rule ⇒ unavailable
      const e = resolveUsd(rule.dimension, rule.serviceTier ?? null);
      if (!e) return null;
      const c = costMicros(rule.units, e.rateMicros, e.unitSize);
      if (!c.ok) return null;
      return { micros: c.micros, settleDim: { dimension: rule.dimension, rateMicros: e.rateMicros, unitSize: e.unitSize, serviceTier: rule.serviceTier ?? null } };
    }
    const profile = cls === "REASONING" ? REASONING_PROFILE : TRANSCRIPTION_PROFILE;
    let total = BigInt(0);
    for (const d of profile) {
      const e = resolveUsd(d.dimension, d.serviceTier);
      if (!e) return null;                                                                 // any missing/stale/non-USD dimension ⇒ unavailable
      const c = costMicros(d.units, e.rateMicros, e.unitSize);
      if (!c.ok) return null;
      total += c.micros;
    }
    // single-dimension classes (transcription) can settle exact; reasoning cannot (two dims, one total) → retain full
    const settleDim = (cls === "TRANSCRIPTION")
      ? (() => { const d = TRANSCRIPTION_PROFILE[0]; const e = resolveUsd(d.dimension, d.serviceTier); return e ? { dimension: d.dimension, rateMicros: e.rateMicros, unitSize: e.unitSize, serviceTier: d.serviceTier } : null; })()
      : null;
    return { micros: total, settleDim };
  }

  // ── PROVIDER_SPEND facade (call-bound, sync, zero I/O) ─────────────────────
  function providerSpendAuthority(binding: ProviderCallBinding): BudgetAuthorityLike {
    const cls = binding.providerSpendClass;
    const providerTurnId = binding.providerTurnId;
    const digest = deps.hashSession(binding.gatewaySessionId);
    function reserve(sessionKey: string, estimate: number): string | null {
      // P1-02 A — reasoning/TTS/transcription MUST carry a non-empty trusted provider-call id.
      if (typeof providerTurnId !== "string" || providerTurnId.length === 0) return null;
      // the caller passes native units; it may NOT change class/model/price (all bound above).
      if (sessionKey !== binding.gatewaySessionId) return null;            // defensive session binding
      if (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0) return null;
      const lease = providerLeases.get(digest);
      if (!leaseValid(lease)) return null;
      // P1-01 — idempotency keyed by the TRUSTED providerTurnId ON THE LEASE (survives facade recreation).
      const commitment = canonicalAcquisitionCommitment({ cls, providerTurnId, estimate: String(estimate) });
      const prior = lease.reservationsByTurn.get(providerTurnId);
      if (prior) {
        // P1-01 5B — a HYDRATED / already-consumed / terminal provider child NEVER authorizes
        // a second provider invocation: return null (no-call) at the provider-call boundary.
        if (prior.terminal) return null;
        return prior.requestCommitment === commitment ? prior.id : null;          // live same-session dup ⇒ same id; conflict ⇒ null
      }
      if (lease.openReservations.size >= PROVIDER_LEDGER_MAX) return null;         // bounded local ledger
      const nowMs = monotonicNow();                                               // P1-05 — guarded authority-time read
      if (nowMs === null) return null;                                            // clock regressed ⇒ fail closed
      const wc = worstCase(lease, cls, nowMs);
      if (!wc) return null;                                                        // no usable USD price ⇒ fail closed
      if (lease.freeMoneyMicros < wc.micros || lease.freeCalls < BigInt(1)) return null; // local headroom
      const id = mint("prov");
      lease.freeMoneyMicros -= wc.micros; lease.openReservedMoneyMicros += wc.micros;
      lease.freeCalls -= BigInt(1); lease.openCalls += BigInt(1);
      const profileUnits = cls === "REASONING" ? BigInt(4000) : cls === "TRANSCRIPTION" ? BigInt(180) : (deps.ttsReservationRule?.units ?? BigInt(0));
      const r: OpenProviderReservation = {
        id, cls, providerTurnId, requestCommitment: commitment, moneyMicros: wc.micros, reservedUnits: profileUnits, settleDim: wc.settleDim,
        settled: false, terminal: false, chargedMicros: BigInt(0), releasedMicros: BigInt(0), actualUnits: null, overCap: false, excessUnits: null, incidentReason: null, revoked: false,
        flushed: false, settleFlushed: false,
      };
      lease.openReservations.set(id, r);
      lease.reservationsByTurn.set(providerTurnId, r);
      return id;
    }
    function settle(reservationId: string, actualOrNull: number | null): void {
      const lease = providerLeases.get(digest);
      if (!lease) return;
      const r = lease.openReservations.get(reservationId);
      if (!r || r.settled) return;                                        // duplicate settle is inert
      r.settled = true;
      lease.openReservedMoneyMicros -= r.moneyMicros; lease.openCalls -= BigInt(1);
      lease.chargedCalls += BigInt(1);                                    // a settled reservation = a call that occurred
      const retainFull = () => { lease.chargedMoneyMicros += r.moneyMicros; r.chargedMicros = r.moneyMicros; r.releasedMicros = BigInt(0); };
      // P1-03 C — convert the actual UPWARD (never downward). Unsafe/unknown ⇒ retain full.
      const safeUnits = actualOrNull === null ? null : safeCeilUnits(actualOrNull);
      if (actualOrNull !== null && safeUnits === null) { retainFull(); r.actualUnits = null; return; }
      // P1-03 D — actual ABOVE reservation: record an EXPLICIT excess incident + revoke (never under-account, never mint).
      if (safeUnits !== null && safeUnits > r.reservedUnits) {
        retainFull(); r.overCap = true; r.excessUnits = safeUnits - r.reservedUnits; r.incidentReason = "provider_actual_over_reservation"; r.revoked = true; r.actualUnits = safeUnits;
        lease.excessEvents.push({ reservationId, reason: r.incidentReason, excessUnits: r.excessUnits.toString() });
        revokeLeaseInMap(providerLeases, digest, "provider_actual_over_reservation");
        return;
      }
      // reasoning (two dims → no split) or an absent actual ⇒ retain the full reservation (P1-03 E).
      if (actualOrNull === null || r.settleDim === null || safeUnits === null) { retainFull(); r.actualUnits = safeUnits; return; }
      // single-dimension exact settle with the upward-safe actual.
      const c = costMicros(safeUnits, r.settleDim.rateMicros, r.settleDim.unitSize);
      if (!c.ok || c.micros > r.moneyMicros) { retainFull(); r.actualUnits = safeUnits; return; }  // never under-account
      lease.chargedMoneyMicros += c.micros; r.chargedMicros = c.micros; r.releasedMicros = r.moneyMicros - c.micros; r.actualUnits = safeUnits;
      lease.freeMoneyMicros += (r.moneyMicros - c.micros);              // release the difference back to the lease
    }
    return Object.freeze({ reserve, settle });
  }

  // ── EXECUTION_ADMISSION facade (session-bound, sync, zero I/O) ─────────────
  function executionAdmissionGate(gatewaySessionId: string): ExecutionBudgetGateLike {
    const digest = deps.hashSession(gatewaySessionId);
    function admit(input: ExecutionBudgetInputLike): ExecutionBudgetOutcomeLike {
      if (!input || typeof input.executionId !== "string" || typeof input.requestDigest !== "string" || !input.executionId || !input.requestDigest) {
        return { decision: "REFUSED" };
      }
      const lease = executionLeases.get(digest);
      if (!leaseValid(lease)) return { decision: "UNAVAILABLE" };
      // idempotency: same executionId + same requestDigest ⇒ SAME ref, no second consumption.
      const prior = lease.admittedByExecution.get(input.executionId);
      if (prior) {
        if (prior.requestDigest === input.requestDigest) return { decision: "ADMITTED", budgetAdmissionRef: prior.ref };
        return { decision: "REFUSED" };                                    // same executionId, different digest ⇒ conflict
      }
      // a requestDigest already bound to a DIFFERENT executionId ⇒ conflicting reuse ⇒ refuse.
      const digestOwner = lease.admittedByDigest.get(input.requestDigest);
      if (digestOwner && digestOwner !== input.executionId) return { decision: "REFUSED" };
      if (lease.admittedByExecution.size >= EXECUTION_LEDGER_MAX) return { decision: "UNAVAILABLE" };
      if (lease.freeAdmissions < BigInt(1)) return { decision: "REFUSED" };       // exhausted execution quota
      lease.freeAdmissions -= BigInt(1); lease.consumedAdmissions += BigInt(1);
      const ref = mint("adm");
      lease.admittedByExecution.set(input.executionId, { requestDigest: input.requestDigest, ref, flushed: false });
      lease.admittedByDigest.set(input.requestDigest, input.executionId);
      return { decision: "ADMITTED", budgetAdmissionRef: ref };            // ZERO provider money consumed
    }
    return Object.freeze({ admit });
  }

  // ── P1-01 — async durable flush of the live lease's child idempotency records ──
  async function persistPending(gatewaySessionId: string): Promise<void> {
    if (!deps.store || !deps.store.configured) return;
    const digest = deps.hashSession(gatewaySessionId);
    // execution admissions
    const exLease = executionLeases.get(digest);
    if (exLease) {
      for (const [executionId, e] of Array.from(exLease.admittedByExecution.entries())) {
        if (e.flushed) continue;
        const res = await deps.store.recordExecutionAdmission({ envelopeId: exLease.envelopeId, gatewaySessionDigest: digest, executionId, requestDigest: e.requestDigest, admissionRef: e.ref });
        if (res.ok) e.flushed = true;
        else if (res.reason === "conflict") { exLease.revoked = true; exLease.revokedReason = "durable_execution_conflict"; } // fail closed
      }
    }
    // provider reservations + settlements
    const pLease = providerLeases.get(digest);
    if (pLease) {
      for (const r of Array.from(pLease.reservationsByTurn.values())) {
        if (!r.flushed) {
          const res = await deps.store.recordProviderReservation({ envelopeId: pLease.envelopeId, reservationRef: r.providerTurnId, providerSpendClass: r.cls, requestCommitment: r.requestCommitment, moneyMicros: r.moneyMicros, providerUnits: r.reservedUnits });
          if (res.ok) r.flushed = true;
          else if (res.reason === "conflict") { pLease.revoked = true; pLease.revokedReason = "durable_provider_conflict"; continue; }
          else continue;
        }
        if (r.settled && !r.settleFlushed) {
          const sres = await deps.store.settleProviderReservation({ reservationRef: r.providerTurnId, chargedMicros: r.chargedMicros, releasedMicros: r.releasedMicros, actualUnits: r.actualUnits, revoked: r.revoked, overCap: r.overCap, excessUnits: r.excessUnits, incidentReason: r.incidentReason });
          if (sres.ok) r.settleFlushed = true;
        }
      }
    }
    // P0-01 A — a locally-revoked lease (e.g. over-cap safety revoke) is durably revoked so a
    // process-loss replay is refused. Bound to the exact envelopeId; idempotent.
    for (const lease of [exLease, pLease]) {
      if (lease && lease.revoked) { try { await deps.store.revokeEnvelope({ envelopeId: lease.envelopeId, reason: lease.revokedReason || "revoked" }); } catch { /* local stays revoked (P0-01 F) */ } }
    }
  }

  // ── P1-01 5A — the async persist barrier: durably persist a pending provider child
  //    AFTER a successful local reserve and BEFORE the provider invocation. Returns false
  //    ⇒ the caller MUST NOT invoke the provider (fail closed). Dormant (no store) ⇒ true. ──
  async function persistProviderReservation(gatewaySessionId: string, providerTurnId: string): Promise<boolean> {
    if (!deps.store || !deps.store.configured) return true;             // dormant path never reaches a real provider
    if (typeof providerTurnId !== "string" || providerTurnId.length === 0) return false;
    const digest = deps.hashSession(gatewaySessionId);
    const lease = providerLeases.get(digest);
    if (!leaseValid(lease)) return false;
    const r = lease.reservationsByTurn.get(providerTurnId);
    if (!r) return false;
    if (r.terminal) return false;                                       // a hydrated/terminal child never re-invokes
    if (r.flushed) return true;
    const res = await deps.store.recordProviderReservation({ envelopeId: lease.envelopeId, reservationRef: r.providerTurnId, providerSpendClass: r.cls, requestCommitment: r.requestCommitment, moneyMicros: r.moneyMicros, providerUnits: r.reservedUnits });
    if (res.ok) { r.flushed = true; return true; }
    if (res.reason === "conflict") { lease.revoked = true; lease.revokedReason = "durable_provider_conflict"; }
    return false;                                                       // persistence failed/ambiguous ⇒ NO provider invocation
  }

  // ── P0-01B — the async POST-SETTLEMENT durable barrier: after the sync local settle,
  //    durably flush the provider settlement (actual/charged/released/over-cap/excess/
  //    incident/terminal state) + any local/envelope revocation, and REPORT the outcome.
  //    false ⇒ persistence is unresolved: the local lease is left revoked (fail-closed) so the
  //    session never allocates fresh provider authority as though the settlement were durable.
  //    Dormant (no store) ⇒ true. NO sync facade performs I/O; this is the async barrier. ──
  async function persistProviderSettlement(gatewaySessionId: string, providerTurnId: string): Promise<boolean> {
    if (!deps.store || !deps.store.configured) return true;             // dormant path never reaches a real provider
    if (typeof providerTurnId !== "string" || providerTurnId.length === 0) return false;
    const digest = deps.hashSession(gatewaySessionId);
    const lease = providerLeases.get(digest);
    if (!lease) return false;
    const r = lease.reservationsByTurn.get(providerTurnId);
    if (!r) return false;
    let ok = true;
    // ensure the reservation child exists durably (defensive; normally flushed by the pre-call barrier)
    if (!r.flushed) {
      const res = await deps.store.recordProviderReservation({ envelopeId: lease.envelopeId, reservationRef: r.providerTurnId, providerSpendClass: r.cls, requestCommitment: r.requestCommitment, moneyMicros: r.moneyMicros, providerUnits: r.reservedUnits });
      if (res.ok) r.flushed = true;
      else { if (res.reason === "conflict") { lease.revoked = true; lease.revokedReason = "durable_provider_conflict"; } ok = false; }
    }
    // flush the settlement (terminal state) once
    if (r.settled && !r.settleFlushed) {
      const sres = await deps.store.settleProviderReservation({ reservationRef: r.providerTurnId, chargedMicros: r.chargedMicros, releasedMicros: r.releasedMicros, actualUnits: r.actualUnits, revoked: r.revoked, overCap: r.overCap, excessUnits: r.excessUnits, incidentReason: r.incidentReason });
      if (sres.ok) r.settleFlushed = true; else ok = false;
    }
    // durably propagate a lease revocation (e.g. an over-cap safety revoke)
    if (lease.revoked) { try { const rr = await deps.store.revokeEnvelope({ envelopeId: lease.envelopeId, reason: lease.revokedReason || "revoked" }); if (!rr.ok) ok = false; } catch { ok = false; } }
    // fail-closed: an unresolved settlement persistence revokes the local lease (no fresh authority)
    if (!ok && !lease.revoked) { lease.revoked = true; lease.revokedReason = "settlement_persist_unresolved"; }
    return ok;
  }

  // ── LIVE-AI-03B — additive REASONING worst-case reservation + exact usage settlement ──
  //    (does NOT touch the legacy reserve()/settle()/REASONING_PROFILE path; sync, zero I/O.)
  function resolveReasoning03bRates(catalog: PriceCatalog, nowMs: number): Reasoning03bRates | null {
    const model = REASONING_MODEL;
    const usd = (dimension: BillingDimension, tier: string | null): Reasoning03bRateTier | null => {
      const e = catalog.resolve({ provider: BUDGET_PROVIDER, model, dimension, serviceTier: tier }, nowMs);
      if (!e || !isUsdCurrency(e.currencyCode)) return null;
      return { rateMicros: e.rateMicros, unitSize: e.unitSize };
    };
    const base = usd("reasoning_input_token", null);
    const out = usd("reasoning_output_token", null);
    if (!base || !out) return null;                                          // required tiers missing ⇒ no authority
    const cached = usd("reasoning_input_token", REASONING_INPUT_TIER_CACHED);
    const cacheWrite = usd("reasoning_input_token", REASONING_INPUT_TIER_CACHE_WRITE);
    // reserve the 32768 input ceiling ONCE at the HIGHEST usable input-tier cost (never triple-counted).
    let inputReserve = BigInt(0);
    for (const t of [base, cached, cacheWrite]) {
      if (!t) continue;
      const c = costMicros(REASONING_03B_MAX_INPUT_TOKENS, t.rateMicros, t.unitSize);
      if (!c.ok) return null;
      if (c.micros > inputReserve) inputReserve = c.micros;
    }
    const oc = costMicros(REASONING_03B_MAX_OUTPUT_TOKENS, out.rateMicros, out.unitSize);
    if (!oc.ok) return null;
    return Object.freeze({ base, cached, cacheWrite, out, worstCaseMicros: inputReserve + oc.micros });
  }

  function quoteReasoning03bWorstCaseMicros(): bigint | null {
    const now = monotonicNow();
    if (now === null) return null;
    const r = resolveReasoning03bRates(deps.catalog, now);
    return r ? r.worstCaseMicros : null;
  }

  function reserveReasoning03b(gatewaySessionId: string, providerTurnId: string): string | null {
    if (typeof providerTurnId !== "string" || providerTurnId.length === 0) return null;
    const digest = deps.hashSession(gatewaySessionId);
    const lease = providerLeases.get(digest);
    if (!leaseValid(lease)) return null;
    const prior = lease.reservationsByTurn.get(providerTurnId);
    if (prior) { if (prior.terminal || !prior.reasoning03b) return null; return prior.id; } // live 03b dup ⇒ same id
    const now = monotonicNow();
    if (now === null) return null;
    const rates = resolveReasoning03bRates(lease.pricedCatalog, now);
    if (!rates) return null;
    if (lease.openReservations.size >= PROVIDER_LEDGER_MAX) return null;
    if (lease.freeMoneyMicros < rates.worstCaseMicros || lease.freeCalls < BigInt(1)) return null; // local headroom
    const id = mint("prov");
    lease.freeMoneyMicros -= rates.worstCaseMicros; lease.openReservedMoneyMicros += rates.worstCaseMicros;
    lease.freeCalls -= BigInt(1); lease.openCalls += BigInt(1);
    const r: OpenProviderReservation = {
      id, cls: "REASONING", providerTurnId,
      requestCommitment: canonicalAcquisitionCommitment({ cls: "REASONING", providerTurnId, kind: "reasoning03b" }),
      moneyMicros: rates.worstCaseMicros, reservedUnits: REASONING_03B_MAX_INPUT_TOKENS + REASONING_03B_MAX_OUTPUT_TOKENS,
      settleDim: null, reasoning03b: rates,
      settled: false, terminal: false, chargedMicros: BigInt(0), releasedMicros: BigInt(0), actualUnits: null,
      overCap: false, excessUnits: null, incidentReason: null, revoked: false, flushed: false, settleFlushed: false,
    };
    lease.openReservations.set(id, r);
    lease.reservationsByTurn.set(providerTurnId, r);
    return id;
  }

  function settleUsage(gatewaySessionId: string, providerTurnId: string, usage: ReasoningUsageV1 | null): void {
    const digest = deps.hashSession(gatewaySessionId);
    const lease = providerLeases.get(digest);
    if (!lease) return;
    const r = lease.reservationsByTurn.get(providerTurnId);
    if (!r || r.settled || !r.reasoning03b) return;                          // only a LIVE 03b reservation
    const rates = r.reasoning03b;
    r.settled = true;
    lease.openReservedMoneyMicros -= r.moneyMicros; lease.openCalls -= BigInt(1); lease.chargedCalls += BigInt(1);
    const retainFull = () => { lease.chargedMoneyMicros += r.moneyMicros; r.chargedMicros = r.moneyMicros; r.releasedMicros = BigInt(0); };
    const asTok = (n: unknown): bigint | null => (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? BigInt(n) : null);
    if (usage === null || typeof usage !== "object") { retainFull(); return; }
    const input = asTok(usage.inputTokens), cached = asTok(usage.cachedInputTokens), cacheWrite = asTok(usage.cacheWriteTokens);
    const output = asTok(usage.outputTokens), reasoning = asTok(usage.reasoningTokens), total = asTok(usage.totalTokens);
    if (input === null || cached === null || cacheWrite === null || output === null || reasoning === null || total === null) { retainFull(); return; }
    // coherence (reject — never normalize)
    if (cached + cacheWrite > input) { retainFull(); return; }
    if (reasoning > output) { retainFull(); return; }
    if (total !== input + output) { retainFull(); return; }
    // provider actual ABOVE the authorized ceiling ⇒ incident + revoke (retain full, never mint).
    if (input > REASONING_03B_MAX_INPUT_TOKENS || output > REASONING_03B_MAX_OUTPUT_TOKENS) {
      retainFull();
      r.overCap = true; r.actualUnits = input + output;
      r.excessUnits = (input > REASONING_03B_MAX_INPUT_TOKENS ? input - REASONING_03B_MAX_INPUT_TOKENS : BigInt(0))
        + (output > REASONING_03B_MAX_OUTPUT_TOKENS ? output - REASONING_03B_MAX_OUTPUT_TOKENS : BigInt(0));
      r.incidentReason = "reasoning_usage_over_reservation"; r.revoked = true;
      lease.excessEvents.push({ reservationId: r.id, reason: r.incidentReason, excessUnits: r.excessUnits.toString() });
      revokeLeaseInMap(providerLeases, digest, "reasoning_usage_over_reservation");
      return;
    }
    // exact multi-tier charge (reasoning tokens are PART of output — NEVER double-charged).
    const ordinaryInput = input - cached - cacheWrite;                       // ≥0 (cached+cacheWrite ≤ input)
    let charge = BigInt(0);
    const add = (units: bigint, tier: Reasoning03bRateTier | null): boolean => {
      if (units === BigInt(0)) return true;
      if (!tier) return false;                                              // a tier a non-zero bucket needs is absent ⇒ can't charge exactly
      const c = costMicros(units, tier.rateMicros, tier.unitSize);
      if (!c.ok) return false;
      charge += c.micros; return true;
    };
    if (!add(ordinaryInput, rates.base) || !add(cached, rates.cached) || !add(cacheWrite, rates.cacheWrite) || !add(output, rates.out)) {
      retainFull(); r.actualUnits = input + output; return;                  // ambiguous ⇒ conservative
    }
    if (charge > r.moneyMicros) { retainFull(); r.actualUnits = input + output; return; } // never under-account / exceed reservation
    lease.chargedMoneyMicros += charge; r.chargedMicros = charge; r.releasedMicros = r.moneyMicros - charge; r.actualUnits = input + output;
    lease.freeMoneyMicros += (r.moneyMicros - charge);
  }

  // ── reconciliation / revocation (async teardown / sync interrupt) ──────────
  async function reconcileSession(gatewaySessionId: string, opts?: { crash?: boolean }): Promise<void> {
    const digest = deps.hashSession(gatewaySessionId);
    const crash = !!(opts && opts.crash);
    for (const kind of ["PROVIDER_SPEND", "EXECUTION_ADMISSION"] as const) {
      const map = kind === "PROVIDER_SPEND" ? providerLeases : executionLeases;
      const lease = map.get(digest);
      if (!lease) continue;
      map.delete(digest);
      const key = wkey(digest, kind);
      const wentry = watchers.get(key); if (wentry) { try { wentry.w.stop(); } catch { /* no-op */ } watchers.delete(key); }
      if (!deps.store) continue;
      // open (unsettled) reservations are retained/charged (unknown outcome → conservative)
      let openMoney = BigInt(0), openCalls = BigInt(0);
      lease.openReservations.forEach((r) => { if (!r.settled) { openMoney += r.moneyMicros; openCalls += BigInt(1); } });
      const chargedMoney = crash ? (lease.chargedMoneyMicros + lease.openReservedMoneyMicros + lease.freeMoneyMicros)
                                 : (lease.chargedMoneyMicros + openMoney);
      const releasedMoney = crash ? BigInt(0) : (lease.freeMoneyMicros);
      const chargedCalls = crash ? (lease.chargedCalls + lease.openCalls + lease.freeCalls) : (lease.chargedCalls + openCalls);
      const releasedCalls = crash ? BigInt(0) : (lease.freeCalls);
      const consumedExec = crash ? (lease.consumedAdmissions + lease.freeAdmissions) : lease.consumedAdmissions;
      const releasedExec = crash ? BigInt(0) : lease.freeAdmissions;
      try {
        await deps.store.reconcile({
          envelopeId: lease.envelopeId, clean: !crash, reconciliationKey: `rec_${lease.envelopeId}`,
          moneyChargedMicros: chargedMoney, moneyReleasedMicros: releasedMoney,
          providerCallsCharged: chargedCalls, providerCallsReleased: releasedCalls,
          executionAdmissionsConsumed: consumedExec, executionAdmissionsReleased: releasedExec,
        });
      } catch { /* best-effort; a failed reconcile leaves the durable envelope held (conservative) */ }
    }
  }
  function revokeSession(gatewaySessionId: string, reason: string): void {
    const digest = deps.hashSession(gatewaySessionId);
    revokeLeaseInMap(providerLeases, digest, reason);
    revokeLeaseInMap(executionLeases, digest, reason);
  }
  // P0-01 — explicit AUTHORITATIVE revocation: mark local revoked (immediate) THEN durably
  // revoke the matching envelope(s) so a process-loss replay is refused. A durable failure
  // leaves the local lease revoked and never restores authority (P0-01 F).
  async function revokeSessionDurable(gatewaySessionId: string, reason: string): Promise<void> {
    const digest = deps.hashSession(gatewaySessionId);
    for (const map of [providerLeases, executionLeases]) {
      const l = map.get(digest);
      if (!l) continue;
      if (!l.revoked) { l.revoked = true; l.revokedReason = reason; }
      if (deps.store) { try { await deps.store.revokeEnvelope({ envelopeId: l.envelopeId, reason }); } catch { /* local stays revoked; authority never restored */ } }
    }
  }

  function view(lease: LocalLease | undefined): LeaseView | null {
    if (!lease) return null;
    return Object.freeze({
      envelopeId: lease.envelopeId, leaseGeneration: lease.leaseGeneration.toString(), revoked: lease.revoked, revokedReason: lease.revokedReason,
      freeMoneyMicros: lease.freeMoneyMicros.toString(), openReservedMoneyMicros: lease.openReservedMoneyMicros.toString(), chargedMoneyMicros: lease.chargedMoneyMicros.toString(),
      freeCalls: lease.freeCalls.toString(), openCalls: lease.openCalls.toString(), chargedCalls: lease.chargedCalls.toString(),
      freeAdmissions: lease.freeAdmissions.toString(), consumedAdmissions: lease.consumedAdmissions.toString(),
      excessCount: lease.excessEvents.length,
      lastFreshMs: lease.lastFreshMs, leaseExpiryMs: lease.pinned.leaseExpiryMs,
    });
  }
  function inspect(gatewaySessionId: string): { provider: LeaseView | null; execution: LeaseView | null } {
    const digest = deps.hashSession(gatewaySessionId);
    return { provider: view(providerLeases.get(digest)), execution: view(executionLeases.get(digest)) };
  }
  function stop(): void { watchers.forEach((entry) => { try { entry.w.stop(); } catch { /* no-op */ } }); watchers.clear(); }

  return Object.freeze({
    prepareProviderLease, prepareExecutionLease, providerSpendAuthority, executionAdmissionGate,
    persistPending, persistProviderReservation, persistProviderSettlement,
    quoteReasoning03bWorstCaseMicros, reserveReasoning03b, settleUsage,
    reconcileSession, revokeSession, revokeSessionDurable, inspect, stop,
  });
}

/** Convenience: a fully DORMANT core (no store) whose facades always fail closed. */
export function createDormantBudgetCore(catalog: PriceCatalog, clock: BudgetCoreClock, hashSession: (s: string) => string, mintRef: (k: string, n: number) => string): BudgetCore {
  return createBudgetCore({ store: null, catalog, clock, hashSession, mintRef });
}
