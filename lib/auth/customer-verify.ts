// Verified customer authentication (hotfix v621 security).
//
// StayBid customer sessions come in two token families:
//   - "backend"  → HS256 JWT signed by Railway with JWT_SECRET (verifiable here)
//   - "firebase" → RS256 JWT signed by Google (needs firebase-admin / JWKS)
//
// This helper CRYPTOGRAPHICALLY verifies the backend HS256 family only. A
// Firebase RS256 token is REJECTED here (fail closed) until the firebase-admin
// verification follow-up lands — we never trust a decoded-but-unverified
// Firebase claim. Callers must respond 401 on null.
import jwt from "jsonwebtoken";

// Railway signs its HS256 access tokens with JWT_ACCESS_SECRET (authoritative —
// see the staybid-Live backend `signAccessToken`). JWT_SECRET is the documented
// frontend secret and is kept as a fallback in case the two are provisioned
// under a single value. We verify against each configured HS256 secret and
// accept on the first that validates — this stays fully cryptographic and fails
// closed when none match (no invented key).
const HS256_SECRETS: string[] = [
  process.env.JWT_ACCESS_SECRET,
  process.env.JWT_SECRET,
].filter((s): s is string => !!s);

export type VerifiedCustomer = {
  id: string;
  phone?: string | null;
  email?: string | null;
};

export function verifiedCustomerFromReq(req: Request): VerifiedCustomer | null {
  if (!HS256_SECRETS.length) return null; // fail closed when config is missing
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  for (const secret of HS256_SECRETS) {
    try {
      const p: any = jwt.verify(token, secret, { algorithms: ["HS256"] });
      const id =
        typeof p?.id === "string"
          ? p.id
          : typeof p?.sub === "string"
            ? p.sub
            : typeof p?.user_id === "string"
              ? p.user_id
              : "";
      if (!id) return null;
      return { id, phone: p?.phone ?? null, email: p?.email ?? null };
    } catch {
      // wrong secret / expired / forged / RS256 Firebase token → try next.
    }
  }
  return null; // fail closed
}

// Accept ONLY a validated internal application path (relative, starts with a
// single "/"). Rejects absolute URLs, protocol-relative "//host", javascript:/
// data:/custom schemes, and control characters. Returns null when unsafe.
export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 512) return null; // empty or excessively long
  if (s[0] !== "/") return null; // relative application path only
  if (s[1] === "/") return null; // protocol-relative "//host" → external origin
  if (s.includes("\\")) return null; // backslash — browsers fold "\" into "/"
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(s)) return null; // control chars + whitespace
  if (/%2f|%5c/i.test(s)) return null; // encoded slash / backslash
  if (/^\/[^/]*:/.test(s)) return null; // scheme-like segment before first "/"
  return s;
}
