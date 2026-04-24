// PATCH /api/rooms/:id/images   body: { images: string[] }
// Hotel-owner endpoint for maintaining a room's image gallery. Used by the
// partner dashboard "Rooms & Pricing" tab so owners can self-manage photos
// without needing a dev to edit the DB.
//
// Ownership is verified through the dual-user-id resolver — a phone may live
// in the users table with or without the +91 prefix.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, authPayload, resolveUserIds } from "@/lib/sb-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const images: string[] = Array.isArray(body?.images) ? body.images.filter((u: any) => typeof u === "string") : null;
  if (!images) return NextResponse.json({ error: "images: string[] required" }, { status: 400 });

  // Verify the room belongs to a hotel this user owns
  const ownerIds = await resolveUserIds(primaryId, payload?.phone);
  const roomsRes = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${params.id}&select=id,hotelId`, { headers: SB_H });
  const rooms = await roomsRes.json();
  if (!Array.isArray(rooms) || !rooms[0]) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const hotelsRes = await fetch(`${SB_URL}/rest/v1/hotels?id=eq.${rooms[0].hotelId}&ownerId=in.(${ownerIds.join(",")})&select=id`, { headers: SB_H });
  const hotels = await hotelsRes.json();
  if (!Array.isArray(hotels) || hotels.length === 0)
    return NextResponse.json({ error: "Not authorized for this room" }, { status: 403 });

  const r = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${params.id}`, {
    method: "PATCH",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify({ images }),
  });
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: t || "Update failed" }, { status: 500 });
  }
  const updated = await r.json();
  return NextResponse.json({ ok: true, room: updated[0] });
}
