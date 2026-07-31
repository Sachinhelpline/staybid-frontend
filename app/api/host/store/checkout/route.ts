import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public Razorpay key (safe in client). Server-side secret stays in the
// /api/razorpay/order self-healing route, which this endpoint calls internally.
import { razorpayKeyId } from "@/lib/razorpay-server";

// Public checkout key id — server env only (hotfix v621.2, RAZORPAY_KEY_ID);
// the POST fails closed with payment_config_missing when absent/malformed.
const PUBLIC_KEY_ID = razorpayKeyId();

const DELIVERY_FEE = 0; // free delivery for now
type Mode = "buy" | "rent" | "emi";

// POST /api/host/store/checkout
// Body: { items: [{ productId, mode, qty }], emiMonths?, address?, contact?, notes? }
// Server re-prices every line from store_products — the client price is ignored.
export async function POST(req: Request) {
  if (!PUBLIC_KEY_ID) return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
  }

  const contact = body?.contact && typeof body.contact === "object" ? body.contact : {};
  const contactPhone = String(contact?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  const contactName = String(contact?.name || "").trim().slice(0, 120);
  if (!contactName || contactPhone.length < 8) {
    return NextResponse.json({ error: "Name and a valid phone are required." }, { status: 400 });
  }

  // Dedup + clamp the requested item list.
  const wanted = new Map<string, { mode: Mode; qty: number }>();
  for (const it of items) {
    const pid = String(it?.productId || "").trim();
    const mode: Mode = (["buy", "rent", "emi"].includes(it?.mode) ? it.mode : "buy") as Mode;
    const qty = Math.max(1, Math.min(50, Math.round(Number(it?.qty) || 1)));
    if (pid) wanted.set(`${pid}|${mode}`, { mode, qty });
  }
  const ids = Array.from(new Set(Array.from(wanted.keys()).map((k) => k.split("|")[0])));
  if (!ids.length) {
    return NextResponse.json({ error: "No valid products in cart." }, { status: 400 });
  }

  // Pull the authoritative product rows.
  let products: any[] = [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/store_products?id=in.(${ids.join(",")})&active=eq.true&in_stock=eq.true`
      + `&select=id,name,buy_price,rent_monthly,emi_available,emi_min_months`,
      { headers: SB_READ, cache: "no-store" },
    );
    products = r.ok ? await r.json() : [];
  } catch {
    return NextResponse.json({ error: "Could not load products." }, { status: 502 });
  }
  const byId = new Map(products.map((p) => [p.id, p]));

  const emiMonths = Math.max(0, Math.min(24, Math.round(Number(body?.emiMonths) || 0)));
  const orderItems: any[] = [];
  let subtotal = 0;
  let anyEmi = false;

  Array.from(wanted.entries()).forEach(([key, { mode, qty }]) => {
    const pid = key.split("|")[0];
    const p = byId.get(pid);
    if (!p) return; // silently drop unavailable items

    let unit = 0;
    if (mode === "rent") {
      if (p.rent_monthly == null) return; // not rentable
      unit = Number(p.rent_monthly);
    } else if (mode === "emi") {
      if (!p.emi_available) return; // not EMI-eligible
      unit = Number(p.buy_price);
      anyEmi = true;
    } else {
      unit = Number(p.buy_price);
    }
    if (!Number.isFinite(unit) || unit <= 0) return;

    const line = Math.round(unit * qty);
    subtotal += line;
    orderItems.push({ product_id: pid, name: p.name, mode, unit_price: unit, qty, line_total: line });
  });

  if (!orderItems.length) {
    return NextResponse.json({ error: "None of the cart items are purchasable in the chosen mode." }, { status: 400 });
  }

  const total = subtotal + DELIVERY_FEE;
  const chargeable = anyEmi && emiMonths > 0 ? Math.round(total / emiMonths) : total; // first instalment for EMI

  // Create the Razorpay order via the self-healing internal route (single
  // source of Razorpay key logic). Amount is the SERVER-computed chargeable.
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: chargeable,
        receipt: `store_${Date.now()}`,
        notes: { kind: "host_store", items: orderItems.length },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json(
        { error: rzp?.error || "Could not start payment.", detail: rzp?.code || null },
        { status: 502 },
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  // Persist the order + items (status 'pending' until verify).
  const user = userFromReq(req);
  const orderRow = {
    user_id: user?.id || null,
    hotel_id: String(body?.hotelId || "").trim() || null,
    mode: anyEmi ? "emi" : (orderItems.every((i) => i.mode === "rent") ? "rent" : "buy"),
    status: "pending",
    subtotal,
    delivery_fee: DELIVERY_FEE,
    total,
    emi_months: anyEmi && emiMonths > 0 ? emiMonths : null,
    razorpay_order_id: rzp.id,
    address: body?.address && typeof body.address === "object" ? body.address : null,
    contact: { name: contactName, phone: contactPhone, email: String(contact?.email || "").trim().slice(0, 160) || null },
    notes: String(body?.notes || "").trim().slice(0, 1000) || null,
  };

  let orderId: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/store_orders`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(orderRow),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save order", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    orderId = saved?.id || null;

    if (orderId && orderItems.length) {
      await fetch(`${SB_URL}/rest/v1/store_order_items`, {
        method: "POST",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify(orderItems.map((i) => ({ ...i, order_id: orderId }))),
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: "Order save failed.", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    orderId,
    razorpayOrderId: rzp.id,
    amount: chargeable,
    total,
    subtotal,
    emiMonths: orderRow.emi_months,
    keyId: PUBLIC_KEY_ID,
  });
}
