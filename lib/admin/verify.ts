// ─────────────────────────────────────────────────────────────────────────
// Admin authorization — the ONLY trusted admin gate (v622 Pass 9C).
//
// Admins sign in with Google/Gmail at /auth. Railway verifies the Firebase ID
// token and mints an HS256 access JWT (signed with JWT_ACCESS_SECRET) whose
// `sub`/compat `id` is the canonical SUPABASE `public.users.id`. The client
// stores it as sb_token and reuses it as sb_admin_token. Every protected admin
// route calls requireVerifiedAdmin(), which:
//
//   1. Verifies the Railway HS256 signature with the EXACT authoritative
//      JWT_ACCESS_SECRET — and ONLY that secret. The old JWT_SECRET compatibility
//      fallback is REMOVED: admin authorization never accepts a token signed with
//      any other secret.
//   2. Derives the subject from verified claims only (string `sub`; if a compat
//      `id` claim is present it MUST equal `sub`).
//   3. Re-reads the canonical Supabase `public.users` row FRESH (dedicated
//      server-only privileged store — never the anon-fallback @/lib/sb helpers)
//      and authorizes ONLY a current, non-blocked admin/super_admin. The token
//      `role` (and phone/email/name) are NEVER trusted.
//   4. Enforces the backend admin-token temporal contract BEFORE any Supabase
//      lookup (9C.1): `iat` + `exp` are mandatory finite numbers; future-dated
//      `iat`, `exp <= iat`, and lifetimes over 1h (+ small skew) all reject —
//      so an invalid token costs zero network calls.
//
// Fails CLOSED on: missing JWT_ACCESS_SECRET, missing/ambiguous token, verify
// error, expired/wrong-alg (e.g. Firebase RS256) token, missing/mismatched
// subject, missing Supabase config, any Supabase lookup error, missing / blocked
// / demoted / deleted / non-admin row. It never trusts x-admin-id, `adm_`
// presence, a client-supplied role, or unverified claims, and never logs token
// contents or raw verification/DB errors.
// ─────────────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";
import { adminStore, type AdminRow } from "./supabase-admin-store";

// Explicit server-only guard (v622 Pass 9C.1) — this module verifies admin
// authority against a server secret and must never execute in a browser.
if (typeof window !== "undefined") {
  throw new Error("server_only_module");
}

// Backend mints admin/super_admin tokens with a ≤1h lifetime (staybid-Live
// ADMIN_TOKEN_TTL). Every Railway token carries `iat` + `exp` (jsonwebtoken
// stamps iat; both issuers set expiresIn), so a token MISSING either claim is
// not a properly-scoped Railway admin token and is rejected — as is a
// future-dated `iat`, a non-positive lifetime (`exp <= iat`), or a lifetime
// over the 1h cap. Small skew for clock drift only.
const ADMIN_TOKEN_MAX_LIFETIME_SEC = 3600;
const ADMIN_TOKEN_CLOCK_SKEW_SEC = 60;

export type VerifiedAdmin = {
  id: string;
  phone: string | null;
  name: string | null;
  role: "admin" | "super_admin";
};

// The authoritative Railway HS256 verification secret — JWT_ACCESS_SECRET ONLY.
function railwayAccessSecret(): string | null {
  return process.env.JWT_ACCESS_SECRET || null;
}

// True only when BOTH the exact verification secret AND the privileged Supabase
// admin store are configured. When false, requireVerifiedAdmin() can never
// succeed (fail-closed).
export function adminAuthConfigured(): boolean {
  return !!railwayAccessSecret() && adminStore.configured();
}

function normalizedAdminRole(role: unknown): "admin" | "super_admin" | null {
  const r = typeof role === "string" ? role.trim().toLowerCase() : "";
  return r === "admin" || r === "super_admin" ? (r as "admin" | "super_admin") : null;
}

// Read the admin token from the two transports the admin clients actually use:
// `Authorization: Bearer` (the /admin/login → check-role call) and `x-admin-token`
// (the admin panel pages). If BOTH are present with DIFFERENT values the request
// is ambiguous → fail closed (return null) rather than silently pick one.
// `x-admin-id` and `adm_` presence are never consulted.
function tokenFromReq(req: Request): string | null {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const headerTok = (req.headers.get("x-admin-token") || "").trim();
  if (bearer && headerTok && bearer !== headerTok) return null; // ambiguous
  return bearer || headerTok || null;
}

