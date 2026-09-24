// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PRIVATE trusted-reader HOST (OFFLINE candidate). Node built-ins only.
//
// PURPOSE (custody HOLD resolution, design + offline artifact ONLY):
//   Define the SOLE permitted consumer of the live_ai_03b_reader credential — a PRIVATE
//   credential-holding host process, SEPARATE from the customer-facing gateway, the activation
//   executor, the probe, unrelated services and CORE-PROD. It holds the readerDbClient inside its
//   own trust boundary, runs ONLY the accepted SELECT-only query registry via the frozen adapter,
//   and emits ONLY a narrowly-typed, VALUE-VALIDATED, non-secret ObservationResult outward.
//
// REMEDIATION (consolidated, two WORK-reproduced leak paths):
//   Leak 1 — a raw DB-driver exception message (which can carry a connection string / secret) must
//     NEVER be forwarded outward. All outward failures now use a FINITE, fixed, non-secret code set
//     (ERROR_CODES). No e.message, no stack, no concatenated adapter reason, no echoed caller input.
//   Leak 2 — a name-only field check + generic JSON round-trip is NOT sufficient: a connection URL
//     embedded in an otherwise-permitted string field slipped through. The outward boundary is now a
//     STRICT ALLOWLIST — exact top-level + per-phase key sets, per-value type + CONTENT validation
//     (safe scalar charset that forbids ':', '/', '@', whitespace ⇒ no URL/DSN/credential), finite
//     numbers only, no functions/DB-client-shaped objects/cycles — enforced identically by observe(),
//     toGatewayMessage() and deliverToGateway(), on success AND failure paths.
//
// Preserved: the accepted fixed SELECT-only registry, private readerDbClient ownership (closure; no
// getter), the fail-closed UNPROVISIONED state, and the frozen predecessor interfaces (imports only).
// OFFLINE: opens NO connection, provisions NO credential, imports only Node built-ins + accepted
// frozen contracts; edits no accepted file; not wired into the frozen production entrypoint.
// ─────────────────────────────────────────────────────────────────────────

import { makeTrustedReadAdapter } from "../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { verifyConnectionTargetBinding, CONNECTION_IDENTITY_PROOF_CONTRACT } from "../trusted-executor-runtime-01/db-target-binding.mjs";
import { validateProvisionedAuthority } from "../trusted-runtime-live-binding-offline-01/production-authority-composition.mjs";
import { CANDIDATE_REGISTRY_DIGEST, buildReviewedStateQueries } from "../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

export const PRIVATE_HOST_ID = "live-ai-03b-private-reader-host";
export const OBSERVATIONS = Object.freeze(["dormant", "armed", "ceilings"]);
export const ALLOWED_REQUEST_KEYS = Object.freeze(["observation"]);

// The COMPLETE, finite set of outward failure codes. Every outward failure uses exactly one of these
// and carries NO other free text. A code can never contain a secret (it is a fixed literal).
export const ERROR_CODES = Object.freeze([
  "unprovisioned",
  "production_rejects_test_boundary",
  "authority_invalid",
  "target_binding_invalid",
  "target_is_core_prod",
  "adapter_init_failed",
  "request_rejected",
  "unknown_observation",
  "observation_unavailable",
  "observation_error",
  "result_boundary_violation",
  "no_result_to_deliver",
  "gateway_delivery_refused",
]);
const CODE = new Set(ERROR_CODES);

// Safe outward scalar STRING: alphanumerics + _ . - only (≤128). Deliberately forbids ':' '/' '@'
// and whitespace, so a connection URL / DSN / credential embedded in ANY permitted string field is
// rejected by CONTENT, not merely by field name. (registry digest = hex, pgService = hyphenated hex,
// phase/kind/mode/code = word-ish — all satisfy this.)
const SAFE_STR = /^[A-Za-z0-9_.\-]{1,128}$/;

