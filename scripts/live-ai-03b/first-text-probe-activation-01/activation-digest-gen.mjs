// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — FIRST-TEXT-PROBE activation artifact set: deterministic digest
// generator. OFFLINE, PURE — no I/O, no clock, no network. Node built-ins only.
//
// It deterministically derives + prints every canonical payload + SHA-256 digest the
// UNAPPLIED activation / restoration SQL and the evidence manifest embed as LITERALS:
//   • the ACTIVE price-catalog canonical payload + digest (the reviewed inactive
//     predecessor with status flipped inactive→active, every other field byte-preserved);
//   • the ONE-CALL active budget policy canonical payload + digest;
//   • the GLOBAL + PROJECT control ACTIVATION (epoch 2, enabled) canonical payloads
//     + record digests;
//   • the GLOBAL + PROJECT control RESTORATION (epoch 3, disabled) canonical payloads
//     + record digests (deterministic — the control digest NEVER commits updated_at);
//   • the one-call policy RESTORED (status active→inactive) canonical payload + digest.
//
// It ALSO re-derives the frozen predecessor digests (the inactive catalog digest, the
// two dormant control digests, the dormant policy digest) purely from their canonical
// field sets and ASSERTS they equal the accepted, already-committed values — proving the
// predecessor reconstruction is exact before any status transition is proposed.
//
// Canonicalization — the accepted BUDGET digest contract (byte-identical to
// scripts/live-ai-budget-01/digest-gen.mjs + price-catalog-digest-gen.mjs):
//   recursive lexicographic object-key sort, UTF-8, no insignificant whitespace,
//   integers as JSON numbers (floats forbidden), booleans as JSON booleans, null as
//   JSON null, standard JSON string escaping, arrays keep their defined canonical order,
//   an explicit `domain` field, lowercase SHA-256 hex.
//
// NON-ACTIVATING: prints values only. No DB, no Railway, no provider, no secret.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

// ── the ONE frozen artifact-creation timestamp (evidence metadata; §6) ──
// Used ONLY as the one-call policy's frozen effective-interval boundary (a deterministic
// interval anchor — NOT a control-freshness value; control updated_at is a fresh
// execution-time parameter, never ARTIFACT_T0 — §6/§16).
export const ARTIFACT_T0 = "2026-09-19T05:41:50Z";

// ── frozen predecessor constants (accepted, already-committed; NEVER changed here) ──
export const DORMANT_T0 = "2026-09-18T14:11:25Z";           // dormant control/policy seed T0
export const CATALOG_T0 = "2026-09-18T18:37:35Z";           // inactive price-catalog seed T0
export const CATALOG_VERIFICATION_EXPIRY = "2026-09-25T18:37:35Z";

export const CONTROL_DOMAIN = "staybid.live-ai.budget.control.v1";
export const POLICY_DOMAIN = "staybid.live-ai.budget.policy.v1";
export const CATALOG_DOMAIN = "staybid.live-ai.budget.price-catalog.v1";

export const PROJECT_ID = "live-ai-03b";
export const DORMANT_POLICY_ID = "live-ai-03b-policy-v1-dormant";
export const ONECALL_POLICY_ID = "live-ai-03b-policy-oneprobe-v1";

export const CATALOG_VERSION_ID = "openai-gpt-5-6-terra-standard-short-v1";
export const SOURCE_ID = "openai-api-pricing/gpt-5.6-terra/standard/short-context/v1";
export const SOURCE_DIGEST = "fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3";

// accepted predecessor digests (proven identical below) ──────────────────────
export const EXPECT_INACTIVE_CATALOG_DIGEST = "453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973";
export const EXPECT_DORMANT_CONTROL_GLOBAL_DIGEST = "26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee";
export const EXPECT_DORMANT_CONTROL_PROJECT_DIGEST = "be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f";
export const EXPECT_DORMANT_POLICY_DIGEST = "cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4";

// the one-call ceilings (accepted design; §15) ──────────────────────────────
export const ONECALL_CEILING_MICROS = 89536;

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
function digestOf(payload) { const c = canonicalize(payload); return { canonical: c, digest: sha256hex(c) }; }

// ── control record payload (committed fields ONLY; updated_at NEVER committed) ──
export function controlPayload(scopeType, scopeKeyDigest, epoch, enabled, killed) {
  return {
    domain: CONTROL_DOMAIN,
    scope_type: scopeType,
    scope_key_digest: scopeKeyDigest,
    control_epoch: epoch,
    enabled,
    killed,
  };
}

// ── policy payload (committed fields; created_at NOT committed) ──
export function policyPayload(id, status, effectiveFrom, ceilings) {
  return {
    domain: POLICY_DOMAIN,
    id,
    project_id: PROJECT_ID,
    status,
    effective_from: effectiveFrom,
    effective_until: null,
    session_money_ceiling_micros: ceilings.session_money_ceiling_micros,
    session_provider_calls: ceilings.session_provider_calls,
    session_execution_admissions: ceilings.session_execution_admissions,
    subject_day_money_ceiling_micros: ceilings.subject_day_money_ceiling_micros,
    project_day_money_ceiling_micros: ceilings.project_day_money_ceiling_micros,
    project_month_money_ceiling_micros: ceilings.project_month_money_ceiling_micros,
    global_day_money_ceiling_micros: ceilings.global_day_money_ceiling_micros,
  };
}

