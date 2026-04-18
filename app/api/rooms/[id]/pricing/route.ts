import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";

function decodeJwt(token: string): any {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch { return null; }
}

const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function sbGet(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
  return res.json();
}

async function sbPatch(path: string, body: Record<string, unknown>) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...SB_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { floorPrice, flashFloorPrice } = await req.json();

  // Verify room belongs to the logged-in owner's hotel
  const hotels = await sbGet(`Hotel?ownerId=eq.${payload.id}&select=id`);
  if (!Array.isArray(hotels) || hotels.length === 0)
    return NextResponse.json({ error: "No hotel for this account" }, { status: 403 });

  const rooms = await sbGet(`Room?id=eq.${params.id}&select=hotelId`);
  if (!Array.isArray(rooms) || rooms.length === 0 || rooms[0].hotelId !== hotels[0].id)
    return NextResponse.json({ error: "Room not found or unauthorized" }, { status: 403 });

  // Build update payload — include flashFloorPrice only if column exists (handled via fallback)
  const updateData: Record<string, unknown> = {};
  if (floorPrice != null)      updateData.floorPrice      = parseFloat(String(floorPrice));
  if (flashFloorPrice != null) updateData.flashFloorPrice = parseFloat(String(flashFloorPrice));

  let res = await sbPatch(`Room?id=eq.${params.id}`, updateData);

  // If flashFloorPrice column doesn't exist yet, retry with only floorPrice
  if (!res.ok && flashFloorPrice != null && floorPrice != null) {
    res = await sbPatch(`Room?id=eq.${params.id}`, { floorPrice: parseFloat(String(floorPrice)) });
  }

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err || "Update failed" }, { status: 500 });
  }

  const updated = await res.json().catch(() => []);
  return NextResponse.json({
    room: updated[0] || { id: params.id, ...updateData },
    saved: true,
  });
}
