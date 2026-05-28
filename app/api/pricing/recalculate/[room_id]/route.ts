import { NextResponse } from "next/server";
import { recalculateRoomPrice } from "@/lib/pricing/engine";

// POST /api/pricing/recalculate/:room_id  — manual or cron-triggered AI recalc
export async function POST(_req: Request, props: { params: Promise<{ room_id: string }> }) {
  const params = await props.params;
  try {
    const r = await recalculateRoomPrice(params.room_id);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "recalc failed" }, { status: 500 });
  }
}
