import { NextResponse } from "next/server";
import { computeTierFromSpend } from "@/lib/tier";

// GET /api/users/me/tier
// Single source of truth for the customer tier shown across:
//  - Wallet page (already computed locally there)
//  - Verification page
//  - /api/verify/request (server-side gate)
//
// Tier is derived from the SAME totalSpend computation the wallet uses,
// so a customer can never see different tiers on different pages.
//
// Auth: Bearer customer JWT (Railway). We forward to the local /api/wallet
// which already merges accepted bids + bookings into a canonical spend.
function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

export async function GET(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    // Reuse the existing /api/wallet route (which merges spend from bids+bookings)
    const url = new URL(req.url);
    const base = `${url.protocol}//${url.host}`;
    const wRes = await fetch(`${base}/api/wallet`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    let totalSpend = 0;
    if (wRes.ok) {
      const w = await wRes.json();
      totalSpend = w?.totalDebit || w?.total_debit || w?.spent || w?._computedSpend || 0;
    }
    const tier = computeTierFromSpend(totalSpend);
    return NextResponse.json({ tier, totalSpend });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "tier failed" }, { status: 500 });
  }
}
