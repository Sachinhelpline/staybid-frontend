// ── Customer bidder-score system ──────────────────────────────────────
// Computes a "bid quality" score from a customer's past bid history.
// Used to (1) display a confidence chip in the Negotiate modal so users
// see their predicted approval speed, and (2) drive the v130 Hybrid AI
// Autopilot — every above-floor bid across every flow (Negotiate /
// simple Bid / reverse-auction `/bid`) schedules an auto-accept at a
// tier-based delay. lib/autopilot.ts further adjusts those windows
// according to the hotel's autopilot mode (auto / hybrid / manual).
//
// v130 thresholds (recalibrated for the wider rollout):
//   ≥ 0.95  → PREMIUM    (~30s   · instant)
//   0.88-0.95 → STRONG    (~3 min · fast)
//   0.82-0.88 → NORMAL    (~8 min · standard)
//   0.75-0.82 → CAUTIOUS  (~20 min · hotel gets time)
//   < 0.75   → LOWBALL    (manual hotel review only)
//
// Old vs new (v70 → v130) — wider STRONG band (0.88 vs 0.90) + wider
// CAUTIOUS floor (0.75 vs 0.78) so the typical bidder lands a tier higher,
// matching the broader flow coverage. NEW bidders still bucket into NORMAL
// timing on their first bid so they're not punished for low sample size.

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

// v130 — wording polish: every customer-facing string says "hotel" never
// "AI" / "auto" so the customer experience stays a clean partner story.
// The autoAcceptMs values stay the operational truth for the scheduler.
const TIER_META: Record<BidderTier, Omit<BidderScore, "score" | "sampleSize">> = {
  PREMIUM:  { tier: "PREMIUM",  label: "Premium Bidder",   badge: "👑 Premium",    responseTime: "~30s · instant",      color: "#10b981", bg: "rgba(16,185,129,0.14)",  tip: "Strong offers in your history — the hotel typically confirms within seconds.",        autoAcceptMs: 30_000     },
  STRONG:   { tier: "STRONG",   label: "Strong Bidder",    badge: "⭐ Strong",     responseTime: "~3 min · fast",       color: "#22c55e", bg: "rgba(34,197,94,0.14)",   tip: "Hotels usually respond quickly to bids like yours.",                                  autoAcceptMs: 180_000    },
  NORMAL:   { tier: "NORMAL",   label: "Smart Bidder",     badge: "✨ Smart",      responseTime: "~8 min · standard",   color: "#eab308", bg: "rgba(234,179,8,0.14)",   tip: "Solid bid history — the hotel takes a standard look before confirming.",              autoAcceptMs: 480_000    },
  CAUTIOUS: { tier: "CAUTIOUS", label: "Cautious Bidder",  badge: "🎯 Cautious",   responseTime: "~20 min · careful",   color: "#f59e0b", bg: "rgba(245,158,11,0.14)",  tip: "Your bids often come in low — the hotel takes longer to review and decide.",          autoAcceptMs: 1_200_000  },
  LOWBALL:  { tier: "LOWBALL",  label: "Lowball Pattern",  badge: "⚠ Low offers",  responseTime: "Hotel review only",   color: "#ef4444", bg: "rgba(239,68,68,0.14)",   tip: "Bids consistently below market — the hotel will review manually before confirming.",  autoAcceptMs: Infinity   },
  NEW:      { tier: "NEW",      label: "New Bidder",       badge: "🌟 Welcome!",   responseTime: "~8 min",              color: "#3b82f6", bg: "rgba(59,130,246,0.14)",  tip: "First few bids — bid strong to earn Premium status and faster confirmations.",        autoAcceptMs: 480_000    },
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

// v130 — recalibrated bands (Option 2 Hybrid AI Autopilot).
function pickTier(avg: number): BidderTier {
  if (avg >= 0.95) return "PREMIUM";
  if (avg >= 0.88) return "STRONG";
  if (avg >= 0.82) return "NORMAL";
  if (avg >= 0.75) return "CAUTIOUS";
  return "LOWBALL";
}

// Format autoAcceptMs into a short "~Xm" string for chips
export function formatAutoAcceptETA(ms: number): string {
  if (!isFinite(ms)) return "Manual review";
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `~${Math.round(ms / 60_000)} min`;
  return `~${Math.round(ms / 3_600_000)}h`;
}
