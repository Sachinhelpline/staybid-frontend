// POST /api/attribution/record
// Body: { bidId, hotelId, customerId?, paidTotal?, flow?, dealId?,
//         source, creatorUserId?, creatorHandle?, creatorType?, videoId? }
//
// Writes / upserts a bid_attributions row. Idempotent — re-posting the same
// bidId updates the existing row (used when paid_total or flow change after
// the initial write, e.g. Hold balance settle).
//
// Also auto-creates an influencer_commissions row when source="creator"
// AND creator_user_id maps to a registered influencer with status='active'.
// Tier 3 (Elite) creators earn 15%, everyone else 12%.
import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

async function sbSelect(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ, cache: "no-store" });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.bidId || !b.hotelId) {
      return NextResponse.json({ error: "bidId + hotelId required" }, { status: 400 });
    }

    const source = String(b.source || "direct");
    let creatorId: string | null = null;
    let commissionPct: number | null = null;
    let commissionAmount: number | null = null;

    // Resolve influencer registration + tier when this is creator-attributed.
    if (source === "creator" && b.creatorUserId) {
      const rows = await sbSelect(
        `influencers?user_id=eq.${encodeURIComponent(b.creatorUserId)}&select=id,status,verification_tier,total_earnings`
      );
      const inf = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (inf && inf.status === "active") {
        creatorId = inf.id;
        commissionPct = inf.verification_tier >= 3 ? 0.15 : 0.12;
        if (b.paidTotal != null) {
          commissionAmount = Math.round(Number(b.paidTotal) * commissionPct * 100) / 100;
        }
      }
    }

    const row = {
      bid_id:            b.bidId,
      hotel_id:          b.hotelId,
      customer_id:       b.customerId || null,
      source,
      creator_id:        creatorId,
      creator_user_id:   b.creatorUserId || null,
      creator_handle:    b.creatorHandle || null,
      creator_type:      b.creatorType || null,
      video_id:          b.videoId || null,
      flow:              b.flow || null,
      deal_id:           b.dealId || null,
      paid_total:        b.paidTotal != null ? Number(b.paidTotal) : null,
      commission_pct:    commissionPct,
      commission_amount: commissionAmount,
      metadata:          b.metadata || null,
    };

    // Upsert: PATCH if existing, else POST.
    const existing = await sbSelect(`bid_attributions?bid_id=eq.${encodeURIComponent(b.bidId)}&select=bid_id`);
    if (Array.isArray(existing) && existing[0]) {
      await fetch(`${SB_URL}/rest/v1/bid_attributions?bid_id=eq.${encodeURIComponent(b.bidId)}`, {
        method: "PATCH", headers: SB_H, body: JSON.stringify(row),
      }).catch(() => {});
    } else {
      await fetch(`${SB_URL}/rest/v1/bid_attributions`, {
        method: "POST", headers: SB_H, body: JSON.stringify(row),
      }).catch(() => {});
    }

    // If a creator commission applies AND a commission row doesn't already
    // exist for this bid, write one (pending) so the creator hub picks it up.
    if (creatorId && commissionAmount != null && commissionAmount > 0) {
      const dup = await sbSelect(`influencer_commissions?bid_id=eq.${encodeURIComponent(b.bidId)}&select=id&limit=1`);
      if (!Array.isArray(dup) || !dup[0]) {
        await fetch(`${SB_URL}/rest/v1/influencer_commissions`, {
          method: "POST", headers: SB_H,
          body: JSON.stringify({
            influencer_id:          creatorId,
            bid_id:                 b.bidId,
            booking_id:             null,
            hotel_id:               b.hotelId,
            booking_amount:         Number(b.paidTotal || 0),
            commission_percentage:  commissionPct,
            commission_amount:      commissionAmount,
            status:                 "pending",
          }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({ recorded: true, source, creatorId, commissionAmount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "record failed" }, { status: 500 });
  }
}

// GET /api/attribution/record?ids=bid1,bid2,...  → bulk read.
// Used by partner + admin Bookings tables to enrich rows with their source.
export async function GET(req: Request) {
  try {
    const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean);
    if (!ids.length) return NextResponse.json({ attributions: {} });
    const rows = await sbSelect(
      `bid_attributions?bid_id=in.(${ids.map(encodeURIComponent).join(",")})&select=*&limit=500`
    );
    const map: Record<string, any> = {};
    for (const r of (rows as any[])) {
      map[r.bid_id] = {
        bidId:            r.bid_id,
        source:           r.source,
        creatorId:        r.creator_id,
        creatorUserId:    r.creator_user_id,
        creatorHandle:    r.creator_handle,
        creatorType:      r.creator_type,
        videoId:          r.video_id,
        flow:             r.flow,
        dealId:           r.deal_id,
        paidTotal:        r.paid_total != null ? Number(r.paid_total) : null,
        commissionPct:    r.commission_pct != null ? Number(r.commission_pct) : null,
        commissionAmount: r.commission_amount != null ? Number(r.commission_amount) : null,
        createdAt:        r.created_at,
      };
    }
    return NextResponse.json({ attributions: map });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
