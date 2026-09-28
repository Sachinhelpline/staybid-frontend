// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — the ONE V2 runtime identity (clean identity boundary).
// OFFLINE, PURE — Node built-ins only. No I/O, no clock, no network, no secret.
//
// Every V2 runtime successor reads its catalog / policy / control / ceiling / target identity from
// THIS module, which derives it from the accepted, frozen M7 Step-1 contract ONLY:
//   m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs  (FIXED_V2)
//   m7-step1-hb1-consolidated-remediation-01/catalog/v2-digest-gen.mjs                   (digests)
// It NEVER imports the V1 pricing-approval contract (`FIXED`, 89,536 ceilings, V1 catalog as the
// target). V1 values appear here ONLY as the frozen HISTORICAL predecessor that must stay inactive.
// A self-check (IDENTITY_SELF_CHECK_FAILURES) recomputes every derived digest at import time; any
// drift makes every consumer fail closed (assertIdentityIntegrity()).
// ─────────────────────────────────────────────────────────────────────────

import * as C from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import * as G from "../../m7-step1-hb1-consolidated-remediation-01/catalog/v2-digest-gen.mjs";
// the probe TEXT is version-neutral and frozen: the V2 probe sends the SAME text / digest.
import { PROBE_TEXT, PROBE_TEXT_SHA256 } from "../../first-text-probe-activation-01/first-text-probe.mjs";

export const FIXED_V2 = C.FIXED_V2;
export const canonicalize = C.canonicalize;
export const sha256hex = C.sha256hex;
export { PROBE_TEXT, PROBE_TEXT_SHA256 };

export const RUNTIME_CONTRACT_VERSION = "V2";
export const PROJECT_ID = G.PROJECT_ID; // "live-ai-03b"

// ── V2 catalog (the ONLY catalog the V2 runtime may activate / observe as the target) ──
export const CATALOG_V2 = Object.freeze({
  id: G.V2_ID,
  entry_ids: Object.freeze([...G.V2_ENTRY_IDS]),
  entry_count: 3,
  source_digest: G.SOURCE_DIGEST_V2,
  inactive_digest: G.v2Inactive.digest,
  active_digest: G.v2Active.digest,
  t0: G.T0,
  verification_expiry: G.T0_PLUS_7_DAYS,
  rates: Object.freeze(G.V2_RATES.map((r) => Object.freeze({ billing_dimension: r.billing_dimension, service_tier: r.service_tier, unit_size: r.unit_size, rate_micros: r.rate_micros }))),
});

// ── V1 = frozen HISTORICAL predecessor (must remain inactive, byte-exact, never revived) ──
export const V1_HISTORICAL = Object.freeze({
  id: G.V1.id,
  entry_count: 2,
  inactive_digest: G.V1.inactive_catalog_digest,
  active_digest_forbidden: G.V1.active_catalog_digest,
  verification_expiry: G.V1.expiry,
  source_digest: G.V1.source_digest,
});
// the superseded 89,536 one-call policy — must be ABSENT (never created on the V2 path).
export const OBSOLETE_ONECALL_V1 = Object.freeze({ id: G.ONECALL_V1.id, ceiling_micros: G.ONECALL_V1.ceiling, active_digest: G.ONECALL_V1.active_digest });

// ── pre-activation totals: 2 catalog versions (V1 + V2) / 5 entries (2 + 3) ──
export const PRE_ACTIVATION_TOTALS = Object.freeze({ catalog_versions: 2, catalog_entries: 5 });

// ── dormant policy + controls (epoch 1) ──
export const DORMANT_V2_VIEW = Object.freeze({
  policy_id: G.DORMANT.policy_id,
  policy_digest: G.DORMANT.policy_digest,
  control_global_digest: G.DORMANT.control_global_digest,
  control_project_digest: G.DORMANT.control_project_digest,
  control_epoch: 1,
});

