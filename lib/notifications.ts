// ── In-app notifications ──────────────────────────────────────────────
// Lightweight pub/sub for toast notifications across the app. Any
// component can dispatch a notification; the global <NotificationToast />
// in app/layout.tsx subscribes and renders them.
//
// Also bridges to the browser Notification API when the user has granted
// permission, so accepted-bid / expiring-bid alerts surface even if the
// tab is in the background.

export type NotificationKind =
  | "bid_accepted"
  | "bid_countered"
  | "bid_rejected"
  | "bid_auto_cancelled"
  | "bid_expiring_soon"   // 5 min warning before auto-cancel
  | "hold_expiring_soon"  // 1 h warning before hold expires
  | "info"
  | "success"
  | "warning"
  | "error";

export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  // Action chips at bottom of toast
  actions?: Array<{ label: string; href?: string; onClick?: () => void; primary?: boolean }>;
  // Auto-dismiss after ms (0 = sticky until user dismisses)
  duration?: number;
  createdAt: number;
};

const EVT = "sb:notify";
const SEEN_KEY = "sb_seen_notifications_v1";

// ── Dispatch ──────────────────────────────────────────────
export function notify(n: Omit<Notification, "id" | "createdAt"> & Partial<Pick<Notification, "id" | "createdAt">>) {
  if (typeof window === "undefined") return;
  const full: Notification = {
    id: n.id || `n-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    createdAt: n.createdAt || Date.now(),
    duration: n.duration ?? defaultDuration(n.kind),
    ...n,
  };
  window.dispatchEvent(new CustomEvent(EVT, { detail: full }));
  // Also fire a browser notification when permission granted + tab is hidden
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    document.visibilityState !== "visible"
  ) {
    try {
      new Notification(full.title, {
        body: full.body,
        icon: "/icon-192.png",
        tag: full.id,
      });
    } catch {}
  }
}

function defaultDuration(kind: NotificationKind): number {
  switch (kind) {
    case "bid_accepted":        return 0;     // sticky — requires user action
    case "bid_expiring_soon":   return 0;     // sticky
    case "bid_auto_cancelled":  return 8000;
    case "bid_rejected":        return 6000;
    case "bid_countered":       return 8000;
    case "hold_expiring_soon":  return 0;
    case "error":               return 6000;
    case "warning":             return 5000;
    case "success":             return 3500;
    default:                    return 4500;
  }
}

// ── Subscribe (used by global toaster) ────────────────────
export function onNotify(cb: (n: Notification) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => cb((e as CustomEvent<Notification>).detail);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

// ── Dedup helper — keeps a localStorage record of seen notif IDs ──
// Use to avoid double-showing the same bid_accepted notif on poll loops.
export function markSeen(id: string) {
  if (typeof window === "undefined") return;
  try {
    const seen: Record<string, number> = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    seen[id] = Date.now();
    // Prune ones older than 7 days
    const cutoff = Date.now() - 7 * 86400_000;
    for (const k of Object.keys(seen)) if (seen[k] < cutoff) delete seen[k];
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {}
}

export function isSeen(id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const seen: Record<string, number> = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    return !!seen[id];
  } catch { return false; }
}

// ── Browser Notification permission ───────────────────────
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}
