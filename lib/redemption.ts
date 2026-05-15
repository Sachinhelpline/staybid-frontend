// ─── StayPoints redemption — shared helpers ──────────────────────────────
// Pure functions only — no Supabase, no fetch. Used by both the customer-side
// client (validation hints in modals) and the server-side API routes.

export type RedemptionKind = "coupon" | "wallet_credit" | "amenity" | "voucher";
export type Tier = "silver" | "gold" | "platinum";
export type CodeStatus = "active" | "used" | "expired" | "revoked";

export type RedemptionRule = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: RedemptionKind;
  points_cost: number;
  value_inr: number;
  min_tier: Tier;
  max_per_user_per_month: number;
  validity_days: number;
  icon: string | null;
  terms: string | null;
  display_order: number;
  active: boolean;
};

export type RedemptionCode = {
  id: string;
  code: string;
  barcode_value: string;
  user_id: string;
  rule_id: string;
  rule_slug: string | null;
  kind: RedemptionKind;
  title: string | null;
  value_inr: number;
  points_spent: number;
  status: CodeStatus;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  used_on_bid_id: string | null;
  used_by_hotel_id: string | null;
  used_by_partner_id: string | null;
  notes: string | null;
};

// ─── Tier helpers ────────────────────────────────────────────────────────
const TIER_RANK: Record<Tier, number> = { silver: 0, gold: 1, platinum: 2 };

export function tierForBalance(balance: number): Tier {
  if (balance >= 50000) return "platinum";
  if (balance >= 10000) return "gold";
  return "silver";
}

export function tierMeetsMin(userTier: Tier, minTier: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[minTier];
}

// ─── Code generator ──────────────────────────────────────────────────────
// Crockford base32-ish alphabet — drops the ambiguous 0/O, 1/I/L. Easy for a
// customer to read off their phone and the partner to type. Result format:
//   STAY-XXXX-XXXX  (8 random chars in two 4-char groups)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars

export function generateCouponCode(prefix = "STAY"): string {
  const rand = (n: number) => {
    let out = "";
    for (let i = 0; i < n; i++) {
      // crypto.getRandomValues if available — else Math.random fallback (still
      // fine for non-security ids since uniqueness is enforced at DB level).
      const idx =
        typeof crypto !== "undefined" && crypto.getRandomValues
          ? crypto.getRandomValues(new Uint32Array(1))[0] % CODE_ALPHABET.length
          : Math.floor(Math.random() * CODE_ALPHABET.length);
      out += CODE_ALPHABET[idx];
    }
    return out;
  };
  return `${prefix}-${rand(4)}-${rand(4)}`;
}

// 12-digit numeric for Code128 / EAN-13 friendly barcode rendering. We derive
// from a random source so it's independent of the alphanumeric code (lets the
// partner panel accept either).
export function generateBarcodeValue(): string {
  let out = "";
  for (let i = 0; i < 12; i++) {
    const idx =
      typeof crypto !== "undefined" && crypto.getRandomValues
        ? crypto.getRandomValues(new Uint32Array(1))[0] % 10
        : Math.floor(Math.random() * 10);
    out += String(idx);
  }
  // First digit should not be 0 (some scanners drop leading zeros).
  if (out[0] === "0") out = "1" + out.slice(1);
  return out;
}

// ─── Validation ──────────────────────────────────────────────────────────
export type RedeemValidation =
  | { ok: true }
  | { ok: false; error: string };

export function canUserRedeem(opts: {
  rule: RedemptionRule;
  pointsBalance: number;
  userTier: Tier;
  monthlyCount: number;
}): RedeemValidation {
  const { rule, pointsBalance, userTier, monthlyCount } = opts;
  if (!rule.active) return { ok: false, error: "This reward is no longer available." };
  if (pointsBalance < rule.points_cost) {
    return { ok: false, error: `Need ${rule.points_cost - pointsBalance} more StayPoints to redeem.` };
  }
  if (!tierMeetsMin(userTier, rule.min_tier)) {
    return { ok: false, error: `${rule.min_tier.toUpperCase()} tier required. Keep travelling to unlock.` };
  }
  if (monthlyCount >= rule.max_per_user_per_month) {
    return { ok: false, error: `Monthly limit reached (max ${rule.max_per_user_per_month}/month).` };
  }
  return { ok: true };
}

