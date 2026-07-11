// v315 — shared partner hotel-scope resolver (Channel Manager Phase 1).
//
// THE MERGE RULE: every channel-manager route must scope by the UNION of
//   • hotels the caller OWNS  (hotels.ownerId, cross-pool resolved), and
//   • hotels the caller OPERATES (owns ≥1 physical unit — the StayBid Circle
//     + host-circle pools reach /partner/dashboard this way).
// Scoping by ownerId alone silently locks Circle partners out of the channel
// manager for their operated properties.
import { NextRequest } from "next/server";
import { sbSelect, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveOperatedHotelIds } from "@/lib/partner/operator-access";

export interface PartnerScope {
  hotelIds: string[];
  userId: string;
}

/** Resolve the caller's full hotel scope (owned ∪ operated). null = no/bad token. */
export async function partnerHotelScope(req: NextRequest): Promise<PartnerScope | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;

  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  ).catch(() => [payload.id]);

  const set = new Set<string>();
  if (ownerIds.length) {
    try {
      const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
      (Array.isArray(hotels) ? hotels : []).forEach((h: any) => {
        if (h?.id) set.add(String(h.id));
      });
    } catch { /* ignore */ }
    try {
      const operated = await resolveOperatedHotelIds(ownerIds);
      operated.forEach((id) => set.add(id));
    } catch { /* ignore */ }
  }
  return { hotelIds: Array.from(set), userId: payload.id };
}
