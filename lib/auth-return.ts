// ─────────────────────────────────────────────────────────────────────────
// Post-sign-in return-route safety (v622 — Google admin auth hotfix).
//
// /auth reads a ?return= query (or a stored sign-in intent) and navigates
// there after login. Two hard rules live here so they are unit-testable:
//
//   • safeReturnRoute() — the return target must be a same-origin RELATIVE
//     path. External URLs, protocol-relative //host, backslash and
//     encoded-slash tricks, schemes (javascript:, data:, https:), embedded
//     whitespace/control chars, and absurd lengths all collapse to "/".
//     This closes the open-redirect on the ?return= param.
//
//   • isAdminIntentRoute() — whether a (already-sanitized) return route is
//     an admin destination. When it is, the sign-in flow must FAIL CLOSED
//     if the backend token exchange fails: never store the Firebase RS256
//     token as sb_token, never create sb_admin_token, show an error and
//     remain signed out of admin. (A Firebase token can never pass
//     /api/admin/check-role, so silently continuing would strand the admin
//     in a confusing half-session — and any widening of the fallback would
//     become an admin bypass.)
// ─────────────────────────────────────────────────────────────────────────

const MAX_RETURN_LEN = 512;

export function safeReturnRoute(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const v = raw.trim();
  if (!v || v.length > MAX_RETURN_LEN) return "/";
  // Must be a rooted relative path: exactly one leading slash.
  if (!v.startsWith("/")) return "/";
  if (v.startsWith("//")) return "/"; // protocol-relative → external
  if (v.includes("\\")) return "/"; // backslash tricks (/\evil.com)
  // Any scheme marker or credentials separator is not a relative path.
  if (v.includes(":")) return "/";
  // Encoded slash/backslash can decode into a new authority downstream.
  if (/%2f|%5c/i.test(v)) return "/";
  // Whitespace / control characters never belong in an app route.
  if (/[\s\u0000-\u001f\u007f]/.test(v)) return "/";
  return v;
}

// True when the sanitized route lands anywhere in the admin panel
// (including /admin/login itself, the normal admin sign-in return target).
export function isAdminIntentRoute(route: string): boolean {
  if (typeof route !== "string") return false;
  return (
    route === "/admin" ||
    route.startsWith("/admin/") ||
    route.startsWith("/admin?") ||
    route.startsWith("/admin#")
  );
}

// The user-facing message when an admin-intent sign-in cannot complete the
// verified backend exchange. Deliberately non-sensitive. It does NOT claim
// "no session exists" — a prior CUSTOMER session may still be present and is
// deliberately preserved; only the ADMIN session is refused.
export const ADMIN_EXCHANGE_FAILED_MSG =
  "Admin sign-in could not be verified with the StayBid server, so no admin session was created. Please try again in a moment.";

// v622 — Admin-session key names. Kept SEPARATE from the customer session
// (sb_token / sb_user / sb_token_type), which this module never touches.
export const ADMIN_SESSION_KEYS = ["sb_admin_token", "sb_admin_user"] as const;

// Clear ONLY the admin-session keys after a failed admin-intent exchange, so
// no stale admin session can survive. The customer session keys are
// deliberately left UNTOUCHED — a failed admin sign-in must not log a
// customer out of their existing session. Storage is injected for testing.
export function clearAdminSessionKeys(storage?: {
  removeItem: (k: string) => void;
}): void {
  const s =
    storage ??
    (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return;
  for (const k of ADMIN_SESSION_KEYS) {
    try { s.removeItem(k); } catch {}
  }
}