export type ApplyContext = {
  bookingTotalInr: number;
  bidId?: string;
};

export type ApplyResult =
  | { ok: true; discountInr: number; finalTotalInr: number }
  | { ok: false; error: string };

// Computes how much a code shaves off a booking. Returns the discount + the
// final total. Wallet credit kind is bounded by available balance, not the
// code's printed value (the value_inr on a wallet_credit code IS its credit
// amount, but the credit lives in wallet_credits.balance_inr — different API
// path actually debits it).
export function applyCodeToBooking(
  code: Pick<RedemptionCode, "kind" | "value_inr" | "status" | "expires_at">,
  ctx: ApplyContext,
): ApplyResult {
  if (code.status !== "active") return { ok: false, error: `Code is ${code.status}.` };
  if (new Date(code.expires_at).getTime() < Date.now()) return { ok: false, error: "Code expired." };

  if (code.kind === "coupon" || code.kind === "voucher") {
    // Coupons cap their discount at the booking total — we never let a code
    // refund money beyond what the customer paid.
    const discount = Math.min(Number(code.value_inr) || 0, ctx.bookingTotalInr);
    if (discount <= 0) return { ok: false, error: "Coupon value is zero." };
    return { ok: true, discountInr: discount, finalTotalInr: Math.max(0, ctx.bookingTotalInr - discount) };
  }
  if (code.kind === "amenity") {
    return { ok: false, error: "Amenity codes are redeemed at the hotel desk, not at checkout." };
  }
  // wallet_credit codes are handled separately — they top up the wallet,
  // not the current booking. The booking-time path uses wallet_credits balance.
  return { ok: false, error: "Wrong code type for booking discount." };
}

// ─── Display helpers ─────────────────────────────────────────────────────
export function kindLabel(kind: RedemptionKind): string {
  if (kind === "coupon") return "Coupon";
  if (kind === "voucher") return "Voucher";
  if (kind === "amenity") return "Hotel Amenity";
  if (kind === "wallet_credit") return "Wallet Credit";
  return "Reward";
}

export function kindIcon(kind: RedemptionKind): string {
  if (kind === "coupon") return "🎟️";
  if (kind === "voucher") return "🎁";
  if (kind === "amenity") return "🏨";
  if (kind === "wallet_credit") return "💰";
  return "✨";
}

export function statusColor(s: CodeStatus): { bg: string; text: string; border: string; label: string } {
  if (s === "active")  return { bg: "#dcfce7", text: "#15803d", border: "#86efac", label: "ACTIVE" };
  if (s === "used")    return { bg: "#e5e7eb", text: "#374151", border: "#d1d5db", label: "USED" };
  if (s === "expired") return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5", label: "EXPIRED" };
  return                       { bg: "#fef3c7", text: "#92400e", border: "#fcd34d", label: "REVOKED" };
}

export function formatCode(code: string): string {
  // Already formatted with hyphens — pass through. Otherwise insert hyphens
  // every 4 chars after the prefix.
  if (code.includes("-")) return code;
  return code.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

// Cleans user input — strips spaces, uppercases, removes typos like O→0 etc.
export function normalizeCodeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "")
    .trim();
}

// Customer-side: pulls a queued coupon from localStorage. The /my-codes
// "Use at next checkout" CTA writes here; BookingReview reads it.
const PENDING_LS_KEY = "sb_pending_redemption_v1";

export type PendingRedemption = {
  code: string;
  kind: RedemptionKind;
  value_inr: number;
  title: string;
  expires_at: string;
  queued_at: number;
};

export function getPendingRedemption(): PendingRedemption | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingRedemption;
    // Auto-prune if queued more than 30 min ago — stale picks shouldn't
    // auto-apply later
    if (Date.now() - (p.queued_at || 0) > 30 * 60 * 1000) {
      localStorage.removeItem(PENDING_LS_KEY);
      return null;
    }
    return p;
  } catch { return null; }
}

export function setPendingRedemption(p: Omit<PendingRedemption, "queued_at">): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PENDING_LS_KEY, JSON.stringify({ ...p, queued_at: Date.now() }));
  } catch {}
}

export function clearPendingRedemption(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(PENDING_LS_KEY); } catch {}
}