// defense-in-depth field-name denylist (secondary to the exact allowlist below).
export const FORBIDDEN_RESULT_KEY_RE =
  /(client|credential|password|secret|dsn|url|connstr|connectionstring|connectiontoken|token|apikey|api_key|privatekey|private_key|readerdb|dbclient|db_client|\benv\b)/i;

// EXACT outward key allowlists.
const TOP_SUCCESS = Object.freeze(["kind", "phase", "ok", "registryDigest", "pgService", "mode", "observation"]);
const TOP_FAILURE = Object.freeze(["kind", "phase", "ok", "code", "mode"]); // phase/mode optional (omitted, not undefined)
const OBS_SCHEMA = Object.freeze({
  dormant: Object.freeze({
    dormantState: Object.freeze(["active_catalog_count", "inactive_catalog_version_count", "inactive_catalog_entry_count", "inactive_catalog_digest", "active_policy_count", "dormant_policy_present", "global_control_epoch", "project_control_epoch", "global_control_enabled", "project_control_enabled", "global_control_killed", "project_control_killed"]),
    counts: Object.freeze(["envelopes", "provider_reservations", "provider_settlements", "execution_consumptions", "decisions", "reconciliations", "scope_counters", "sessions"]),
  }),
  armed: Object.freeze({
    armedState: Object.freeze(["active_catalog_digest", "one_call_policy_digest", "control_global_digest", "control_project_digest", "global_control_epoch", "project_control_epoch", "global_control_enabled", "project_control_enabled", "global_control_killed", "project_control_killed"]),
  }),
  ceilings: Object.freeze({
    oneCallPolicy: Object.freeze(["session_money_ceiling_micros", "session_provider_calls", "session_execution_admissions", "subject_day_money_ceiling_micros", "project_day_money_ceiling_micros", "project_month_money_ceiling_micros", "global_day_money_ceiling_micros"]),
  }),
});

export const PRIVATE_HOST_CONTRACT = Object.freeze({
  id: PRIVATE_HOST_ID,
  sole_credential_consumer: "this private host process ONLY (holds readerDbClient in closure; never returned)",
  separate_from: ["customer-facing gateway (" + FIXED.ai_staging_gateway + ")", "activation executor", "probe", "unrelated services", "CORE-PROD (" + FIXED.core_excluded_postgres + ")"],
  never_egress: ["readerDbClient", "dbClient", "database URL/DSN", "credential/password/secret", "connectionToken", "raw exception text/stack", "arbitrary query capability"],
  gateway_receives_only: "a strict value-validated non-secret ObservationResult (assertOutwardMessage)",
  outward_error_codes: ERROR_CODES,
  approved_registry_digest: CANDIDATE_REGISTRY_DIGEST,
  ai_staging_pg_service: FIXED.ai_staging_postgres,
  offline: true,
});

// Fail-closed default: nothing is provisioned in this repository state.
export const UNPROVISIONED = Object.freeze({ available: false, code: "unprovisioned" });

function isSafeScalar(v) {
  const t = typeof v;
  if (t === "boolean") return true;
  if (t === "number") return Number.isFinite(v);
  if (t === "string") return SAFE_STR.test(v);
  return false; // null/undefined/object/function/symbol/bigint are never a permitted outward scalar
}

/**
 * STRICT outward-message boundary. A value may cross to a downstream consumer (gateway) ONLY if it is
 * a plain object matching the exact allowlisted shape with validated value types AND content:
 *  - exact top-level key set (success vs failure);
 *  - failure ⇒ code ∈ ERROR_CODES and no observation;
 *  - success ⇒ registryDigest/pgService pinned, observation matches the exact per-phase key set with
 *    every leaf a SAFE scalar (finite number / boolean / SAFE_STR string) — so a URL/DSN/credential
 *    embedded in a permitted field is rejected by content;
 *  - no function, no `.query`-shaped object, no forbidden-named key, no cycle; JSON-pure.
 * Returns { ok:true } or { ok:false, code:"result_boundary_violation" } — never any secret.
 */
