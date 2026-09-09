// ═══════════════════════════════════════════════════════════════════════════
// SEC-00B — cryptographically-verified PARTNER authority (server-only).
// ═══════════════════════════════════════════════════════════════════════════
// The legacy partner routes (and partnerHotelScope) resolve the caller with a
// DECODE-ONLY JWT payload — no signature check — so an attacker can forge a
// partner identity. The verified-stay evidence write path must NOT trust that.
//
// This gate:
//   1. CRYPTOGRAPHICALLY verifies the partner token (HS256 against the Railway
//      customer-family secrets — JWT_ACCESS_SECRET, with the JWT_SECRET compat
//      fallback the customer contract already uses). Rejects decode-only /
//      unsigned / forged / RS256 / alg:none / expired / wrong-secret tokens.
//      Subject = verified `sub` (or `id` when `sub` is absent); if both present
//      they MUST be equal.
//   2. Proves the verified subject is AUTHORIZED for a specific hotel by reading
//      the PROTECTED, forge-proof verified_partner_hotel_scope binding (an
//      ACTIVE row for that exact subject + hotel). A partner for Hotel A can
//      NEVER verify a Hotel B stay.
// Fail closed at every gap. The hotel-scope resolver is INJECTED so the gate is
// hermetically testable and cannot smuggle a network call of its own.
//
// SEC-00B FINAL (partner↔hotel authority): the scope resolver reads ONLY the
// protected verified_partner_hotel_scope table (service-role, deny-by-default),
// NOT the client-writable hotels.ownerId / hotel_room_units.owner_user_id
// mappings (both have permissive production RLS). So a normal customer editing
// one of those public tables to their own subject gains NO partner scope, and a
// validly-signed CUSTOMER token with no active binding resolves to an empty
// scope (→ fail closed). Those public mappings stay DISPLAY / inventory data.
import jwt from "jsonwebtoken";

export type VerifiedPartnerIdentity = {
  subject: string;
  phone: string | null;
  email: string | null;
};

/**
 * Pure crypto: verify the partner token against ANY of the provided
 * customer-family secrets (HS256 only). Returns the verified identity or null
 * (fail closed). A decode-only / forged / unsigned / non-HS256 token can never
 * pass.
 */
export function verifyPartnerToken(
  token: string,
  secrets: Array<string | undefined>
): VerifiedPartnerIdentity | null {
  const valid = (secrets || []).filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  if (!valid.length) return null; // no config → fail closed
  if (typeof token !== "string" || token.trim().length === 0) return null;
  const t = token.trim();
  for (const secret of valid) {
    let p: unknown;
    try {
      p = jwt.verify(t, secret, { algorithms: ["HS256"] });
    } catch {
      continue; // wrong secret / expired / forged / RS256 / alg:none
    }
    if (!p || typeof p !== "object") continue;
    const c = p as Record<string, unknown>;
    const sub = typeof c.sub === "string" && c.sub.length > 0 ? c.sub : null;
    const idc = typeof c.id === "string" && c.id.length > 0 ? c.id : null;
    if (sub && idc && sub !== idc) continue; // id, if present with sub, must equal it
    const subject = sub || idc;
    if (!subject) continue; // need a verified subject
    const emailRaw = typeof c.email === "string" ? c.email.trim() : "";
    const email = emailRaw && /@/.test(emailRaw) ? emailRaw : null;
    const phoneRaw = typeof c.phone === "string" ? c.phone.trim() : "";
    const phone = phoneRaw.length > 0 ? phoneRaw : null;
    return { subject, phone, email };
  }
  return null;
}

function bearerFromReq(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/** Resolve the hotel ids a verified subject is authorized for (owned ∪ operated). */
export type ResolvePartnerHotelIds = (
  subject: string,
  phone: string | null,
  email: string | null
) => Promise<string[]>;

export type PartnerAuthorityDeps = {
  secrets: Array<string | undefined>; // customer-family HS256 secrets
  resolveHotelIds: ResolvePartnerHotelIds;
};

export type VerifiedPartnerScope = { subject: string; hotelIds: string[] };

/**
 * Verify the partner token, then resolve the verified subject's authorized
 * hotel ids. null = not a verified partner (fail closed). A resolver throw also
 * fails closed.
 */
export async function resolveVerifiedPartnerScope(
  req: Request,
  deps: PartnerAuthorityDeps
): Promise<VerifiedPartnerScope | null> {
  const idn = verifyPartnerToken(bearerFromReq(req), deps.secrets);
  if (!idn) return null;
  let hotelIds: string[] = [];
  try {
    const resolved = await deps.resolveHotelIds(idn.subject, idn.phone, idn.email);
    hotelIds = Array.isArray(resolved) ? resolved.map((h) => String(h)) : [];
  } catch {
    return null; // resolver failure → fail closed
  }
  return { subject: idn.subject, hotelIds };
}

/**
 * Can this verified partner verify a stay AT this hotel? Returns the verified
 * subject when authorized. Fail closed otherwise.
 */
export async function partnerAuthorizedForHotel(
  req: Request,
  deps: PartnerAuthorityDeps,
  hotelId: string | null | undefined
): Promise<{ ok: boolean; subject?: string }> {
  const scope = await resolveVerifiedPartnerScope(req, deps);
  if (!scope) return { ok: false };
  if (!hotelId || !scope.hotelIds.includes(String(hotelId))) return { ok: false };
  return { ok: true, subject: scope.subject };
}
