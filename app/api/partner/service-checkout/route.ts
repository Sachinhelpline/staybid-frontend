// v178 — Partner service subscription billing (Phase 3).
//
//   POST { action: "create",  hotelId?, serviceKey? | bundleId?, plan }
//        → server resolves the price from service_pricing / service_bundles,
//          creates a Razorpay order with that VALIDATED amount, records a
//          service_payments row (status=created) and returns the order so
//          the client can open the Razorpay modal. The client never picks
//          the amount — it cannot be tampered.
//
//   POST { action: "verify", paymentId, razorpay_order_id,
//          razorpay_payment_id, razorpay_signature }
//        → verifies the HMAC signature server-side, marks the payment paid
//          and grants the service(s) via hotel_services (access_type=paid,
//          plan, term-based expires_at). Pending requests for those keys
//          are auto-approved so the lock UI clears.
//
// Owner-scoped. Razorpay LIVE keys hardcoded as a self-healing fallback
// (same pattern as /api/razorpay/order). Lazy expiry — no cron.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { isSubscriptionService } from "@/lib/partner/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAN_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, yearly: 365 };
const PLAN_FIELD: Record<string, "monthly" | "quarterly" | "yearly"> = {
  monthly: "monthly", quarterly: "quarterly", yearly: "yearly",
};

const LIVE_KEY_ID     = "rzp_live_SfFAsbYjbHfztd";
const LIVE_KEY_SECRET = "dv3xFGG44R2FSqlshkDVY2Gn";
const ENV_KEY_ID      = process.env.RAZORPAY_KEY_ID     || "";
const ENV_KEY_SECRET  = process.env.RAZORPAY_KEY_SECRET || "";

type KeyPair = { id: string; secret: string };
function keyCandidates(): KeyPair[] {
  const out: KeyPair[] = [];
  if (ENV_KEY_ID && ENV_KEY_SECRET && ENV_KEY_ID.startsWith("rzp_live_")) {
    out.push({ id: ENV_KEY_ID, secret: ENV_KEY_SECRET });
  }
  if (!out.length || out[0].id !== LIVE_KEY_ID) {
    out.push({ id: LIVE_KEY_ID, secret: LIVE_KEY_SECRET });
  }
  return out;
}
function secretCandidates(): string[] {
  const out: string[] = [];
  if (ENV_KEY_SECRET && ENV_KEY_ID.startsWith("rzp_live_")) out.push(ENV_KEY_SECRET);
  if (!out.includes(LIVE_KEY_SECRET)) out.push(LIVE_KEY_SECRET);
  return out;
}

async function owned(req: NextRequest): Promise<{ ids: string[]; userId: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const p = decodeJwt(token);
  if (!p?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    p.id, p.phone || req.headers.get("x-phone") || "", p.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [], userId: p.id };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id), userId: p.id };
}

