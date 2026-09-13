// ════════════════════════════════════════════════════════════════
// v750 (PRICE-CONSISTENCY-01) — canonical calendar price SCOPE helpers.
//
// The hotel-detail calendar reads the pricing spine's livePrice per day, but the
// SAME <LuxuryCalendar> instance is reused for different ROOM SCOPES (all hotel
// rooms for the ordinary date picker, a SINGLE room for the flash "extend stay"
// picker). A canonical price resolved for room-set A must NEVER render for
// room-set B — not even for one render while B's request is still pending.
//
// These PURE helpers make that invariant enforceable and unit-testable:
//   • roomScopeKey       — a deterministic, ORDER-INDEPENDENT fingerprint for a
//                          set of room ids (so equivalent sets share one key).
//   • readScopedDayPrices — reads ONLY the current scope's map (never another
//                          scope's data); returns {} when the scope is unresolved.
//   • isValidSpineBatch  — true only when the batched /api/pricing/spine contract
//                          (`pricesByDate` object, no `error`) is actually present,
//                          so a failed/garbled response never poisons cached state
//                          and stays retryable.
//
// Pure — no imports, no DB, no fetch, no React. Server- and client-safe.
// ════════════════════════════════════════════════════════════════

/** One resolved day cell: the canonical spine price + its demand tier/score. */
export interface ScopedDayPrice {
  price: number;
  tier: "green" | "orange" | "red";
  score: number;
}

/**
 * Deterministic, order-independent fingerprint for a set of room ids.
 * De-duplicates and sorts before joining, so `["b","a"]` and `["a","a","b"]`
 * both yield the same key. An empty set yields "" (no hotel-mode fetch).
 */
export function roomScopeKey(roomIds: string[]): string {
  return Array.from(new Set((roomIds || []).filter(Boolean).map(String)))
    .sort()
    .join(",");
}

/**
 * Read the canonical day-price map for EXACTLY the current room scope.
 * Returns {} when that scope has not resolved yet — so a scope change can never
 * surface the previous scope's prices, even for a single render.
 */
export function readScopedDayPrices(
  byScope: Record<string, Record<string, ScopedDayPrice>>,
  scopeKey: string,
): Record<string, ScopedDayPrice> {
  return (byScope && byScope[scopeKey]) || {};
}

/**
 * A batched /api/pricing/spine response is only trustworthy when it actually
 * carries the `pricesByDate` object contract and no `error`. The route's error
 * path returns `{ prices, error }` WITHOUT `pricesByDate`; treating that (or any
 * non-object / missing-key body) as a failure keeps the month+scope retryable
 * and prevents another scope's/an empty map from being cached as authoritative.
 */
export function isValidSpineBatch(res: any): boolean {
  return !!res
    && typeof res === "object"
    && !("error" in res)
    && !!res.pricesByDate
    && typeof res.pricesByDate === "object";
}
