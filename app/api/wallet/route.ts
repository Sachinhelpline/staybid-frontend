// GET /api/wallet
// Supabase-backed wallet summary — replaces the Railway `/api/wallet` call
// which cold-starts and often returns nothing. We derive the numbers directly
// from accepted bids + real bookings so the Wallet / Profile / Tracker pages
// always show accurate data, even when Railway is down.
//
// Shape matches what the frontend expects:
//   { wallet: { balance, totalCredit, totalDebit, transactions: [...] } }

import { NextRequest, NextResponse } from "next/server";
import { authPayload, sbSelect, resolveUserIds } from "@/lib/sb-server";

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerIds = await resolveUserIds(primaryId, payload?.phone);
  const inList = customerIds.join(",");

  // v124 — also pull real wallet_credits balance + ledger so the wallet page
  // shows ACTUAL spendable balance (from points redemptions etc.), not just
  // the computed "total spent" from bids/bookings.
  const [bookings, acceptedBids, walletCreditRows, walletLedgerRows] = await Promise.all([
    sbSelect(`bookings?customerId=in.(${inList})&select=*`),
    sbSelect(`bids?customerId=in.(${inList})&status=eq.ACCEPTED&select=*`),
    sbSelect(`wallet_credits?user_id=in.(${inList})&select=*`),
    sbSelect(`wallet_credit_history?user_id=in.(${inList})&select=*&order=created_at.desc&limit=50`),
  ]);
  // Aggregate across both cross-pool user ids if multiple rows exist
  const realBalance = (walletCreditRows || []).reduce((s: number, w: any) => s + Number(w.balance_inr || 0), 0);
  const lifetimeCredited = (walletCreditRows || []).reduce((s: number, w: any) => s + Number(w.lifetime_credited || 0), 0);
  const lifetimeDebited = (walletCreditRows || []).reduce((s: number, w: any) => s + Number(w.lifetime_debited || 0), 0);

  // BULLETPROOF: pull authoritative paid amounts (from bid_paid_amounts)
  // for every accepted bid. This is what the customer actually paid via
  // Razorpay — bid.amount may be the floor (corrupted by fallback path).
  const allBidIds = acceptedBids.map((b: any) => b.id).filter(Boolean);
  const paidById: Record<string, number> = {};
  if (allBidIds.length) {
    try {
      const paidRows = await sbSelect(`bid_paid_amounts?bid_id=in.(${allBidIds.join(",")})&select=bid_id,paid_total`);
      for (const r of paidRows) paidById[r.bid_id] = Number(r.paid_total);
    } catch {}
  }

  // Gather hotel names for nice transaction descriptions
  const hotelIds = Array.from(new Set([
    ...bookings.map((b: any) => b.hotelId),
    ...acceptedBids.map((b: any) => b.hotelId),
  ].filter(Boolean)));
  const hotels = hotelIds.length
    ? await sbSelect(`hotels?id=in.(${hotelIds.join(",")})&select=id,name`)
    : [];
  const hotelName = (id: string) => hotels.find((h: any) => h.id === id)?.name || "Hotel";

  // Dedup: if a real booking exists for same (hotelId,roomId), skip the bid
  const realKeys = new Set(bookings.map((b: any) => `${b.hotelId}|${b.roomId}`));
  const effectiveBids = acceptedBids.filter((b: any) => !realKeys.has(`${b.hotelId}|${b.roomId}`));

  const bookingTxns = bookings.map((b: any) => ({
    id: `bk_${b.id}`,
    type: "DEBIT",
    amount: Number(b.totalAmount || b.amount || 0),
    description: `Booking — ${hotelName(b.hotelId)}`,
    createdAt: b.createdAt,
  }));
  const bidTxns = effectiveBids.map((b: any) => ({
    id: `bid_${b.id}`,
    type: "DEBIT",
    // Authoritative paid amount first, then bid.amount fallback.
    amount: paidById[b.id] ?? Number(b.amount || 0),
    description: `Booking — ${hotelName(b.hotelId)}`,
    createdAt: b.updatedAt || b.createdAt,
  }));

  // v124 — wallet credit history rows become transactions too. Credits are
  // positive (green); debits are negative (red).
  const creditTxns = (walletLedgerRows || []).map((l: any) => ({
    id: `wch_${l.id}`,
    type: Number(l.delta_inr) >= 0 ? "CREDIT" : "DEBIT",
    amount: Math.abs(Number(l.delta_inr || 0)),
    description: l.reason || (l.type === "credit_from_points" ? "Wallet credit from StayPoints"
                              : l.type === "debit_on_booking" ? "Applied to booking"
                              : l.type === "refund" ? "Refund"
                              : "Wallet adjustment"),
    createdAt: l.created_at,
  }));

  const transactions = [...creditTxns, ...bookingTxns, ...bidTxns].sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  const totalDebit = [...bookingTxns, ...bidTxns].reduce((s, t) => s + t.amount, 0);

  return NextResponse.json({
    wallet: {
      // Real spendable balance from wallet_credits (₹)
      balance: realBalance,
      totalCredit: lifetimeCredited,
      walletCreditBalance: realBalance,
      walletCreditDebited: lifetimeDebited,
      totalDebit,
      spent: totalDebit,
      transactions,
    },
  });
}
