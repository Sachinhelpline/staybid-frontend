import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function GET() {
  const [rooms, deals] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/rooms?select=id,aiPrice,floorPrice`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/flash_deals?select=*`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
  ]);

  const aiManaged = (rooms as any[]).filter((r) => r.aiPrice).length;
  const manual = (rooms as any[]).length - aiManaged;

  return NextResponse.json({
    aiManaged,
    manual,
    totalRooms: (rooms as any[]).length,
    flashDeals: deals,
    activeDeals: (deals as any[]).filter((d: any) => new Date(d.validUntil) > new Date()).length,
    lastRecalc: new Date().toISOString(),
  });
}