const ZERO_CEILINGS = {
  session_money_ceiling_micros: 0, session_provider_calls: 0, session_execution_admissions: 0,
  subject_day_money_ceiling_micros: 0, project_day_money_ceiling_micros: 0,
  project_month_money_ceiling_micros: 0, global_day_money_ceiling_micros: 0,
};
const ONECALL_CEILINGS = {
  session_money_ceiling_micros: ONECALL_CEILING_MICROS,
  session_provider_calls: 1,
  session_execution_admissions: 1,
  subject_day_money_ceiling_micros: ONECALL_CEILING_MICROS,
  project_day_money_ceiling_micros: ONECALL_CEILING_MICROS,
  project_month_money_ceiling_micros: ONECALL_CEILING_MICROS,
  global_day_money_ceiling_micros: ONECALL_CEILING_MICROS,
};

// ── price-catalog payload (reviewed shape; status parameterised) ──
function entryRow(idSuffix, billingDimension, unitSize, rateMicros, status) {
  return {
    id: CATALOG_VERSION_ID + idSuffix,
    catalog_version_id: CATALOG_VERSION_ID,
    provider: "openai",
    model: "gpt-5.6-terra",
    service_tier: null,
    billing_dimension: billingDimension,
    currency_code: "USD",
    unit_size: unitSize,
    rate_micros: rateMicros,
    effective_from: CATALOG_T0,
    effective_until: null,
    verified_at: CATALOG_T0,
    verification_expires_at: CATALOG_VERIFICATION_EXPIRY,
    source_id: SOURCE_ID,
    source_digest: SOURCE_DIGEST,
    status,
    created_at: CATALOG_T0,
  };
}
export function catalogPayload(status) {
  // entry array ordering: lexicographic by entry id (input < output).
  const entries = [
    entryRow("-reasoning-input-token-base", "reasoning_input_token", 1000000, 2000000, status),
    entryRow("-reasoning-output-token-base", "reasoning_output_token", 1000000, 12000000, status),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    catalog_version: {
      id: CATALOG_VERSION_ID,
      status,
      effective_from: CATALOG_T0,
      effective_until: null,
      created_at: CATALOG_T0,
    },
    domain: CATALOG_DOMAIN,
    entries,
  };
}

// ── self-check: reproduce the accepted frozen predecessor digests exactly ──
const inactiveCatalog = digestOf(catalogPayload("inactive"));
const dormantGlobal = digestOf(controlPayload("global", "global", 1, false, false));
const dormantProject = digestOf(controlPayload("project", PROJECT_ID, 1, false, false));
const dormantPolicy = digestOf(policyPayload(DORMANT_POLICY_ID, "inactive", DORMANT_T0, ZERO_CEILINGS));

const selfChecks = [
  ["inactive_catalog_digest", inactiveCatalog.digest, EXPECT_INACTIVE_CATALOG_DIGEST],
  ["dormant_control_global_digest", dormantGlobal.digest, EXPECT_DORMANT_CONTROL_GLOBAL_DIGEST],
  ["dormant_control_project_digest", dormantProject.digest, EXPECT_DORMANT_CONTROL_PROJECT_DIGEST],
  ["dormant_policy_digest", dormantPolicy.digest, EXPECT_DORMANT_POLICY_DIGEST],
];
const selfCheckFailures = selfChecks.filter(([, got, want]) => got !== want);

// ── the NEW activation / restoration payloads + digests ──
export const activeCatalog = digestOf(catalogPayload("active"));
export const oneCallPolicyActive = digestOf(policyPayload(ONECALL_POLICY_ID, "active", ARTIFACT_T0, ONECALL_CEILINGS));
export const oneCallPolicyRestored = digestOf(policyPayload(ONECALL_POLICY_ID, "inactive", ARTIFACT_T0, ONECALL_CEILINGS));
export const controlGlobalActivation = digestOf(controlPayload("global", "global", 2, true, false));
export const controlProjectActivation = digestOf(controlPayload("project", PROJECT_ID, 2, true, false));
export const controlGlobalRestoration = digestOf(controlPayload("global", "global", 3, false, false));
export const controlProjectRestoration = digestOf(controlPayload("project", PROJECT_ID, 3, false, false));

export const RESULT = {
  ARTIFACT_T0,
  canonicalization_rules: [
    "recursive lexicographic object-key sort",
    "UTF-8",
    "no insignificant whitespace",
    "integers as JSON numbers (floats forbidden)",
    "booleans as JSON booleans",
    "null as JSON null",
    "standard JSON string escaping",
    "arrays keep their defined canonical order",
    "explicit domain field",
    "lowercase SHA-256 hex",
  ],
  predecessor_self_check_ok: selfCheckFailures.length === 0,
  predecessor_self_checks: selfChecks.map(([k, got, want]) => ({ key: k, got, want, ok: got === want })),
  active_price_catalog: activeCatalog,
  one_call_active_policy: oneCallPolicyActive,
  control_global_activation: controlGlobalActivation,   // epoch 2, enabled=true, killed=false
  control_project_activation: controlProjectActivation, // epoch 2, enabled=true, killed=false
  control_global_restoration: controlGlobalRestoration, // epoch 3, enabled=false, killed=false
  control_project_restoration: controlProjectRestoration, // epoch 3, enabled=false, killed=false
  one_call_policy_restored: oneCallPolicyRestored,      // status inactive (restoration)
  inactive_price_catalog_digest: EXPECT_INACTIVE_CATALOG_DIGEST, // restoration returns catalog to this
};

function main() {
  if (selfCheckFailures.length > 0) {
    process.stderr.write("FATAL: predecessor digest self-check FAILED:\n" + JSON.stringify(selfCheckFailures, null, 2) + "\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(RESULT, null, 2) + "\n");
}
if (import.meta.url === `file://${process.argv[1]}`) main();
