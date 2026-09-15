// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — INTELLIGENCE-CONTRACT-01 — the EXACT-SIX capability
// registry. PURE DATA + one delegating validator function.
//
// EXACTLY six capabilities exist in Customer V1, with IDs IDENTICAL to the
// accepted R5A operation names. Argument authority is DELEGATED to the ONE
// accepted validator (live-ai-schemas validateModelOperation) — this module
// NEVER forks a looser (or different) argument rule. Descriptors are PURE
// FROZEN DATA (no callbacks / function pointers travel through the
// registry); unknown / legacy / retired / extra capability ids FAIL CLOSED.
// Confirmation class is NONE for ALL six (READ + UI_LOCAL only — nothing
// here is transactional; booking/bid/payment/messaging writes DO NOT EXIST
// in this registry and cannot be added without a new owner-approved packet).
// ─────────────────────────────────────────────────────────────────────────

import { validateModelOperation } from "./live-ai-schemas";
import type { OperationName } from "./live-ai-schemas";
import { INTELLIGENCE_CONTRACT_VERSION } from "./live-ai-intelligence-contract";
import type { RetryDisposition } from "./live-ai-intelligence-contract";

export type CapabilityAuthorityClass = "READ" | "UI_LOCAL";
export type CapabilityContextEffect = "NONE" | "ADVANCES_CONTEXT" | "ADVANCES_ROUTE";
export type CapabilityEvidenceType = "results" | "comparison" | "detail" | "ui_state" | "navigation";

export interface CapabilityDescriptor {
  readonly capabilityId: OperationName;
  readonly contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  readonly requiredPageId: "hotels" | "hotel-detail";
  readonly allowedRoles: readonly ("anonymous" | "customer")[];
  readonly authorityClass: CapabilityAuthorityClass;
  /** Whether the capability's ACCEPTED semantics advance the bound context /
   *  route. Any non-"NONE" effect forces a MANDATORY rebind + replan before
   *  further capability steps (stale continuations become inert). SHOW is
   *  conservatively ADVANCES_CONTEXT: under the accepted fingerprint
   *  semantics its section change advances contextRevision — encoding it
   *  weaker would let a stale continuation run under a superseded context. */
  readonly contextEffect: CapabilityContextEffect;
  readonly evidenceType: CapabilityEvidenceType;
  /** NONE for all six — READ + UI_LOCAL never require a confirmation UI. */
  readonly confirmationClass: "NONE";
  readonly retryDisposition: RetryDisposition;
  /** ALWAYS true: only a trusted TERMINAL observation completes the step —
   *  accepted/acted is NEVER completion (security-critical invariant). */
  readonly requiresTerminalVerification: true;
}

const ROLES_ALL = Object.freeze(["anonymous", "customer"] as const);

function descriptor(d: CapabilityDescriptor): CapabilityDescriptor {
  return Object.freeze(d);
}

