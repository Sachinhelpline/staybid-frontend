// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-BUDGET-01 — versioned price catalog + integer money.
//
// The FOUNDATION module of the DPBEL budget core. It owns:
//   • the canonical provider-spend money unit (USD_MICRO, 1 USD = 1,000,000);
//   • BigInt-only, checked, upward-rounding cost arithmetic (NO floating point);
//   • the versioned, verification-bounded price catalog (types + validation +
//     resolution). The PRODUCTION default catalog is EMPTY / INACTIVE, so
//     provider-spend authority is UNAVAILABLE until an authoritative catalog is
//     injected — tests supply explicit fixture rates;
//   • the closed foundation vocab (budget classes, provider-spend classes,
//     billing dimensions, period kinds, scope types, accounting dimensions)
//     shared by every other budget module.
//
// PURE: no network, DB, env, secret, clock, or randomness. Time is always an
// explicit caller-supplied `nowMs`. This module NEVER hard-codes a current public
// provider rate as a timeless production constant — the production catalog is empty.
// ─────────────────────────────────────────────────────────────────────────

// ═══════════════════════════ canonical money unit ══════════════════════════
export const USD_MICROS_PER_USD = BigInt(1000000);
export const CURRENCY_USD = "USD" as const;
/** Signed 64-bit ceiling — every stored/computed money + counter value MUST fit. */
export const MAX_INT64 = BigInt("9223372036854775807");

// ═══════════════════════════ closed foundation vocab ═══════════════════════
export const BUDGET_CLASSES = Object.freeze(["EXECUTION_ADMISSION", "PROVIDER_SPEND"] as const);
export type BudgetClass = (typeof BUDGET_CLASSES)[number];

export const PROVIDER_SPEND_CLASSES = Object.freeze(["REASONING", "TRANSCRIPTION", "TTS"] as const);
export type ProviderSpendClass = (typeof PROVIDER_SPEND_CLASSES)[number];

/** The provider billing dimensions this V1 can price. A dimension is NOT money —
 *  it is the provider's native billed unit; the catalog maps dimension → rate. */
export const BILLING_DIMENSIONS = Object.freeze([
  "reasoning_input_token",
  "reasoning_output_token",
  "realtime_audio_second",
  "tts_output_token",
  "tts_output_second",
] as const);
export type BillingDimension = (typeof BILLING_DIMENSIONS)[number];

/** Stable durable period kinds (accounting reset boundaries). */
export const PERIOD_KINDS = Object.freeze(["session", "day", "month", "lifetime"] as const);
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** Durable scope authority types — a gateway_session scope is keyed by the
 *  gateway-owned session digest, NEVER a browser-owned protocol identity. */
export const SCOPE_TYPES = Object.freeze(["gateway_session", "subject", "project", "global"] as const);
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** The three orthogonal accounted exposures. Execution admissions consume ZERO
 *  provider money; provider spend consumes money + provider calls. */
export const ACCOUNTING_DIMENSIONS = Object.freeze(["money_micros", "provider_calls", "execution_admissions"] as const);
export type AccountingDimension = (typeof ACCOUNTING_DIMENSIONS)[number];

export const CATALOG_ENTRY_STATUSES = Object.freeze(["active", "inactive", "revoked"] as const);
export type CatalogEntryStatus = (typeof CATALOG_ENTRY_STATUSES)[number];

// ═══════════════════════════ integer money arithmetic ═════════════════════
export type MoneyResult = { readonly ok: true; readonly micros: bigint } | { readonly ok: false; readonly reason: string };

function isNonNegInt(v: unknown): v is bigint { return typeof v === "bigint" && v >= BigInt(0); }

/** ceil(providerUnits * rateMicros / unitSize) in BigInt — checked, upward-rounding.
 *  Rules (BUDGET-01 §14): no floating point; negatives invalid; malformed invalid;
 *  unitSize must be > 0; a NONZERO billable product rounds UP to ≥ 1 micro; the
 *  result must fit signed-64-bit or it is invalid (never a silent wrap/truncation). */
