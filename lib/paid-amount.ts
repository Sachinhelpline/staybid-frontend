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
