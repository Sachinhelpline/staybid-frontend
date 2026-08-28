// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — abuse / cost / circuit-breaker controls.
//
// Pure, in-memory, fail-closed rate + cost + circuit logic (injectable clock for
// tests). Rate keys are SALTED HASHES of the derived IP — no raw identifier is
// ever stored. Start limits (anon vs authenticated), per-session/day cost caps,
// and a provider circuit breaker are enforced here; per-session concurrency lives
// in the session store.
//
// No secret VALUE is logged; the salt is injected, never printed.
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { type GatewayLimits } from "./config";

/** Salted, non-reversible IP rate key. Never store or log the raw IP. */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 40);
}

// ─── cost-control model (SB04-R1-REREV-03: reservation + real-usage reconcile) ──
// TWO layers enforce the per-session / daily / monthly spend ceilings:
//   1. A conservative PRE-WORK RESERVATION (estimateTurnCents/estimateToolCents) is
//      charged BEFORE the provider does billable work, so a runaway turn fails
//      closed even before any usage arrives.
//   2. When the provider reports REAL token usage (the response.done `usage`
//      object), `costCentsForUsage` converts it with the CURRENT documented
//      gpt-realtime pricing and the sideband RECONCILES the reservation to the
//      real figure (charging a shortfall through the same gate, refunding an
//      overage). An UNKNOWN model ⇒ null ⇒ cost enforcement fails CLOSED.
// There is NO network pricing lookup during a session — the table is a build-time
// constant sourced from OpenAI's published pricing (verified Aug 2026).
export const COST_MODEL_VERSION = "sb04-r2-usage-reconciled-v1";

// Conservative pre-work reservation (cents). Deliberately >0 so nothing runs free.
const MODEL_COST_CENTS: Record<string, { perTurnCents: number; perToolCents: number }> = {
  "gpt-realtime-2.1": { perTurnCents: 5, perToolCents: 1 },
};
export function estimateTurnCents(model: string): number | null {
  const r = MODEL_COST_CENTS[model];
  return r ? r.perTurnCents : null;
}
export function estimateToolCents(model: string): number | null {
  const r = MODEL_COST_CENTS[model];
  return r ? r.perToolCents : null;
}

// OFFICIAL OpenAI gpt-realtime-2.1 pricing — USD per 1M tokens, from the official
// model page https://developers.openai.com/api/docs/models/gpt-realtime-2.1
// (verified Aug 2026): text input $4 / cached input $0.40 / output $24; audio
// input $32 / cached input $0.40 / output $64. Stored as CENTS per 1M tokens.
// R3 (SB04-R2-REREV-03) corrects the R2 text-output value ($16 → $24) and adds the
// cached-input categories (billed at $0.40, distinct from full input).
export interface ProviderUsageTokens {
  inputTextTokens: number;
  cachedInputTextTokens: number;
  outputTextTokens: number;
  inputAudioTokens: number;
  cachedInputAudioTokens: number;
  outputAudioTokens: number;
}
interface ModelPrice {
  inText: number;
  cachedText: number;
  outText: number;
  inAudio: number;
  cachedAudio: number;
  outAudio: number;
  source: string;
  verified: string;
}
const MODEL_TOKEN_PRICE_CENTS_PER_M: Record<string, ModelPrice> = {
  "gpt-realtime-2.1": {
    inText: 400,
    cachedText: 40,
    outText: 2400,
    inAudio: 3200,
    cachedAudio: 40,
    outAudio: 6400,
    source: "https://developers.openai.com/api/docs/models/gpt-realtime-2.1",
    verified: "2026-08",
  },
};
export const COST_PRICE_TABLE = MODEL_TOKEN_PRICE_CENTS_PER_M;
/**
 * REAL usage → cents (round UP, conservative). The FULL (non-cached) input token
 * counts are charged at the full rate and the cached portion at the cached rate;
 * the caller passes cached counts SEPARATELY (already subtracted from full).
 * Unknown model ⇒ null (fail closed). Negative/NaN ⇒ treated as 0 (a single bad
 * field never becomes a credit); "no usage at all" is handled UPSTREAM by NOT
 * emitting a usage event (REREV-03), so this is only ever called with real usage.
 */
export function costCentsForUsage(model: string, usage: ProviderUsageTokens): number | null {
  const p = MODEL_TOKEN_PRICE_CENTS_PER_M[model];
  if (!p) return null;
  const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const cents =
    (clamp(usage.inputTextTokens) * p.inText +
      clamp(usage.cachedInputTextTokens) * p.cachedText +
      clamp(usage.outputTextTokens) * p.outText +
      clamp(usage.inputAudioTokens) * p.inAudio +
      clamp(usage.cachedInputAudioTokens) * p.cachedAudio +
      clamp(usage.outputAudioTokens) * p.outAudio) /
    1_000_000;
  return Math.ceil(cents);
}

const FIFTEEN_MIN_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const CIRCUIT_OPEN_MS = 60_000;
// R2 (REREV-03): an explicit provider-429 cooldown — after a rate-limited provider
// response, refuse new session/turn starts for this window (independent of the
// failure-rate circuit breaker) so we back off instead of hammering the provider.
const PROVIDER_RATELIMIT_COOLDOWN_MS = 30_000;
const CIRCUIT_CONSECUTIVE = 5;
const CIRCUIT_WINDOW = 50;
const CIRCUIT_FAILURE_RATE = 0.2;

