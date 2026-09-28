// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — FIRST TEXT PROBE V2 (UNEXECUTED). Node built-ins only.
//
// Successor of first-text-probe-activation-01/first-text-probe.mjs (V1, frozen: receipt pin 2b69ce,
// `spendMicros <= 89536`). SAME probe text + digest; ONE request; at most ONE provider call; NO retry;
// NO second turn; no personal data / booking / payment / voice / tools. It imports NO http/https/fetch
// client and constructs NO provider URL — the only egress is the INJECTED staging broker→gateway
// transport, so it is structurally incapable of calling the provider directly.
//
// Receipt binding (the V2 gate): the probe accepts ONLY a FirstProbePreflightReceiptV2 that
//   (a) was ISSUED in-process by runPreflightV2 (a fabricated / copied / re-serialised object — even one
//       with a correctly recomputed commitment — is refused);
//   (b) has the V2 contract, pass:true, the expected mode, a recomputed commitment;
//   (c) is fresh (≤ 15 s, not future-dated) and issued before the V2 catalog expiry;
//   (d) binds EXACTLY the V2 identity: catalog/policy/105,920 ceilings/epoch-2 controls/AI-STAGING
//       targets/probe digest/gateway source 4f390…/derivation base/a RESOLVED Step-2 runtime pin, and the
//       caller-expected approval_id + execution_id.
// A V1 receipt (`pin` shape / 2b69ce), a stale receipt, or a receipt for another target/approval fails.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { PROBE_TEXT, PROBE_TEXT_SHA256, CATALOG_V2, POLICY_V2, CONTROLS_V2, TARGETS_V2, canonicalize } from "../identity/v2-identity.mjs";
import { GATEWAY_DEPLOY_SOURCE_V2, DERIVATION_BASE, STEP2_PIN_STATUS_REQUIRED } from "../identity/v2-source-identity.mjs";
import { PREFLIGHT_RECEIPT_CONTRACT_V2, preflightReceiptCommitmentV2, isIssuedPreflightReceiptV2 } from "../runtime/v2-preflight.mjs";
import { V2_REGISTRY_DIGEST } from "../runtime/v2-query-registry.mjs";

export { PROBE_TEXT, PROBE_TEXT_SHA256 };
export const RECEIPT_MAX_AGE_MS = 15000;
export const PROBE_MONEY_CEILING_MICROS = POLICY_V2.money_ceiling_micros; // 105,920
const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
const IDRE = /^[A-Za-z0-9._:-]{8,128}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const fail = (reason) => ({ ok: false, reason });

function probeTextValid() { return createHash("sha256").update(Buffer.from(PROBE_TEXT, "utf8")).digest("hex") === PROBE_TEXT_SHA256; }

/** the fixed (non-approval) part of the identity every V2 receipt must carry, byte-for-byte. */
export function expectedFixedIdentityV2() {
  return {
    contract_version: "V2",
    catalog_version_id: CATALOG_V2.id, active_catalog_digest: CATALOG_V2.active_digest, catalog_verification_expiry: CATALOG_V2.verification_expiry,
    one_call_policy_id: POLICY_V2.id, one_call_policy_digest: POLICY_V2.active_digest, one_call_money_ceiling_micros: POLICY_V2.money_ceiling_micros,
    ceilings: { ...POLICY_V2.ceilings },
    control_epoch: CONTROLS_V2.armed_epoch, control_global_digest: CONTROLS_V2.global_activation_digest, control_project_digest: CONTROLS_V2.project_activation_digest,
    derivation_base: { commit: DERIVATION_BASE.commit, tree: DERIVATION_BASE.tree },
    gateway_source: { commit: GATEWAY_DEPLOY_SOURCE_V2.commit, tree: GATEWAY_DEPLOY_SOURCE_V2.tree, voice_gateway_tree: GATEWAY_DEPLOY_SOURCE_V2.voice_gateway_tree },
    targets: { project: TARGETS_V2.project, environment: TARGETS_V2.environment, gateway: TARGETS_V2.gateway, postgres: TARGETS_V2.postgres },
    probe_text_sha256: PROBE_TEXT_SHA256, read_registry_digest: V2_REGISTRY_DIGEST,
  };
}
const IDENTITY_KEYS = ["activation_receipt_commitment", "active_catalog_digest", "approval_id", "catalog_verification_expiry", "catalog_version_id", "ceilings",
  "consumed_at", "content_digest", "contract_version", "control_epoch", "control_global_digest", "control_project_digest", "derivation_base", "execution_id",
  "gateway_source", "one_call_money_ceiling_micros", "one_call_policy_digest", "one_call_policy_id", "probe_text_sha256", "read_registry_digest",
  "step2_runtime", "targets"];

/**
 * @param receipt the object returned by runPreflightV2().receipt
 * @param ctx { nowIso, expectedApprovalId, expectedExecutionId, expectedMode ('production' default | 'test') }
 */
