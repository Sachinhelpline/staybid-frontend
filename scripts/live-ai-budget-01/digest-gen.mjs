// LIVE-AI-BUDGET-01 — dormant control/policy seed: deterministic digest generator
// (OFFLINE, PURE — no I/O, no clock, no network, no DB). Reused by verify-seed.mjs.
//
// Canonicalization contract (frozen):
//   SHA-256 over canonical UTF-8 JSON:
//   - recursively lexicographically sorted object keys
//   - no insignificant whitespace
//   - integers as JSON numbers (floats forbidden)
//   - booleans as JSON booleans, null as JSON null
//   - strings use standard JSON escaping
//   - an explicit `domain` field is committed
//   - output = lowercase hex SHA-256
//
// This artifact computes NOTHING from the wall clock. The single frozen UTC
// timestamp below was generated exactly once at artifact-creation time and is
// the same literal embedded in the SQL seed, the verification test, and the
// evidence manifest.

import { createHash } from 'node:crypto';

// ── the one frozen UTC timestamp (generated once via `date -u`, then frozen) ──
export const EFFECTIVE_FROM = '2026-09-18T14:11:25Z';

// ── frozen digest domains ──
export const CONTROL_DOMAIN = 'staybid.live-ai.budget.control.v1';
export const POLICY_DOMAIN = 'staybid.live-ai.budget.policy.v1';

// ── canonical JSON serializer (deterministic) ──
export function canonicalize(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isInteger(v)) throw new Error('canonicalize: floating-point values are forbidden');
    return String(v);
  }
  if (t === 'string') return JSON.stringify(v); // standard JSON string escaping
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  throw new Error('canonicalize: unsupported type ' + t);
}

export function sha256hex(s) {
  return createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

// ── the exact intended rows (owner-approved frozen dormant design) ──
// CONTROL digest commits to EXACTLY: domain, scope_type, scope_key_digest,
//                                    control_epoch, enabled, killed.
export const controlGlobalPayload = {
  domain: CONTROL_DOMAIN,
  scope_type: 'global',
  scope_key_digest: 'global',
  control_epoch: 1,
  enabled: false,
  killed: false,
};

export const controlProjectPayload = {
  domain: CONTROL_DOMAIN,
  scope_type: 'project',
  scope_key_digest: 'live-ai-03b',
  control_epoch: 1,
  enabled: false,
  killed: false,
};

// POLICY digest commits to EXACTLY: domain, id, project_id, status,
//   effective_from, effective_until, and all seven ceilings.
export const policyPayload = {
  domain: POLICY_DOMAIN,
  id: 'live-ai-03b-policy-v1-dormant',
  project_id: 'live-ai-03b',
  status: 'inactive',
  effective_from: EFFECTIVE_FROM,
  effective_until: null,
  session_money_ceiling_micros: 0,
  session_provider_calls: 0,
  session_execution_admissions: 0,
  subject_day_money_ceiling_micros: 0,
  project_day_money_ceiling_micros: 0,
  project_month_money_ceiling_micros: 0,
  global_day_money_ceiling_micros: 0,
};

// ── independently derived digests ──
export const controlGlobalCanonical = canonicalize(controlGlobalPayload);
export const controlProjectCanonical = canonicalize(controlProjectPayload);
export const policyCanonical = canonicalize(policyPayload);

export const controlGlobalDigest = sha256hex(controlGlobalCanonical);
export const controlProjectDigest = sha256hex(controlProjectCanonical);
export const policyDigest = sha256hex(policyCanonical);

export const DIGESTS = {
  control_global: { canonical: controlGlobalCanonical, digest: controlGlobalDigest },
  control_project: { canonical: controlProjectCanonical, digest: controlProjectDigest },
  policy: { canonical: policyCanonical, digest: policyDigest },
};

// ── print when run directly ──
function main() {
  const out = {
    effective_from: EFFECTIVE_FROM,
    control_global: { canonical: controlGlobalCanonical, digest: controlGlobalDigest },
    control_project: { canonical: controlProjectCanonical, digest: controlProjectDigest },
    policy: { canonical: policyCanonical, digest: policyDigest },
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
