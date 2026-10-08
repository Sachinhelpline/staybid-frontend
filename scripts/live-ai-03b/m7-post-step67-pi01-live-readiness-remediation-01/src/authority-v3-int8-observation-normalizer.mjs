// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — V3 RUNTIME PG BIGINT NORMALIZATION REMEDIATION 01 — Authority V3 reader INT8 observation normalizer.
// OFFLINE candidate. Imported ONLY by authority-v3-composition.mjs. No I/O of its own; no SQL text of its own.
//
// Why: node-postgres returns PostgreSQL INT8/BIGINT as JavaScript STRINGS (no custom type parser is installed —
// deliberately not changed globally). The frozen R3 runtime contract compares these observation fields as
// JavaScript NUMBERS (canonical byte-compare of predecessor entries; strict `!== 0` / `=== 1` dormant checks;
// strict `!== 1000000` / rate checks + digest rebuild for V3 entries). A semantically exact database therefore
// fails `predecessor_not_byte_exact` (proven on a real PostgreSQL cluster with the real pg driver).
//
// What: wraps the Authority's reader PHYSICAL factory. For a row set returned by EXACTLY one of three frozen R3
// observation query texts (QUERIES.catalogEntries / QUERIES.policy / QUERIES.controls — compared by string
// identity), and ONLY for the allowlisted BIGINT columns of that query, a value that is canonical non-negative
// decimal-integer text within Number.MAX_SAFE_INTEGER is converted to the identical JavaScript integer.
// Everything else is returned UNCHANGED (same object): session lifecycle SQL, clock-sampler SQL, the catalog
// version query, the ledger query, any other statement, and every non-allowlisted column (ids, digests,
// timestamps, statuses, booleans, nullable service_tier, …).
//
// Fail-closed without new failure modes: an allowlisted value that is NOT canonical safe non-negative decimal text
// (empty, whitespace, sign, fraction, exponent, leading zeros, non-numeric, > 2^53−1, null, boolean, bigint,
// unsafe/negative/fractional number) is left byte-for-byte UNCHANGED — never coerced, never rounded — so the
// frozen strict comparisons refuse deterministically (a refusal, not an ambiguous error). Nothing here throws on
// data. The frozen R3 runtime, its query registry, digests and the successor runtime pin are NOT modified.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { QUERIES } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-query-registry.mjs";

export const INT8_NORMALIZER_VERSION = "lai03b-v3-reader-int8-observation-normalizer-01";

/** Exact allowlist: frozen observation query key → its BIGINT columns (schema: all BIGINT NOT NULL, CHECK >= 0). */
export const INT8_OBSERVATION_FIELDS = Object.freeze({
  catalogEntries: Object.freeze(["unit_size", "rate_micros"]),
  policy: Object.freeze([
    "session_money_ceiling_micros", "session_provider_calls", "session_execution_admissions",
    "subject_day_money_ceiling_micros", "project_day_money_ceiling_micros", "project_month_money_ceiling_micros",
    "global_day_money_ceiling_micros",
  ]),
  controls: Object.freeze(["control_epoch"]),
});

const FIELDS_BY_SQL = new Map(Object.entries(INT8_OBSERVATION_FIELDS).map(([k, cols]) => {
  if (typeof QUERIES[k] !== "string" || !QUERIES[k].startsWith("SELECT ")) throw new Error("int8_normalizer_registry_mismatch");
  for (const c of cols) if (!new RegExp("[,\\s]" + c + "[,\\s]").test(QUERIES[k])) throw new Error("int8_normalizer_column_not_in_query");
  return [QUERIES[k], cols];
}));
if (FIELDS_BY_SQL.size !== 3) throw new Error("int8_normalizer_registry_mismatch");

// Canonical PostgreSQL int8 text output for a non-negative value: "0" or no leading zero, digits only, ≤ 16 digits.
const CANONICAL_NON_NEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]{0,15})$/;

/** Pure. {ok:true,value} only for a safe non-negative integer Number or its canonical decimal text; else {ok:false}. */
export function normalizeInt8Value(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0) ? { ok: true, value: v } : { ok: false };
  if (typeof v !== "string" || !CANONICAL_NON_NEGATIVE_DECIMAL.test(v)) return { ok: false };
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || String(n) !== v) return { ok: false };
  return { ok: true, value: n };
}

/** Pure. Returns the SAME rows reference for any SQL that is not one of the three frozen observation queries. */
export function normalizeObservationRows(sql, rows) {
  const cols = FIELDS_BY_SQL.get(sql);
  if (!cols || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const out = { ...row };
    for (const c of cols) {
      if (!Object.prototype.hasOwnProperty.call(out, c)) continue;
      const n = normalizeInt8Value(out[c]);
      if (n.ok) out[c] = n.value;   // otherwise left UNCHANGED → the frozen strict checks refuse
    }
    return out;
  });
}

const PHYSICAL_KEYS = "applicationName,close,isDead,onDead,query";

/**
 * Wrap the reader physical factory. The returned physical exposes exactly the accepted reader physical surface
 * (applicationName/query/onDead/isDead/close), delegating each to the SAME underlying connection; it adds no
 * query, no write path and no SQL of its own. An unexpected underlying shape closes it and refuses at open().
 */
export function makeInt8NormalizingReaderPhysicalFactory(inner) {
  if (!inner || typeof inner.open !== "function") throw new Error("int8_normalizer_inner_factory_invalid");
  return Object.freeze({
    kind: inner.kind,
    async open() {
      const p = await inner.open();
      if (!p || typeof p !== "object" || Object.keys(p).sort().join(",") !== PHYSICAL_KEYS || typeof p.query !== "function") {
        try { if (p && typeof p.close === "function") await p.close(); } catch {}
        throw new Error("reader_physical_shape_unexpected");
      }
      return Object.freeze({
        applicationName: p.applicationName,
        async query(sql, params) {
          const r = await p.query(sql, params);
          if (!FIELDS_BY_SQL.has(sql) || !r || !Array.isArray(r.rows)) return r;
          return { rows: normalizeObservationRows(sql, r.rows) };
        },
        onDead(cb) { return p.onDead(cb); },
        isDead() { return p.isDead(); },
        close() { return p.close(); },
      });
    },
  });
}
