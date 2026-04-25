import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, SB } from "@/lib/onboard/supabase-admin";

// Hotel + room image registry. The actual file is uploaded via /api/onboard/upload;
// then this endpoint records the URL into the matching table.
//
// POST   /api/onboard/images     { scope: "hotel"|"room", hotel_id, room_id?, url, storage_path?, sort_order?, kind? }
// DELETE /api/onboard/images?scope=hotel&id=...
// GET    /api/onboard/images?scope=hotel&hotel_id=... | scope=room&room_id=...
export async function GET(req: Request) {
  try {
    requireOnboardUser(req);
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope");
    if (scope === "hotel") {
      const hotel_id = url.searchParams.get("hotel_id");
      if (!hotel_id) return NextResponse.json({ images: [] });
      const rows = await sbSelect<any>("hotel_images", `hotel_id=eq.${encodeURIComponent(hotel_id)}&order=sort_order.asc`);
      return NextResponse.json({ images: rows });
    }
    if (scope === "room") {
      const room_id = url.searchParams.get("room_id");
      if (!room_id) return NextResponse.json({ images: [] });
      const rows = await sbSelect<any>("room_images", `room_id=eq.${encodeURIComponent(room_id)}&order=sort_order.asc`);
      return NextResponse.json({ images: rows });
    }
    return NextResponse.json({ error: "scope must be hotel|room" }, { status: 400 });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    requireOnboardUser(req);
    const body = await req.json();
    if (body.scope === "hotel") {
      if (!body.hotel_id || !body.url) return NextResponse.json({ error: "hotel_id + url required" }, { status: 400 });
      const row = await sbInsert("hotel_images", {
        hotel_id: body.hotel_id, url: body.url, storage_path: body.storage_path || null,
        kind: body.kind || "gallery", sort_order: body.sort_order ?? 0,
      });
      return NextResponse.json({ image: row });
    }
    if (body.scope === "room") {
      if (!body.room_id || !body.hotel_id || !body.url) return NextResponse.json({ error: "hotel_id + room_id + url required" }, { status: 400 });
      const row = await sbInsert("room_images", {
        room_id: body.room_id, hotel_id: body.hotel_id, url: body.url,
        storage_path: body.storage_path || null, sort_order: body.sort_order ?? 0,
      });
      return NextResponse.json({ image: row });
    }
    return NextResponse.json({ error: "scope must be hotel|room" }, { status: 400 });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "image save failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    requireOnboardUser(req);
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope");
    const id = url.searchParams.get("id");
    if (!id || (scope !== "hotel" && scope !== "room")) return NextResponse.json({ error: "scope+id required" }, { status: 400 });
    const table = scope === "hotel" ? "hotel_images" : "room_images";
    await fetch(`${SB.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SB.key}`, apikey: SB.key },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "image delete failed" }, { status: 500 });
  }
}
