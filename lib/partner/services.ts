// v176 — Partner-panel service catalog (entitlements / subscription).
//
// Default services are free for every hotel forever. Subscription
// services stay locked until the admin grants access (free, trial or
// paid). Shared by the dashboard (client) + the entitlement APIs.

export const DEFAULT_SERVICES = [
  "overview", "bids", "rooms", "bookings", "availability", "complaints", "content", "profile",
  // v265 — Passport Guests (read-only Explorer Passport holders at this hotel).
  "passport",
] as const;

export const SUBSCRIPTION_SERVICES = [
  "flash", "reservations", "housekeeping", "billing", "menu", "fnbqr",
  "guests", "reports", "redeem", "channels", "staff", "verification",
] as const;

export const SERVICE_LABEL: Record<string, string> = {
  flash:        "Flash Deals",
  reservations: "Reservations",
  housekeeping: "Housekeeping",
  billing:      "Billing & Folios",
  menu:         "F&B Digital Menu",
  fnbqr:        "F&B QR Ordering",
  guests:       "Guest CRM",
  reports:      "Reports & Analytics",
  redeem:       "Redeem Codes",
  channels:     "Channel Manager",
  staff:        "Staff & Roles",
  verification: "Verification",
};

export function isDefaultService(key: string): boolean {
  return (DEFAULT_SERVICES as readonly string[]).includes(key);
}
export function isSubscriptionService(key: string): boolean {
  return (SUBSCRIPTION_SERVICES as readonly string[]).includes(key);
}

// Effective lock check given a hotel_services row (or undefined).
export function isServiceUnlocked(serviceKey: string, row?: { expires_at?: string | null } | null): boolean {
  if (isDefaultService(serviceKey)) return true;
  if (!row) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}
