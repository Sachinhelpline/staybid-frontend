import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";
  const filter = status === "all" ? "" : `verification_status=eq.${encodeURIComponent(status)}&`;

  const res = await fetch(
    `${SB_URL}/rest/v1/hotel_videos?${filter}select=*&order=created_at.desc&limit=200`,
    { headers: SB_H }
  );
  const videos = res.ok ? await res.json() : [];
  const list: any[] = Array.isArray(videos) ? videos : [];

  // Enrich with hotel name in one batch
  const hotelIds = Array.from(new Set(list.map((v: any) => v.hotel_id).filter(Boolean)));
  let hotelMap: Record<string, any> = {};
  if (hotelIds.length) {
    const hRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map((i) => encodeURIComponent(i)).join(",")})&select=id,name,city`,
      { headers: SB_H }
    );
    const arr = hRes.ok ? await hRes.json() : [];
    if (Array.isArray(arr)) for (const h of arr) hotelMap[h.id] = h;
  }

  const enriched = list.map((v: any) => ({ ...v, hotel: hotelMap[v.hotel_id] || null }));
  return NextResponse.json({ videos: enriched, total: enriched.length });
}
