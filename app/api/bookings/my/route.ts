import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect } from "@/lib/sb-server";

export async function GET(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookings = await sbSelect(`bookings?customerId=eq.${customerId}&select=*`);
  if (!bookings.length) return NextResponse.json({ bookings: [] });

  const hotelIds = [...new Set(bookings.map((b: any) => b.hotelId).filter(Boolean))];
  const roomIds  = [...new Set(bookings.map((b: any) => b.roomId).filter(Boolean))];

  const [hotels, rooms] = await Promise.all([
    hotelIds.length ? sbSelect(`hotels?id=in.(${hotelIds.join(",")})&select=*`) : Promise.resolve([]),
    roomIds.length  ? sbSelect(`rooms?id=in.(${roomIds.join(",")})&select=*`)   : Promise.resolve([]),
  ]);

  const enriched = bookings.map((b: any) => ({
    ...b,
    hotel: hotels.find((h: any) => h.id === b.hotelId) || null,
    room:  rooms.find((r: any) => r.id === b.roomId)  || null,
  }));

  enriched.sort((a: any, b: any) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  return NextResponse.json({ bookings: enriched });
}