interface StartRecord {
  windowStart: number;
  windowCount: number;
  dayStart: number;
  dayCount: number;
}

export type StartDecision = { ok: true } | { ok: false; reason: "start_rate_15m" | "start_rate_day" };

export interface RateLimiterDeps {
  limits: GatewayLimits;
  now?: () => number;
}

export function createRateLimiter(deps: RateLimiterDeps) {
  const now = deps.now || (() => Date.now());
  const L = deps.limits;
  const starts = new Map<string, StartRecord>();

  // circuit breaker state
  let consecutiveFailures = 0;
  const recent: boolean[] = []; // true = failure
  let circuitOpenedAt = 0;
  // provider-429 cooldown state (independent of the failure-rate circuit)
  let rateLimitedUntil = 0;

  // cost ledger
  let dayStart = now();
  let daySpendCents = 0;
  let monthStart = now();
  let monthSpendCents = 0;

  function pruneStarts() {
    const t = now();
    const stale: string[] = [];
    starts.forEach((rec, key) => {
      if (t - rec.dayStart > DAY_MS && t - rec.windowStart > FIFTEEN_MIN_MS) stale.push(key);
    });
    stale.forEach((k) => starts.delete(k));
  }

  return {
    /** Enforce anon/auth start limits for a rate key (hashed IP or subject). */
    checkStart(key: string, authenticated: boolean): StartDecision {
      const t = now();
      const per15 = authenticated ? L.authStartsPer15Min : L.anonStartsPer15Min;
      const perDay = authenticated ? L.authStartsPerDay : L.anonStartsPerDay;
      let rec = starts.get(key);
      if (!rec) {
        rec = { windowStart: t, windowCount: 0, dayStart: t, dayCount: 0 };
        starts.set(key, rec);
      }
      if (t - rec.windowStart >= FIFTEEN_MIN_MS) {
        rec.windowStart = t;
        rec.windowCount = 0;
      }
      if (t - rec.dayStart >= DAY_MS) {
        rec.dayStart = t;
        rec.dayCount = 0;
      }
      if (rec.windowCount >= per15) return { ok: false, reason: "start_rate_15m" };
      if (rec.dayCount >= perDay) return { ok: false, reason: "start_rate_day" };
      rec.windowCount += 1;
      rec.dayCount += 1;
      pruneStarts();
      return { ok: true };
    },

    // ---- circuit breaker ----
    isCircuitOpen(): boolean {
      if (circuitOpenedAt === 0) return false;
      if (now() - circuitOpenedAt >= CIRCUIT_OPEN_MS) {
        // half-open: clear so the next attempt is allowed
        circuitOpenedAt = 0;
        consecutiveFailures = 0;
        recent.length = 0;
        return false;
      }
      return true;
    },
    recordProviderResult(success: boolean) {
      recent.push(!success);
      if (recent.length > CIRCUIT_WINDOW) recent.shift();
      if (success) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures += 1;
      }
      const failures = recent.filter(Boolean).length;
      const rate = recent.length >= CIRCUIT_WINDOW ? failures / recent.length : 0;
      if (consecutiveFailures >= CIRCUIT_CONSECUTIVE || rate >= CIRCUIT_FAILURE_RATE) {
        if (circuitOpenedAt === 0) circuitOpenedAt = now();
      }
    },

    // ---- provider-429 cooldown (REREV-03) ----
    /** Note a provider rate-limit (HTTP 429) — opens an explicit backoff window. */
    noteProviderRateLimited() {
      rateLimitedUntil = now() + PROVIDER_RATELIMIT_COOLDOWN_MS;
    },
    /** True while the provider-429 backoff window is open (new starts refused). */
    isRateLimitedCooldown(): boolean {
      if (rateLimitedUntil === 0) return false;
      if (now() >= rateLimitedUntil) {
        rateLimitedUntil = 0;
        return false;
      }
      return true;
    },

    // ---- cost ceilings (conservative, never fabricated exact billing) ----
    /** Would spending `cents` more breach the per-session, daily, or monthly cap? */
    canSpend(sessionSpentCents: number, cents: number): boolean {
      const t = now();
      if (t - dayStart >= DAY_MS) {
        dayStart = t;
        daySpendCents = 0;
      }
      if (t - monthStart >= 30 * DAY_MS) {
        monthStart = t;
        monthSpendCents = 0;
      }
      if (sessionSpentCents + cents > Math.round(L.perSessionCostCeilingUsd * 100)) return false;
      if (daySpendCents + cents > Math.round(L.dailyCostCapUsd * 100)) return false;
      if (monthSpendCents + cents > Math.round(L.monthlyCostCapUsd * 100)) return false;
      return true;
    },
    recordSpend(cents: number) {
      if (!Number.isFinite(cents) || cents <= 0) return;
      daySpendCents += cents;
      monthSpendCents += cents;
    },
    /** Reconcile a reservation DOWNWARD when real usage < reserved (never below 0). */
    refundSpend(cents: number) {
      if (!Number.isFinite(cents) || cents <= 0) return;
      daySpendCents = Math.max(0, daySpendCents - cents);
      monthSpendCents = Math.max(0, monthSpendCents - cents);
    },
    snapshot() {
      return {
        circuitOpen: circuitOpenedAt !== 0,
        daySpendCents,
        monthSpendCents,
        trackedKeys: starts.size,
      };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
