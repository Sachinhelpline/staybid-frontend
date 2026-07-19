// v378 — Model 3 shared MARKET reader (server-only). The room's REAL guest-facing
// selling price (Spine live_price) across a date range → ADR + low/high. Backs
// BOTH the dynamic wholesale floor (owner/lots + owner/quote) and the agent's AI
// coach (lots/[id]), so the floor and the coach read the exact same live engine.
// room_date_price cache first; a bounded number of on-the-fly Spine fills for gaps.
import { SB_URL, SB_READ } from "@/lib/sb";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";

export type MonthMarket = { adr: number; low: number; high: number; samples: number; rack: number };

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d < end) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86_400_000); }
  return out;
}

/**
 * Live market ADR/low/high for a room over [from, to). `maxSpineFills` bounds the
 * on-the-fly compute so a wide range can't stall a request. Returns null if no
 * price could be resolved (caller degrades gracefully — never a fake number).
 */
export async function monthMarket(roomId: string, from: string, to: string, maxSpineFills = 14): Promise<MonthMarket | null> {
  const dates = enumerateDates(from, to);
  if (!dates.length || !roomId) return null;
  const price: Record<string, number> = {};
  let rack = 0; // the room's list/rack rate (MRP-equivalent) = max base_rate seen
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_date_price?room_id=eq.${encodeURIComponent(roomId)}&date=gte.${from}&date=lt.${to}&select=date,live_price,base_rate`,
      { headers: SB_READ, cache: "no-store" },
    );
    (r.ok ? await r.json().catch(() => []) : []).forEach((x: any) => {
      const d = String(x.date).slice(0, 10); const p = Math.round(Number(x.live_price) || 0);
      if (p > 0) price[d] = p;
      const br = Math.round(Number(x.base_rate) || 0);
      if (br > rack) rack = br;
    });
  } catch { /* fall through to Spine compute */ }
  const missing = dates.filter((d) => !price[d]).slice(0, Math.max(0, maxSpineFills));
  for (const d of missing) {
    try { const sp = await resolveSpinePrices([roomId], d); const p = Math.round(Number(sp?.[roomId]?.livePrice) || 0); if (p > 0) price[d] = p; }
    catch { /* skip this night */ }
  }
  const vals = dates.map((d) => price[d]).filter((v) => v > 0);
  if (!vals.length) return null;
  const high = Math.max(...vals);
  // Rack rate falls back to ~1.6× the peak live price if base_rate wasn't cached.
  if (rack <= high) rack = Math.round(high * 1.6);
  return { low: Math.min(...vals), high, adr: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), samples: vals.length, rack };
}
