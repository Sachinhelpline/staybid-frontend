// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — PRODUCT-02 — founder-only REAL AI TEXT eligibility (server-only).
//
// Decides whether the CURRENT verified admin may see the founder TEXT opt-in. It reuses
// the EXISTING staging authority chain unchanged (lib/live-ai/staging-authority.ts:
// Bearer-only admin transport → requireVerifiedAdmin → HMAC-derived opaque subject →
// exact single-operator match) and the same broker config/origin contract the staging
// session route enforces. It NEVER mints an assertion, contacts the gateway, reads a
// provider key, or writes anything. Fail closed on every missing input.
//
// Dedicated server gate: LIVE_AI_FOUNDER_TEXT_ENABLED === "1" (default OFF). This is
// distinct from the 03B staging broker gate and from every NEXT_PUBLIC_* flag.
// No secret VALUE appears in this file — env NAMES only.
// ─────────────────────────────────────────────────────────────────────────
import { isSameOrigin, validateGatewayHttpsOrigin } from "./broker";
import {
  decideStagingSession,
  extractStagingAdminBearer,
  resolveStagingOperatorSubject,
  type VerifiedAdminIdentity,
} from "./staging-authority";

export interface FounderEligibilityInput {
  readonly env: Record<string, string | undefined>;
  readonly origin: string | null;
  readonly secFetchSite: string | null;
  readonly authorization: string | null;
  readonly xAdminToken: string | null;
  readonly verifyAdmin: () => Promise<VerifiedAdminIdentity | null>;
}
export interface FounderEligibilityOutcome {
  readonly status: number;
  readonly body: { eligible: boolean; mode?: "text"; error?: string };
}

function nonEmpty(v: string | undefined): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
function firstOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.trim();
    if (!t) continue;
    try { const u = new URL(t); if (u.protocol === "https:" || u.protocol === "http:") return `${u.protocol}//${u.host}`; } catch { /* skip */ }
  }
  return null;
}
const deny = (status: number, error: string): FounderEligibilityOutcome => ({ status, body: { eligible: false, error } });

export async function decideFounderTextEligibility(i: FounderEligibilityInput): Promise<FounderEligibilityOutcome> {
  const env = i.env;
  // 1) dedicated founder gate (default OFF) + the existing staging broker gate.
  if (env.LIVE_AI_FOUNDER_TEXT_ENABLED !== "1") return deny(503, "founder_text_disabled");
  if (env.LIVE_AI_03B_STAGING_BROKER_ENABLED !== "1") return deny(503, "staging_broker_disabled");
  // 2) the same config the staging session route needs (presence only; values never read out).
  const operatorSubject = resolveStagingOperatorSubject(env.LIVE_AI_03B_STAGING_OPERATOR_SUBJECT);
  const derivationSecret = nonEmpty(env.LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET);
  const canonicalOrigin = firstOrigin(env.LIVE_AI_ALLOWED_ORIGINS);
  if (!nonEmpty(env.LIVE_AI_SESSION_SIGNING_PRIVATE_KEY) || !nonEmpty(env.LIVE_AI_SESSION_ISSUER)
      || !nonEmpty(env.LIVE_AI_SESSION_AUDIENCE) || !canonicalOrigin
      || !validateGatewayHttpsOrigin(nonEmpty(env.LIVE_AI_GATEWAY_URL))) {
    return deny(503, "unconfigured");
  }
  // 3) same-origin contract.
  if (!isSameOrigin(i.origin, i.secFetchSite, canonicalOrigin)) return deny(403, "origin_not_allowed");
  // 4) the unchanged composed staging authority decision.
  const decision = await decideStagingSession({
    brokerConfig: { brokerEnabled: true, operatorSubject, hmacSecretPresent: !!derivationSecret },
    derivationSecret,
    transport: extractStagingAdminBearer({ authorization: i.authorization, xAdminToken: i.xAdminToken }),
    verifyAdmin: i.verifyAdmin,
  });
  if (!decision.ok) return deny(decision.status, decision.error);
  return { status: 200, body: { eligible: true, mode: "text" } };
}
