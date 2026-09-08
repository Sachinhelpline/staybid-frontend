// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B-P1E-R1 — STRICT customer-domain MEDIA authority gate (server-only).
//
// This is the P1E-locked customer-domain authority for the media upload-session
// path. It is DELIBERATELY separate from the generic `verifiedCustomerFromReq`
// (lib/auth/customer-verify.ts), which stays intact for its OTHER consumers
// (app/api/notifications/queue, lib/support/agent-auth) and is TOO BROAD to be a
// media-ownership authority (it accepts JWT_SECRET, extracts id ?? sub ?? user_id,
// enforces no mandatory sub / no id===sub, and does no admin rejection or fresh
// account-state proof).
//
// Two fail-closed stages:
//   Stage 1 — crypto (pure): HS256 with the EXACT JWT_ACCESS_SECRET only.
//     • mandatory non-empty string `sub`
//     • if `id` present it MUST be a string EXACTLY equal to `sub`
//     • `user_id` is NEVER canonical authority or a fallback
//     • an admin / super_admin role claim is REJECTED (defence-in-depth; a role
//       claim never establishes customer authority either way)
//     • NO JWT_SECRET fallback, NO RS256/Firebase, NO decode-only path
//   Stage 2 — fresh Railway customer proof (INJECTED): a server-only lookup of the
//     canonical customer by the verified subject returning {id, role, isBlocked}
//     (null when missing; THROWS on lookup/network/config failure). Authority
//     requires: row exists, row.id === subject, not blocked, role not admin.
//
// ownerUserId := the verified `sub` (== the fresh Railway row id). The client can
// NEVER choose the owner. No token is logged; no raw error is surfaced.
//
// PURITY: the resolver + crypto stage import only `jsonwebtoken`. The fresh
// customer transport is INJECTED so the whole gate is hermetically testable and
// cannot smuggle a network call of its own. The production factory builds the
// transport from the existing backend base (NEXT_PUBLIC_API_URL).
// ═══════════════════════════════════════════════════════════════════════════
import jwt from "jsonwebtoken";

export type VerifiedMediaCustomer = { id: string; authorityDomain: "customer" };

// The fresh canonical Railway customer proof (mirrors the backend
// findUserByIdForGate select shape). SEC-00B-P1E-R1 remediation: all three fields
// are REQUIRED and strictly typed — the production parser must PROVE this shape and
// never coerce/default a missing or malformed security field.
export type FreshCustomer = { id: string; role: string; isBlocked: boolean };

// Injected fresh-customer proof. MUST hit the authoritative Railway customer
// store (server-side). Returns null when the canonical customer does not exist;
// THROWS on lookup / network / config failure so the caller fails closed.
export type FetchFreshCustomer = (
  subject: string,
  bearerToken: string,
) => Promise<FreshCustomer | null>;

export type MediaCustomerDeps = {
  secret: string | undefined; // EXACT JWT_ACCESS_SECRET only
  fetchCustomer: FetchFreshCustomer;
};

function isAdminRoleClaim(role: unknown): boolean {
  if (typeof role !== "string") return false;
  const r = role.trim().toLowerCase();
  return r === "admin" || r === "super_admin";
}

/**
 * Stage 1 — pure crypto. Returns the canonical subject (verified `sub`) or null
 * (fail closed). HS256 + exact secret only; mandatory sub; id===sub when present;
 * user_id never authority; admin/super_admin role claim rejected.
 */
export function verifyMediaCustomerToken(token: string, secret: string | undefined): string | null {
  if (typeof secret !== "string" || secret.length === 0) return null; // no config → fail closed
  if (typeof token !== "string" || token.trim().length === 0) return null;
  let p: unknown;
  try {
    p = jwt.verify(token.trim(), secret, { algorithms: ["HS256"] });
  } catch {
    return null; // wrong secret / expired / forged / RS256 Firebase / alg:none
  }
  if (!p || typeof p !== "object") return null;
  const claims = p as Record<string, unknown>;
  const sub = claims.sub;
  if (typeof sub !== "string" || sub.length === 0) return null; // mandatory non-empty sub
  if (claims.id !== undefined) {
    if (typeof claims.id !== "string" || claims.id !== sub) return null; // id, if present, MUST equal sub
  }
  // `user_id` is NEVER read as authority or fallback (deliberately ignored).
  if (isAdminRoleClaim(claims.role)) return null; // defence-in-depth: reject admin/super_admin claim
  return sub;
}

