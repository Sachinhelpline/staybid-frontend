import { NextResponse } from "next/server";
import { manualOverride, setFloor } from "@/lib/pricing/engine";

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// POST /api/pricing/override/:room_id     — hotel sets price manually (disables AI)
// PATCH /api/pricing/override/:room_id    — hotel sets floor only
export async function POST(req: Request, { params }: { params: { room_id: string } }) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { price } = await req.json();
    if (!price) return NextResponse.json({ error: "price required" }, { status: 400 });
    const r = await manualOverride(params.room_id, Number(price), payload.id);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "override failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { room_id: string } }) {
  try {
    const { floor } = await req.json();
    if (!floor) return NextResponse.json({ error: "floor required" }, { status: 400 });
    const r = await setFloor(params.room_id, Number(floor));
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "floor failed" }, { status: 500 });
  }
}
