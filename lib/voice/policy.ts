// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — the POLICY GATE.
//
// Every capability call passes through evaluatePolicy() BEFORE any request is
// built or dispatched. It enforces, fail-closed:
//   • the capability name is in the static registry allowlist
//   • getHotelDetails / detail access targets an ALLOWLISTED hotel id only
//   • inputs re-validate (bounded/canonical)
//
// A denied decision carries a stable machine reason code (never free text from
// the model). Pure module: no I/O, no React, no next/*, no @/lib imports.
// ─────────────────────────────────────────────────────────────────────────
import { type CapabilityName, isCapabilityName, isValidHotelId } from "./contracts";
import { isAllowedCapability } from "./registry";
import { type VoiceSession } from "./session";

export type PolicyDenyReason =
  | "unknown_capability"
  | "capability_not_allowlisted"
  | "hotel_id_invalid"
  | "hotel_id_not_allowlisted"
  | "compare_too_many"
  | "compare_empty"
  | "malformed_input";

export type PolicyDecision =
  | { ok: true; capability: CapabilityName }
  | { ok: false; reason: PolicyDenyReason };

export interface PolicyRequest {
  capability: unknown;
  input?: Record<string, unknown>;
}

const MAX_COMPARE = 3;

export function evaluatePolicy(req: PolicyRequest, session: VoiceSession): PolicyDecision {
  const name = req.capability;
  if (!isCapabilityName(name)) return { ok: false, reason: "unknown_capability" };
  if (!isAllowedCapability(name)) return { ok: false, reason: "capability_not_allowlisted" };

  const input = req.input && typeof req.input === "object" ? req.input : {};

  if (name === "getHotelDetails") {
    if (!isValidHotelId(input.id)) return { ok: false, reason: "hotel_id_invalid" };
    if (!session.hasHotelId(input.id)) return { ok: false, reason: "hotel_id_not_allowlisted" };
  }

  if (name === "compareHotels") {
    const ids = input.hotelIds;
    if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: "compare_empty" };
    if (ids.length > MAX_COMPARE) return { ok: false, reason: "compare_too_many" };
    for (const id of ids) {
      if (!isValidHotelId(id)) return { ok: false, reason: "hotel_id_invalid" };
      if (!session.hasHotelId(id)) return { ok: false, reason: "hotel_id_not_allowlisted" };
    }
  }

  return { ok: true, capability: name };
}
