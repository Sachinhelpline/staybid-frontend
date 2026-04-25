import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { generateHotelPublicId } from "@/lib/onboard/hotel-id";

// Listing draft API — single source of truth that the wizard writes to
// after the AI search/auto-fetch step. Returns the in-progress hotel record
// + room list + image counts + KYC + bank + agreement statuses, so the UI
// can show readiness for publish.
//
// GET  /api/onboard/listing                       → the user's current draft listing
// POST /api/onboard/listing                       → create or update the draft
// POST /api/onboard/listing/preview-viewed         → mark preview as viewed (publish gate)
//
// We persist the draft as a row in the `hotels` table with status='draft'
// (never visible publicly until status='published').

export async function GET(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const url = new URL(req.url);
    const hotelId = url.searchParams.get("hotelId");

    let hotel: any | null = null;
    if (hotelId) {
      const rows = await sbSelect<any>("hotels", `id=eq.${encodeURIComponent(hotelId)}&limit=1`);
      hotel = rows[0] || null;
    } else {
      // Get the most recent draft for this user
      const rows = await sbSelect<any>(
        "hotels",
        `"ownerId"=eq.${claims.sub}&order="createdAt".desc&limit=1`
      );
      hotel = rows[0] || null;
    }

    if (!hotel) return NextResponse.json({ hotel: null });

    const [rooms, hotelImgs, roomImgs, kyc, bank, agr] = await Promise.all([
      sbSelect<any>("rooms", `"hotelId"=eq.${encodeURIComponent(hotel.id)}&order="floorPrice".asc`),
      sbSelect<any>("hotel_images", `hotel_id=eq.${encodeURIComponent(hotel.id)}&order=sort_order.asc`),
      sbSelect<any>("room_images", `hotel_id=eq.${encodeURIComponent(hotel.id)}`),
      sbSelect<any>("kyc_submissions", `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotel.id)}&order=updated_at.desc&limit=1`),
      sbSelect<any>("bank_details", `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotel.id)}&order=updated_at.desc&limit=1`),
      sbSelect<any>("host_agreements", `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotel.id)}&order=signed_at.desc&limit=1`),
    ]);

    const checklist = {
      // Only name + city are mandatory (matches existing frontend schema).
      // Lat/lng/address/contact are stored if the user fills them but are
      // optional. This keeps the publish gate aligned with the customer site.
      basics: !!(hotel.name && hotel.city),
      images: hotelImgs.length >= 3,
      rooms: rooms.length >= 1,
      kyc: !!(kyc[0] && kyc[0].consent_listing && kyc[0].consent_price_compare && kyc[0].consent_image_rights && kyc[0].consent_legal),
      bank: !!bank[0],
      agreement: !!agr[0],
      previewViewed: !!hotel.preview_viewed,
    };

    return NextResponse.json({
      hotel,
      rooms,
      hotelImages: hotelImgs,
      roomImages: roomImgs,
      kyc: kyc[0] || null,
      bank: bank[0]
        ? {
            id: bank[0].id,
            account_holder: bank[0].account_holder,
            account_last4: bank[0].account_last4,
            ifsc: bank[0].ifsc,
            bank_name: bank[0].bank_name,
            verified: bank[0].verified,
          }
        : null,
      agreement: agr[0] || null,
      checklist,
      readyToPublish: Object.values(checklist).every(Boolean),
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "listing fetch failed" }, { status: 500 });
  }
}

// POST creates or updates a draft hotel
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const { id, ...rest } = body || {};

    const patch: any = {
      name: rest.name,
      description: rest.description ?? null,
      city: rest.city,
      state: rest.state ?? null,
      country: rest.country ?? "India",
      starRating: rest.starRating ?? 4,
      lat: rest.lat ?? null,
      lng: rest.lng ?? null,
      place_id: rest.place_id ?? null,
      formatted_address: rest.formatted_address ?? null,
      contact_phone: rest.contact_phone ?? null,
      contact_email: rest.contact_email ?? null,
      contact_website: rest.contact_website ?? null,
      amenities: rest.amenities ?? [],
      ownerId: claims.sub,
      onboarded_via: rest.onboarded_via || "self",
      onboarded_by: claims.sub,
      onboarding_agent: rest.onboarding_agent || null,
      source: rest.source || "onboarding",
    };
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    let hotel;
    if (id) {
      const upd = await sbUpdate("hotels", `id=eq.${encodeURIComponent(id)}`, patch);
      hotel = Array.isArray(upd) ? upd[0] : upd;
    } else {
      const newId = await generateHotelPublicId();
      try {
        hotel = await sbInsert("hotels", { id: newId, public_id: newId, status: "draft", ...patch });
      } catch {
        // Schema rejection fallback
        hotel = await sbInsert("hotels", { id: newId, status: "draft", name: patch.name, city: patch.city, starRating: patch.starRating, ownerId: claims.sub });
      }
    }
    return NextResponse.json({ hotel });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "listing save failed" }, { status: 500 });
  }
}

// PATCH /api/onboard/listing  → mark preview as viewed
export async function PATCH(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const { hotelId } = await req.json();
    if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
    const rows = await sbSelect<any>("hotels", `id=eq.${encodeURIComponent(hotelId)}&"ownerId"=eq.${claims.sub}&limit=1`);
    if (!rows[0]) return NextResponse.json({ error: "not found or not yours" }, { status: 404 });
    const upd = await sbUpdate("hotels", `id=eq.${encodeURIComponent(hotelId)}`, { preview_viewed: true });
    return NextResponse.json({ hotel: Array.isArray(upd) ? upd[0] : upd });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "patch failed" }, { status: 500 });
  }
}