export type AdminVerifyDeps = {
  /** The exact Railway HS256 verification secret (JWT_ACCESS_SECRET), or null. */
  secret: string | null;
  /** Fresh Supabase admin lookup; throws to signal an infra/config failure. */
  findAdminById: (id: string) => Promise<AdminRow | null>;
};

// Testable core — pure over its injected verifier secret + admin lookup, so the
// full gate can be exercised hermetically with a fake store.
export function makeRequireVerifiedAdmin(deps: AdminVerifyDeps) {
  return async function verifyAdmin(req: Request): Promise<VerifiedAdmin | null> {
    // Fail closed without the exact verification secret.
    if (!deps.secret) return null;

    const token = tokenFromReq(req);
    if (!token) return null;

    // HS256-only signature verification against JWT_ACCESS_SECRET. A Firebase
    // RS256 token fails the algorithm check; an expired/forged token throws.
    let claims: any = null;
    try {
      claims = jwt.verify(token, deps.secret, { algorithms: ["HS256"] });
    } catch {
      return null;
    }
    if (!claims || typeof claims !== "object") return null;

    // Subject from verified claims only. Require a valid string `sub`; a compat
    // `id` claim, when PRESENT, must be the EXACT same string as `sub` (any
    // other type/value is a malformed or spliced token → reject).
    const sub = typeof claims.sub === "string" && claims.sub ? claims.sub : "";
    if (!sub) return null;
    if (claims.id !== undefined && claims.id !== sub) return null;

    // Temporal claims — validated BEFORE any Supabase lookup so an invalid
    // token costs ZERO network calls (v622 Pass 9C.1). `iat` and `exp` are
    // MANDATORY finite numbers; a future-dated `iat`, a non-positive lifetime
    // (`exp <= iat`), or a lifetime over the backend's 1h admin cap all reject.
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = claims.iat;
    const exp = claims.exp;
    if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    if (iat > nowSec + ADMIN_TOKEN_CLOCK_SKEW_SEC) return null; // future-dated
    if (exp <= iat) return null; // non-positive lifetime
    if (exp - iat > ADMIN_TOKEN_MAX_LIFETIME_SEC + ADMIN_TOKEN_CLOCK_SKEW_SEC) return null; // over cap

    // Fresh canonical Supabase role/blocked lookup. A store/config error is a
    // fail-closed signal (never read as "not found"): deny.
    let row: AdminRow | null;
    try {
      row = await deps.findAdminById(sub);
    } catch {
      return null;
    }
    if (!row) return null; // missing / deleted
    if (String(row.id) !== sub) return null; // mismatched returned row id
    if (row.isBlocked) return null; // blocked
    const role = normalizedAdminRole(row.role);
    if (!role) return null; // non-admin / demoted

    // Identity is built ONLY from the fresh Supabase row.
    return { id: String(row.id), phone: row.phone ?? null, name: row.name ?? null, role };
  };
}

// The single admin authorization gate used by every admin route. Wires the exact
// JWT_ACCESS_SECRET (read live) + the dedicated privileged Supabase admin store.
// Returns a verified admin identity or null. Callers MUST respond 401/403 on
// null and MUST NOT fall back to any other identity source.
export function requireVerifiedAdmin(req: Request): Promise<VerifiedAdmin | null> {
  return makeRequireVerifiedAdmin({
    secret: railwayAccessSecret(),
    findAdminById: (id) => adminStore.findAdminById(id),
  })(req);
}

// Audit-log identity: the verified admin, or "unknown". NEVER an
// attacker-controllable x-admin-* header value.
export function auditIdentity(admin: VerifiedAdmin | null): {
  id: string | null;
  phone: string | null;
  name: string | null;
} {
  if (!admin) return { id: "unknown", phone: null, name: null };
  return { id: admin.id, phone: admin.phone, name: admin.name };
}
