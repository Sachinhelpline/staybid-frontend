// ── Customer bidder-score system ──────────────────────────────────────
// Computes a "bid quality" score from a customer's past bid history.
// Used to (1) display a confidence chip in the Negotiate modal so users
// see their predicted approval speed, and (2) inform backend auto-accept
// timing (premium bidders confirm instantly, lowballers wait or require
// hotel approval — backend Railway code enforces actual timing).
//
// Score computation — average of (bid amount / floor price) across the
// customer's last 10 bids:
//   ≥ 0.95  → PREMIUM   (instant auto-accept · ~30s)
//   0.90-0.95 → STRONG  (fast auto-accept · 1-3 min)
//   0.85-0.90 → NORMAL  (standard window · 3-5 min)
//   0.78-0.85 → CAUTIOUS (slower · 5-12 min OR wait for hotel)
//   < 0.78   → LOWBALL  (hotel review required · no auto-accept)
//
// Backend "auto-accept timing" rule (documented here, enforced on Railway):
//   • PREMIUM:  auto-accept within 30s if hotel hasn't rejected
//   • STRONG:   auto-accept within 2 min
//   • NORMAL:   auto-accept within 5 min
//   • CAUTIOUS: auto-accept window doubled to 10 min — gives hotel time
//   • LOWBALL:  no auto-accept; bid waits for hotel manual approval

export type BidderTier = "PREMIUM" | "STRONG" | "NORMAL" | "CAUTIOUS" | "LOWBALL" | "NEW";

export type BidderScore = {
  tier: BidderTier;
  score: number;              // 0-1 ratio of bid/floor
  sampleSize: number;         // how many bids the score is based on
  label: string;              // e.g. "Premium Bidder"
  badge: string;              // emoji + word
  responseTime: string;       // human-readable expected window
  color: string;              // hex
  bg: string;                 // hex with alpha for chip bg
  tip: string;                // contextual tip shown in UI
  // Suggested time multiplier — frontend uses this to display a more
  // accurate "Acceptance in ~X min" estimate on the bid card.
  autoAcceptMs: number;
};

const TIER_META: Record<BidderTier, Omit<BidderScore, "score" | "sampleSize">> = {
  PREMIUM:  { tier: "PREMIUM",  label: "Premium Bidder",   badge: "👑 Premium",    responseTime: "~30s · instant",     color: "#10b981", bg: "rgba(16,185,129,0.14)",  tip: "Your history shows strong offers — auto-confirms almost instantly.", autoAcceptMs: 30_000 },
  STRONG:   { tier: "STRONG",   label: "Strong Bidder",    badge: "⭐ Strong",     responseTime: "~1-3 min · fast",    color: "#22c55e", bg: "rgba(34,197,94,0.14)",   tip: "Hotels love your bidding pattern — quick approval expected.",       autoAcceptMs: 120_000 },
  NORMAL:   { tier: "NORMAL",   label: "Smart Bidder",     badge: "✨ Smart",      responseTime: "~3-5 min · normal",  color: "#eab308", bg: "rgba(234,179,8,0.14)",   tip: "Solid bid history — standard auto-accept window applies.",          autoAcceptMs: 300_000 },
  CAUTIOUS: { tier: "CAUTIOUS", label: "Cautious Bidder",  badge: "🎯 Cautious",   responseTime: "~5-12 min · slower", color: "#f59e0b", bg: "rgba(245,158,11,0.14)",  tip: "Your bids often come in low — we double the review window to give the hotel time.", autoAcceptMs: 600_000 },
  LOWBALL:  { tier: "LOWBALL",  label: "Lowball Pattern",  badge: "⚠ Low offers",  responseTime: "Hotel review only",  color: "#ef4444", bg: "rgba(239,68,68,0.14)",   tip: "Bids consistently below market — hotel will review manually before accepting.", autoAcceptMs: Infinity },
  NEW:      { tier: "NEW",      label: "New Bidder",       badge: "🌟 Welcome!",   responseTime: "~3-5 min",           color: "#3b82f6", bg: "rgba(59,130,246,0.14)",  tip: "First few bids — earn Premium status by bidding strong.",           autoAcceptMs: 300_000 },
};

export function computeBidderScore(bids: Array<{ amount?: number; room?: { floorPrice?: number }; floorPrice?: number; message?: string }>): BidderScore {
  // Pull the customer's actual bid intent (use the message token where
  // available — below-floor bids store their preferred price there).
  const extract = (msg?: string | null): number | undefined => {
    if (!msg) return undefined;
    const m = msg.match(/preferred price[:\s]*₹?\s*(\d+(?:\.\d+)?)/i);
    return m ? parseFloat(m[1]) : undefined;
  };

  const recent = bids.slice(0, 10); // last 10 bids
  const ratios = recent
    .map((b) => {
      const floor = b.room?.floorPrice || b.floorPrice;
      if (!floor || floor <= 0) return null;
      const actualBid = extract(b.message) ?? b.amount;
      if (!actualBid || actualBid <= 0) return null;
      return actualBid / floor;
    })
    .filter((r): r is number => r !== null);

  if (ratios.length === 0) {
    return { ...TIER_META.NEW, score: 0, sampleSize: 0 };
  }

  const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const tier = pickTier(avg);
  return { ...TIER_META[tier], score: avg, sampleSize: ratios.length };
}

function pickTier(avg: number): BidderTier {
  if (avg >= 0.95) return "PREMIUM";
  if (avg >= 0.90) return "STRONG";
  if (avg >= 0.85) return "NORMAL";
  if (avg >= 0.78) return "CAUTIOUS";
  return "LOWBALL";
}

// Format autoAcceptMs into a short "~Xm" string for chips
export function formatAutoAcceptETA(ms: number): string {
  if (!isFinite(ms)) return "Manual review";
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `~${Math.round(ms / 60_000)} min`;
  return `~${Math.round(ms / 3_600_000)}h`;
}
