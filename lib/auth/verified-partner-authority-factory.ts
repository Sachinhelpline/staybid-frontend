// Production wiring for the verified-partner authority (server-only).
// Kept separate from the pure gate (lib/auth/verified-partner-authority.ts) so
// the gate stays hermetically testable with an injected resolver.
import { sbSelect } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveOperatedHotelIds } from "@/lib/partner/operator-access";
import type { PartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority";

/**
 * Build the partner authority deps. Secrets = the Railway customer-family HS256
 * secrets (JWT_ACCESS_SECRET + the JWT_SECRET compat fallback). The hotel-id
 * resolver returns the hotels the verified subject OWNS (hotels.ownerId) ∪
 * OPERATES (owns ≥1 unit — hotel_room_units.owner_user_id), cross-pool resolved.
 */
export function createPartnerAuthorityDeps(
  env: Record<string, string | undefined> = process.env
): PartnerAuthorityDeps {
  return {
    secrets: [env.JWT_ACCESS_SECRET, env.JWT_SECRET],
    resolveHotelIds: async (subject, phone, email) => {
      const ownerIds = await resolveOwnerIdsCrossPool(
        subject,
        phone || "",
        email || ""
      ).catch(() => [subject]);
      const set = new Set<string>();
      if (ownerIds.length) {
        try {
          const hotels = await sbSelect(
            `hotels?ownerId=in.(${ownerIds.map(encodeURIComponent).join(",")})&select=id`
          );
          (Array.isArray(hotels) ? hotels : []).forEach((h: any) => {
            if (h?.id) set.add(String(h.id));
          });
        } catch {
          /* ignore — treated as no owned hotels */
        }
        try {
          (await resolveOperatedHotelIds(ownerIds)).forEach((id) => set.add(String(id)));
        } catch {
          /* ignore — treated as no operated hotels */
        }
      }
      return Array.from(set);
    },
  };
}
