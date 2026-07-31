// Razorpay server credential access — ENVIRONMENT-ONLY (hotfix v621.2).
//
// Single source of truth for reading the server-side Razorpay key pair.
// Hardcoded key ids / secrets are FORBIDDEN anywhere in the tree (enforced by
// tests/security/security.test.js). Server checkout routes hand the CLIENT the
// public key id from `RAZORPAY_KEY_ID` (the id half of the pair is public by
// design — the secret NEVER leaves the server); client-only code uses
// `NEXT_PUBLIC_RAZORPAY_KEY_ID` instead (see lib/razorpay.ts). Both vars must
// point at the SAME active provider key pair for the environment (LIVE in
// production, TEST in preview/staging). When the applicable var is absent or
// malformed every caller FAILS CLOSED with `payment_config_missing` — there is
// no fallback credential.
//
// Deliberately dependency-free (no next/server import) so the security suite
// can compile and exercise it in isolation.

const RAZORPAY_KEY_ID_SHAPE = /^rzp_(live|test)_[A-Za-z0-9]{6,}$/;

/** The server-side public key id, or null when unset/malformed. */
export function razorpayKeyId(): string | null {
  const id = (process.env.RAZORPAY_KEY_ID || "").trim();
  return RAZORPAY_KEY_ID_SHAPE.test(id) ? id : null;
}

/** The server-side key secret, or null when unset. NEVER include in a response. */
export function razorpayKeySecret(): string | null {
  const secret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  return secret.length > 0 ? secret : null;
}

/** True only when a plausibly-valid key pair is present in the environment. */
export function razorpayConfigured(): boolean {
  return razorpayKeyId() !== null && razorpayKeySecret() !== null;
}

/**
 * The public checkout key id, returned ONLY when the COMPLETE pair (key id +
 * secret) is configured. A half-configured environment (id without secret, or
 * secret without id) fails closed — otherwise a checkout could mint orders
 * that can never be signature-verified.
 */
export function checkoutKeyId(): string | null {
  return razorpayConfigured() ? razorpayKeyId() : null;
}
