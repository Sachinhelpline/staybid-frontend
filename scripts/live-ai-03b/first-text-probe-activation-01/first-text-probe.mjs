// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — FIRST TEXT PROBE  (UNEXECUTED)
//
// ⚠ NOT executed by this packet. Node built-ins ONLY.
//
// The single, deterministic first text probe. It is TEXT-ONLY, ONE request, at most ONE
// provider call, no personal data, no booking / bid / payment, no voice / STT / TTS, no
// browser / tool use, no arbitrary destination / model / provider URL. It makes NO direct
// provider API call — it sends ONLY through the accepted staging broker -> gateway transport
// (an INJECTED `sendViaStagingBroker`). It REQUIRES an explicit preflight PASS receipt and
// fails closed if that receipt is absent / stale / mismatched. It NEVER retries a
// provider-bearing request and NEVER silently issues another turn. It emits ONLY bounded,
// non-secret operational evidence.
//
// This module imports NO http/https/fetch client and constructs NO provider URL: the only
// egress is the injected broker transport, so it is structurally incapable of calling the
// provider directly.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

// The EXACT probe text (do not alter — 150 UTF-8 bytes).
export const PROBE_TEXT =
  "I have not selected a destination or hotel yet. Ask me which destination I want. Do not navigate, change filters, open a hotel, or perform any action.";
export const PROBE_TEXT_SHA256 = "8efedb83900154947f749a5ca0c66546a5580593db18aa125e3d6809e311700d";

// bind the probe to the reviewed source/target so a stale receipt cannot authorize it.
export const EXPECT_PIN = Object.freeze({
  deployable_commit: "2b69ce28230fc9d56a035846e95d8de206d5db3b",
  deployable_tree: "87aad22d90f84f2c3b307201c3e0d3b8658b1619",
  gateway_service_id: "dd96c7cd-02c1-4d02-89eb-7e217930ebfa",
  postgres_service_id: "b7362594-a01b-4623-a982-394707a6cec2",
});
// a preflight receipt older than this many ms is treated as stale (fail closed).
export const RECEIPT_MAX_AGE_MS = 15000;

const RFC3339_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

function probeTextValid() {
  return createHash("sha256").update(Buffer.from(PROBE_TEXT, "utf8")).digest("hex") === PROBE_TEXT_SHA256;
}

/** Validate the injected preflight PASS receipt: present, PASS, fresh, and pinned to the
 *  reviewed source/target. Returns {ok, reason}. Never inspects/echoes any secret. */
export function validatePreflightReceipt(receipt, nowIso) {
  if (!receipt || typeof receipt !== "object") return { ok: false, reason: "receipt_absent" };
  if (receipt.pass !== true) return { ok: false, reason: "receipt_not_pass" };
  if (!RFC3339_UTC.test(String(receipt.issuedAtIso || ""))) return { ok: false, reason: "receipt_time_bad" };
  if (!RFC3339_UTC.test(String(nowIso || ""))) return { ok: false, reason: "now_bad" };
  const age = Date.parse(nowIso) - Date.parse(receipt.issuedAtIso);
  if (!(age >= 0)) return { ok: false, reason: "receipt_in_future" };
  if (age > RECEIPT_MAX_AGE_MS) return { ok: false, reason: "receipt_stale" };
  const p = receipt.pin || {};
  for (const k of Object.keys(EXPECT_PIN)) {
    if (p[k] !== EXPECT_PIN[k]) return { ok: false, reason: `receipt_pin_mismatch:${k}` };
  }
  return { ok: true };
}

// single-shot guard — this module can authorize at most ONE send for its lifetime.
let ALREADY_SENT = false;

/**
 * Send the single probe through the injected staging broker -> gateway transport.
 * deps = { preflightReceipt, nowIso, sendViaStagingBroker(payload)->Promise<outcome> }.
 * Returns bounded non-secret evidence. NEVER retries, NEVER sends a second time.
 */
export async function runProbe(deps) {
  if (!deps || typeof deps !== "object") return { ok: false, stage: "input", reason: "deps_absent", sent: false };
  if (!probeTextValid()) return { ok: false, stage: "integrity", reason: "probe_text_digest_mismatch", sent: false };
  if (ALREADY_SENT) return { ok: false, stage: "guard", reason: "probe_already_sent_no_second_turn", sent: false };

  const rc = validatePreflightReceipt(deps.preflightReceipt, deps.nowIso);
  if (!rc.ok) return { ok: false, stage: "preflight_receipt", reason: rc.reason, sent: false };

  if (typeof deps.sendViaStagingBroker !== "function") {
    return { ok: false, stage: "transport", reason: "staging_broker_transport_absent", sent: false };
  }

  // exactly ONE provider-bearing request; claim the single-shot BEFORE sending so a throw
  // can never lead to a retry.
  ALREADY_SENT = true;
  let outcome;
  try {
    outcome = await deps.sendViaStagingBroker({
      kind: "text",
      text: PROBE_TEXT,
      // explicit one-call intent; the gateway still enforces the one-call budget authority.
      oneCall: true,
    });
  } catch {
    // NO retry of a provider-bearing request. Report failure; leave close/reconcile to the
    // gateway + the postflight/abort runbook.
    return { ok: false, stage: "send", reason: "provider_bearing_send_failed_no_retry", sent: true };
  }

  // emit ONLY bounded non-secret operational evidence (never the model prose, never a secret).
  const o = outcome && typeof outcome === "object" ? outcome : {};
  return {
    ok: o.accepted === true,
    stage: "sent",
    sent: true,
    providerCalls: typeof o.providerCalls === "number" ? o.providerCalls : null,
    spendMicros: typeof o.spendMicros === "number" ? o.spendMicros : null,
    withinCeiling: typeof o.spendMicros === "number" ? o.spendMicros <= 89536 : null,
    reservationRef: typeof o.reservationRef === "string" ? o.reservationRef.slice(0, 64) : null,
    note: "bounded non-secret evidence only; provider prose is never surfaced here",
  };
}

// ── FAIL-CLOSED CLI: no injected transport/receipt here ⇒ refuse; send nothing. ──
function main() {
  process.stderr.write(
    "[live-ai-03b first-text-probe] FAIL-CLOSED: this script sends nothing on its own.\n" +
    "It requires an INJECTED staging broker->gateway transport AND a fresh preflight PASS receipt via\n" +
    "runProbe(deps). It makes NO direct provider call and constructs NO provider URL. Invoked directly it\n" +
    "sends nothing and exits non-zero (2).\n",
  );
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
