"use client";

// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B — canonical CUSTOMER session upgrade (client-side, shared).
//
// A legitimate normal customer can be in the SUPPORTED Firebase-fallback session:
// when the verified backend exchange is unavailable at login, app/auth/page.tsx
// stores the Firebase idToken as `sb_token` with `sb_token_type = "firebase"`.
// The strict HS256 media authority (Verified Guest picker + secure media writer)
// requires a backend-verified token, so a Firebase-fallback customer would 401.
//
// This upgrades the session IN PLACE through the EXISTING canonical same-origin
// exchange (POST /api/proxy/api/auth/social-login { idToken }) and hands the
// backend token back so the CURRENT request uses it — not only future requests.
// ONE shared helper backs BOTH the picker and the writer so they cannot drift.
//
// SESSION-INTEGRITY (the exchange is an async gap in which the browser session
// can change under us — logout, or a different account signing in):
//   • Every in-flight exchange is BOUND to the exact originating Firebase token.
//   • The single-flight is SESSION-AWARE (keyed by that token): a different
//     token / user can NEVER join another session's exchange.
//   • Immediately before committing the returned backend credentials, the CURRENT
//     session is re-read and must STILL be that exact originating Firebase session
//     (sb_token === the originating token AND sb_token_type === "firebase").
//     If it changed / disappeared / was replaced, we ABORT and write NOTHING —
//     never resurrect the old session, never overwrite the new one.
//
// FAIL CLOSED — on any exchange failure it THROWS and never:
//   • uses a decode-only Firebase token as ownership authority,
//   • falls back to the legacy / public media writer,
//   • adds a JWT_SECRET / x-email / x-phone trust path.
// Admin/super_admin rejection is unchanged: it lives in the strict media
// authority (resolveVerifiedMediaCustomer), which rejects an admin token even
// if the exchange minted one — this helper is identity-agnostic and never
// elevates a session (the token reflects the backend-verified identity).
// ═══════════════════════════════════════════════════════════════════════════

export type SessionUpgradeCode = "needs_reauth" | "exchange_failed" | "session_changed";

export class SessionUpgradeError extends Error {
  code: SessionUpgradeCode;
  constructor(code: SessionUpgradeCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SessionUpgradeError";
  }
}

const REAUTH_MSG =
  "Please sign in again to continue — your session needs to be refreshed.";
const EXCHANGE_MSG =
  "Your session needs a refresh. Please sign out and sign in again to continue.";
const SESSION_CHANGED_MSG =
  "Your session changed while signing in — please try that again.";

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

// Session-aware single-flight: keyed by the ORIGINATING Firebase token, so
// concurrent callers for the SAME session share ONE exchange while a DIFFERENT
// token / user can never join it. Entries are cleared on settle (bounded to the
// tokens currently mid-exchange); a failure throws to the caller and does not
// auto-retry here, so there is no retry/exchange loop.
const inFlight = new Map<string, Promise<string>>();

async function exchangeFirebaseForBackend(firebaseToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/proxy/api/auth/social-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ idToken: firebaseToken }),
    });
  } catch {
    throw new SessionUpgradeError("exchange_failed", EXCHANGE_MSG);
  }
  // Forged / invalid / expired Firebase token → backend rejects (non-2xx) →
  // NO backend session is written.
  if (!res.ok) throw new SessionUpgradeError("exchange_failed", EXCHANGE_MSG);

  const data = await res.json().catch(() => null);
  const backendToken =
    data && typeof data.token === "string" ? data.token.trim() : "";
  if (!backendToken) throw new SessionUpgradeError("exchange_failed", EXCHANGE_MSG);
  // Defensive: the exchange must return a DISTINCT backend token, never echo the
  // Firebase token back (which would leave a decode-only token tagged "backend").
  if (backendToken === firebaseToken) {
    throw new SessionUpgradeError("exchange_failed", EXCHANGE_MSG);
  }

  // ── SESSION RE-BIND (guards the async gap) ────────────────────────────────
  // Only commit if the CURRENT session is STILL the exact originating Firebase
  // session. If the user logged out, or another account replaced the session
  // while the exchange was in flight, abort WITHOUT writing — never resurrect
  // the old session and never overwrite the new/current one. This check and the
  // writes below are one SYNCHRONOUS block (no await between), so no other JS
  // can change localStorage between the check and the commit.
  if (readLocal("sb_token") !== firebaseToken || readLocal("sb_token_type") !== "firebase") {
    throw new SessionUpgradeError("session_changed", SESSION_CHANGED_MSG);
  }
  try {
    localStorage.setItem("sb_token", backendToken);
    if (data.user !== undefined && data.user !== null) {
      localStorage.setItem("sb_user", JSON.stringify(data.user));
    }
    localStorage.setItem("sb_token_type", "backend");
  } catch {
    // A partial write can only touch the ORIGINATING user's own session (we just
    // re-bound to it synchronously) — never a different user's — and any
    // inconsistent state fails closed at the strict media authority on next use.
    throw new SessionUpgradeError("exchange_failed", EXCHANGE_MSG);
  }
  // Let the auth/tier providers re-probe on the upgraded session.
  try {
    window.dispatchEvent(new Event("sb:tier-refresh"));
  } catch {
    /* non-DOM context — ignore */
  }
  return backendToken;
}

/**
 * Ensure the current customer session carries a backend-verified token and
 * return that token (for the CURRENT request). Backend sessions pass straight
 * through with NO exchange; a Firebase-fallback session is upgraded once
 * (session-aware single-flight, bound to the originating token); no session at
 * all throws `needs_reauth`. Throws `SessionUpgradeError` (fail closed) on any
 * exchange failure or if the session changed mid-exchange (`session_changed`).
 */
export async function ensureBackendSessionToken(): Promise<string> {
  const token = readLocal("sb_token");
  if (!token) throw new SessionUpgradeError("needs_reauth", REAUTH_MSG);

  const type = readLocal("sb_token_type");
  // "backend" (or any non-firebase/legacy default) already satisfies the strict
  // media authority — no unnecessary exchange.
  if (type !== "firebase") return token;

  // Session-aware single-flight keyed by THIS Firebase token. A concurrent call
  // for the SAME session joins the one exchange; a DIFFERENT token never joins
  // (it starts its own, bound to its own token).
  const existing = inFlight.get(token);
  if (existing) return existing;

  const p = exchangeFirebaseForBackend(token).finally(() => {
    if (inFlight.get(token) === p) inFlight.delete(token);
  });
  inFlight.set(token, p);
  return p;
}
