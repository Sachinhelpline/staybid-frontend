import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { resolveRoomListings } from "@/lib/circle/room-listings";


const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [hotelRes, roomsRes, reviewsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?id=eq.${id}&select=*`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/rooms?hotelId=eq.${id}&select=*`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/reviews?hotelId=eq.${id}&select=*&limit=20`, { headers: SB_H }),
  ]);

  let hotels:  any[] = [];
  let rooms:   any[] = [];
  let reviews: any[] = [];
  try { hotels  = JSON.parse(await hotelRes.text());   if (!Array.isArray(hotels))  hotels  = []; } catch { hotels  = []; }
  try { rooms   = JSON.parse(await roomsRes.text());   if (!Array.isArray(rooms))   rooms   = []; } catch { rooms   = []; }
  try { reviews = JSON.parse(await reviewsRes.text()); if (!Array.isArray(reviews)) reviews = []; } catch { reviews = []; }

  if (!hotels[0]) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  // Phase 3 — individual-room listings. For a hotel with investor-owned physical
  // rooms, each becomes its own Airbnb-style listing (own price/amenities/photos/
  // host-rating). A hotel with no owned units → individualRooms:false + [] → the
  // customer page renders category cards exactly as today. Additive.
  // PERF: only StayBid-operated / circle hotels can have owned units — skip the
  // extra query for every classic hotel_owner hotel (the default).
  const roomsArr = Array.isArray(rooms) ? rooms : [];
  const acct = String(hotels[0]?.account_type || "hotel_owner");
  const { individualRooms, listings } =
    acct === "hotel_owner"
      ? { individualRooms: false, listings: [] as any[] }
      : await resolveRoomListings(id, roomsArr);

  const hotel = {
    ...hotels[0],
    rooms: roomsArr,
    reviews: Array.isArray(reviews) ? reviews : [],
    individualRooms,
    roomListings: listings,
  };

  return NextResponse.json({ hotel });
}
