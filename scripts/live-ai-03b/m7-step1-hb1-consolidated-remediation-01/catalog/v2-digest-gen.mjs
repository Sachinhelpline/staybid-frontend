// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 1 — SUCCESSOR V2 price catalog + successor one-call policy:
// deterministic digest generator. OFFLINE, PURE — no I/O, no clock (T0 frozen below),
// no network, no secret. Node built-ins only.
//
// Canonicalization = the ACCEPTED BUDGET digest contract, byte-identical to
//   scripts/live-ai-budget-01/price-catalog-digest-gen.mjs and
//   scripts/live-ai-03b/first-text-probe-activation-01/activation-digest-gen.mjs:
//   recursive lexicographic object-key sort, UTF-8, no insignificant whitespace, integers
//   as JSON numbers (floats forbidden), booleans/null as JSON, standard JSON escaping,
//   arrays keep their DEFINED canonical order, explicit domain field, lowercase SHA-256 hex.
// The self-check below re-derives EVERY accepted predecessor digest (V1 source, V1
// inactive/active catalog, dormant policy, one-call V1 policy active/restored, the four
// control digests) with this exact code and refuses to print if any differs.
//
// HB-1 remediation: the V2 source evidence + catalog commit to THREE rates
//   (base input 2,000,000 · cache_write input 2,500,000 · base output 12,000,000 per 1e6),
// and the successor one-call policy carries FIVE money ceilings of 105,920 micros plus
// TWO count ceilings of 1 (session_provider_calls, session_execution_admissions).
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

// ── the ONE frozen M7 artifact T0 (generated once via `date -u`) + exactly 7 calendar days ──
export const T0 = "2026-09-28T15:26:23Z";
export const T0_PLUS_7_DAYS = "2026-10-05T15:26:23Z";

export const CATALOG_DOMAIN = "staybid.live-ai.budget.price-catalog.v1"; // contract domain (NOT the catalog version)
export const POLICY_DOMAIN = "staybid.live-ai.budget.policy.v1";
export const CONTROL_DOMAIN = "staybid.live-ai.budget.control.v1";
export const BUNDLE_DOMAIN_V2 = "staybid.live-ai.activation-bundle.v2";

// source_id identifies the EVIDENCE CLASS (OpenAI API pricing / model / Standard / short
// context); it is preserved from the accepted contract. The rate SET it proves is committed
// by source_digest (which now covers three rates), not by source_id.
export const SOURCE_ID = "openai-api-pricing/gpt-5.6-terra/standard/short-context/v1";
export const SOURCE_URL = "https://developers.openai.com/api/docs/pricing";
export const PROJECT_ID = "live-ai-03b";

export const V2_ID = "openai-gpt-5-6-terra-standard-short-v2";
export const V2_POLICY_ID = "live-ai-03b-policy-oneprobe-v2";
export const V2_CEILING_MICROS = 105920; // 32768×2,500,000/1e6 (=81,920) + 2000×12,000,000/1e6 (=24,000)

// ── accepted predecessor constants (frozen; NEVER changed here) ──
export const V1 = Object.freeze({
  id: "openai-gpt-5-6-terra-standard-short-v1",
  t0: "2026-09-18T18:37:35Z",
  expiry: "2026-09-25T18:37:35Z",
  source_digest: "fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3",
  inactive_catalog_digest: "453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973",
  active_catalog_digest: "616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8",
});
export const DORMANT = Object.freeze({
  t0: "2026-09-18T14:11:25Z",
  policy_id: "live-ai-03b-policy-v1-dormant",
  policy_digest: "cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4",
  control_global_digest: "26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee",
  control_project_digest: "be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f",
});
export const ONECALL_V1 = Object.freeze({
  id: "live-ai-03b-policy-oneprobe-v1",
  t0: "2026-09-19T05:41:50Z",
  ceiling: 89536,
  active_digest: "9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c",
  restored_digest: "a74a7e347f511e4c2c423fa62d3cce10559713acf903138939b59d6037b8c4d9",
});
export const CONTROL_DIGESTS = Object.freeze({
  global_activation: "0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b",
  project_activation: "eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f",
  global_restoration: "0d2f68853d59b59b4d57d84eedb03af5e2117643c8b4bc378674f4be7dc4b707",
  project_restoration: "d26219d1e4ed6e418dd7f71ec97947b2502c004b59c7fd7c88638059139db7f4",
});
// the accepted repository state this successor is built on (frozen M6 HEAD).
export const BASE_COMMIT = "9270c282d5fd65e9fe49261391badfe92c777b8f";
export const BASE_TREE = "c46da04123dc44cd9954fe350de0b1bc20ff0948";

