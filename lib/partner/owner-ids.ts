// Cross-pool ownerId resolver used by every /api/partner/* route.
//
// Customer and partner logins authenticate against the legacy `users` table
// (Railway/customer pool). Hotels onboarded via the new `/onboard` panel
// store their ownerId from `onboarding_users` (IDs prefixed `ou_`). To let a
// host see their newly-onboarded hotel from the partner dashboard with the
// same phone/email, we union both pools when resolving owner IDs.
const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function resolveOwnerIdsCrossPool(
  primaryId: string,
  jwtPhone?: string,
  jwtEmail?: string
): Promise<string[]> {
  const ids: string[] = [primaryId];
  let rawPhone = "";
  let email = (jwtEmail || "").trim().toLowerCase();
  try {
    const r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${primaryId}&select=phone,email`, { headers: H });
    const us = await r.json();
    if (Array.isArray(us) && us[0]) {
      if (us[0].phone) rawPhone = String(us[0].phone).replace(/^\+91/, "").replace(/\D/g, "");
      if (!email && us[0].email) email = String(us[0].email).toLowerCase();
    }
  } catch { /* ignore */ }

  if (!rawPhone && jwtPhone) rawPhone = String(jwtPhone).replace(/^\+91/, "").replace(/\D/g, "");
  if (!rawPhone && !email) return ids;

  // 1) Customer `users` table by phone variants
  if (rawPhone) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/users?or=(phone.eq.${rawPhone},phone.eq.%2B91${rawPhone})&select=id`,
        { headers: H }
      );
      const all = await r.json();
      if (Array.isArray(all)) all.forEach((u: any) => { if (u.id && !ids.includes(u.id)) ids.push(u.id); });
    } catch { /* ignore */ }
  }

  // 2) `onboarding_users` by phone variants and/or email
  try {
    const filters: string[] = [];
    if (rawPhone) {
      filters.push(`phone.eq.${rawPhone}`);
      filters.push(`phone.eq.%2B91${rawPhone}`);
    }
    if (email) filters.push(`email.eq.${encodeURIComponent(email)}`);
    if (filters.length) {
      const r = await fetch(
        `${SB_URL}/rest/v1/onboarding_users?or=(${filters.join(",")})&select=id`,
        { headers: H }
      );
      const onb = await r.json();
      if (Array.isArray(onb)) onb.forEach((u: any) => { if (u.id && !ids.includes(u.id)) ids.push(u.id); });
    }
  } catch { /* ignore */ }

  return ids;
}
