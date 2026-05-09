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

export function socialUserFromReq(req: Request): SocialAuthUser | null {
  const token = tokenFromReq(req);
  if (!token) return null;
  const payload: any = decodeJwt(token);
  if (!payload) return null;
  const id: string | undefined = payload.id || payload.user_id || payload.sub;
  if (!id) return null;
  return {
    id,
    email: payload.email || payload.email_address || undefined,
    phone: payload.phone || payload.phone_number || undefined,
    name:  payload.name  || payload.display_name || payload.given_name || undefined,
    role:  payload.role,
    raw:   payload,
  };
}
