import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(req: NextRequest) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay not configured" }, { status: 500 });
  }
  try {
    const { amount, receipt, notes } = await req.json();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: notes || {},
    });
    return NextResponse.json(order);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Order creation failed" }, { status: 500 });
  }
}
