import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveOperatedHotelIds } from "@/lib/partner/operator-access";
import { SB_URL, SB_KEY } from "@/lib/sb";

// v285 — Multi-property support.
// Returns the LIGHT list of every hotel this partner owns (across the customer
// `users` + `onboarding_users` pools) so the dashboard can render a property
// switcher. Single-hotel owners get a 1-item array and see no switcher.
//
// This is the sibling of /api/partner/hotel (which returns ONE hotel's full
// detail). Kept lightweight — no rooms/bookings/paid-amount joins.

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

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

  // Circle operators own physical units on StayBid-operated hotels (no ownerId
  // match) — union those hotel ids into the scope.
  const operatedIds = await resolveOperatedHotelIds(ownerIds);

  const SELECT = "id,name,city,state,images,status,account_type,circle_bundle_id,starRating";
  const ownerFilter = `ownerId.in.(${ownerIds.join(",")})`;
  const filter = operatedIds.length
    ? `or=(${ownerFilter},id.in.(${operatedIds.map((i) => encodeURIComponent(i)).join(",")}))`
    : `ownerId=in.(${ownerIds.join(",")})`;

  const hRes = await fetch(
    `${SB_URL}/rest/v1/hotels?${filter}&select=${SELECT}&order=createdAt.asc`,
    { headers: SB_H }
  );
  const hotels = await hRes.json().catch(() => []);
  const list = Array.isArray(hotels) ? hotels : [];

  return NextResponse.json({ hotels: list, count: list.length });
}
