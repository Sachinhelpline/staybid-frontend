import { NextRequest, NextResponse } from "next/server";

const RZP_KEY_ID     = process.env.RAZORPAY_KEY_ID     || "rzp_live_SfFAsbYjbHfztd";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "dv3xFGG44R2FSqlshkDVY2Gn";

export async function POST(req: NextRequest) {
  try {
    const Razorpay = (await import("razorpay")).default;
    const razorpay = new Razorpay({
      key_id:     RZP_KEY_ID,
      key_secret: RZP_KEY_SECRET,
    });
    const { amount, receipt, notes } = await req.json();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: notes || {},
    });
    return NextResponse.json(order);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Order creation failed" }, { status: 500 });
  }
}
