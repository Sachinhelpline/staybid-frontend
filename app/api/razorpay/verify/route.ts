import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ verified: false, error: "Missing payment fields" }, { status: 400 });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET!;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected === razorpay_signature) {
    return NextResponse.json({ verified: true, paymentId: razorpay_payment_id });
  }
  return NextResponse.json({ verified: false, error: "Signature mismatch" }, { status: 400 });
}