// ── create ───────────────────────────────────────────────────────────
async function handleCreate(req: NextRequest, o: { ids: string[]; userId: string }, body: any) {
  const hotelId = body.hotelId && o.ids.includes(body.hotelId) ? body.hotelId : o.ids[0];
  if (!hotelId) return NextResponse.json({ error: "No hotel" }, { status: 403 });

  const plan = String(body.plan || "");
  if (!PLAN_DAYS[plan]) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  const planField = PLAN_FIELD[plan];

  // Resolve the price + effective service keys SERVER-SIDE.
  let amount = 0;
  let serviceKey: string | null = null;
  let bundleId: string | null = null;
  let serviceKeys: string[] = [];
  let label = "";

  if (body.bundleId) {
    const rows = await sbSelect(
      `service_bundles?id=eq.${encodeURIComponent(String(body.bundleId))}&active=is.true&select=*`
    ).catch(() => []);
    const b = rows?.[0];
    if (!b) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    const price = Number(b[planField]);
    if (!Number.isFinite(price) || price <= 0)
      return NextResponse.json({ error: "Bundle ke is plan ka price set nahi hai" }, { status: 412 });
    bundleId = b.id;
    amount = price;
    serviceKeys = (Array.isArray(b.service_keys) ? b.service_keys : []).filter((k: any) => isSubscriptionService(String(k)));
    label = `${b.name} (bundle)`;
    if (!serviceKeys.length) return NextResponse.json({ error: "Bundle empty hai" }, { status: 400 });
  } else {
    const key = String(body.serviceKey || "");
    if (!isSubscriptionService(key))
      return NextResponse.json({ error: "Invalid service" }, { status: 400 });
    const rows = await sbSelect(
      `service_pricing?service_key=eq.${encodeURIComponent(key)}&active=is.true&select=*`
    ).catch(() => []);
    const pr = rows?.[0];
    const price = pr ? Number(pr[planField]) : NaN;
    if (!Number.isFinite(price) || price <= 0)
      return NextResponse.json({ error: "Is service ke is plan ka price abhi set nahi hai" }, { status: 412 });
    serviceKey = key;
    amount = price;
    serviceKeys = [key];
    label = key;
  }

  const hotels = await sbSelect(`hotels?id=eq.${encodeURIComponent(hotelId)}&select=name`).catch(() => []);
  const hotelName = hotels?.[0]?.name || null;

  // Create the Razorpay order with the validated amount.
  const amountPaise = Math.round(amount * 100);
  if (amountPaise < 100) return NextResponse.json({ error: "Amount too low" }, { status: 400 });

  let order: any = null;
  let usedKeyId = LIVE_KEY_ID;
  let lastErr = "Order create nahi hua";
  for (const cand of keyCandidates()) {
    try {
      const auth = Buffer.from(`${cand.id}:${cand.secret}`).toString("base64");
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountPaise, currency: "INR",
          receipt: `svc_${Date.now()}`.slice(0, 40),
          notes: { hotelId, plan, service: label },
          payment_capture: 1,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.id) { order = d; usedKeyId = cand.id; break; }
      lastErr = d?.error?.description || d?.error?.reason || `Razorpay ${r.status}`;
      if (r.status !== 401 && r.status !== 403) break;
    } catch (e: any) {
      lastErr = e?.message || "Razorpay reach nahi hua";
      break;
    }
  }
  if (!order) return NextResponse.json({ error: lastErr }, { status: 502 });

  const expires = new Date(Date.now() + PLAN_DAYS[plan] * 86400000).toISOString();
  const rowId = genId("svcpay");
  const row = {
    id: rowId,
    hotel_id: hotelId, hotel_name: hotelName,
    service_key: serviceKey, bundle_id: bundleId,
    service_keys: serviceKeys,
    plan, amount, currency: "INR", status: "created",
    razorpay_order_id: order.id,
    expires_at: expires,
    created_by: o.userId,
  };
  const ins = await fetch(`${SB_URL}/rest/v1/service_payments`, {
    method: "POST",
    headers: { ...SB_H_REPRESENT, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!ins.ok) {
    const txt = await ins.text();
    if (ins.status === 404 || /does not exist/i.test(txt))
      return NextResponse.json({ error: "Billing system not provisioned. Apply migrations/2026-05-21-service-payments.sql." }, { status: 412 });
    return NextResponse.json({ error: txt || "Payment record fail" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    paymentId: rowId,
    orderId: order.id,
    amount,
    amountPaise,
    keyId: usedKeyId,
    label,
    plan,
  });
}

// ── verify ───────────────────────────────────────────────────────────
async function handleVerify(req: NextRequest, o: { ids: string[]; userId: string }, body: any) {
  const { paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!paymentId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });

  const rows = await sbSelect(
    `service_payments?id=eq.${encodeURIComponent(String(paymentId))}&select=*`
  ).catch(() => []);
  const pay = rows?.[0];
  if (!pay) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (!o.ids.includes(pay.hotel_id))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (pay.razorpay_order_id !== razorpay_order_id)
    return NextResponse.json({ error: "Order mismatch" }, { status: 400 });
  if (pay.status === "paid")
    return NextResponse.json({ ok: true, already: true });

  // Verify the HMAC signature against each known secret.
  const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
  let verified = false;
  try {
    const sigBuf = Buffer.from(String(razorpay_signature), "hex");
    for (const secret of secretCandidates()) {
      const expBuf = Buffer.from(createHmac("sha256", secret).update(payload).digest("hex"), "hex");
      if (expBuf.length === sigBuf.length && timingSafeEqual(expBuf, sigBuf)) { verified = true; break; }
    }
  } catch { verified = false; }

  if (!verified) {
    await fetch(`${SB_URL}/rest/v1/service_payments?id=eq.${encodeURIComponent(String(paymentId))}`, {
      method: "PATCH", headers: SB_H,
      body: JSON.stringify({ status: "failed" }),
    }).catch(() => {});
    return NextResponse.json({ error: "Signature verification fail" }, { status: 400 });
  }

  // Mark paid.
  await fetch(`${SB_URL}/rest/v1/service_payments?id=eq.${encodeURIComponent(String(paymentId))}`, {
    method: "PATCH", headers: SB_H,
    body: JSON.stringify({
      status: "paid",
      razorpay_payment_id, razorpay_signature,
      paid_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  // Grant each service.
  const days = PLAN_DAYS[pay.plan] || 30;
  const expires = pay.expires_at || new Date(Date.now() + days * 86400000).toISOString();
  const keys: string[] = Array.isArray(pay.service_keys) ? pay.service_keys : [];
  for (const key of keys) {
    const existing = await sbSelect(
      `hotel_services?hotel_id=eq.${encodeURIComponent(pay.hotel_id)}&service_key=eq.${encodeURIComponent(key)}&select=id`
    ).catch(() => []);
    const svcRow = {
      id: existing?.[0]?.id || genId("hsvc"),
      hotel_id: pay.hotel_id, service_key: key,
      status: "active",
      access_type: "paid",
      plan: pay.plan,
      expires_at: expires,
      granted_by: `payment:${pay.id}`,
      updated_at: new Date().toISOString(),
    };
    await fetch(`${SB_URL}/rest/v1/hotel_services?on_conflict=hotel_id,service_key`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(svcRow),
    }).catch(() => {});
    // Clear any pending admin request for this service.
    await fetch(
      `${SB_URL}/rest/v1/service_requests?hotel_id=eq.${encodeURIComponent(pay.hotel_id)}&service_key=eq.${encodeURIComponent(key)}&status=eq.pending`,
      {
        method: "PATCH", headers: SB_H,
        body: JSON.stringify({ status: "approved", decided_by: "razorpay", decided_at: new Date().toISOString() }),
      }
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, granted: keys, expiresAt: expires });
}

export async function POST(req: NextRequest) {
  const o = await owned(req);
  if (!o) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!o.ids.length) return NextResponse.json({ error: "No hotel for this account" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || "");

  try {
    if (action === "create") return await handleCreate(req, o, body);
    if (action === "verify") return await handleVerify(req, o, body);
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }
}