// ── successor one-call policy (105,920) + armed controls (epoch 2) + restoration (epoch 3) ──
export const POLICY_V2 = Object.freeze({
  id: G.V2_POLICY_ID,
  active_digest: G.v2PolicyActive.digest,
  restored_digest: G.v2PolicyRestored.digest,
  ceilings: Object.freeze({ ...G.V2_CEILINGS }),
  money_ceiling_micros: G.V2_CEILING_MICROS,
});
export const CONTROLS_V2 = Object.freeze({
  armed_epoch: 2,
  global_activation_digest: G.CONTROL_DIGESTS.global_activation,
  project_activation_digest: G.CONTROL_DIGESTS.project_activation,
  restored_epoch: 3,
  global_restoration_digest: G.CONTROL_DIGESTS.global_restoration,
  project_restoration_digest: G.CONTROL_DIGESTS.project_restoration,
});
export const CEILING_KEYS = Object.freeze(Object.keys(G.V2_CEILINGS).sort());
export const MONEY_CEILING_KEYS = Object.freeze(CEILING_KEYS.filter((k) => k.endsWith("_micros")));
export const COUNT_CEILING_KEYS = Object.freeze(CEILING_KEYS.filter((k) => !k.endsWith("_micros")));

// ── infra targets (identical accepted identities; carried by FIXED_V2) ──
export const TARGETS_V2 = Object.freeze({
  project: FIXED_V2.ai_staging_project,
  environment: FIXED_V2.ai_staging_environment,
  postgres: FIXED_V2.ai_staging_postgres,
  gateway: FIXED_V2.ai_staging_gateway,
  core_excluded_project: FIXED_V2.core_excluded_project,
  core_excluded_postgres: FIXED_V2.core_excluded_postgres,
});
export const STORE_BINDING_REF = "live-ai-03b-staging::railway-postgres::" + FIXED_V2.ai_staging_postgres;
export const REASONING_MODEL = FIXED_V2.model;

// ── deployment env NAMES (non-secret; unchanged accepted names) ──
export const REQUIRED_ENV_NAMES_GATEWAY = Object.freeze([
  "LIVE_AI_03B_STAGING_DATABASE_URL", "LIVE_AI_BUDGET_ENABLED", "LIVE_AI_BUDGET_STORE_BINDING",
  "LIVE_AI_BUDGET_PROJECT_ID", "LIVE_AI_BUDGET_LEASE_TTL_MS", "LIVE_AI_BUDGET_MAX_CONTROL_STALENESS_MS",
  "LIVE_AI_BUDGET_CONTROL_POLL_MS", "OPENAI_API_KEY", "LIVE_AI_REASONING_MODEL", "LIVE_AI_RUNTIME_ENABLED",
  "LIVE_AI_SESSION_SIGNING_PUBLIC_KEY", "LIVE_AI_SESSION_ISSUER", "LIVE_AI_SESSION_AUDIENCE",
  "LIVE_AI_CONTROL_TOKEN_SECRET", "LIVE_AI_KILL_SWITCH_HMAC_SECRET", "LIVE_AI_ALLOWED_ORIGINS",
  "LIVE_AI_IP_HASH_SALT", "LIVE_AI_03B_STAGING_TEXT_ENABLED", "LIVE_AI_03B_STAGING_SUBJECT_ALLOWLIST",
  "LIVE_AI_03B_FIRST_PROBE_ONE_CALL",
]);
export const REQUIRED_ENV_NAMES_BROKER = Object.freeze([
  "LIVE_AI_03B_STAGING_BROKER_ENABLED", "LIVE_AI_03B_STAGING_OPERATOR_SUBJECT",
  "LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET", "LIVE_AI_SESSION_SIGNING_PRIVATE_KEY", "LIVE_AI_GATEWAY_URL",
]);

