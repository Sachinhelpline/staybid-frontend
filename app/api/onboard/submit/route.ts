import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { generateHotelPublicId } from "@/lib/onboard/hotel-id";

// POST /api/onboard/submit
// Body: {
//   draftId, payload (HotelDraftPayload), ownerConsent (bool),
//   onboardedVia: "self" | "agent", agentCode?: string
// }
// Side-effects:
//   - Creates `hotels` row + `rooms` rows in Supabase (so it appears in
//     customer site immediately — same `hotels` table customer panel reads).
//   - Marks draft as submitted/live with the generated public_id.
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const {
      draftId, payload, ownerConsent,
      onboardedVia = "self", agentCode = null,
    } = body || {};

    if (!payload?.name || !payload?.city) {
      return NextResponse.json({ error: "name + city required" }, { status: 400 });
    }
    if (!ownerConsent) {
      return NextResponse.json({ error: "Owner consent is required to publish." }, { status: 400 });
    }
    if (onboardedVia === "agent") {
      if (!agentCode) return NextResponse.json({ error: "Agent code required" }, { status: 400 });
      const a = await sbSelect<any>("agents", `agent_code=eq.${encodeURIComponent(agentCode)}&active=eq.true&limit=1`);
      if (!a[0]) return NextResponse.json({ error: "Invalid agent code" }, { status: 400 });
    }

    const publicId = await generateHotelPublicId();

    // Insert hotel row — best-effort field mapping with the existing schema.
    const hotelRow: any = {
      id: publicId,                          // use STB-YYYY-XXXXX as primary id
      public_id: publicId,
      name: payload.name,
      city: payload.city,
      state: payload.state || null,
      country: payload.country || "India",
      starRating: payload.starRating || 4,
      ownerId: claims.sub,                   // links to onboarding_users.id
      onboarded_via: onboardedVia,
      onboarded_by: claims.sub,
      onboarding_agent: agentCode,
      source: payload.source || "onboarding",
      amenities: payload.amenities || [],
      photos: payload.photos || [],
    };

    let hotel: any;
    try {
      hotel = await sbInsert("hotels", hotelRow);
    } catch (e: any) {
      // If schema mismatches, drop unknown columns and retry with minimal set.
      const minimal: any = {
        id: publicId,
        name: payload.name,
        city: payload.city,
        starRating: payload.starRating || 4,
        ownerId: claims.sub,
      };
      hotel = await sbInsert("hotels", minimal);
    }

    // Insert rooms (best-effort; non-fatal)
    const rooms = (payload.rooms || []).slice(0, 8);
    for (const r of rooms) {
      try {
        await sbInsert("rooms", {
          hotelId: hotel.id || publicId,
          type: r.type,
          capacity: r.capacity || 2,
          basePrice: r.basePrice,
          floorPrice: r.floorPrice || Math.round((r.basePrice || 4999) * 0.78),
          amenities: r.amenities || [],
        });
      } catch {
        // continue
      }
    }

    // Mark draft live
    if (draftId) {
      try {
        await sbUpdate("hotel_drafts", `id=eq.${draftId}`, {
          status: "live",
          hotel_id: publicId,
          owner_consent: true,
          agent_code: agentCode,
          payload,
        });
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      hotelId: publicId,
      hotel: { id: publicId, name: payload.name, city: payload.city },
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "submit failed" }, { status: 500 });
  }
}
