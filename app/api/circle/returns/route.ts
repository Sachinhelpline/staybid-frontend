import { NextResponse } from "next/server";
import { computeLiveReturns, type ReturnsItem } from "@/lib/circle/returns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/circle/returns
// The LIVE "Investment & Returns" calculator source. Turns the investor's
// current selection (property × room × rooms) + a chosen month into a real
// demand-driven projection using the StayBid AI pricing engine
// (lib/ai-pricing.calculateDynamicPrice — the same model that prices every
// hotel night). NO static / prototype numbers.
//
// Body: { items: ReturnsItem[], month: number(0-11) }
// Returns: LiveReturns (see lib/circle/returns). Pure compute — no DB.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const month = Number(body?.month);

    const items: ReturnsItem[] = rawItems
      .slice(0, 24)
      .map((it: any) => ({
        propertyId: String(it?.propertyId || ""),
        city: String(it?.city || "").trim(),
        monthlyRate: Math.max(0, Number(it?.monthlyRate) || 0),
        rooms: Math.max(0, Math.floor(Number(it?.rooms) || 0)),
        roiMin: Math.max(0, Number(it?.roiMin) || 0),
        roiMax: Math.max(0, Number(it?.roiMax) || 0),
      }))
      .filter((it: ReturnsItem) => it.city && it.rooms > 0 && it.monthlyRate > 0);

    const result = computeLiveReturns(
      items,
      Number.isFinite(month) ? month : new Date().getMonth(),
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e).slice(0, 160) },
      { status: 200 },
    );
  }
}
