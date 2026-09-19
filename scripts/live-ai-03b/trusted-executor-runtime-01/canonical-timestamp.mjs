// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (Implementation E) — canonical
// consumed_at timestamp mapping. OFFLINE, Node built-ins only. No I/O.
//
// The accepted frozen SQL activation receipt formats consumed_at as WHOLE-SECOND
// UTC via to_char(consumed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
// (see scripts/live-ai-03b/trusted-activation-boundary-01/db/2026-09-19-p1-02-
// trusted-activation-boundary.sql). The frozen Phase-B verifier
// (verifyConsumedApproval) requires the receipt's consumed_at to EXACTLY equal
// the ledger observation's consumed_at (string equality) and to sit inside the
// approval validity window. Therefore the trusted read adapter MUST return
// consumed_at in the identical whole-second UTC form.
//
// PREFERRED PATH (DB-side): both the receipt (frozen) and the read query use the
// SAME to_char expression, so the two strings are byte-identical with no client
// conversion at all. This module exports that exact expression as the single
// reviewed source (CANONICAL_CONSUMED_AT_SQL) so the read adapter cannot drift.
//
// DEFENSIVE PATH (client-side): if a generic PostgreSQL client returns a Date or
// a fractional/offset string instead of the to_char string, canonicalizeConsumedAt
// converts to whole-second UTC by TRUNCATION toward the second (matching to_char,
// never rounding — rounding could push :59.6 into the next minute and silently
// mismatch the receipt). Malformed or missing values FAIL CLOSED. Parsing is
// bounded to an RFC3339 shape (never permissive Date parsing of arbitrary text).
// ─────────────────────────────────────────────────────────────────────────

// The ONE reviewed DB-side canonicalizer. Used by the trusted read adapter's fixed
// ledger query so its consumed_at is byte-identical to the frozen receipt's.
export const CANONICAL_CONSUMED_AT_SQL =
  "to_char(consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')";

// exact canonical whole-second UTC form the receipt + ledger observation must share.
export const CANONICAL_CONSUMED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// RFC3339-ish shape accepted for defensive client-side conversion (date T time,
// optional fractional seconds, and Z or a ±HH:MM offset). Nothing else parses.
const RFC3339_ANY = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

class TimestampError extends Error {
  constructor(reason) { super(reason); this.name = "TimestampError"; this.reason = reason; }
}
export { TimestampError };

function fmtUtcWholeSecond(epochMs) {
  // floor toward the second to mirror to_char (truncation, NOT rounding).
  const d = new Date(Math.floor(epochMs / 1000) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T`
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

/**
 * Canonicalize a consumed_at value to whole-second UTC ("YYYY-MM-DDTHH:MM:SSZ").
 * - already-canonical string → returned unchanged.
 * - Date → floor to second, UTC.
 * - RFC3339 string (fractional and/or offset) → convert to UTC, floor to second.
 * - null/undefined/"" → TimestampError("consumed_at_missing").
 * - anything else / non-RFC3339 / unparseable → TimestampError("consumed_at_malformed").
 * Truncation is toward the second (matches to_char); never rounds.
 */
export function canonicalizeConsumedAt(value) {
  if (value === null || value === undefined || value === "") throw new TimestampError("consumed_at_missing");
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new TimestampError("consumed_at_malformed");
    return fmtUtcWholeSecond(ms);
  }
  if (typeof value !== "string") throw new TimestampError("consumed_at_malformed");
  if (CANONICAL_CONSUMED_AT_RE.test(value)) return value; // already exact whole-second UTC
  if (!RFC3339_ANY.test(value)) throw new TimestampError("consumed_at_malformed");
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new TimestampError("consumed_at_malformed");
  return fmtUtcWholeSecond(ms);
}

/** Guard that a value IS already the exact canonical whole-second UTC form (no conversion). */
export function assertCanonicalConsumedAt(value) {
  if (typeof value !== "string" || !CANONICAL_CONSUMED_AT_RE.test(value)) {
    throw new TimestampError("consumed_at_not_canonical");
  }
  return value;
}
