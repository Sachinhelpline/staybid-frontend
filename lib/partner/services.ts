// v176 — Partner-panel service catalog (entitlements / subscription).
//
// Default services are free for every hotel forever. Subscription
// services stay locked until the admin grants access (free, trial or
// paid). Shared by the dashboard (client) + the entitlement APIs.

export const DEFAULT_SERVICES = [
  "overview", "bids", "rooms", "bookings", "availability", "complaints", "content", "profile",
  // v265 — Passport Guests (read-only Explorer Passport holders at this hotel).
  "passport",
  // v288 — StayCircle investments (read-only community-partner view).
  "circle",
] as const;

export const SUBSCRIPTION_SERVICES = [
  "flash", "reservations", "housekeeping", "billing", "menu", "fnbqr",
  "guests", "reports", "redeem", "channels", "staff", "verification",
] as const;

// v344 — M5: Circle per-model ENROLLMENT MARKERS. Deliberately NOT in
// SUBSCRIPTION_SERVICES (so they never tab-gate the partner dashboard nor hit
// the paid service-checkout / isSubscriptionService gates) and NOT in
// DEFAULT_SERVICES. Granted FREE on verify by the 3 model journeys
// (grantModel1/3/4Service) purely as an enrollment marker — real Circle access
// stays ownership-based (hotel_room_units.owner_user_id /
// inventory_blocks.investor_user_id). Listed here only for recognition + labels.
export const CIRCLE_SERVICES = ["circle_model1", "circle_model3", "circle_model4"] as const;

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
  // v344 — M5: Circle per-model enrollment markers (free).
  circle_model1: "Circle · Model 1 (Revenue Share)",
  circle_model3: "Circle · Model 3 (Pre-buy Inventory)",
  circle_model4: "Circle · Model 4 (B2B Exchange)",
};

export function isDefaultService(key: string): boolean {
  return (DEFAULT_SERVICES as readonly string[]).includes(key);
}
export function isSubscriptionService(key: string): boolean {
  return (SUBSCRIPTION_SERVICES as readonly string[]).includes(key);
}
// v344 — M5: a Circle enrollment marker (free; never a paid/tab-gated service).
export function isCircleService(key: string): boolean {
  return (CIRCLE_SERVICES as readonly string[]).includes(key);
}

// Effective lock check given a hotel_services row (or undefined).
export function isServiceUnlocked(serviceKey: string, row?: { expires_at?: string | null } | null): boolean {
  if (isDefaultService(serviceKey)) return true;
  if (!row) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}