// ── integrity self-check (import-time, pure) ──
const checks = [
  ["step1_predecessor_self_check", G.SELF_CHECK_FAILURES.length === 0],
  ["catalog_id_is_v2", CATALOG_V2.id === "openai-gpt-5-6-terra-standard-short-v2" && FIXED_V2.catalog_version_id === CATALOG_V2.id],
  ["inactive_digest", CATALOG_V2.inactive_digest === "36355fab5be8009fa66352ce678394d4963f2927a39d1a8eea63f4aa5b939b62" && FIXED_V2.inactive_catalog_digest === CATALOG_V2.inactive_digest],
  ["active_digest", CATALOG_V2.active_digest === "836548ef0274f3a068c83cf4d8e952eb6388921f2064c5e29e8ec25cd7eb798b" && FIXED_V2.active_catalog_digest === CATALOG_V2.active_digest],
  ["source_digest", CATALOG_V2.source_digest === "ec23657bf0c20390afec4d4f233f14300e43b136cc6f27c25d6ffc35e1d7b357"],
  ["expiry", CATALOG_V2.verification_expiry === "2026-10-05T15:26:23Z" && CATALOG_V2.t0 === "2026-09-28T15:26:23Z"],
  ["three_entries", CATALOG_V2.entry_ids.length === 3],
  ["policy_id", POLICY_V2.id === "live-ai-03b-policy-oneprobe-v2" && FIXED_V2.one_call_policy_id === POLICY_V2.id],
  ["policy_active_digest", POLICY_V2.active_digest === "864e24817b2f98d741495bb403c20ada31cd4f27db3d9dfe1c50bb7d99ad9245" && FIXED_V2.one_call_policy_digest === POLICY_V2.active_digest],
  ["policy_restored_digest", POLICY_V2.restored_digest === "833e5b963bbba37e6e6759e60269246ba8c61949257f5bb9edf49cc82829da79"],
  ["money_ceiling_105920", POLICY_V2.money_ceiling_micros === 105920 && G.V2_WORST_CASE_MICROS === 105920 && FIXED_V2.one_call_money_ceiling_micros === 105920],
  ["seven_ceilings", CEILING_KEYS.length === 7 && MONEY_CEILING_KEYS.length === 5 && COUNT_CEILING_KEYS.length === 2
    && MONEY_CEILING_KEYS.every((k) => POLICY_V2.ceilings[k] === 105920) && COUNT_CEILING_KEYS.every((k) => POLICY_V2.ceilings[k] === 1)],
  ["v1_is_not_target", V1_HISTORICAL.id !== CATALOG_V2.id && OBSOLETE_ONECALL_V1.id !== POLICY_V2.id],
  ["bundle_digest", FIXED_V2.activation_bundle_digest === "d6f40fc53dd6002fbed4990603aeddabe3bfff39b6a81aadc9e57dd6ef618e1e"],
  ["probe_text_digest", PROBE_TEXT_SHA256 === "8efedb83900154947f749a5ca0c66546a5580593db18aa125e3d6809e311700d"],
  ["targets_not_core", TARGETS_V2.postgres !== TARGETS_V2.core_excluded_postgres && TARGETS_V2.project !== TARGETS_V2.core_excluded_project],
];
export const IDENTITY_SELF_CHECK_FAILURES = Object.freeze(checks.filter(([, ok]) => ok !== true).map(([k]) => k));
export function assertIdentityIntegrity() {
  return IDENTITY_SELF_CHECK_FAILURES.length === 0 ? { ok: true } : { ok: false, reason: "v2_identity_self_check_failed:" + IDENTITY_SELF_CHECK_FAILURES.join(",") };
}

/** STRICT integer equality (no coercion; NaN / Infinity / floats / strings never pass). */
export function exactInt(v, want) { return typeof v === "number" && Number.isInteger(v) && Object.is(v, want); }

/** The seven V2 ceilings: every field present, strict integer, exact. */
export function ceilingsExactV2(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "one_call_policy_absent" };
  const keys = Object.keys(p).sort();
  if (keys.join(",") !== CEILING_KEYS.join(",")) return { ok: false, reason: "ceiling_key_set_not_exact" };
  for (const k of CEILING_KEYS) if (!exactInt(p[k], POLICY_V2.ceilings[k])) return { ok: false, reason: `ceiling_${k}_invalid_or_mismatch` };
  return { ok: true };
}
