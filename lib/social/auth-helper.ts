// ═══════════════════════════════════════════════════════════════════════════
// Social-feed auth helper — resolves the auth user from a request, accepting
// BOTH StayBid backend HS256 tokens (payload.id) AND Firebase RS256 tokens
// (payload.sub / payload.user_id). The shared `userFromReq` in lib/sb.ts
// only checks payload.id — Firebase users would otherwise hit 401 on every
// social endpoint. We don't modify lib/sb.ts (non-destructive rule); this
// helper sits beside it.
// ═══════════════════════════════════════════════════════════════════════════
import { decodeJwt, tokenFromReq } from "@/lib/sb";

export type SocialAuthUser = {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  role?: string;
  raw: any;
};

/**
 * v112.2 — normalize ids to a single canonical form.
 *
 * Old auth paths used to prefix Firebase ids with "fb_" (and a few with
 * "firebase_") when persisting to users / social_profiles. The current
 * path uses the raw uid. The mix caused ONE person to end up with TWO
 * social_profiles rows + the awkward "@user_fb_<…>" auto-handle the
 * user flagged. Stripping the prefix here makes every downstream
 * lookup hit the same row regardless of which auth path issued the
 * token.
 *
 * Safe because:
 *  - Real Firebase uids never start with "fb_" / "firebase_" (they're
 *    bare alphanumerics from Google Identity).
 *  - Real CUIDs (backend HS256) start with "c…" — also untouched.
 */
export function normalizeAuthId(id: string): string {
  if (!id) return id;
  if (id.startsWith("fb_"))       return id.slice(3);
  if (id.startsWith("firebase_")) return id.slice(9);
  return id;
}

export function socialUserFromReq(req: Request): SocialAuthUser | null {
  const token = tokenFromReq(req);
  if (!token) return null;
  const payload: any = decodeJwt(token);
  if (!payload) return null;
  const rawId: string | undefined = payload.id || payload.user_id || payload.sub;
  if (!rawId) return null;
  return {
    id: normalizeAuthId(rawId),
    email: payload.email || payload.email_address || undefined,
    phone: payload.phone || payload.phone_number || undefined,
    name:  payload.name  || payload.display_name || payload.given_name || undefined,
    role:  payload.role,
    raw:   payload,
  };
}