// ── canonicalization (the accepted BUDGET contract) ──
export function canonicalize(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") {
    if (!Number.isInteger(v)) throw new Error("canonicalize: floating-point forbidden");
    return String(v);
  }
  if (t === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
  }
  throw new Error("canonicalize: unsupported type " + t);
}
export function sha256hex(s) { return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex"); }
export function digestOf(payload) { const c = canonicalize(payload); return { canonical: c, digest: sha256hex(c) }; }

// ── rate rows (id-suffix, dimension, tier, unit, rate) ──
// Canonical array order everywhere = lexicographic by ENTRY ID:
//   …-reasoning-input-token-base  <  …-reasoning-input-token-cache-write  <  …-reasoning-output-token-base
export const V2_RATES = Object.freeze([
  Object.freeze({ suffix: "-reasoning-input-token-base", billing_dimension: "reasoning_input_token", service_tier: null, unit_size: 1000000, rate_micros: 2000000 }),
  Object.freeze({ suffix: "-reasoning-input-token-cache-write", billing_dimension: "reasoning_input_token", service_tier: "cache_write", unit_size: 1000000, rate_micros: 2500000 }),
  Object.freeze({ suffix: "-reasoning-output-token-base", billing_dimension: "reasoning_output_token", service_tier: null, unit_size: 1000000, rate_micros: 12000000 }),
]);
const V1_RATES = [
  { suffix: "-reasoning-input-token-base", billing_dimension: "reasoning_input_token", service_tier: null, unit_size: 1000000, rate_micros: 2000000 },
  { suffix: "-reasoning-output-token-base", billing_dimension: "reasoning_output_token", service_tier: null, unit_size: 1000000, rate_micros: 12000000 },
];
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ── SOURCE-evidence payload (accepted shape; rates array in entry-id order) → source_digest ──
export function sourcePayload(rates, verifiedAt, versionId) {
  const ordered = rates.map((r) => ({ id: versionId + r.suffix, r })).sort(byId).map((x) => x.r);
  return {
    context_tier: "short",
    currency: "USD",
    model: "gpt-5.6-terra",
    processing_mode: "standard",
    provider: "openai",
    rates: ordered.map((r) => ({ billing_dimension: r.billing_dimension, rate_micros: r.rate_micros, service_tier: r.service_tier, unit_size: r.unit_size })),
    source_id: SOURCE_ID,
    source_url: SOURCE_URL,
    verified_at: verifiedAt,
  };
}

// ── full entry rows (accepted shape) ──
export function entryRows(versionId, rates, t0, expiry, sourceDigest, status) {
  return rates.map((r) => ({
    id: versionId + r.suffix,
    catalog_version_id: versionId,
    provider: "openai",
    model: "gpt-5.6-terra",
    service_tier: r.service_tier,
    billing_dimension: r.billing_dimension,
    currency_code: "USD",
    unit_size: r.unit_size,
    rate_micros: r.rate_micros,
    effective_from: t0,
    effective_until: null,
    verified_at: t0,
    verification_expires_at: expiry,
    source_id: SOURCE_ID,
    source_digest: sourceDigest,
    status,
    created_at: t0,
  })).sort(byId);
}

// ── catalog payload (accepted shape; status parameterised; digest NOT in its own payload) ──
export function catalogPayload(versionId, rates, t0, expiry, sourceDigest, status) {
  return {
    catalog_version: { id: versionId, status, effective_from: t0, effective_until: null, created_at: t0 },
    domain: CATALOG_DOMAIN,
    entries: entryRows(versionId, rates, t0, expiry, sourceDigest, status),
  };
}

// ── policy payload (accepted shape; created_at NOT committed) ──
export function policyPayload(id, status, effectiveFrom, c) {
  return {
    domain: POLICY_DOMAIN, id, project_id: PROJECT_ID, status, effective_from: effectiveFrom, effective_until: null,
    session_money_ceiling_micros: c.session_money_ceiling_micros,
    session_provider_calls: c.session_provider_calls,
    session_execution_admissions: c.session_execution_admissions,
    subject_day_money_ceiling_micros: c.subject_day_money_ceiling_micros,
    project_day_money_ceiling_micros: c.project_day_money_ceiling_micros,
    project_month_money_ceiling_micros: c.project_month_money_ceiling_micros,
    global_day_money_ceiling_micros: c.global_day_money_ceiling_micros,
  };
}
export function oneCallCeilings(money) {
  // FIVE money ceilings + TWO count ceilings (NOT seven money fields).
  return {
    session_money_ceiling_micros: money,
    subject_day_money_ceiling_micros: money,
    project_day_money_ceiling_micros: money,
    project_month_money_ceiling_micros: money,
    global_day_money_ceiling_micros: money,
    session_provider_calls: 1,
    session_execution_admissions: 1,
  };
}
const ZERO = { session_money_ceiling_micros: 0, session_provider_calls: 0, session_execution_admissions: 0, subject_day_money_ceiling_micros: 0, project_day_money_ceiling_micros: 0, project_month_money_ceiling_micros: 0, global_day_money_ceiling_micros: 0 };
export function controlPayload(scopeType, scopeKey, epoch, enabled, killed) {
  return { domain: CONTROL_DOMAIN, scope_type: scopeType, scope_key_digest: scopeKey, control_epoch: epoch, enabled, killed };
}

// ── worst case (mirrors the accepted gateway resolveReasoning03bRates: 32768 input ONCE at the
//    HIGHEST input tier + 2000 output; ceil-div costMicros) ──
export const MAX_INPUT_TOKENS = 32768;
export const MAX_OUTPUT_TOKENS = 2000;
const ceilDiv = (a, b) => (a === 0n ? 0n : (a + b - 1n) / b);
export function worstCaseMicros(rates) {
  let input = 0n;
  for (const r of rates) if (r.billing_dimension === "reasoning_input_token") {
    const c = ceilDiv(BigInt(MAX_INPUT_TOKENS) * BigInt(r.rate_micros), BigInt(r.unit_size));
    if (c > input) input = c;
  }
  const out = rates.find((r) => r.billing_dimension === "reasoning_output_token" && r.service_tier === null);
  return Number(input + ceilDiv(BigInt(MAX_OUTPUT_TOKENS) * BigInt(out.rate_micros), BigInt(out.unit_size)));
}

// ═══════════════════ predecessor self-check (must reproduce accepted digests) ═══════════
const v1Source = digestOf(sourcePayload(V1_RATES, V1.t0, V1.id));
const selfChecks = [
  ["v1_source_digest", v1Source.digest, V1.source_digest],
  ["v1_inactive_catalog_digest", digestOf(catalogPayload(V1.id, V1_RATES, V1.t0, V1.expiry, V1.source_digest, "inactive")).digest, V1.inactive_catalog_digest],
  ["v1_active_catalog_digest", digestOf(catalogPayload(V1.id, V1_RATES, V1.t0, V1.expiry, V1.source_digest, "active")).digest, V1.active_catalog_digest],
  ["dormant_policy_digest", digestOf(policyPayload(DORMANT.policy_id, "inactive", DORMANT.t0, ZERO)).digest, DORMANT.policy_digest],
  ["onecall_v1_active_digest", digestOf(policyPayload(ONECALL_V1.id, "active", ONECALL_V1.t0, oneCallCeilings(ONECALL_V1.ceiling))).digest, ONECALL_V1.active_digest],
  ["onecall_v1_restored_digest", digestOf(policyPayload(ONECALL_V1.id, "inactive", ONECALL_V1.t0, oneCallCeilings(ONECALL_V1.ceiling))).digest, ONECALL_V1.restored_digest],
  ["dormant_control_global", digestOf(controlPayload("global", "global", 1, false, false)).digest, DORMANT.control_global_digest],
  ["dormant_control_project", digestOf(controlPayload("project", PROJECT_ID, 1, false, false)).digest, DORMANT.control_project_digest],
  ["control_global_activation", digestOf(controlPayload("global", "global", 2, true, false)).digest, CONTROL_DIGESTS.global_activation],
  ["control_project_activation", digestOf(controlPayload("project", PROJECT_ID, 2, true, false)).digest, CONTROL_DIGESTS.project_activation],
  ["control_global_restoration", digestOf(controlPayload("global", "global", 3, false, false)).digest, CONTROL_DIGESTS.global_restoration],
  ["control_project_restoration", digestOf(controlPayload("project", PROJECT_ID, 3, false, false)).digest, CONTROL_DIGESTS.project_restoration],
  ["v1_worst_case_equals_v1_ceiling", String(worstCaseMicros(V1_RATES)), String(ONECALL_V1.ceiling)],
];
export const SELF_CHECK_FAILURES = selfChecks.filter(([, got, want]) => got !== want);

// ═══════════════════════════════ V2 successor values ════════════════════════════════
export const v2Source = digestOf(sourcePayload(V2_RATES, T0, V2_ID));
export const SOURCE_DIGEST_V2 = v2Source.digest;
export const v2Inactive = digestOf(catalogPayload(V2_ID, V2_RATES, T0, T0_PLUS_7_DAYS, SOURCE_DIGEST_V2, "inactive"));
export const v2Active = digestOf(catalogPayload(V2_ID, V2_RATES, T0, T0_PLUS_7_DAYS, SOURCE_DIGEST_V2, "active"));
export const V2_CEILINGS = Object.freeze(oneCallCeilings(V2_CEILING_MICROS));
export const v2PolicyActive = digestOf(policyPayload(V2_POLICY_ID, "active", T0, V2_CEILINGS));
export const v2PolicyRestored = digestOf(policyPayload(V2_POLICY_ID, "inactive", T0, V2_CEILINGS));
export const V2_ENTRY_IDS = Object.freeze(entryRows(V2_ID, V2_RATES, T0, T0_PLUS_7_DAYS, SOURCE_DIGEST_V2, "inactive").map((e) => e.id));
export const V2_WORST_CASE_MICROS = worstCaseMicros(V2_RATES);

// ── V2 activation bundle (binds the approval to the exact reviewed activation set) ──
export function bundlePayloadV2() {
  return {
    domain: BUNDLE_DOMAIN_V2,
    base_commit: BASE_COMMIT,
    base_tree: BASE_TREE,
    catalog_version_id: V2_ID,
    inactive_catalog_digest: v2Inactive.digest,
    active_catalog_digest: v2Active.digest,
    source_digest: SOURCE_DIGEST_V2,
    catalog_verification_expiry: T0_PLUS_7_DAYS,
    one_call_policy_id: V2_POLICY_ID,
    one_call_policy_digest: v2PolicyActive.digest,
    one_call_ceilings: V2_CEILINGS,
    control_global_activation_digest: CONTROL_DIGESTS.global_activation,
    control_project_activation_digest: CONTROL_DIGESTS.project_activation,
    service_tier: "default",
  };
}
export const v2Bundle = digestOf(bundlePayloadV2());

export const RESULT = Object.freeze({
  T0, T0_PLUS_7_DAYS,
  predecessor_self_check_ok: SELF_CHECK_FAILURES.length === 0,
  predecessor_self_checks: selfChecks.map(([key, got, want]) => ({ key, got, want, ok: got === want })),
  v2_catalog_version_id: V2_ID,
  v2_entry_ids: V2_ENTRY_IDS,
  source_canonical: v2Source.canonical,
  source_digest: SOURCE_DIGEST_V2,
  inactive_catalog_canonical: v2Inactive.canonical,
  inactive_catalog_digest: v2Inactive.digest,
  active_catalog_canonical: v2Active.canonical,
  active_catalog_digest: v2Active.digest,
  successor_policy_id: V2_POLICY_ID,
  successor_policy_active_canonical: v2PolicyActive.canonical,
  successor_policy_active_digest: v2PolicyActive.digest,
  successor_policy_restored_digest: v2PolicyRestored.digest,
  successor_ceilings: V2_CEILINGS,
  worst_case_reservation_micros: V2_WORST_CASE_MICROS,
  activation_bundle_canonical: v2Bundle.canonical,
  activation_bundle_digest: v2Bundle.digest,
});

function main() {
  if (SELF_CHECK_FAILURES.length) {
    process.stderr.write("FATAL: predecessor digest self-check FAILED:\n" + JSON.stringify(SELF_CHECK_FAILURES, null, 2) + "\n");
    process.exit(2);
  }
  if (V2_WORST_CASE_MICROS !== V2_CEILING_MICROS) { process.stderr.write("FATAL: worst case != 105920\n"); process.exit(2); }
  process.stdout.write(JSON.stringify(RESULT, null, 2) + "\n");
}
if (import.meta.url === `file://${process.argv[1]}`) main();
