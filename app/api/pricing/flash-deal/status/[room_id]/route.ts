import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/pricing/flash-deal/status/:room_id
// Customer-safe: returns current_price + validUntil + start_price for the
// dropping animation. Never returns floor_price or drop_amount.
export async function GET(_req: Request, { params }: { params: { room_id: string } }) {
  try {
    const nowIso = new Date().toISOString();
    const rows = await sbSelect<any>(
      "flash_deals",
      `roomId=eq.${params.room_id}&isActive=eq.true&validUntil=gt.${encodeURIComponent(nowIso)}&order=createdAt.desc&limit=1`
    );
    const d = rows[0];
    if (!d) return NextResponse.json({ active: false });
    return NextResponse.json({
      active: true,
      dealId: d.id,
      currentPrice: Number(d.aiPrice),
      startPrice: Number(d.start_price) || Number(d.aiPrice),
      discount: Number(d.discount) || 0,
      validUntil: d.validUntil,
      maxBookings: d.maxBookings,
      bookingCount: d.bookingCount || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "status failed" }, { status: 500 });
  }
}
