// v361 — Model 3: PUBLIC lot detail + selectable segments (sealed-bid, so we
// NEVER expose other agents' bids). Returns the lot, its month range, the
// enumerated segments (full month / weeks / weekends), and the EMD deposit %.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { enumerateSegments } from "@/lib/trade/auction-engine";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: SB_READ, cache: "no-store" },
  );
  const [lot] = r.ok ? await r.json().catch(() => []) : [];
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });

  const range = {
    monthKey: lot.month_key, monthStart: String(lot.month_start).slice(0, 10),
    monthEnd: String(lot.month_end).slice(0, 10),
    nights: Math.round((new Date(lot.month_end).getTime() - new Date(lot.month_start).getTime()) / 86_400_000),
  };
  const segments = enumerateSegments(range).map((s) => ({
    type: s.type, weekIndex: s.weekIndex, label: s.label, nights: s.nights,
  }));
  const cfg = await resolveAuctionConfig();
  return NextResponse.json({ lot, range, segments, depositPct: cfg.depositPct, buyerPremiumPct: cfg.buyerPremiumPct });
}
