// Single source of truth for "what did the customer ACTUALLY pay" on a bid.
// Backend often stores bid.amount = floor price (because flash bids below floor
// are accepted only via dealId fallback), so the bid.amount column doesn't
// reflect the real payment. We embed `paid:X` and `rate:Y` tokens in the
// bid message at booking time; this helper extracts them.
//
// Resolution order:
//   1. paid:X token in bid.message       (works on customer + partner view)
//   2. localStorage paid_amount_{bidId}   (customer device only — fastest)
//   3. localStorage deal_price_{bidId}    (legacy per-night value)
//   4. bid.totalAmount / bid.amount       (backend value — may be floor)

export function extractPaidFromMessage(msg?: string | null): { total?: number; rate?: number } {
  if (!msg) return {};
  const total = msg.match(/paid:\s*(\d+(?:\.\d+)?)/i);
  const rate  = msg.match(/rate:\s*(\d+(?:\.\d+)?)/i);
  return {
    total: total ? parseFloat(total[1]) : undefined,
    rate:  rate  ? parseFloat(rate[1])  : undefined,
  };
}

export function resolvePaidAmount(bid: {
  id?: string;
  amount?: number;
  totalAmount?: number;
  message?: string | null;
}): number {
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
