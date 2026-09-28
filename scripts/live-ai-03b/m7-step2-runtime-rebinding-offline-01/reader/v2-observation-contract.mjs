// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 private-reader OBSERVATION contract + strict outward boundary. OFFLINE.
//
// Successor of the observation schema / assertOutwardMessage in
// private-reader-host-offline-01/private-reader-host.mjs (V1, frozen: phases dormant/armed/ceilings over
// the V1 registry digest). V2 observations: pre-activation / activated / armed / ceilings / restored.
// The V2 message kind is DISTINCT ("live-ai-03b-observation-v2") so a V1 host message can never satisfy a
// V2 caller and vice versa. The finite failure-code set is the accepted one (reused, unchanged).
// Every leaf crossing the boundary is a SAFE scalar (finite number / boolean / [A-Za-z0-9_.-]{1,128}
// string) — a NULL / NaN / URL / DSN / credential in ANY field is rejected by CONTENT.
// ─────────────────────────────────────────────────────────────────────────

import { ERROR_CODES, FORBIDDEN_RESULT_KEY_RE } from "../../private-reader-host-offline-01/private-reader-host.mjs";
import { TARGETS_V2 } from "../identity/v2-identity.mjs";
import { V2_REGISTRY_DIGEST } from "../runtime/v2-query-registry.mjs";

export { ERROR_CODES };
export const MESSAGE_KIND_V2 = "live-ai-03b-observation-v2";
export const OBSERVATIONS_V2 = Object.freeze(["pre-activation", "activated", "armed", "ceilings", "restored"]);
const CODE = new Set(ERROR_CODES);
const SAFE_STR = /^[A-Za-z0-9_.\-]{1,128}$/;

const CAT = ["catalog_version_count", "catalog_entry_count", "active_catalog_count", "active_catalog_entry_count", "v1_inactive_digest", "v1_inactive_entry_count",
  "v1_expiry_is_historical", "v2_entry_count", "v2_input_rate_micros", "v2_cache_write_rate_micros", "v2_output_rate_micros"];
const POL = ["active_policy_count", "policy_version_count", "dormant_policy_present", "obsolete_v1_policy_present", "wildcard_policy_present"];
const CTL = ["control_row_count", "global_control_epoch", "project_control_epoch", "global_control_enabled", "project_control_enabled", "global_control_killed",
  "project_control_killed", "control_global_digest", "control_project_digest"];
const CNT = ["envelopes", "provider_reservations", "provider_settlements", "execution_consumptions", "decisions", "reconciliations", "scope_counters", "sessions"];
export const OBS_SCHEMA_V2 = Object.freeze({
  "pre-activation": Object.freeze({ preActivationState: Object.freeze([...CAT, "v2_inactive_digest", "v2_inactive_entry_count", ...POL, "v2_policy_present", ...CTL]), counts: Object.freeze(CNT) }),
  activated: Object.freeze({ activatedState: Object.freeze([...CAT, "v2_active_digest", "v2_active_entry_count", ...POL, "v2_policy_present", ...CTL]) }),
  armed: Object.freeze({ armedState: Object.freeze([...CAT, "v2_active_digest", "v2_active_entry_count", "one_call_policy_digest", ...POL, ...CTL]) }),
  ceilings: Object.freeze({ oneCallPolicy: Object.freeze(["session_money_ceiling_micros", "session_provider_calls", "session_execution_admissions",
    "subject_day_money_ceiling_micros", "project_day_money_ceiling_micros", "project_month_money_ceiling_micros", "global_day_money_ceiling_micros"]) }),
  restored: Object.freeze({ restoredState: Object.freeze([...CAT, "v2_inactive_digest", "v2_inactive_entry_count", "v2_policy_restored_present", ...POL, ...CTL]) }),
});
const TOP_SUCCESS = ["kind", "phase", "ok", "registryDigest", "pgService", "mode", "observation"];
const TOP_FAILURE = ["kind", "phase", "ok", "code", "mode"];

