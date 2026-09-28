// LIVE-AI-03B — M7 STEP 1 — the FIRST-PROBE provider REQUEST contract (offline checker; pure).
// The 03B Responses request body must carry EXACTLY the reviewed request fields, including the
// explicit Standard pin service_tier:"default". A body with no service_tier (⇒ "auto" ⇒ project
// setting, possibly Fast/Priority), or any other tier (auto/flex/priority/fast/scale/ultrafast), is
// REJECTED: its price is not the price the budget authority reserved against.
export const FIRST_PROBE_BODY_KEYS = Object.freeze(["background", "input", "max_output_tokens", "model", "reasoning", "service_tier", "store", "stream", "text", "tools", "truncation"]);
export function checkFirstProbeRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "body_absent" };
  if (!Object.prototype.hasOwnProperty.call(body, "service_tier")) return { ok: false, reason: "service_tier_missing" };
  if (body.service_tier !== "default") return { ok: false, reason: "service_tier_not_default" };
  if (Object.keys(body).sort().join(",") !== [...FIRST_PROBE_BODY_KEYS].join(",")) return { ok: false, reason: "body_keys_not_exact" };
  if (body.model !== "gpt-5.6-terra") return { ok: false, reason: "model_mismatch" };
  if (!body.reasoning || body.reasoning.effort !== "low") return { ok: false, reason: "reasoning_effort_mismatch" };
  if (body.max_output_tokens !== 2000) return { ok: false, reason: "max_output_tokens_mismatch" };
  if (body.store !== false || body.background !== false || body.stream !== false) return { ok: false, reason: "store_background_stream_not_false" };
  if (!Array.isArray(body.tools) || body.tools.length !== 0) return { ok: false, reason: "tools_not_empty" };
  if (body.truncation !== "disabled") return { ok: false, reason: "truncation_not_disabled" };
  if (!body.text || !body.text.format || body.text.format.type !== "json_schema" || body.text.format.strict !== true) return { ok: false, reason: "structured_output_mismatch" };
  return { ok: true };
}
