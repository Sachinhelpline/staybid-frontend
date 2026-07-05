import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import {
  computeBundle,
  CIRCLE_PLANS,
  HOLD_FRACTION,
  type BundleItem,
  type PaymentPlanKey,
} from "@/lib/circle/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";

// POST /api/circle/checkout
// Body: { items: [{roomTypeId, rooms}], plan, contact: {name, phone, email} }
//
// TAMPER-SAFE: the client only sends roomTypeId + rooms count. Every rate,
// ROI band and the final charge is re-derived here from the DB rows +
// lib/circle/engine — the client NEVER sets an amount (same contract as the
// host wizard + service-subscription + store checkouts).
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const rawItems: any[] = Array.isArray(body?.items) ? body.items.slice(0, 12) : [];
  const planKey: PaymentPlanKey = CIRCLE_PLANS[body?.plan as PaymentPlanKey]
    ? (body.plan as PaymentPlanKey)
    : "monthly";
  const payOption: "full" | "hold" | "emi" =
    body?.payOption === "hold" || body?.payOption === "emi" ? body.payOption : "full";

  const contact = body?.contact && typeof body.contact === "object" ? body.contact : {};
  const name = String(contact?.name || "").trim().slice(0, 120);
  const phone = String(contact?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!name || phone.length < 8) {
    return NextResponse.json({ error: "Name aur valid phone required hai." }, { status: 400 });
  }

  const roomTypeIds = rawItems
    .map((it) => String(it?.roomTypeId || "").trim())
    .filter(Boolean);
  if (!roomTypeIds.length) {
    return NextResponse.json({ error: "Bundle me kam se kam 1 room add karein." }, { status: 400 });
  }

  // Authoritative rates from DB.
  let roomTypes: any[] = [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_room_types?id=in.(${roomTypeIds.map((i) => `"${i}"`).join(",")})&active=eq.true&select=*`,
      { headers: SB_H },
    );
    roomTypes = r.ok ? await r.json() : [];
  } catch {
    return NextResponse.json({ error: "Catalog unreachable — thodi der me try karein." }, { status: 502 });
  }
  if (!roomTypes.length) {
    return NextResponse.json({ error: "Selected rooms ab available nahi hain." }, { status: 404 });
  }

  const propIds: string[] = [];
  roomTypes.forEach((rt: any) => {
    const pid = String(rt.property_id);
    if (!propIds.includes(pid)) propIds.push(pid);
  });
  let props: any[] = [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_properties?id=in.(${propIds.map((i) => `"${i}"`).join(",")})&status=eq.active&select=*`,
      { headers: SB_H },
    );
    props = r.ok ? await r.json() : [];
  } catch { /* handled below */ }
  const propById = Object.fromEntries(props.map((p: any) => [String(p.id), p]));

  // Build authoritative bundle items + availability guard.
  const items: BundleItem[] = [];
  for (const rt of roomTypes) {
    const requested = rawItems.find((it) => String(it?.roomTypeId) === String(rt.id));
    const rooms = Math.max(0, Math.floor(Number(requested?.rooms) || 0));
    if (rooms <= 0) continue;

    const prop = propById[String(rt.property_id)];
    if (!prop) {
      return NextResponse.json({ error: "Ek property ab active nahi hai — bundle refresh karein." }, { status: 409 });
    }
    const available = Math.max(0, (Number(rt.total_units) || 0) - (Number(rt.locked_units) || 0));
    if (rooms > available) {
      return NextResponse.json(
        {
          error: `${prop.title} — ${rt.name}: sirf ${available} unit available hai.`,
          roomTypeId: rt.id,
          maxAvailable: available,
        },
        { status: 409 },
      );
    }

    items.push({
      propertyId: String(prop.id),
      propertyTitle: String(prop.title),
      city: String(prop.city),
      roomTypeId: String(rt.id),
      roomTypeName: String(rt.name),
      monthlyRate: Number(rt.monthly_rate) || 0,   // DB rate — never client's
      rooms,
      roiMin: Number(prop.roi_min_pct) || 0,
      roiMax: Number(prop.roi_max_pct) || 0,
    });
  }

  const bundle = computeBundle(items, planKey);
  if (!bundle.ok || bundle.payNow <= 0) {
    return NextResponse.json({ error: bundle.error || "Invalid bundle." }, { status: 400 });
  }
  // Monthly plan is restricted to a single property (Sachin's rule).
  if (bundle.monthlyPlanBlocked) {
    return NextResponse.json(
      { error: "Monthly plan sirf 1 property ke liye hai — quarterly ya usse bada plan choose karein, ya bundle me 1 hi property rakhein." },
      { status: 400 },
    );
  }

  // Pay-option amounts (server-authoritative — client never sets a ₹).
  const holdAmount = Math.round(bundle.payNow * HOLD_FRACTION);
  const chargeable = payOption === "hold" ? holdAmount : bundle.payNow;
  const balanceDue = payOption === "hold" ? bundle.payNow - holdAmount : 0;

  // Razorpay order via the shared self-healing route (amount in rupees).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: chargeable,
        receipt: `circle_${Date.now()}`,
        notes: {
          kind: "circle_bundle",
          plan: bundle.plan,
          pay_option: payOption,
          properties: String(bundle.propertyCount),
          rooms: String(bundle.roomCount),
        },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json(
        { error: rzp?.error || "Payment start nahi hua.", detail: rzp?.code || null },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  const user = userFromReq(req);
  const row = {
    user_id: user?.id || null,
    items: bundle.items,
    payment_plan: bundle.plan,
    monthly_total: bundle.monthlyTotal,
    discount_pct: bundle.discountPct,
    pay_now: bundle.payNow,
    pay_option: payOption,
    charged_amount: chargeable,
    hold_amount: payOption === "hold" ? holdAmount : null,
    balance_due: balanceDue,
    security_amount: bundle.securityAmount,
    advance_amount: bundle.advanceAmount,
    expected_monthly_income: bundle.expectedMonthlyIncome,
    expected_roi_min: bundle.expectedRoiMin,
    expected_roi_max: bundle.expectedRoiMax,
    payback_label: bundle.paybackLabel,
    breakdown: bundle,
    contact: { name, phone, email: String(contact?.email || "").trim().slice(0, 160) || null },
    status: "pending_payment",
    razorpay_order_id: rzp.id,
  };

  let bundleId: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/circle_bundles`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Bundle save nahi hua", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    bundleId = saved?.id || null;
  } catch (e: any) {
    return NextResponse.json({ error: "Save failed.", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    bundleId,
    razorpayOrderId: rzp.id,
    amount: chargeable,
    payOption,
    holdAmount: payOption === "hold" ? holdAmount : 0,
    balanceDue,
    keyId: PUBLIC_KEY_ID,
    breakdown: bundle,
  });
}
