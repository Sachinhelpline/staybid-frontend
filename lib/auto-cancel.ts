// ── Auto-cancel timer for accepted bids ──────────────────────────────
// When a hotel ACCEPTS a customer's bid (and customer hasn't paid yet),
// the customer has a fixed window to confirm with payment. If they
// don't, the bid auto-cancels and the room is released.
//
// MVP: state tracked in localStorage. Backend Railway cron will enforce
// real cancellation server-side in a later phase.
//
// Defaults (rule documented for backend reference):
//   • ACCEPTANCE_WINDOW_MIN = 15  // customer has 15 min to pay
//   • WARNING_THRESHOLD_MIN = 5   // popup warning at 5 min remaining

export const ACCEPTANCE_WINDOW_MIN = 15;
export const WARNING_THRESHOLD_MIN = 5;

export type AcceptedBidWindow = {
  bidId: string;
  acceptedAt: string;        // ISO when hotel accepted
  expiresAt: string;         // ISO when window closes
  warnedAt?: string;         // ISO when 5-min warning was shown (idempotent)
  cancelledAt?: string;      // ISO when auto-cancelled
};

const KEY_PREFIX = "accept_window_";

export function startAcceptanceWindow(bidId: string, acceptedAt: Date | number = Date.now()): AcceptedBidWindow {
  const acc = new Date(typeof acceptedAt === "number" ? acceptedAt : acceptedAt.getTime());
  const exp = new Date(acc.getTime() + ACCEPTANCE_WINDOW_MIN * 60_000);
  const w: AcceptedBidWindow = {
    bidId,
    acceptedAt: acc.toISOString(),
    expiresAt: exp.toISOString(),
  };
  saveWindow(w);
  return w;
}

export function saveWindow(w: AcceptedBidWindow) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY_PREFIX + w.bidId, JSON.stringify(w)); } catch {}
}

export function readWindow(bidId: string): AcceptedBidWindow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + bidId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearWindow(bidId: string) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY_PREFIX + bidId); } catch {}
}

export function readAllWindows(): AcceptedBidWindow[] {
  if (typeof window === "undefined") return [];
  const out: AcceptedBidWindow[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) {
        try {
          const w = JSON.parse(localStorage.getItem(k) || "");
          if (w && w.bidId) out.push(w);
        } catch {}
      }
    }
  } catch {}
  return out;
}

// ── Timer math ────────────────────────────────────────────
export function timeLeftMs(w: AcceptedBidWindow): number {
  return Math.max(0, new Date(w.expiresAt).getTime() - Date.now());
}

export function isExpired(w: AcceptedBidWindow): boolean {
  return timeLeftMs(w) <= 0;
}

export function shouldWarn(w: AcceptedBidWindow): boolean {
  if (w.warnedAt) return false; // already warned
  if (isExpired(w)) return false;
  return timeLeftMs(w) <= WARNING_THRESHOLD_MIN * 60_000;
}

export function markWarned(bidId: string) {
  const w = readWindow(bidId);
  if (!w) return;
  saveWindow({ ...w, warnedAt: new Date().toISOString() });
}

export function markCancelled(bidId: string) {
  const w = readWindow(bidId);
  if (!w) return;
  saveWindow({ ...w, cancelledAt: new Date().toISOString() });
}

export function formatCountdown(w: AcceptedBidWindow): string {
  const ms = timeLeftMs(w);
  if (ms === 0) return "Expired";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}
