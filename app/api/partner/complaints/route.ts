// v98 — Partner-side Complaints feed.
//
// Hotels can see complaints raised against THEIR hotel — both:
//   - public.complaints       (general; new in v98 with /complaints UI)
//   - public.vp_complaints    (video-evidence complaints; existed since Apr 2026)
//
// Read-only for partners. Resolution still happens admin-side.
//
// GET /api/partner/complaints
//   Headers: Authorization: Bearer <sb_partner_token>
//            x-phone / x-email (optional, for cross-pool resolve)
//   Returns: { complaints: [...], vpComplaints: [...], stats: {open,total,...} }

import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { SB_URL, SB_KEY } from "@/lib/sb";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const headerPhone = req.headers.get("x-phone") || "";
  const headerEmail = req.headers.get("x-email") || "";
  const ownerIds = await resolveOwnerIdsCrossPool(payload.id, payload.phone || headerPhone, payload.email || headerEmail);

  // Resolve the partner's hotel(s)
  const hRes = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id,name`,
    { headers: SB_H },
  );
  const hotels: any[] = hRes.ok ? await hRes.json() : [];
  if (!hotels.length) {
    return NextResponse.json({ complaints: [], vpComplaints: [], stats: { open: 0, total: 0 } });
  }
  const hotelIds = hotels.map((h) => h.id);
  const hotelInList = hotelIds.map(encodeURIComponent).join(",");

  // Bulk read both complaint sources in parallel
  const [generalRes, vpRes] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/complaints?"hotelId"=in.(${hotelInList})&select=*&order="createdAt".desc&limit=200`,
      { headers: SB_H },
    ),
    fetch(
      `${SB_URL}/rest/v1/vp_complaints?hotel_id=in.(${hotelInList})&select=*&order=created_at.desc&limit=100`,
      { headers: SB_H },
    ),
  ]);
  const general: any[] = generalRes.ok ? await generalRes.json() : [];
  const vp: any[]      = vpRes.ok      ? await vpRes.json()      : [];

  // Stats — combined open + total
  const openGeneral = general.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const openVp      = vp.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const highPriority = general.filter((c) => c.priority === "high").length;

  return NextResponse.json({
    complaints:    general,
    vpComplaints:  vp,
    hotels,
    stats: {
      open:        openGeneral + openVp,
      total:       general.length + vp.length,
      general:     general.length,
      video:       vp.length,
      highPriority,
    },
  });
}
