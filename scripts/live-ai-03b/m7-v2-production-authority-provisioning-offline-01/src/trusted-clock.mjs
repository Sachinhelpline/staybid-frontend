// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — bounded trusted clock. OFFLINE candidate.
//
// There is NO caller-provided / request-provided time. The production clock reads the host system clock and is
// usable ONLY after it has been BOUND to the database clock observed on the actual restricted executor
// connection (|host − DB| ≤ MAX_DB_SKEW_MS). It never moves backwards (monotonic floor). The live mutation
// clock remains PostgreSQL clock_timestamp() inside activate_catalog_v2 (the Step-1 contract); this clock is the
// pre-check / attestation-freshness clock of the authority. A TEST clock exists only under an explicit test
// boundary and carries a TEST provenance that the production validator refuses.
// ─────────────────────────────────────────────────────────────────────────
export const TRUSTED_CLOCK_CONTRACT = "LiveAi03bTrustedClockV1";
export const CLOCK_PROVENANCE_PRODUCTION = "host-system-clock-bound-to-ai-staging-db-clock";
export const CLOCK_PROVENANCE_TEST = "TEST-ONLY-clock";
export const MAX_DB_SKEW_MS = 5000;

const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); // the frozen verifiers accept whole-second RFC3339 UTC

function make(provenance, readMs) {
  let bound = false, skew = null, floor = -Infinity;
  const nowMs = () => { if (!bound) throw new Error("trusted_clock_not_bound"); const t = readMs(); floor = Math.max(floor, t); return floor; };
  return Object.freeze({
    contract: TRUSTED_CLOCK_CONTRACT, provenance,
    /** bind to the DB clock (ms since epoch) observed on the actual executor connection. One-time. */
    bindToDbClock(dbNowMs) {
      if (bound) return { ok: false, reason: "trusted_clock_already_bound" };
      if (!Number.isSafeInteger(dbNowMs) || dbNowMs <= 0) return { ok: false, reason: "db_clock_unreadable" };
      const s = readMs() - dbNowMs;
      if (!Number.isFinite(s) || Math.abs(s) > MAX_DB_SKEW_MS) return { ok: false, reason: "host_db_clock_skew_exceeds_bound" };
      skew = s; bound = true; return { ok: true, skewMs: s };
    },
    isBound: () => bound, skewMs: () => skew,
    nowMs, nowIso: () => isoSeconds(nowMs()),
  });
}

/** PRODUCTION clock (host system clock; must be DB-bound before use). */
export function makeProductionClock() { return make(CLOCK_PROVENANCE_PRODUCTION, () => Date.now()); }

/** TEST clock — explicit test boundary only. */
export function makeTestClock(readMs, opts) {
  if (!opts || opts.testBoundary !== true) throw new Error("test_clock_requires_testBoundary_true");
  if (typeof readMs !== "function") throw new Error("test_clock_source_absent");
  return make(CLOCK_PROVENANCE_TEST, readMs);
}

export function validateClock(clock, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!clock || typeof clock !== "object" || clock.contract !== TRUSTED_CLOCK_CONTRACT || !Object.isFrozen(clock)) return { ok: false, reason: "trusted_clock_invalid" };
  if (clock.provenance !== (testBoundary ? CLOCK_PROVENANCE_TEST : CLOCK_PROVENANCE_PRODUCTION)) return { ok: false, reason: "trusted_clock_provenance_untrusted" };
  for (const f of ["bindToDbClock", "isBound", "nowMs", "nowIso"]) if (typeof clock[f] !== "function") return { ok: false, reason: "trusted_clock_invalid" };
  return { ok: true };
}
