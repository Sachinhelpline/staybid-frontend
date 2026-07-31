import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { requireVerifiedAdmin } from "@/lib/admin/verify";


const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(`${SB_URL}/rest/v1/payouts?select=*&order=createdAt.desc&limit=200`, { headers: H });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ payouts: data });
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { hotelId, amount, period, notes } = await req.json();
  if (!hotelId || !amount) return NextResponse.json({ error: "hotelId and amount required" }, { status: 400 });
  const payload = {
    hotelId,
    amount: Number(amount),
    period: period || new Date().toISOString().slice(0, 7),
    status: "pending",
    notes: notes || null,
    createdAt: new Date().toISOString(),
  };
  const res = await fetch(`${SB_URL}/rest/v1/payouts`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  return NextResponse.json({ ok: res.ok, payout: res.ok ? (await res.json())[0] : null });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { payoutId, status, txnRef } = await req.json();
  if (!payoutId || !status) return NextResponse.json({ error: "payoutId and status required" }, { status: 400 });
  const res = await fetch(`${SB_URL}/rest/v1/payouts?id=eq.${payoutId}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ status, txnRef: txnRef || null, paidAt: status === "paid" ? new Date().toISOString() : null }),
  });
  return NextResponse.json({ ok: res.ok });
}
