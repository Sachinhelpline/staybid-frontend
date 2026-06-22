import { NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

// GET /api/host/store/orders — the signed-in user's store orders + line items.
export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ orders: [] });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/store_orders?user_id=eq.${user.id}&order=created_at.desc&limit=50`
      + `&select=id,mode,status,subtotal,delivery_fee,total,emi_months,razorpay_order_id,razorpay_payment_id,created_at`,
      { headers: SB_READ, cache: "no-store" },
    );
    const orders = r.ok ? await r.json() : [];
    if (!orders.length) return NextResponse.json({ orders: [] });

    const ids = orders.map((o: any) => o.id);
    const ir = await fetch(
      `${SB_URL}/rest/v1/store_order_items?order_id=in.(${ids.join(",")})&select=order_id,name,mode,unit_price,qty,line_total`,
      { headers: SB_READ, cache: "no-store" },
    );
    const allItems = ir.ok ? await ir.json() : [];
    const byOrder = new Map<string, any[]>();
    for (const it of allItems) {
      const arr = byOrder.get(it.order_id) || [];
      arr.push(it);
      byOrder.set(it.order_id, arr);
    }
    return NextResponse.json({
      orders: orders.map((o: any) => ({ ...o, items: byOrder.get(o.id) || [] })),
    });
  } catch (e: any) {
    return NextResponse.json({ orders: [], error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
