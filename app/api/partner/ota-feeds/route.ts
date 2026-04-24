// CRUD for OTA iCal feeds (Booking.com / Airbnb / GoIbibo / MMT / Agoda / Other).
// Partners paste their iCal URL; we store it. Sync endpoint fetches + imports.
import { NextRequest, NextResponse } from "next/server";
import { sbInsert, sbSelect, SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

export async function GET(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  try {
    const feeds = await sbSelect(`ota_feeds?hotelId=eq.${hotelId}&select=*&order=createdAt.desc`);
    return NextResponse.json({ feeds });
  } catch (e: any) {
    return NextResponse.json({ feeds: [], warning: e?.message });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, roomId, provider, icalUrl, label } = body;
  if (!hotelId || !roomId || !provider || !icalUrl) {
    return NextResponse.json({ error: "hotelId, roomId, provider, icalUrl required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(icalUrl)) {
    return NextResponse.json({ error: "icalUrl must be http(s)" }, { status: 400 });
  }

  try {
    const row = await sbInsert("ota_feeds", {
      hotelId, roomId, provider, icalUrl, label: label || provider, active: true,
    });
    return NextResponse.json({ ok: true, feed: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    // Delete the feed
    await fetch(`${SB_URL}/rest/v1/ota_feeds?id=eq.${id}`, { method: "DELETE", headers: SB_H });
    // Also remove any blocks this feed had imported
    await fetch(`${SB_URL}/rest/v1/room_blocks?feedId=eq.${id}`, { method: "DELETE", headers: SB_H }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
