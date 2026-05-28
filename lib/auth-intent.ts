// ── Pending-Intent layer for sign-in-then-resume UX (v241.3) ─────────
//
// Before v241.3, every auth-gated CTA followed the same anti-pattern:
//
//   if (!user) return router.push("/auth");
//
// User loses every bit of state they filled in (dates, picker rooms,
// budget, bid form, modal selection) AND lands on the home page after
// sign-in — never back on the CTA they were trying to fire. They have
// to navigate back, refill, retap. Cost = 30+ second churn per bounce.
//
// This module centralizes the "remember what you were trying to do" +
// "go back there after sign-in" plumbing. Three surfaces:
//
//   1. redirectToSignIn(router, intent) — call at every !user guard.
//      Persists the intent to localStorage + navigates to /auth with
//      a ?return=<encoded route> query param.
//
//   2. /auth login success — reads ?return param, routes there instead
//      of the legacy router.push("/"). 3 sites updated (Firebase social
//      sync, Firebase fallback, WhatsApp/Mobile OTP verify).
//
//   3. Destination page (the one carrying the original CTA) — on mount,
//      reads `peekPendingIntent()`; if user is signed-in AND the intent
//      matches THIS route, consumes + restores state + auto-fires the
//      original handler. If user is not signed in, no-op (intent stays
//      for the next sign-in attempt).
//
// TTL: 30 min. Long enough to cover the OTP flow + any backend cold-
// start; short enough that a user who walks away doesn't come back to
// a stale auto-firing CTA.
//
// Storage: localStorage (NOT sessionStorage). Firebase popups in some
// browsers spawn a new window context — sessionStorage wouldn't survive
// the round-trip. localStorage with strict TTL is the safer choice.
//
// Future-proof contract:
//   - New auth-gated CTAs MUST go through redirectToSignIn(), never
//     router.push("/auth") directly.
//   - New destination pages MUST call consumePendingIntent() on mount
//     (after auth hydration completes) so the intent doesn't leak.

export type PendingIntent = {
  // The full destination URL (pathname + search). Used for /auth's
  // ?return param + matched against window.location on mount.
  route: string;
  // Free-form action label — "bid_launch" / "book_now" / "negotiate" /
  // "simple_bid" / "counter_accept" / "pay_now" / "flash_book". Lets
  // the destination page decide which handler to auto-fire.
  action?: string;
  // Arbitrary state the destination needs to restore the exact UI
  // (room id, modal state, picker values that don't live in URL).
  payload?: Record<string, any>;
  // Wall-clock timestamp at write time. Used for TTL check on read.
  savedAt: number;
};

const STORAGE_KEY = "sb_pending_intent";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

function safeRead(): PendingIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: PendingIntent = JSON.parse(raw);
    if (!parsed?.route || !parsed?.savedAt) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function peekPendingIntent(): PendingIntent | null {
  return safeRead();
}

export function consumePendingIntent(): PendingIntent | null {
  const intent = safeRead();
  if (intent && typeof window !== "undefined") {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return intent;
}

export function clearPendingIntent() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Save the pending intent and redirect to /auth.
 *
 * The router argument is intentionally untyped — every caller already
 * imports Next.js router; keeping this dependency-light avoids forcing
 * the lib to import next/navigation.
 *
 * @param router  Next.js router instance (from useRouter()).
 * @param intent  { route, action?, payload? }. `route` should be the
 *                full pathname + search of the page the user is on.
 */
export function redirectToSignIn(
  router: { push: (path: string) => void },
  intent: Omit<PendingIntent, "savedAt">,
): void {
  if (typeof window !== "undefined") {
    try {
      const toStore: PendingIntent = { ...intent, savedAt: Date.now() };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch { /* localStorage full / disabled — fall through */ }
  }
  const ret = encodeURIComponent(intent.route || "/");
  router.push(`/auth?return=${ret}`);
}

/**
 * Helper for destination pages: returns the intent ONLY if its `route`
 * matches the current location (pathname). Prevents an intent saved
 * from /hotels/123 from auto-firing on /hotels/456 by mistake.
 *
 * Pages should call this in a mount useEffect after auth hydration.
 *
 * @param expectedAction  Optional action filter — if set, only returns
 *                        the intent if its `action` matches.
 */
export function consumeMatchingIntent(expectedAction?: string): PendingIntent | null {
  if (typeof window === "undefined") return null;
  const intent = peekPendingIntent();
  if (!intent) return null;
  // Match on pathname only — query strings drift (e.g. timestamp params).
  try {
    const intentPath = new URL(intent.route, window.location.origin).pathname;
    if (intentPath !== window.location.pathname) return null;
  } catch {
    return null;
  }
  if (expectedAction && intent.action !== expectedAction) return null;
  return consumePendingIntent();
}