// ── Verified identity claims (email / phone / name) — SEC-00B authority-boundary
// remediation. Some ownership-sensitive resolvers (Verified Guest booking
// ownership + the eligible-bookings picker) must bridge a person's identity twins
// by email / phone. Those twin ATTRIBUTES must themselves come from a
// CRYPTOGRAPHICALLY VERIFIED token — never a decode-only claim. This returns the
// verified subject PLUS any email / phone / name claims carried by the SAME HS256
// token, applying the IDENTICAL crypto rules as verifyMediaCustomerToken (exact
// JWT_ACCESS_SECRET only, mandatory sub, id===sub when present, admin/super_admin
// rejected). It performs NO fresh Railway proof — callers pair it with
// resolveVerifiedMediaCustomer for the authoritative id + account-state proof.
export type VerifiedMediaIdentity = {
  sub: string;
  email: string | null;
  phone: string | null;
  name: string | null;
};

// A claim is usable only if it is a non-empty, reasonably-bounded string.
function cleanClaimString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= 320 ? t : null;
}

/**
 * Verify the token (same strict crypto as verifyMediaCustomerToken) and return
 * the verified subject + verified email / phone / name claims, or null (fail
 * closed). The email / phone reaching an ownership resolver from here are
 * cryptographically verified attributes — NOT decode-only claims.
 */
export function verifyMediaCustomerIdentity(
  token: string,
  secret: string | undefined,
): VerifiedMediaIdentity | null {
  if (typeof secret !== "string" || secret.length === 0) return null; // no config → fail closed
  if (typeof token !== "string" || token.trim().length === 0) return null;
  let p: unknown;
  try {
    p = jwt.verify(token.trim(), secret, { algorithms: ["HS256"] });
  } catch {
    return null; // wrong secret / expired / forged / non-HS256 / alg:none
  }
  if (!p || typeof p !== "object") return null;
  const claims = p as Record<string, unknown>;
  const sub = claims.sub;
  if (typeof sub !== "string" || sub.length === 0) return null; // mandatory non-empty sub
  if (claims.id !== undefined) {
    if (typeof claims.id !== "string" || claims.id !== sub) return null; // id, if present, MUST equal sub
  }
  if (isAdminRoleClaim(claims.role)) return null; // reject admin/super_admin claim
  const emailRaw = cleanClaimString(claims.email) ?? cleanClaimString(claims.email_address);
  const email = emailRaw && /@/.test(emailRaw) ? emailRaw : null;
  const phone = cleanClaimString(claims.phone) ?? cleanClaimString(claims.phone_number);
  const name =
    cleanClaimString(claims.name) ??
    cleanClaimString(claims.display_name) ??
    cleanClaimString(claims.given_name);
  return { sub, email, phone, name };
}