export function costMicros(providerUnits: bigint, rateMicros: bigint, unitSize: bigint): MoneyResult {
  if (!isNonNegInt(providerUnits) || !isNonNegInt(rateMicros)) return { ok: false, reason: "negative_or_malformed" };
  if (typeof unitSize !== "bigint" || unitSize <= BigInt(0)) return { ok: false, reason: "invalid_unit_size" };
  const product = providerUnits * rateMicros; // BigInt: no overflow at compute time
  if (product < BigInt(0)) return { ok: false, reason: "negative_product" };
  const micros = product === BigInt(0) ? BigInt(0) : (product + unitSize - BigInt(1)) / unitSize; // ceil-div; 0 stays 0
  if (micros > MAX_INT64) return { ok: false, reason: "overflow_int64" };
  return { ok: true, micros };
}

/** Checked non-negative BigInt addition bounded to signed-64-bit. */
export function addMicros(a: bigint, b: bigint): MoneyResult {
  if (!isNonNegInt(a) || !isNonNegInt(b)) return { ok: false, reason: "negative_or_malformed" };
  const sum = a + b;
  if (sum > MAX_INT64) return { ok: false, reason: "overflow_int64" };
  return { ok: true, micros: sum };
}

/** BUDGET-01 §7 (P1-03 A) — is this the ONE authorized provider-spend currency? Provider
 *  monetary authority is USD-only; any other currency MUST be refused. */
export function isUsdCurrency(code: unknown): boolean {
  return typeof code === "string" && code === CURRENCY_USD;
}

/** BUDGET-01 §7 (P1-03 C) — convert a provider-reported JS-number `actual` usage figure
 *  into an EXACT, SAFE, non-negative bigint unit count for accounting. Rules: finite,
 *  non-negative, and representable as a safe integer. A FRACTIONAL billable value rounds
 *  UP (conservative — never downward, never Math.trunc). A NaN/±Infinity/negative/unsafe
 *  value returns null ⇒ the caller treats the actual as incomplete/unknown and retains the
 *  FULL reservation. This NEVER rounds downward and NEVER silently under-accounts. */
export function safeCeilUnits(n: unknown): bigint | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n > Number.MAX_SAFE_INTEGER) return null;           // beyond exact representation ⇒ unknown
  const ceil = Math.ceil(n);                              // conservative UPWARD (never downward)
  if (!Number.isSafeInteger(ceil)) return null;
  return BigInt(ceil);
}

/** Parse a decimal integer string (from a BIGINT column) into a non-negative bigint,
 *  or null. Rejects floats, signs beyond a leading digit run, and out-of-range values. */
export function parseInt64(v: unknown): bigint | null {
  if (typeof v === "bigint") return v >= BigInt(0) && v <= MAX_INT64 ? v : null;
  if (typeof v === "number") { if (!Number.isSafeInteger(v) || v < 0) return null; return BigInt(v); }
  if (typeof v !== "string") return null;
  if (!/^\d{1,19}$/.test(v)) return null;
  try { const b = BigInt(v); return b >= BigInt(0) && b <= MAX_INT64 ? b : null; } catch { return null; }
}

// ═══════════════════════════ versioned price catalog ══════════════════════
export interface PriceCatalogEntry {
  readonly provider: string;
  readonly model: string;
  /** an optional service/context tier (e.g. cached-input class); null = base. */
  readonly serviceTier: string | null;
  readonly billingDimension: BillingDimension;
  readonly currencyCode: string;
  /** the number of provider units one `rateMicros` charge covers (e.g. 1000 tokens). */
  readonly unitSize: bigint;
  readonly rateMicros: bigint;
  readonly effectiveFromMs: number;
  readonly effectiveUntilMs: number | null;
  readonly verifiedAtMs: number;
  readonly verificationExpiresAtMs: number;
  readonly sourceId: string;
  readonly sourceDigest: string;
  readonly status: CatalogEntryStatus;
}

