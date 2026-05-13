import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET() {
  const res = await fetch(
    `${SB_URL}/rest/v1/rooms?select=id,type,floorPrice,aiPrice,hotelId,hotels(name,city)&order=hotelId.asc&limit=500`,
    { headers: H }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ rooms: data });
}

export async function PATCH(req: NextRequest) {
  const { roomId, floorPrice, aiPrice } = await req.json();
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });
  const patch: any = {};
  if (floorPrice != null) patch.floorPrice = Number(floorPrice);
  if (aiPrice != null) patch.aiPrice = Number(aiPrice);
  const res = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${roomId}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return NextResponse.json({ ok: res.ok });
}