function bearerFromReq(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Full gate: crypto → fresh Railway customer proof. Returns the verified media
 * customer or null (fail closed at every gap). The returned `id` equals the
 * verified `sub` AND the fresh Railway row id. Reads ONLY the Authorization
 * header — never a body/query/header owner field.
 */
export async function resolveVerifiedMediaCustomer(
  req: Request,
  deps: MediaCustomerDeps,
): Promise<VerifiedMediaCustomer | null> {
  const token = bearerFromReq(req);
  if (!token) return null;
  const subject = verifyMediaCustomerToken(token, deps.secret);
  if (!subject) return null;

  let fresh: FreshCustomer | null;
  try {
    fresh = await deps.fetchCustomer(subject, token);
  } catch {
    return null; // lookup / network / config failure → fail closed
  }
  if (!fresh) return null; // canonical customer missing
  if (typeof fresh.id !== "string" || fresh.id !== subject) return null; // row id must equal subject
  if (fresh.isBlocked === true) return null; // blocked
  if (isAdminRoleClaim(fresh.role)) return null; // fresh state resolves admin/super_admin → reject
  return { id: subject, authorityDomain: "customer" };
}

/**
 * Request-level companion to resolveVerifiedMediaCustomer: reads ONLY the
 * Authorization header and returns the VERIFIED identity claims (sub + email /
 * phone / name) for identity-twin reconciliation. Never reads a body / query /
 * hint header. Pair with resolveVerifiedMediaCustomer (authority id + fresh
 * account-state proof); this supplies the verified twin attributes.
 */
export function resolveVerifiedMediaIdentity(
  req: Request,
  secret: string | undefined,
): VerifiedMediaIdentity | null {
  return verifyMediaCustomerIdentity(bearerFromReq(req), secret);
}

// ── Production transport (server-only) ──────────────────────────────────────
// Reuses the existing backend base (NEXT_PUBLIC_API_URL). Fails closed on
// missing/untrusted config, timeout, non-2xx, or malformed body. Never logs the
// token; never returns a raw provider error.
const MEDIA_CUSTOMER_PATH = "/api/auth/media-customer";
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * SEC-00B-P1E-R1 — STRICT production response parser (pure, exported for hermetic
 * tests). Establishes the full FreshMediaCustomerProof shape or FAILS CLOSED. It
 * does NOT coerce/default any security field (no `role ?? null`, no
 * `isBlocked === true` shortcut, no Boolean()/String()).
 *   • HTTP 404               → null (canonical customer missing)
 *   • non-2xx                → throw (fail closed)
 *   • 2xx + body proving {id:non-empty string, role:non-empty string,
 *     isBlocked:boolean} → the proof; ANYTHING else → throw (fail closed)
 * Semantic checks (id===sub, blocked, admin) remain in resolveVerifiedMediaCustomer.
 */
export function parseFreshCustomerProof(status: number, body: unknown): FreshCustomer | null {
  if (status === 404) return null; // canonical customer missing
  if (status < 200 || status >= 300) throw new Error("media_customer_lookup_failed"); // non-2xx → fail closed
  if (!body || typeof body !== "object") throw new Error("media_customer_lookup_malformed");
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.length === 0) throw new Error("media_customer_lookup_malformed");
  if (typeof b.role !== "string" || b.role.length === 0) throw new Error("media_customer_lookup_malformed");
  if (typeof b.isBlocked !== "boolean") throw new Error("media_customer_lookup_malformed");
  return { id: b.id, role: b.role, isBlocked: b.isBlocked };
}

function resolveApiBase(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null; // no plaintext backend authority
  if (u.username || u.password) return null; // no embedded credentials
  return u.origin;
}

/**
 * Build the production media customer authority. `secret` = JWT_ACCESS_SECRET
 * only (no fallback). The transport GETs the backend media-customer proof
 * endpoint with the caller's bearer, server-side, bounded timeout, no-store.
 */
export function createMediaCustomerAuthority(
  env: Record<string, string | undefined> = process.env,
): MediaCustomerDeps {
  const secret = env.JWT_ACCESS_SECRET;
  const base = resolveApiBase(env.NEXT_PUBLIC_API_URL);

  const fetchCustomer: FetchFreshCustomer = async (_subject, bearerToken) => {
    if (!base) throw new Error("media_customer_backend_unconfigured"); // fail closed
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${base}${MEDIA_CUSTOMER_PATH}`, {
        method: "GET",
        headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // Parse body defensively (malformed JSON → null), then apply the STRICT
    // fail-closed schema parser. No security-field defaulting.
    const body = await res.json().catch(() => null);
    return parseFreshCustomerProof(res.status, body);
  };

  return { secret, fetchCustomer };
}
