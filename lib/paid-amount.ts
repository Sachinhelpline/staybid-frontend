// Single source of truth for "what did the customer ACTUALLY pay" on a bid.
//
// Resolution order (highest authority first):
//   1. server-side bid_paid_amounts table (via /api/bid/paid?ids=...)
//   2. paid:X token in bid.message          (legacy — pre-bulletproof bookings)
//   3. localStorage paid_amount_{bidId}      (same device only)
//   4. localStorage deal_price_{bidId}       (legacy per-night)
//   5. bid.totalAmount / bid.amount          (backend — corrupted to floor in
//                                              the flash-fallback path)

export function extractPaidFromMessage(msg?: string | null): { total?: number; rate?: number } {
  if (!msg) return {};
  const total = msg.match(/paid:\s*(\d+(?:\.\d+)?)/i);
  const rate  = msg.match(/rate:\s*(\d+(?:\.\d+)?)/i);
  return {
    total: total ? parseFloat(total[1]) : undefined,
    rate:  rate  ? parseFloat(rate[1])  : undefined,
  };
}

// Below-floor bids are forcibly submitted at floorPrice (because backend
// rejects below-floor without a dealId), so bid.amount in DB ≠ customer's
// actual bid intent. The real intent is preserved in the message token:
//   "Guest's preferred price: ₹1500/night..."
// Use this to recover what the customer ACTUALLY bid for display.
export function extractCustomerBidFromMessage(msg?: string | null): number | undefined {
  if (!msg) return undefined;
  const m = msg.match(/preferred price[:\s]*₹?\s*(\d+(?:\.\d+)?)/i);
  return m ? parseFloat(m[1]) : undefined;
}

// Single source of truth for "what is the customer's bid amount" — used
// across My Bids / Bookings / hotel page to show consistent pricing.
//
// Priority:
//   1. counterAmount (if hotel has countered) — that's the active price now
//   2. customer's preferred price from message (below-floor case)
//   3. server-side paidPerNight (from bid_paid_amounts)
//   4. bid.amount (DB value, may be floor for below-floor cases)
export function resolveBidDisplayAmount(bid: {
  amount?: number;
  counterAmount?: number | null;
  message?: string | null;
  serverPaid?: { paidPerNight?: number | null };
  status?: string;
}): number {
  // If hotel countered, the active price is the counter
  if (bid.counterAmount && bid.status !== "PENDING") return Number(bid.counterAmount);

  // Customer's actual bid intent (below-floor recovery)
  const fromMsg = extractCustomerBidFromMessage(bid.message);
  if (fromMsg) return fromMsg;

  if (bid.serverPaid?.paidPerNight) return Number(bid.serverPaid.paidPerNight);

  return Number(bid.amount || 0);
}

export type PaidServerInfo = { paidTotal?: number; paidPerNight?: number | null; nights?: number };

export async function fetchServerPaid(ids: string[]): Promise<Record<string, PaidServerInfo>> {
  if (!ids.length) return {};
  try {
    const r = await fetch(`/api/bid/paid?ids=${ids.map(encodeURIComponent).join(",")}`, { cache: "no-store" });
    if (!r.ok) return {};
    const j = await r.json();
    return j.paid || {};
  } catch { return {}; }
}

export function resolvePaidAmount(bid: {
  id?: string;
  amount?: number;
  totalAmount?: number;
  message?: string | null;
  serverPaid?: PaidServerInfo;     // injected by caller after bulk fetch
}): number {
  if (bid.serverPaid?.paidTotal) return bid.serverPaid.paidTotal;

  const fromMsg = extractPaidFromMessage(bid.message);
  if (fromMsg.total) return fromMsg.total;

  if (typeof window !== "undefined" && bid.id) {
    const lsPaid = localStorage.getItem(`paid_amount_${bid.id}`);
    if (lsPaid) return parseFloat(lsPaid);
    const lsDeal = localStorage.getItem(`deal_price_${bid.id}`);
    if (lsDeal) return parseFloat(lsDeal);
  }

  return bid.totalAmount || bid.amount || 0;
}
