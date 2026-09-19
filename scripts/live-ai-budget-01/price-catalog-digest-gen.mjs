// LIVE-AI-BUDGET-01 — inactive price-catalog seed: deterministic digest generator.
// OFFLINE, PURE — no I/O, no clock (T0 frozen below), no network. Node built-ins only.
// Canonicalization: SHA-256 over canonical UTF-8 JSON — recursive lexicographic key
// sort, no insignificant whitespace, integers as JSON numbers (no floats), null as
// JSON null, standard string escaping, arrays keep their defined canonical order.

import { createHash } from 'node:crypto';

// ── the one frozen timestamp (generated once via `date -u`) + 7 calendar days ──
export const T0 = '2026-09-18T18:37:35Z';
export const T0_PLUS_7_DAYS = '2026-09-25T18:37:35Z';

export const CATALOG_DOMAIN = 'staybid.live-ai.budget.price-catalog.v1';
export const SOURCE_ID = 'openai-api-pricing/gpt-5.6-terra/standard/short-context/v1';
export const SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
export const CATALOG_VERSION_ID = 'openai-gpt-5-6-terra-standard-short-v1';

export function canonicalize(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isInteger(v)) throw new Error('canonicalize: floating-point forbidden');
    return String(v);
  }
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  throw new Error('canonicalize: unsupported type ' + t);
}
export function sha256hex(s) { return createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex'); }

// ── the two frozen rate rows (accepted design) ──
export const INPUT = {
  id: CATALOG_VERSION_ID + '-reasoning-input-token-base',
  billing_dimension: 'reasoning_input_token',
  service_tier: null,
  unit_size: 1000000,
  rate_micros: 2000000,
};
export const OUTPUT = {
  id: CATALOG_VERSION_ID + '-reasoning-output-token-base',
  billing_dimension: 'reasoning_output_token',
  service_tier: null,
  unit_size: 1000000,
  rate_micros: 12000000,
};

// ── canonical SOURCE-evidence payload (§8) → source_digest ──
export const sourcePayload = {
  context_tier: 'short',
  currency: 'USD',
  model: 'gpt-5.6-terra',
  processing_mode: 'standard',
  provider: 'openai',
  rates: [
    { billing_dimension: INPUT.billing_dimension, rate_micros: INPUT.rate_micros, service_tier: INPUT.service_tier, unit_size: INPUT.unit_size },
    { billing_dimension: OUTPUT.billing_dimension, rate_micros: OUTPUT.rate_micros, service_tier: OUTPUT.service_tier, unit_size: OUTPUT.unit_size },
  ],
  source_id: SOURCE_ID,
  source_url: SOURCE_URL,
  verified_at: T0,
};
export const sourceCanonical = canonicalize(sourcePayload);
export const sourceDigest = sha256hex(sourceCanonical);

// ── the full entry rows (for the catalog payload) ──
function entryRow(e) {
  return {
    id: e.id,
    catalog_version_id: CATALOG_VERSION_ID,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    service_tier: e.service_tier,
    billing_dimension: e.billing_dimension,
    currency_code: 'USD',
    unit_size: e.unit_size,
    rate_micros: e.rate_micros,
    effective_from: T0,
    effective_until: null,
    verified_at: T0,
    verification_expires_at: T0_PLUS_7_DAYS,
    source_id: SOURCE_ID,
    source_digest: sourceDigest,
    status: 'inactive',
    created_at: T0,
  };
}
// entry array ordering: lexicographic by entry id (input < output)
export const entries = [entryRow(INPUT), entryRow(OUTPUT)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// ── canonical CATALOG payload (§10) → catalog_digest (digest not in its own payload) ──
export const catalogPayload = {
  catalog_version: {
    id: CATALOG_VERSION_ID,
    status: 'inactive',
    effective_from: T0,
    effective_until: null,
    created_at: T0,
  },
  domain: CATALOG_DOMAIN,
  entries,
};
export const catalogCanonical = canonicalize(catalogPayload);
export const catalogDigest = sha256hex(catalogCanonical);

function main() {
  process.stdout.write(JSON.stringify({
    T0, T0_PLUS_7_DAYS,
    source_canonical: sourceCanonical,
    source_digest: sourceDigest,
    catalog_canonical: catalogCanonical,
    catalog_digest: catalogDigest,
  }, null, 2) + '\n');
}
if (import.meta.url === `file://${process.argv[1]}`) main();