export function assertOutwardMessage(x) {
  const BAD = { ok: false, code: "result_boundary_violation" };
  if (!x || typeof x !== "object" || Array.isArray(x)) return BAD;
  if (x.kind !== "live-ai-03b-observation") return BAD;
  if (typeof x.ok !== "boolean") return BAD;
  const allowedTop = x.ok ? TOP_SUCCESS : TOP_FAILURE;
  for (const k of Object.keys(x)) if (!allowedTop.includes(k)) return BAD;
  if (x.phase !== undefined && !OBSERVATIONS.includes(x.phase)) return BAD;
  if (x.mode !== undefined && x.mode !== "production" && x.mode !== "test") return BAD;
  // top-level scalar strings must be safe.
  for (const k of ["kind", "phase", "registryDigest", "pgService", "mode", "code"]) {
    if (x[k] !== undefined && typeof x[k] === "string" && !SAFE_STR.test(x[k])) return BAD;
  }

  if (x.ok === false) {
    if (!CODE.has(x.code)) return BAD;               // finite fixed code ONLY
    return jsonPure(x) ? { ok: true } : BAD;
  }

  // success path
  if (!OBSERVATIONS.includes(x.phase)) return BAD;
  if (x.registryDigest !== CANDIDATE_REGISTRY_DIGEST) return BAD;
  if (x.pgService !== FIXED.ai_staging_postgres) return BAD;
  const obs = x.observation;
  if (!obs || typeof obs !== "object" || Array.isArray(obs)) return BAD;
  const schema = OBS_SCHEMA[x.phase];
  const groups = Object.keys(schema);
  const obsKeys = Object.keys(obs);
  if (obsKeys.length !== groups.length || !groups.every((g) => obsKeys.includes(g))) return BAD;
  for (const g of groups) {
    const sub = obs[g];
    if (!sub || typeof sub !== "object" || Array.isArray(sub)) return BAD;
    const want = schema[g];
    const have = Object.keys(sub);
    if (have.length !== want.length || !want.every((k) => have.includes(k))) return BAD;
    for (const k of want) {
      if (FORBIDDEN_RESULT_KEY_RE.test(k)) return BAD;
      if (!isSafeScalar(sub[k])) return BAD;         // value type + content validated
    }
  }
  return jsonPure(x) ? { ok: true } : BAD;
}
function jsonPure(x) {
  let round;
  try { round = JSON.parse(JSON.stringify(x)); } catch { return false; }
  return JSON.stringify(round) === JSON.stringify(x);
}
// name-compat alias (the strict replacement for the former name-only guard).
export const assertNonSecretResult = assertOutwardMessage;

function failMsg(code, phase, mode) {
  const m = { kind: "live-ai-03b-observation", ok: false, code: CODE.has(code) ? code : "result_boundary_violation" };
  if (phase !== undefined) m.phase = phase;
  if (mode !== undefined) m.mode = mode;
  return m;
}
function successMsg(phase, observation, mode) {
  return { kind: "live-ai-03b-observation", phase, ok: true, registryDigest: CANDIDATE_REGISTRY_DIGEST, pgService: FIXED.ai_staging_postgres, mode, observation };
}
// Every outward value passes through emit(): the message is validated; if it is not a clean allowlisted
// message, a fixed non-secret failure code is emitted instead (never the offending content).
function emit(msg) {
  if (assertOutwardMessage(msg).ok) return msg;
  return failMsg("result_boundary_violation", (msg && OBSERVATIONS.includes(msg.phase)) ? msg.phase : undefined, (msg && (msg.mode === "production" || msg.mode === "test")) ? msg.mode : undefined);
}

