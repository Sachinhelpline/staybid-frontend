// ─────────────────────────────────────────────────────────────────────────
// Admin authorization — the ONLY trusted admin gate (hotfix v621 security).
//
// Replaces the legacy `adminFromReq` (lib/admin/audit.ts) authorization
// behaviour, which accepted ANY of: a decoded-but-unverified JWT, the mere
// presence of an opaque `adm_` string, or a bare `x-admin-id` header. None of
// those proved anything cryptographically. This module trusts a request ONLY
// when it carries a signature-verified admin token AND the derived subject is
// confirmed admin/super_admin by a server-side role lookup performed on EVERY
// request.
//
// Two accepted token families (kept deliberately separate — a customer token
// is NEVER interchangeable with an admin token):
//   1. Master-PIN admin session JWT — HS256 signed with ADMIN_JWT_SECRET,
//      issuer/audience both "staybid-admin", short (2–4h) expiry. Minted by
//      /api/admin/check-role after PIN + role verification.
//   2. Railway OTP admin JWT — HS256 signed with the authoritative JWT_SECRET
//      (no iss/aud). A Railway *customer* token is also signed with JWT_SECRET,
//      so signature alone is not enough — the role lookup below is what keeps
//      the families separate (a customer subject fails the admin/super_admin
//      check and is rejected).
//
// Fails closed: any missing secret, verify error, expired token, wrong
// iss/aud, missing subject, or non-admin role → returns null (caller responds
// 401/403). It never trusts x-admin-id, `adm_` presence, or unverified claims.
// ─────────────────────────────────────────────────────────────────────────
import jwt from "jsonwebtoken";
import { SB_URL, SB_READ } from "@/lib/sb";

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "";
// Railway signs its admin/customer HS256 tokens with JWT_ACCESS_SECRET
// (authoritative — see staybid-Live `signAccessToken`); JWT_SECRET is the
// documented frontend var, kept as a fallback. A Railway token is accepted only
// after the server-side role lookup confirms admin/super_admin, so verifying
// against either secret never widens authorization.
const RAILWAY_HS256_SECRETS: string[] = [
  process.env.JWT_ACCESS_SECRET,
  process.env.JWT_SECRET,
].filter((s): s is string => !!s);

export const ADMIN_JWT_ISSUER = "staybid-admin";
export const ADMIN_JWT_AUDIENCE = "staybid-admin";
// Short-lived admin session (owner decision: 2–4h). 3h is the midpoint.
export const ADMIN_JWT_TTL = "3h";

export type VerifiedAdmin = {
  id: string;
  phone: string | null;
  name: string | null;
  role: "admin" | "super_admin";
};

// True only when at least one admin-verification secret is configured. When
// this is false, requireVerifiedAdmin() can never succeed (fail-closed).
export function adminAuthConfigured(): boolean {
  return !!(ADMIN_JWT_SECRET || RAILWAY_HS256_SECRETS.length);
}

// Master-PIN issuance uses ADMIN_JWT_SECRET ONLY — it never silently falls
// back to the general JWT_SECRET. Throws when the secret is absent so the
// login route can fail closed instead of minting an unsigned/forgeable token.
export function isAdminIssuanceConfigured(): boolean {
  return !!ADMIN_JWT_SECRET;
}

export function signAdminSessionToken(input: {
  sub: string;
  phone?: string | null;
  name?: string | null;
  role: "admin" | "super_admin";
}): string {
  if (!ADMIN_JWT_SECRET) {
    throw new Error("ADMIN_JWT_SECRET_NOT_CONFIGURED");
  }
  return jwt.sign(
    {
      sub: input.sub,
      phone: input.phone ?? null,
      name: input.name ?? null,
      role: input.role,
    },
    ADMIN_JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: ADMIN_JWT_ISSUER,
      audience: ADMIN_JWT_AUDIENCE,
      expiresIn: ADMIN_JWT_TTL,
    },
  );
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
// other identity source.
export async function requireVerifiedAdmin(
  req: Request,
): Promise<VerifiedAdmin | null> {
  const token = tokenFromReq(req);
  if (!token) return null;

  let claims: any = null;

  // Path 1 — master-PIN admin session JWT (strict iss/aud).
  if (ADMIN_JWT_SECRET) {
    try {
      claims = jwt.verify(token, ADMIN_JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: ADMIN_JWT_ISSUER,
        audience: ADMIN_JWT_AUDIENCE,
      });
    } catch {
      claims = null;
    }
  }

  // Path 2 — Railway OTP admin JWT (HS256, no iss/aud). Railway signs with
  // JWT_ACCESS_SECRET; JWT_SECRET is kept as a fallback. Authorization still
  // requires the server-side admin role lookup below, so verifying against
  // either secret never widens access.
  if (!claims) {
    for (const secret of RAILWAY_HS256_SECRETS) {
      try {
        claims = jwt.verify(token, secret, { algorithms: ["HS256"] });
        break;
      } catch {
        claims = null;
      }
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

  // Identity is derived from verified claims only (the subject), and the role
  // is authoritative from the server-side lookup.
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
