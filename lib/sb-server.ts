// Server-only Supabase REST helper. Never import in client components.
//
// v101 — Service-role aware. When SUPABASE_SERVICE_ROLE_KEY env var is
// set, every helper here uses the service-role key (bypasses RLS).
// Otherwise it falls back to the JWT anon key so the app keeps working
// as it did before v101.
//
// The anon key is the only thing that ever leaked to client bundles in
// older eras; this file is server-only by convention and the
// service-role key MUST NOT be exposed anywhere reachable from the
// browser. Server actions, route handlers, and edge-runtime-disabled
// functions only.
export const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";

// Plain anon key — kept exported for legacy callers + clear documentation.
export const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

// Effective key — service-role when configured, anon otherwise.
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const EFFECTIVE_KEY = SERVICE_ROLE_KEY || SB_KEY;
export function hasServiceRole(): boolean {
  return !!SERVICE_ROLE_KEY;
}

// v104.3 — Supabase's new key format requires PUBLIC key in apikey + the
// role-elevation key in Authorization Bearer. See lib/sb.ts for the rule.
// Always send legacy anon JWT in apikey; send the effective key (legacy
// or sb_secret_*) in Authorization. Both legacy and new formats work this way.

// SB_H now uses service-role when available. All helpers below (sbSelect,
// sbInsert, sbUpdate, sbUpsertUser, ensureUser, resolveUserIds) auto-graduate
// to service-role — no per-call-site code change needed. Falls back to anon
// when env var missing so prod behaviour is identical until the env var lands.
export const SB_H: Record<string, string> = {
  apikey: SB_KEY,                                  // always legacy anon JWT (publishable)
  Authorization: `Bearer ${EFFECTIVE_KEY}`,        // service-role when env var set, else anon
  "Content-Type": "application/json",
};

export const SB_H_REPRESENT = { ...SB_H, Prefer: "return=representation" };

// Plain anon header — for cases where you DELIBERATELY want anon behaviour
// (e.g. testing RLS or hitting a public endpoint as the anon role).
// Almost never the right choice; prefer SB_H above.
export const SB_H_ANON_ONLY = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export function decodeJwt(token: string): any {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch { return null; }
}

export function authUserId(req: Request): string | null {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  return payload?.id || payload?.user_id || payload?.sub || null;
}

export function authPayload(req: Request): any {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return decodeJwt(token);
}

// Ensure a row exists in public.users for the given id. Uses PostgREST upsert
// (Prefer: resolution=merge-duplicates) so duplicate calls are safe.
// Without this, FK constraints (bids_customerId_fkey) fail when the Railway
// JWT subject has never been mirrored into Supabase.
export async function ensureUser(id: string, phone?: string, name?: string): Promise<void> {
  if (!id) return;
  const row = {
    id,
    phone: phone || `unknown_${id}`,
    name: name || null,
    role: "CUSTOMER",
    isBlocked: false,
    updatedAt: new Date().toISOString(),
  };
  await fetch(`${SB_URL}/rest/v1/users?on_conflict=id`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  }).catch(() => {});
}

export async function sbSelect(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    const t = await r.text();
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function sbInsert(table: string, row: any): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: SB_H_REPRESENT,
    body: JSON.stringify(row),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Insert failed: ${t}`);
  const j = JSON.parse(t);
  return Array.isArray(j) ? j[0] : j;
}

export async function sbUpdate(table: string, filter: string, patch: any): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: SB_H_REPRESENT,
    body: JSON.stringify(patch),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Update failed: ${t}`);
  const j = JSON.parse(t);
  return Array.isArray(j) ? j[0] : j;
}

// Find all user IDs sharing the same phone (handles +91 prefix variants).
// Mirrors resolveOwnerIds from partner routes so customer-side endpoints
// (my-bids, bookings) don't miss rows stored under the alternate phone format.
export async function resolveUserIds(primaryId: string, jwtPhone?: string): Promise<string[]> {
  const ids: string[] = [primaryId];
  let rawPhone = "";
  try {
    const uRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${primaryId}&select=phone`, { headers: SB_H });
    const users = await uRes.json();
    if (Array.isArray(users) && users[0]?.phone) {
      rawPhone = String(users[0].phone).replace(/^\+91/, "").replace(/\D/g, "");
    }
  } catch {}
  if (!rawPhone && jwtPhone) {
    rawPhone = String(jwtPhone).replace(/^\+91/, "").replace(/\D/g, "");
  }
  if (!rawPhone) return ids;
  try {
    const allRes = await fetch(
      `${SB_URL}/rest/v1/users?or=(phone.eq.${rawPhone},phone.eq.%2B91${rawPhone})&select=id`,
      { headers: SB_H }
    );
    const all = await allRes.json();
    if (Array.isArray(all)) all.forEach((u: any) => { if (u.id && !ids.includes(u.id)) ids.push(u.id); });
  } catch {}
  return ids;
}

export function genId(prefix: string = "b"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