function buildHost({ adapter, mode }) {
  async function observe(request) {
    const req = request && typeof request === "object" ? request : {};
    for (const k of Object.keys(req)) if (!ALLOWED_REQUEST_KEYS.includes(k)) return emit(failMsg("request_rejected", undefined, mode)); // no echoed key name
    const obs = req.observation;
    if (!OBSERVATIONS.includes(obs)) return emit(failMsg("unknown_observation", undefined, mode)); // no echoed observation value
    let res;
    try {
      if (obs === "dormant") res = await adapter.observeDormant();
      else if (obs === "armed") res = await adapter.observeArmed();
      else res = await adapter.observeCeilings();
    } catch { return emit(failMsg("observation_error", obs, mode)); } // NEVER forward e.message / stack
    if (!res || res.ok !== true) return emit(failMsg("observation_unavailable", obs, mode)); // no adapter reason forwarded
    let observation;
    if (obs === "dormant") observation = { dormantState: res.dormantState, counts: res.counts };
    else if (obs === "armed") observation = { armedState: res.armedState };
    else observation = { oneCallPolicy: res.oneCallPolicy };
    return emit(successMsg(obs, observation, mode)); // validated (rejects malformed/NaN/embedded-URL)
  }

  // The gateway may ONLY receive an allowlisted outward message — re-validated here.
  function toGatewayMessage(message) {
    if (!assertOutwardMessage(message).ok) return { ok: false, code: "gateway_delivery_refused" };
    return { ok: true, message };
  }

  return Object.freeze({ id: PRIVATE_HOST_ID, mode, available: true, observe, toGatewayMessage });
}

/** PRODUCTION factory — sole credential-consumption point. Fails closed (fixed codes) and is never
 *  satisfiable by real trust offline (needs a trusted connection-identity proof absent here). */
export function makePrivateReaderHost(authority, opts) {
  if (opts && opts.testBoundary === true) return { available: false, code: "production_rejects_test_boundary" };
  if (!validateProvisionedAuthority(authority).ok) return { available: false, code: "authority_invalid" };
  const tb = verifyConnectionTargetBinding({
    expectedServiceId: FIXED.ai_staging_postgres,
    expectedIssuer: authority.expectedIssuer,
    connectionToken: authority.connectionToken,
    connectionIdentityProof: authority.connectionIdentityProof,
  });
  if (!tb.ok) return { available: false, code: "target_binding_invalid" };
  if (tb.verifiedServiceId === FIXED.core_excluded_postgres) return { available: false, code: "target_is_core_prod" };
  let adapter;
  try {
    adapter = makeTrustedReadAdapter({
      dbClient: authority.readerDbClient,               // held privately in the adapter closure
      targetBinding: tb,
      reviewedStateQueries: authority.reviewedStateQueries, // content-verified by validateProvisionedAuthority
      mode: "production",
    });
  } catch { return { available: false, code: "adapter_init_failed" }; } // no e.message
  return buildHost({ adapter, mode: "production" });
}

/** OFFLINE TEST factory — explicit test boundary ONLY (never a production path). */
export function makePrivateReaderHostForTest({ dbClient, reviewedStateQueries } = {}) {
  const proof = {
    provenance: CONNECTION_IDENTITY_PROOF_CONTRACT.test_provenance,
    issuer: "TEST-ISSUER", boundConnectionToken: "TEST-TOKEN",
    serviceId: FIXED.ai_staging_postgres, projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment,
  };
  const tb = verifyConnectionTargetBinding({ expectedServiceId: FIXED.ai_staging_postgres, expectedIssuer: "TEST-ISSUER", connectionToken: "TEST-TOKEN", connectionIdentityProof: proof, testBoundary: true });
  if (!tb.ok) return { available: false, code: "target_binding_invalid" };
  const adapter = makeTrustedReadAdapter({ dbClient, targetBinding: tb, reviewedStateQueries: reviewedStateQueries || buildReviewedStateQueries(), mode: "test" });
  return buildHost({ adapter, mode: "test" });
}

/** Standalone gateway-delivery boundary — same strict allowlist; refuses anything else. */
export function deliverToGateway(candidateMessage) {
  if (!assertOutwardMessage(candidateMessage).ok) return { ok: false, code: "gateway_delivery_refused" };
  return { ok: true, delivered: candidateMessage };
}

/** Acquire the private host from the current repository state — always UNPROVISIONED (fail closed). */
export async function acquirePrivateReaderHost() { return UNPROVISIONED; }
