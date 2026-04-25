import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";

// GET  /api/onboard/kyc?hotelId=...   → existing KYC for this user/hotel (or null)
// POST /api/onboard/kyc                → create or update
export async function GET(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const hotelId = new URL(req.url).searchParams.get("hotelId");
    let q = `user_id=eq.${claims.sub}&order=updated_at.desc&limit=1`;
    if (hotelId) q = `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotelId)}&order=updated_at.desc&limit=1`;
    const rows = await sbSelect<any>("kyc_submissions", q);
    return NextResponse.json({ kyc: rows[0] || null });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "kyc fetch failed" }, { status: 500 });
  }
}

const REQUIRED_CONSENTS = [
  "consent_listing", "consent_price_compare", "consent_image_rights", "consent_legal",
];

export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();

    // Validate consents (frontend should already gate, this is defense-in-depth)
    for (const k of REQUIRED_CONSENTS) {
      if (!body[k]) return NextResponse.json({ error: `Missing consent: ${k}` }, { status: 400 });
    }
    if (!body.owner_full_name) return NextResponse.json({ error: "Owner full name required" }, { status: 400 });
    if (!body.business_legal_name) return NextResponse.json({ error: "Business legal name required" }, { status: 400 });

    const row: any = {
      user_id: claims.sub,
      hotel_id: body.hotel_id || null,
      owner_full_name: body.owner_full_name,
      owner_dob: body.owner_dob || null,
      owner_pan: body.owner_pan || null,
      owner_aadhaar_last4: body.owner_aadhaar_last4 || null,
      owner_address: body.owner_address || null,
      business_legal_name: body.business_legal_name,
      business_type: body.business_type || null,
      business_gstin: body.business_gstin || null,
      business_pan: body.business_pan || null,
      business_address: body.business_address || null,
      business_state: body.business_state || null,
      business_pincode: body.business_pincode || null,
      doc_owner_id_url: body.doc_owner_id_url || null,
      doc_property_proof_url: body.doc_property_proof_url || null,
      doc_business_pan_url: body.doc_business_pan_url || null,
      doc_gst_url: body.doc_gst_url || null,
      consent_listing: !!body.consent_listing,
      consent_price_compare: !!body.consent_price_compare,
      consent_image_rights: !!body.consent_image_rights,
      consent_legal: !!body.consent_legal,
      consent_signed_at: new Date().toISOString(),
      status: "submitted",
      updated_at: new Date().toISOString(),
    };

    // Upsert: if a submission exists for this (user, hotel), update; else insert.
    const existing = await sbSelect<any>(
      "kyc_submissions",
      `user_id=eq.${claims.sub}${body.hotel_id ? `&hotel_id=eq.${encodeURIComponent(body.hotel_id)}` : ""}&order=updated_at.desc&limit=1`
    );
    let kyc;
    if (existing[0]) {
      const upd = await sbUpdate("kyc_submissions", `id=eq.${existing[0].id}`, row);
      kyc = Array.isArray(upd) ? upd[0] : upd;
    } else {
      kyc = await sbInsert("kyc_submissions", row);
    }
    return NextResponse.json({ kyc });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "kyc save failed" }, { status: 500 });
  }
}
