import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { logAdminAction } from "@/lib/admin/audit";
import { SB_URL, SB_KEY } from "@/lib/sb";



async function sb(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  try {
    // v262 — surface approval_status + submitted_for_review_at so the admin
    // can run the verify-before-live review queue.
    const approval = searchParams.get("approval");
    // v310 (Host Property-Listing, Phase 5) — surface owner_type + account_type
    // so the admin can distinguish a StayBid-operated (host_circle / circle)
    // hotel from a classic owner-run one.
    let query = "hotels?select=id,name,city,state,ownerId,owner_type,account_type,status,approval_status,isVerified,submitted_for_review_at,published_at,images,starRating,createdAt&order=createdAt.desc&limit=200";
    if (city && city !== "all") query += `&city=eq.${city}`;
    if (status && status !== "all") query += `&status=eq.${status}`;
    if (approval && approval !== "all") query += `&approval_status=eq.${approval}`;

    let hotels = (await sb(query)) as any[];

    if (search) {
      const s = search.toLowerCase();
      hotels = hotels.filter(
        (h) => h.name?.toLowerCase().includes(s) || h.city?.toLowerCase().includes(s)
      );
    }

    const [rooms, bookings] = await Promise.all([
      sb("rooms?select=id,hotelId,type,floorPrice,aiPrice"),
      sb("bookings?select=id,hotelId,totalAmount,status,createdAt"),
    ]);

    const enriched = hotels.map((h: any) => {
      const hotelRooms = (rooms as any[]).filter((r) => r.hotelId === h.id);
      const hotelBookings = (bookings as any[]).filter((b) => b.hotelId === h.id);
      const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
      const monthBookings = hotelBookings.filter((b) => new Date(b.createdAt) >= monthAgo);
      const gmv = hotelBookings.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
      return {
        ...h,
        roomsCount: hotelRooms.length,
        bookingsThisMonth: monthBookings.length,
        gmv,
        commission: h.commission || 5,
      };
    });

    return NextResponse.json({ hotels: enriched, total: enriched.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { hotelId, action, value } = await req.json();
  try {
    let update: Record<string, unknown> = {};
    if (action === "status") update = { status: value };
    else if (action === "commission") update = { commission: value };
    // v262 — admin verify-before-live actions. Approve makes the hotel
    // discoverable across every customer surface (the gate filters on
    // approval_status='approved'); reject keeps it hidden with a reason.
    else if (action === "approve")
      update = {
        approval_status: "approved",
        status: "active",
        isVerified: true,
        published_at: new Date().toISOString(),
      };
    else if (action === "reject")
      update = { approval_status: "rejected", rejection_reason: value ?? null };
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    // The reject path may reference a column the DB doesn't have yet; strip it
    // and retry so the core status flip always lands.
    const doPatch = async (body: Record<string, unknown>) =>
      fetch(`${SB_URL}/rest/v1/hotels?id=eq.${hotelId}`, {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });

    let res = await doPatch(update);
    if (!res.ok && action === "reject" && "rejection_reason" in update) {
      // DB without rejection_reason column → retry with just the status flip.
      const { rejection_reason, ...rest } = update as any;
      res = await doPatch(rest);
    }
    const data = await res.json();

    // v98 — audit
    logAdminAction({
      admin: auditIdentity(admin),
      action: `hotel.${action}`,
      targetType: "hotel",
      targetId: hotelId,
      details: { value },
    });

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