export function validatePreflightReceiptV2(receipt, ctx) {
  const c = ctx || {};
  if (!receipt || typeof receipt !== "object") return fail("receipt_absent");
  if (receipt.contract !== PREFLIGHT_RECEIPT_CONTRACT_V2) return fail(receipt.pin ? "receipt_is_v1_shape_rejected" : "receipt_contract_not_v2");
  if (!isIssuedPreflightReceiptV2(receipt)) return fail("receipt_not_issued_by_v2_preflight");
  if (receipt.pass !== true) return fail("receipt_not_pass");
  const expectedMode = c.expectedMode === undefined ? "production" : c.expectedMode;
  if (receipt.mode !== expectedMode) return fail("receipt_mode_mismatch");
  if (!RFC3339_UTC.test(String(receipt.issuedAtIso || ""))) return fail("receipt_time_bad");
  if (!RFC3339_UTC.test(String(c.nowIso || ""))) return fail("now_bad");
  const age = Date.parse(c.nowIso) - Date.parse(receipt.issuedAtIso);
  if (!(age >= 0)) return fail("receipt_in_future");
  if (age > RECEIPT_MAX_AGE_MS) return fail("receipt_stale");
  if (Date.parse(c.nowIso) >= Date.parse(CATALOG_V2.verification_expiry)) return fail("catalog_v2_verification_expired");
  const id = receipt.identity;
  if (!id || typeof id !== "object" || Object.keys(id).sort().join(",") !== IDENTITY_KEYS.join(",")) return fail("receipt_identity_shape_not_exact");
  if (receipt.commitment !== preflightReceiptCommitmentV2(id, receipt.issuedAtIso, receipt.mode)) return fail("receipt_commitment_mismatch");
  const fixed = expectedFixedIdentityV2();
  for (const k of Object.keys(fixed)) if (canonicalize(id[k]) !== canonicalize(fixed[k])) return fail(`receipt_identity_mismatch:${k}`);
  if (typeof c.expectedApprovalId !== "string" || !IDRE.test(c.expectedApprovalId) || id.approval_id !== c.expectedApprovalId) return fail("receipt_for_another_approval");
  if (typeof c.expectedExecutionId !== "string" || !IDRE.test(c.expectedExecutionId) || id.execution_id !== c.expectedExecutionId) return fail("receipt_for_another_execution");
  if (!HEX64.test(String(id.activation_receipt_commitment)) || !HEX64.test(String(id.content_digest))) return fail("receipt_approval_binding_malformed");
  const s2 = id.step2_runtime;
  if (!s2 || typeof s2 !== "object" || s2.status === STEP2_PIN_STATUS_REQUIRED || !HEX40.test(String(s2.commit)) || !HEX64.test(String(s2.runtime_manifest_digest))) return fail("receipt_step2_runtime_pin_unresolved");
  return { ok: true };
}

let ALREADY_SENT = false; // module-lifetime single shot

/**
 * deps = { preflightReceipt, nowIso, expectedApprovalId, expectedExecutionId, expectedMode?, sendViaStagingBroker(payload) }.
 * Returns bounded non-secret evidence. NEVER retries, NEVER sends a second time.
 */
export async function runProbeV2(deps) {
  if (!deps || typeof deps !== "object") return { ok: false, stage: "input", reason: "deps_absent", sent: false };
  if (!probeTextValid()) return { ok: false, stage: "integrity", reason: "probe_text_digest_mismatch", sent: false };
  if (ALREADY_SENT) return { ok: false, stage: "guard", reason: "probe_already_sent_no_second_turn", sent: false };
  const rc = validatePreflightReceiptV2(deps.preflightReceipt, deps);
  if (!rc.ok) return { ok: false, stage: "preflight_receipt", reason: rc.reason, sent: false };
  if (typeof deps.sendViaStagingBroker !== "function") return { ok: false, stage: "transport", reason: "staging_broker_transport_absent", sent: false };

  ALREADY_SENT = true; // claim BEFORE sending: a throw can never lead to a retry
  let outcome;
  try { outcome = await deps.sendViaStagingBroker(Object.freeze({ kind: "text", text: PROBE_TEXT, oneCall: true })); }
  catch { return { ok: false, stage: "send", reason: "provider_bearing_send_failed_no_retry", sent: true }; }

  const o = outcome && typeof outcome === "object" ? outcome : {};
  const spend = Number.isInteger(o.spendMicros) && o.spendMicros >= 0 ? o.spendMicros : null;
  const calls = Number.isInteger(o.providerCalls) && o.providerCalls >= 0 ? o.providerCalls : null;
  const withinCeiling = spend === null ? null : spend <= PROBE_MONEY_CEILING_MICROS;
  const oneCall = calls === null ? null : calls <= 1;
  return {
    ok: o.accepted === true && withinCeiling === true && oneCall === true,
    stage: "sent", sent: true,
    providerCalls: calls, spendMicros: spend, withinCeiling, ceilingMicros: PROBE_MONEY_CEILING_MICROS,
    reason: o.accepted !== true ? "not_accepted" : withinCeiling !== true ? "spend_over_ceiling_or_unknown" : oneCall !== true ? "more_than_one_provider_call_or_unknown" : undefined,
    reservationRef: typeof o.reservationRef === "string" ? o.reservationRef.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64) : null,
    note: "bounded non-secret evidence only; provider prose is never surfaced here",
  };
}

function main() {
  process.stderr.write("[live-ai-03b V2 first-text-probe] FAIL-CLOSED: sends nothing on its own; requires an INJECTED staging broker transport AND an in-process V2 preflight receipt. Exit 2.\n");
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
