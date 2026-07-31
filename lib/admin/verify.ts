// ─────────────────────────────────────────────────────────────────────────
// Admin authorization — the ONLY trusted admin gate (hotfix v621 security).
//
// Admins sign in with Google/Gmail at /auth, which returns a Railway HS256
// access JWT (stored as sb_token). /api/admin/check-role verifies that token
// and, on success, the client reuses it as sb_admin_token. Every protected
// admin route then re-verifies the signature here AND re-checks the subject's
// admin/super_admin role in the database on EVERY request.
//
// The legacy phone + Master-PIN admin login is REMOVED. There is no longer any
// legitimate issuer of an ADMIN_JWT_SECRET-signed "admin session" token, so
// that acceptance path (and its signing/issuance helpers) are gone — a
// forge-your-own-admin-token surface has been eliminated. This module now
// trusts a request ONLY when it carries a signature-verified Railway HS256
// token whose derived subject is confirmed admin/super_admin by the role
// lookup below.
//
// Railway signs its admin/customer HS256 tokens with JWT_ACCESS_SECRET
// (authoritative — see staybid-Live `signAccessToken`); JWT_SECRET is the
// documented frontend var, kept as a temporary compatibility fallback. A
// Railway *customer* token is signed with the same secret, so signature alone
// is not enough — the server-side role lookup is what authorizes (a customer
// subject fails the admin/super_admin check and is rejected).
//
// Fails closed: any missing secret, verify error, expired token, wrong
// algorithm (e.g. a Firebase RS256 token), missing subject, or non-admin role
// → returns null (caller responds 401/403). It never trusts x-admin-id,
// `adm_` presence, a client-supplied role, or unverified claims.
// ─────────────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";
import { SB_URL, SB_READ } from "@/lib/sb";

// Railway signs HS256 tokens with JWT_ACCESS_SECRET (authoritative). JWT_SECRET
// is kept ONLY as a temporary compatibility fallback for older tokens.
const RAILWAY_HS256_SECRETS: string[] = [
  process.env.JWT_ACCESS_SECRET,
  process.env.JWT_SECRET,
].filter((s): s is string => !!s);

export type VerifiedAdmin = {
  id: string;
  phone: string | null;
  name: string | null;
  role: "admin" | "super_admin";
};

// True only when at least one Railway verification secret is configured. When
// this is false, requireVerifiedAdmin() can never succeed (fail-closed).
export function adminAuthConfigured(): boolean {
  return RAILWAY_HS256_SECRETS.length > 0;
}

function tokenFromReq(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  return (req.headers.get("x-admin-token") || "").trim();
}

// Server-side role lookup on EVERY request. A token minted for an admin whose
// role was later revoked stops passing the moment their row is no longer
// admin/super_admin — verification is never cached.
async function lookupAdminRole(id: string): Promise<VerifiedAdmin | null> {
  try {
    const url =
      `${SB_URL}/rest/v1/users` +
      `?select=id,phone,name,role&id=eq.${encodeURIComponent(id)}&limit=1`;
    const res = await fetch(url, { headers: SB_READ, cache: "no-store" });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    if (row.role !== "admin" && row.role !== "super_admin") return null;
    return {
      id: String(row.id),
      phone: row.phone ?? null,
      name: row.name ?? null,
      role: row.role,
    };
  } catch {
    return null;
  }
}

// The single admin authorization gate. Returns a verified admin identity or
// null. Callers MUST respond 401/403 on null and MUST NOT fall back to any
// other identity source (no client role, no localStorage value, no header).
export async function requireVerifiedAdmin(
  req: Request,
): Promise<VerifiedAdmin | null> {
  const token = tokenFromReq(req);
  if (!token) return null;

  // Verify the Railway HS256 signature (JWT_ACCESS_SECRET, then the JWT_SECRET
  // compatibility fallback). A Firebase RS256 token fails the HS256 algorithm
  // check and is rejected. Authorization still requires the DB role lookup
  // below, so verifying against either secret never widens access.
  let claims: any = null;
  for (const secret of RAILWAY_HS256_SECRETS) {
    try {
      claims = jwt.verify(token, secret, { algorithms: ["HS256"] });
      break;
    } catch {
      claims = null;
    }
  }
  if (!claims) return null;

  const sub =
    typeof claims.sub === "string"
      ? claims.sub
      : typeof claims.id === "string"
        ? claims.id
        : "";
  if (!sub) return null;

  // Identity is derived from verified claims only (the subject); the role is
  // authoritative from the server-side lookup, never from the token claim.
  return lookupAdminRole(sub);
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
