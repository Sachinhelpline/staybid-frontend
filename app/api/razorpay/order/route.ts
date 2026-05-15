// v125 — bulletproof order route.
// Previously called the `razorpay` SDK whose errors are NOT Error instances
// (they are { statusCode, error: { description, ... } } objects). On Vercel
// the SDK was either tree-shaken or failing to initialize, so `err.message`
// was always undefined → the user saw a generic "Order creation failed"
// alert with zero signal about the real cause.
//
// v125 talks to Razorpay's REST API directly with Basic-auth — no SDK, no
// bundle surprises, and the real `error.description` is forwarded to the
// client so future regressions surface honestly.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RZP_KEY_ID     = process.env.RAZORPAY_KEY_ID     || "rzp_live_SfFAsbYjbHfztd";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "dv3xFGG44R2FSqlshkDVY2Gn";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  const amountRupees = Number(body?.amount);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return NextResponse.json(
      { error: "Amount must be a positive number (in INR rupees)" },
      { status: 400 },
    );
  }

  // Razorpay min ₹1 (100 paise), max ₹5,00,000 per order. Receipt ≤ 40 chars.
  const amountPaise = Math.round(amountRupees * 100);
  if (amountPaise < 100) {
    return NextResponse.json(
      { error: "Minimum order amount is ₹1" },
      { status: 400 },
    );
  }
  const rawReceipt = String(body?.receipt || `rcpt_${Date.now()}`);
  const receipt = rawReceipt.slice(0, 40);
  const notes =
    body?.notes && typeof body.notes === "object" && !Array.isArray(body.notes)
      ? body.notes
      : {};

  const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString("base64");

  try {
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes,
        payment_capture: 1,
      }),
      // 20 s should be plenty — Razorpay typically responds in 200-600ms.
      // A hang past this means the network is wedged and we should fail
      // fast rather than letting the user stare at "Opening Razorpay…".
      signal: AbortSignal.timeout(20_000),
    });

    const data = await rzpRes.json().catch(() => ({}));

    if (!rzpRes.ok) {
      // Razorpay error shape: { error: { code, description, source, step, reason } }
      const description: string =
        data?.error?.description ||
        data?.error?.reason ||
        data?.description ||
        `Razorpay returned ${rzpRes.status}`;
      console.error("[razorpay/order] upstream error", {
        status: rzpRes.status,
        body: data,
      });
      return NextResponse.json(
        {
          error: description,
          code: data?.error?.code || null,
          status: rzpRes.status,
        },
        { status: rzpRes.status >= 400 && rzpRes.status < 500 ? 400 : 502 },
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    const isAbort = err?.name === "AbortError" || err?.name === "TimeoutError";
    const msg = isAbort
      ? "Razorpay took too long to respond. Please try again."
      : err?.message ||
        "Could not reach Razorpay. Check your internet and retry.";
    console.error("[razorpay/order] network error", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Health probe — lets the diagnostic endpoint confirm the route is live
// without spending a real Razorpay order. Returns the key prefix so it's
// safe to read from the browser.
export async function GET() {
  return NextResponse.json({
    ok: true,
    keyIdPrefix: RZP_KEY_ID.slice(0, 12),
    hasSecret: !!RZP_KEY_SECRET,
  });
}
