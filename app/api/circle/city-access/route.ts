// v348 — Circle Model 2: per-investor city-access paywall (₹999 one-time).
//
//   GET  /api/circle/city-access
//     → { cities: string[], price }  (the caller's ACTIVE cities + live price)
//   POST /api/circle/city-access   { city }
//     → creates a Razorpay order for the admin-priced access fee and an upsert
//       pending row; the sibling verify route flips it active (lifetime).
//
// Auth: customer sb_token → cross-pool owner ids. Tamper-safe: the amount is the
// server-resolved price (client never sets ₹). Idempotent: a deterministic row
// id means re-tries reuse the same row; already-active cities 409 up front.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H_REPRESENT } from "@/lib/sb-server";
import { userFromReq } from "@/lib/sb";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveB2bFeeConfig } from "@/lib/b2b/fee-config-store";
import { normalizeCity, cityAccessId, resolveActiveCities } from "@/lib/circle/city-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { checkoutKeyId } from "@/lib/razorpay-server";

// Public checkout key id — present ONLY when the COMPLETE server env pair
// (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET) is configured (hotfix v621.2); the
// POST fails closed with payment_config_missing BEFORE any body parse / DB /
// order work when either half is absent or malformed.
const PUBLIC_KEY_ID = checkoutKeyId();

export async function GET(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(user.id, user.phone, user.email);
  const [active, cfg] = await Promise.all([
    resolveActiveCities(ownerIds),
    resolveB2bFeeConfig(),
  ]);
  return NextResponse.json({ cities: Array.from(active), price: cfg.cityAccessPrice });
}

export async function POST(req: NextRequest) {
  if (!PUBLIC_KEY_ID) return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Please sign in to unlock a city." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const city = normalizeCity(body?.city);
  if (!city) return NextResponse.json({ error: "Pick a city to unlock." }, { status: 400 });

  const ownerIds = await resolveOwnerIdsCrossPool(user.id, user.phone, user.email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Already unlocked? (any cross-pool id)
  const active = await resolveActiveCities(ownerIds);
  if (active.has(city)) {
    return NextResponse.json({ error: "You've already unlocked this city.", alreadyActive: true }, { status: 409 });
  }

  const cfg = await resolveB2bFeeConfig();
  const price = cfg.cityAccessPrice;
  if (price <= 0) {
    // Free city access → activate immediately, no payment.
    const id = cityAccessId(String(user.id), city);
    try {
      await fetch(`${SB_URL}/rest/v1/circle_city_access?on_conflict=id`, {
        method: "POST",
        headers: { ...SB_H_REPRESENT, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id, user_id: String(user.id), city, status: "active", amount: 0,
          activated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }),
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, free: true, city });
  }

  // Razorpay order for the access fee.
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: price,
        receipt: `cca_${city}`.slice(0, 40),
        notes: { kind: "circle_city_access", city, userId: String(user.id) },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json({ error: rzp?.error || "Could not start payment." }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  // Upsert the pending access row (deterministic id — re-tries reuse it).
  const id = cityAccessId(String(user.id), city);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/circle_city_access?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id,
        user_id: String(user.id),
        city,
        status: "pending_payment",
        amount: price,
        razorpay_order_id: rzp.id,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "Could not start access.", detail: err.slice(0, 160) }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    keyId: PUBLIC_KEY_ID,
    order: { id: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" },
    city,
    price,
  });
}
