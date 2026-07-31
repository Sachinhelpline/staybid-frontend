// v125.1 — self-healing verify route.
//
// The Razorpay payment signature is HMAC-SHA256 of `order_id|payment_id`
// using the merchant's KEY_SECRET. If the env-var secret is stale (the
// same misconfig that caused the order route's auth failures), every
// signature compare would also fail — but the payment ITSELF would have
// succeeded on Razorpay's side. Verify against EACH known secret and
// accept if any matches; record which one in the response.
//
// Pinned to Node runtime so `crypto` always resolves. Wraps every step
// in defensive try/catch so a malformed body can't leak a 500.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay verification secret is ENVIRONMENT-ONLY (hotfix v621 security).
// The hardcoded LIVE fallback has been removed — verification fails closed
// when RAZORPAY_KEY_SECRET is absent.
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { verified: false, error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json(
      { verified: false, error: "Missing payment fields" },
      { status: 400 },
    );
  }

  if (!RAZORPAY_KEY_SECRET) {
    return NextResponse.json(
      { verified: false, error: "payment_config_missing" },
      { status: 503 },
    );
  }

  try {
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const sigBuf = Buffer.from(String(razorpay_signature), "hex");
    const expectedHex = createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest("hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (
      expectedBuf.length === sigBuf.length &&
      timingSafeEqual(expectedBuf, sigBuf)
    ) {
      return NextResponse.json({ verified: true, paymentId: razorpay_payment_id });
    }

    return NextResponse.json({ verified: false, error: "Signature mismatch" });
  } catch (err: any) {
    console.error("[razorpay/verify] hmac error", err);
    return NextResponse.json(
      { verified: false, error: err?.message || "Verification error" },
      { status: 500 },
    );
  }
}