// The EXACT six — accepted R5A names, accepted page/authority semantics.
const DESCRIPTORS: readonly CapabilityDescriptor[] = Object.freeze([
  descriptor({
    capabilityId: "APPLY_HOTEL_REFINEMENT",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    requiredPageId: "hotels",
    allowedRoles: ROLES_ALL,
    authorityClass: "UI_LOCAL",
    contextEffect: "ADVANCES_CONTEXT",
    evidenceType: "results",
    confirmationClass: "NONE",
    retryDisposition: "USER_REQUIRED",
    requiresTerminalVerification: true,
  }),
  descriptor({
    capabilityId: "READ_CURRENT_RESULTS",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    requiredPageId: "hotels",
    allowedRoles: ROLES_ALL,
    authorityClass: "READ",
    contextEffect: "NONE",
    evidenceType: "results",
    confirmationClass: "NONE",
    retryDisposition: "SAFE_SAME_AUTHORITY",
    requiresTerminalVerification: true,
  }),
  descriptor({
    capabilityId: "COMPARE_VISIBLE_HOTELS",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    requiredPageId: "hotels",
    allowedRoles: ROLES_ALL,
    authorityClass: "READ",
    contextEffect: "NONE",
    evidenceType: "comparison",
    confirmationClass: "NONE",
    retryDisposition: "SAFE_SAME_AUTHORITY",
    requiresTerminalVerification: true,
  }),
  descriptor({
    capabilityId: "OPEN_VISIBLE_HOTEL",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    requiredPageId: "hotels",
    allowedRoles: ROLES_ALL,
    authorityClass: "UI_LOCAL",
    contextEffect: "ADVANCES_ROUTE",     // one CURRENT VISIBLE ordinal; route advances
    evidenceType: "navigation",
    confirmationClass: "NONE",
    retryDisposition: "NEVER",
    requiresTerminalVerification: true,
  }),
  descriptor({
    capabilityId: "READ_CURRENT_HOTEL_FACTS",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    requiredPageId: "hotel-detail",
    allowedRoles: ROLES_ALL,
    authorityClass: "READ",
    contextEffect: "NONE",
    evidenceType: "detail",
    confirmationClass: "NONE",
    retryDisposition: "SAFE_SAME_AUTHORITY",
    requiresTerminalVerification: true,
  }),
  descriptor({
    capabilityId: "SHOW_HOTEL_SECTION",
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    requiredPageId: "hotel-detail",
    allowedRoles: ROLES_ALL,
    authorityClass: "UI_LOCAL",
    contextEffect: "ADVANCES_CONTEXT",   // exact section vocabulary (rooms|about) via the accepted validator
    evidenceType: "ui_state",
    confirmationClass: "NONE",
    retryDisposition: "USER_REQUIRED",
    requiresTerminalVerification: true,
  }),
]);

// Null-prototype frozen lookup map — no inherited keys ("toString",
// "constructor", "__proto__" …) can ever resolve to a capability.
const REGISTRY: Readonly<Record<string, CapabilityDescriptor>> = (() => {
  const m: Record<string, CapabilityDescriptor> = Object.create(null);
  for (let i = 0; i < DESCRIPTORS.length; i++) m[DESCRIPTORS[i].capabilityId] = DESCRIPTORS[i];
  return Object.freeze(m);
})();

export const CAPABILITY_IDS: readonly OperationName[] = Object.freeze(
  DESCRIPTORS.map((d) => d.capabilityId),
);
export const CAPABILITY_COUNT = DESCRIPTORS.length; // EXACTLY six

/** Look up a capability descriptor. Unknown / legacy / retired / non-string /
 *  hostile ids FAIL CLOSED to null. There is NO registration API — the set is
 *  closed at module load and deep-frozen. */
export function getCapability(capabilityId: unknown): CapabilityDescriptor | null {
  try {
    if (typeof capabilityId !== "string") return null;
    const d = REGISTRY[capabilityId];
    return d === undefined ? null : d;
  } catch { return null; }
}

export function listCapabilities(): readonly CapabilityDescriptor[] {
  return DESCRIPTORS;
}

/** Validate a model-proposed argument object for a capability. DELEGATES
 *  ENTIRELY to the accepted R5A validator: the args object must BE the closed
 *  operation (its `op` is the discriminant) and its op must equal the declared
 *  capabilityId. Returns the FROZEN canonical accepted operation, or null.
 *  TOTAL — hostile input fails closed, never throws. */
export function validateCapabilityArgs(capabilityId: unknown, args: unknown): Record<string, unknown> | null {
  try {
    const d = getCapability(capabilityId);
    if (!d) return null;
    const op = validateModelOperation(args);
    if (!op || op.op !== d.capabilityId) return null;
    return op;
  } catch { return null; }
}

/** True when a terminal VERIFIED observation for this capability requires the
 *  loop to rebind + replan before any further capability step (its accepted
 *  semantics advance context or route). Unknown capability ⇒ true (fail
 *  closed — treat unknown as context-advancing so nothing stale continues). */
export function capabilityAdvancesContext(capabilityId: unknown): boolean {
  const d = getCapability(capabilityId);
  if (!d) return true;
  return d.contextEffect !== "NONE";
}
