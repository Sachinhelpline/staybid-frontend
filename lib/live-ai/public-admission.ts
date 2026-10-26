// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — G-PUBLIC — server-only PUBLIC CUSTOMER admission for the customer broker.
//
// PURE + injectable (no I/O of its own), used by POST /api/live-ai/session ONLY when the dedicated public
// admission gate LIVE_AI_PUBLIC_ADMISSION_ENABLED is exactly "1". It:
//   1. requires the dedicated subject-derivation secret LIVE_AI_PUBLIC_SUBJECT_HMAC_SECRET (never the JWT /
//      signing / staging secrets) — absent ⇒ 503 (fail closed);
//   2. obtains the customer ONLY through the injected STRICT verified-customer gate (the accepted
//      resolveVerifiedMediaCustomer: HS256 JWT_ACCESS_SECRET signature, mandatory `sub`, `id===sub`, admin
//      roles rejected, a FRESH backend account lookup refusing missing/blocked/admin rows) — no verified
//      customer ⇒ 401 `sign_in_required`; there is NO anonymous fallback while the public gate is on;
//   3. derives a STABLE OPAQUE subject `pub1.<64 hex>` = HMAC-SHA256(secret, DOMAIN ‖ US ‖ customerId) — the
//      raw customer id, phone or email NEVER reaches the gateway or the provider.
// The caller then mints the ONE-USE ~60 s `auth:true` assertion for exactly that subject. The gateway admits
// it only under its own separate gate + exact subject-shape check (config.liveAi03bPublicSessionAllowed).
// No secret VALUE appears here — the secret arrives as an argument.
// ─────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";

export const PUBLIC_SUBJECT_DOMAIN = "staybid-live-ai-public-customer-v1" as const;
export const PUBLIC_SUBJECT_PREFIX = "pub1." as const;
const US = "\u001f"; // unit separator — unambiguous canonical encoding
export const PUBLIC_SUBJECT_SHAPE = /^pub1\.[0-9a-f]{64}$/;

/** Derive the stable opaque public subject for a VERIFIED customer id, or null (fail closed). */
export function derivePublicSubject(customerId: unknown, hmacSecret: unknown): string | null {
  if (typeof customerId !== "string" || customerId.length === 0 || customerId.length > 256) return null;
  if (customerId.indexOf(US) !== -1) return null;
  if (typeof hmacSecret !== "string" || hmacSecret.length < 16) return null;
  return PUBLIC_SUBJECT_PREFIX + createHmac("sha256", hmacSecret).update(PUBLIC_SUBJECT_DOMAIN + US + customerId).digest("hex");
}

export interface PublicAdmissionEnv { [k: string]: string | undefined }

/** G-GATE — the server public-admission gate (exact "1"). */
export function publicAdmissionEnabled(env: PublicAdmissionEnv): boolean {
  return env.LIVE_AI_PUBLIC_ADMISSION_ENABLED === "1";
}

export interface VerifiedPublicCustomer { readonly id: string }
export interface PublicAdmissionDeps {
  readonly env: PublicAdmissionEnv;
  /** the bound STRICT verified-customer gate (resolveVerifiedMediaCustomer(req, authority)). */
  readonly verifyCustomer: () => Promise<VerifiedPublicCustomer | null>;
}
export type PublicAdmissionDecision =
  | { readonly ok: true; readonly subject: string }
  | { readonly ok: false; readonly status: number; readonly error: "public_admission_unconfigured" | "sign_in_required" };

/** The composed, fail-closed public admission decision (call ONLY when publicAdmissionEnabled(env)). */
export async function decidePublicAdmission(deps: PublicAdmissionDeps): Promise<PublicAdmissionDecision> {
  const secret = deps.env.LIVE_AI_PUBLIC_SUBJECT_HMAC_SECRET;
  if (typeof secret !== "string" || secret.trim().length < 16) return { ok: false, status: 503, error: "public_admission_unconfigured" };
  let customer: VerifiedPublicCustomer | null;
  try { customer = await deps.verifyCustomer(); } catch { customer = null; }
  if (!customer || typeof customer.id !== "string" || customer.id.length === 0) return { ok: false, status: 401, error: "sign_in_required" };
  const subject = derivePublicSubject(customer.id, secret);
  if (!subject) return { ok: false, status: 401, error: "sign_in_required" };
  return { ok: true, subject };
}
