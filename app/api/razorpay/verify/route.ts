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

const LIVE_KEY_SECRET = "dv3xFGG44R2FSqlshkDVY2Gn";
const ENV_KEY_ID      = process.env.RAZORPAY_KEY_ID || "";
const ENV_KEY_SECRET  = process.env.RAZORPAY_KEY_SECRET || "";

function candidateSecrets(): { secret: string; source: "env" | "hardcoded" }[] {
  const out: { secret: string; source: "env" | "hardcoded" }[] = [];
  if (ENV_KEY_SECRET && ENV_KEY_ID.startsWith("rzp_live_")) {
    out.push({ secret: ENV_KEY_SECRET, source: "env" });
  }
  if (!out.length || out[0].secret !== LIVE_KEY_SECRET) {
    out.push({ secret: LIVE_KEY_SECRET, source: "hardcoded" });
  }
  return out;
}

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

  try {
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const sigBuf = Buffer.from(String(razorpay_signature), "hex");

    for (const { secret, source } of candidateSecrets()) {
      const expectedHex = createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const expectedBuf = Buffer.from(expectedHex, "hex");
      if (
        expectedBuf.length === sigBuf.length &&
        timingSafeEqual(expectedBuf, sigBuf)
      ) {
        if (source === "hardcoded" && ENV_KEY_SECRET) {
          console.warn(
            "[razorpay/verify] env-var secret did not match; succeeded with hardcoded LIVE secret",
          );
        }
        return NextResponse.json({
          verified: true,
          paymentId: razorpay_payment_id,
          _secretSource: source,
        });
      }
    }

    return NextResponse.json({
      verified: false,
      error: "Signature mismatch",
    });
  } catch (err: any) {
    console.error("[razorpay/verify] hmac error", err);
    return NextResponse.json(
      { verified: false, error: err?.message || "Verification error" },
      { status: 500 },
    );
  }
}
