import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// GET  /api/verify/complaint?customerId=... | hotelId=...
// POST /api/verify/complaint { bookingId, hotelId, requestId?, evidenceVideoId?, category, description }
// PATCH /api/verify/complaint { id, status, resolution, resolution_notes }
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const customerId = u.searchParams.get("customerId");
    const hotelId = u.searchParams.get("hotelId");
    let q = "order=created_at.desc&limit=100";
    if (customerId) q = `customer_id=eq.${customerId}&${q}`;
    else if (hotelId) q = `hotel_id=eq.${hotelId}&${q}`;
    const rows = await sbSelect<any>("vp_complaints", q);
    return NextResponse.json({ complaints: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "list failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.bookingId || !body.hotelId) return NextResponse.json({ error: "bookingId + hotelId required" }, { status: 400 });

    const row = await sbInsert("vp_complaints", {
      booking_id: body.bookingId,
      bid_id: body.bidId || null,
      hotel_id: body.hotelId,
      customer_id: payload.id,
      request_id: body.requestId || null,
      evidence_video_id: body.evidenceVideoId || null,
      category: body.category || "other",
      description: body.description || "",
      status: "open",
    });
    return NextResponse.json({ complaint: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "create failed" }, { status: 500 });
  }
}

// Admin/partner action
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const patch: any = { updated_at: new Date().toISOString() };
    if (body.status) patch.status = body.status;
    if (body.resolution) patch.resolution = body.resolution;
    if (body.resolution_notes) patch.resolution_notes = body.resolution_notes;
    if (body.status === "resolved") patch.resolved_at = new Date().toISOString();
    const upd = await sbUpdate("vp_complaints", `id=eq.${body.id}`, patch);
    return NextResponse.json({ complaint: Array.isArray(upd) ? upd[0] : upd });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 });
  }
}