/** A frozen, deep-validated catalog entry, or null if malformed. */
export function validatePriceCatalogEntry(raw: unknown): PriceCatalogEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
  if (!str(r.provider) || !str(r.model) || !str(r.currencyCode) || !str(r.sourceId) || !str(r.sourceDigest)) return null;
  if (r.serviceTier !== null && !str(r.serviceTier)) return null;
  if (typeof r.billingDimension !== "string" || !(BILLING_DIMENSIONS as readonly string[]).includes(r.billingDimension)) return null;
  if (typeof r.status !== "string" || !(CATALOG_ENTRY_STATUSES as readonly string[]).includes(r.status)) return null;
  const unitSize = r.unitSize; const rateMicros = r.rateMicros;
  if (typeof unitSize !== "bigint" || unitSize <= BigInt(0) || unitSize > MAX_INT64) return null;
  if (typeof rateMicros !== "bigint" || rateMicros < BigInt(0) || rateMicros > MAX_INT64) return null;
  const numOk = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!numOk(r.effectiveFromMs) || !numOk(r.verifiedAtMs) || !numOk(r.verificationExpiresAtMs)) return null;
  if (r.effectiveUntilMs !== null && !numOk(r.effectiveUntilMs)) return null;
  if (r.effectiveUntilMs !== null && (r.effectiveUntilMs as number) <= (r.effectiveFromMs as number)) return null;
  if ((r.verificationExpiresAtMs as number) < (r.verifiedAtMs as number)) return null;
  return Object.freeze({
    provider: r.provider, model: r.model, serviceTier: (r.serviceTier as string | null),
    billingDimension: r.billingDimension as BillingDimension, currencyCode: r.currencyCode,
    unitSize, rateMicros, effectiveFromMs: r.effectiveFromMs as number,
    effectiveUntilMs: (r.effectiveUntilMs as number | null), verifiedAtMs: r.verifiedAtMs as number,
    verificationExpiresAtMs: r.verificationExpiresAtMs as number, sourceId: r.sourceId, sourceDigest: r.sourceDigest,
    status: r.status as CatalogEntryStatus,
  });
}

/** An entry is USABLE for pricing at `nowMs` ONLY when it is active, inside its
 *  effective window, and its verification has not expired (stale/revoked/missing
 *  ⇒ refuse new provider authority — BUDGET-01 §13). */
export function isCatalogEntryUsable(e: PriceCatalogEntry, nowMs: number): boolean {
  if (e.status !== "active") return false;
  if (!(typeof nowMs === "number" && Number.isFinite(nowMs))) return false;
  if (nowMs < e.effectiveFromMs) return false;
  if (e.effectiveUntilMs !== null && nowMs >= e.effectiveUntilMs) return false;
  if (nowMs >= e.verificationExpiresAtMs) return false; // verification expired ⇒ unusable
  return true;
}

export interface PriceCatalogQuery {
  readonly provider: string;
  readonly model: string;
  readonly dimension: BillingDimension;
  readonly serviceTier?: string | null;
}

export interface PriceCatalog {
  readonly version: string;
  /** the number of entries (usable or not) this catalog carries. */
  readonly size: number;
  /** resolve the single USABLE entry for a query at `nowMs`, or null. When more than
   *  one usable entry matches, resolution is DETERMINISTIC (latest effectiveFrom, then
   *  latest verifiedAt) — never ambiguous. */
  resolve(q: PriceCatalogQuery, nowMs: number): PriceCatalogEntry | null;
}

export function createPriceCatalog(version: string, rawEntries: readonly unknown[]): PriceCatalog {
  const entries: PriceCatalogEntry[] = [];
  for (let i = 0; i < rawEntries.length; i++) {
    const v = validatePriceCatalogEntry(rawEntries[i]);
    if (v) entries.push(v);
  }
  const frozen = Object.freeze(entries.slice());
  function resolve(q: PriceCatalogQuery, nowMs: number): PriceCatalogEntry | null {
    const tier = q.serviceTier === undefined ? null : q.serviceTier;
    let best: PriceCatalogEntry | null = null;
    for (let i = 0; i < frozen.length; i++) {
      const e = frozen[i];
      if (e.provider !== q.provider || e.model !== q.model || e.billingDimension !== q.dimension) continue;
      if ((e.serviceTier ?? null) !== (tier ?? null)) continue;
      if (!isCatalogEntryUsable(e, nowMs)) continue;
      if (best === null || e.effectiveFromMs > best.effectiveFromMs ||
        (e.effectiveFromMs === best.effectiveFromMs && e.verifiedAtMs > best.verifiedAtMs)) best = e;
    }
    return best;
  }
  return Object.freeze({ version, size: frozen.length, resolve });
}

/** The PRODUCTION default — an EMPTY / INACTIVE catalog. No active price entry ⇒
 *  every provider-spend reservation fails closed until an authoritative catalog is
 *  injected out of band (never a hard-coded timeless rate). */
export const EMPTY_PRICE_CATALOG: PriceCatalog = createPriceCatalog("empty.inactive.v1", []);
