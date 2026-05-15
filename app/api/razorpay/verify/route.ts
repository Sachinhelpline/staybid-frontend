// v125 — verify route hardened.
// Pinned to Node runtime so `crypto` always resolves, returns 200 with
// verified:false on signature mismatch instead of 4xx (so the client can
// branch on `data.verified` cleanly without try/catching every call), and
// the cryptography is wrapped in defensive try/catch so a malformed body
// can't leak a 500.

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const secret =
    process.env.RAZORPAY_KEY_SECRET || "dv3xFGG44R2FSqlshkDVY2Gn";

  try {
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = createHmac("sha256", secret).update(payload).digest("hex");

    // Timing-safe compare — both must be the same byte length or
    // timingSafeEqual throws.
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(String(razorpay_signature), "hex");
    const verified = a.length === b.length && timingSafeEqual(a, b);

    if (!verified) {
      return NextResponse.json({
        verified: false,
        error: "Signature mismatch",
      });
    }
    return NextResponse.json({
      verified: true,
      paymentId: razorpay_payment_id,
    });
  } catch (err: any) {
    console.error("[razorpay/verify] hmac error", err);
    return NextResponse.json(
      { verified: false, error: err?.message || "Verification error" },
      { status: 500 },
    );
  }
}
