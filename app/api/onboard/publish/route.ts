import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";

// POST /api/onboard/publish { hotel_id }
// Gated publish: refuses to publish unless every required readiness gate
// is satisfied. Mirrors the checklist from /api/onboard/listing.
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const { hotel_id } = await req.json();
    if (!hotel_id) return NextResponse.json({ error: "hotel_id required" }, { status: 400 });

    const hRows = await sbSelect<any>("hotels", `id=eq.${encodeURIComponent(hotel_id)}&"ownerId"=eq.${claims.sub}&limit=1`);
    const hotel = hRows[0];
    if (!hotel) return NextResponse.json({ error: "hotel not found or not yours" }, { status: 404 });

    const [rooms, hotelImgs, kyc, bank, agr] = await Promise.all([
      sbSelect<any>("rooms", `"hotelId"=eq.${encodeURIComponent(hotel_id)}&limit=20`),
      sbSelect<any>("hotel_images", `hotel_id=eq.${encodeURIComponent(hotel_id)}&limit=50`),
      sbSelect<any>("kyc_submissions", `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotel_id)}&limit=1`),
      sbSelect<any>("bank_details", `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotel_id)}&limit=1`),
      sbSelect<any>("host_agreements", `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotel_id)}&limit=1`),
    ]);

    const checklist = {
      basics: !!(hotel.name && hotel.city),
      images: hotelImgs.length >= 3,
      rooms: rooms.length >= 1,
      kyc: !!(kyc[0] && kyc[0].consent_listing && kyc[0].consent_price_compare && kyc[0].consent_image_rights && kyc[0].consent_legal),
      bank: !!bank[0],
      agreement: !!agr[0],
      previewViewed: !!hotel.preview_viewed,
    };
    const missing = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      return NextResponse.json({ error: "Cannot publish — missing requirements", missing, checklist }, { status: 400 });
    }

    const upd = await sbUpdate("hotels", `id=eq.${encodeURIComponent(hotel_id)}`, {
      status: "published",
      published_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, hotel: Array.isArray(upd) ? upd[0] : upd });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "publish failed" }, { status: 500 });
  }
}
