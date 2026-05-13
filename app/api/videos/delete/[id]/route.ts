import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const cur = await fetch(`${SB_URL}/rest/v1/hotel_videos?id=eq.${encodeURIComponent(params.id)}&select=uploaded_by`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  const row = Array.isArray(cur) && cur[0] ? cur[0] : null;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.uploaded_by !== payload.id && payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const del = await fetch(`${SB_URL}/rest/v1/hotel_videos?id=eq.${encodeURIComponent(params.id)}`, { method: "DELETE", headers: SB_H });
  if (!del.ok) return NextResponse.json({ error: "Delete failed", detail: await del.text() }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