function isSafeScalar(v) {
  if (typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return SAFE_STR.test(v);
  return false;
}
function jsonPure(x) { let r; try { r = JSON.parse(JSON.stringify(x)); } catch { return false; } return JSON.stringify(r) === JSON.stringify(x); }

export function assertOutwardMessageV2(x) {
  const BAD = { ok: false, code: "result_boundary_violation" };
  if (!x || typeof x !== "object" || Array.isArray(x)) return BAD;
  if (x.kind !== MESSAGE_KIND_V2 || typeof x.ok !== "boolean") return BAD;
  for (const k of Object.keys(x)) if (!(x.ok ? TOP_SUCCESS : TOP_FAILURE).includes(k)) return BAD;
  if (x.phase !== undefined && !OBSERVATIONS_V2.includes(x.phase)) return BAD;
  if (x.mode !== undefined && x.mode !== "production" && x.mode !== "test") return BAD;
  for (const k of ["registryDigest", "pgService", "code"]) if (x[k] !== undefined && (typeof x[k] !== "string" || !SAFE_STR.test(x[k]))) return BAD;
  if (x.ok === false) return CODE.has(x.code) && jsonPure(x) ? { ok: true } : BAD;
  if (!OBSERVATIONS_V2.includes(x.phase)) return BAD;
  if (x.registryDigest !== V2_REGISTRY_DIGEST || x.pgService !== TARGETS_V2.postgres) return BAD;
  const obs = x.observation;
  if (!obs || typeof obs !== "object" || Array.isArray(obs)) return BAD;
  const schema = OBS_SCHEMA_V2[x.phase];
  const groups = Object.keys(schema);
  if (Object.keys(obs).sort().join(",") !== [...groups].sort().join(",")) return BAD;
  for (const g of groups) {
    const sub = obs[g];
    if (!sub || typeof sub !== "object" || Array.isArray(sub)) return BAD;
    if (Object.keys(sub).sort().join(",") !== [...schema[g]].sort().join(",")) return BAD;
    for (const k of schema[g]) { if (FORBIDDEN_RESULT_KEY_RE.test(k)) return BAD; if (!isSafeScalar(sub[k])) return BAD; }
  }
  return jsonPure(x) ? { ok: true } : BAD;
}

export function failMsgV2(code, phase, mode) {
  const m = { kind: MESSAGE_KIND_V2, ok: false, code: CODE.has(code) ? code : "result_boundary_violation" };
  if (phase !== undefined) m.phase = phase;
  if (mode !== undefined) m.mode = mode;
  return m;
}
export function successMsgV2(phase, observation, mode) {
  return { kind: MESSAGE_KIND_V2, phase, ok: true, registryDigest: V2_REGISTRY_DIGEST, pgService: TARGETS_V2.postgres, mode, observation };
}
/** Every outward value passes here: clean ⇒ as-is; anything else ⇒ a fixed non-secret failure code. */
export function emitV2(msg, mode) {
  if (assertOutwardMessageV2(msg).ok) return msg;
  return failMsgV2("result_boundary_violation", msg && OBSERVATIONS_V2.includes(msg.phase) ? msg.phase : undefined, mode === "production" || mode === "test" ? mode : undefined);
}
/** adapter result → the exact outward observation groups for a phase. */
export function observationFromAdapterResult(phase, res) {
  if (phase === "pre-activation") return { preActivationState: res.preActivationState, counts: res.counts };
  if (phase === "activated") return { activatedState: res.activatedState };
  if (phase === "armed") return { armedState: res.armedState };
  if (phase === "ceilings") return { oneCallPolicy: res.oneCallPolicy };
  return { restoredState: res.restoredState };
}
export function adapterCallFor(adapter, phase) {
  if (phase === "pre-activation") return adapter.observePreActivation();
  if (phase === "activated") return adapter.observeActivated();
  if (phase === "armed") return adapter.observeArmed();
  if (phase === "ceilings") return adapter.observeCeilings();
  return adapter.observeRestored();
}
