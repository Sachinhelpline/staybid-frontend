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
// FAIL CLOSED — on any exchange failure it THROWS and never:
//   • uses a decode-only Firebase token as ownership authority,
//   • falls back to the legacy / public media writer,
//   • adds a JWT_SECRET / x-email / x-phone trust path.
// Admin/super_admin rejection is unchanged: it lives in the strict media
// authority (resolveVerifiedMediaCustomer), which rejects an admin token even
// if the exchange minted one — this helper is identity-agnostic and never
// elevates a session (the token reflects the backend-verified identity).
// ═══════════════════════════════════════════════════════════════════════════

export type SessionUpgradeCode = "needs_reauth" | "exchange_failed";

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

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

// Module-level single-flight: concurrent picker + upload callers share ONE
// exchange, so there is no double-exchange, no localStorage corruption, and no
// retry/exchange loop. Reset after settle; each user action is one discrete
// attempt (a failure throws to the caller, it does not auto-retry here).
let inFlight: Promise<string> | null = null;

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

  // Atomically promote the session to a backend-verified token.
  try {
    localStorage.setItem("sb_token", backendToken);
    if (data.user !== undefined && data.user !== null) {
      localStorage.setItem("sb_user", JSON.stringify(data.user));
    }
    localStorage.setItem("sb_token_type", "backend");
  } catch {
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
 * (single-flight); no session at all throws `needs_reauth`. Throws
 * `SessionUpgradeError` (fail closed) on any exchange failure.
 */
export async function ensureBackendSessionToken(): Promise<string> {
  const token = readLocal("sb_token");
  if (!token) throw new SessionUpgradeError("needs_reauth", REAUTH_MSG);

  const type = readLocal("sb_token_type");
  // "backend" (or any non-firebase/legacy default) already satisfies the strict
  // media authority — no unnecessary exchange.
  if (type !== "firebase") return token;

  if (!inFlight) {
    inFlight = exchangeFirebaseForBackend(token).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
