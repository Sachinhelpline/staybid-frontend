// ── Hold-amount tier system ────────────────────────────────────────────
// Customer can pay a small refundable hold instead of the full booking
// amount — locks the room for 24h while they decide to confirm.
//
// Default tiers (by TOTAL booking amount, not per-night):
//   ≤ ₹2,000        → ₹99
//   ₹2,001–5,000    → ₹199
//   ₹5,001–10,000   → ₹299
//   ₹10,001–15,000  → ₹399
//   > ₹15,000       → ₹499
//
// Hotels can override their tiers via partner-panel config (admin can
// override globally). If an override map is passed, it takes precedence.

export type HoldTier = { upTo: number; amount: number };

export const DEFAULT_HOLD_TIERS: HoldTier[] = [
  { upTo: 2000,  amount: 99  },
  { upTo: 5000,  amount: 199 },
  { upTo: 10000, amount: 299 },
  { upTo: 15000, amount: 399 },
  { upTo: Infinity, amount: 499 },
];

export const HOLD_DURATION_HOURS = 24;

export function computeHoldAmount(
  totalBookingAmount: number,
  tiers: HoldTier[] = DEFAULT_HOLD_TIERS
): number {
  for (const t of tiers) {
    if (totalBookingAmount <= t.upTo) return t.amount;
  }
  // Defensive: never let hold be more than 20% of total or less than ₹99
  const last = tiers[tiers.length - 1];
  return Math.max(99, Math.min(last.amount, Math.floor(totalBookingAmount * 0.2)));
}

export function holdExpiresAt(createdAt: Date | number = Date.now()): Date {
  const ms = typeof createdAt === "number" ? createdAt : createdAt.getTime();
  return new Date(ms + HOLD_DURATION_HOURS * 60 * 60 * 1000);
}

export function formatHoldCountdown(expiresAt: Date | string | number): string {
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  const ms = Math.max(0, exp - now);
  if (ms === 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}

export function isHoldExpired(expiresAt: Date | string | number): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

// ── Persistence (localStorage MVP) ─────────────────────────────────────
// In phase 3 we move this to a Supabase `bid_holds` table so holds
// survive device changes + a cron can auto-expire. For MVP we read/write
// localStorage on the customer's device.

export type HoldState = {
  bidId: string;
  bookingId?: string;       // booking row id if accept created one
  hotelId: string;
  hotelName: string;
  roomType?: string;
  holdAmount: number;
  balanceDue: number;
  totalAmount: number;
  holdPaymentId?: string;
  balancePaymentId?: string;
  expiresAt: string;        // ISO
  createdAt: string;        // ISO
  status: "active" | "completed" | "expired" | "cancelled";
  flow: "book-now" | "flash" | "negotiate" | "counter-accept" | "pay-now";
  checkIn?: string;
  checkOut?: string;
  payAtHotel?: boolean;     // if true, balance is settled at the hotel desk
};

const KEY_PREFIX = "hold_state_";

export function saveHoldState(s: HoldState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY_PREFIX + s.bidId, JSON.stringify(s));
  } catch {}
}

export function readHoldState(bidId: string): HoldState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + bidId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function readAllHoldStates(): HoldState[] {
  if (typeof window === "undefined") return [];
  const out: HoldState[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) {
        try {
          const s = JSON.parse(localStorage.getItem(k) || "");
          if (s && s.bidId) out.push(s);
        } catch {}
      }
    }
  } catch {}
  return out;
}

export function removeHoldState(bidId: string) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY_PREFIX + bidId); } catch {}
}
