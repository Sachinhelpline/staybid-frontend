// Shared Supabase REST helpers used by every Next.js API route added in
// Sessions 1–6. Keeps URL/key/header definitions in one place so future
// rotations touch a single file.
//
// v101 — SB_H / SB_READ now auto-graduate to service-role when the
// SUPABASE_SERVICE_ROLE_KEY env var is set. Identical behaviour when the
// env var is missing (uses anon key). This single change opts in every
// route that imports from here, so locking down a sensitive table via
// `/admin/rls` only requires setting the env var on Vercel + clicking
// the 🔒 Lock button. No per-route refactor needed.
export const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
export const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
export function hasServiceRole(): boolean {
  return !!SERVICE_ROLE_KEY;
}

// Effective key for server-side calls. Service-role when set, anon otherwise.
export const SB_ADMIN_KEY = SERVICE_ROLE_KEY || SB_KEY;

// v104.3 — Supabase's NEW key format (sb_secret_* / sb_publishable_*)
// rule per their 2024+ docs:
//   - `apikey` header MUST carry a PUBLIC key (legacy anon JWT or
//     sb_publishable_*). PostgREST validates this against the public
//     allowlist; sb_secret_* in this slot returns "Invalid API key".
//   - `Authorization: Bearer` carries the role-elevation token:
//     - legacy JWT: same as apikey (full back-compat)
//     - sb_secret_*: PostgREST recognises it for service-role bypass
//
// Earlier v104 had this backwards (apikey only for new format) which
// caused "Invalid API key" on every admin RLS request after the env
// var landed. Fixed here: always send the legacy anon JWT in apikey
// + send the actual SB_ADMIN_KEY (legacy OR sb_secret_*) in Bearer.
function isLegacyJwt(k: string): boolean {
  return typeof k === "string" && k.startsWith("eyJ");
}

const ADMIN_HEADERS_BASE: Record<string, string> = {
  // apikey ALWAYS uses the legacy anon JWT (or any valid publishable key).
  // sb_secret_* in this position is rejected as "Invalid API key".
  apikey: SB_KEY,
  // Authorization: Bearer carries the role-elevation key — could be the
  // legacy service-role JWT, sb_secret_*, or fall back to SB_KEY itself
  // when env var isn't set (no elevation, behaves as anon).
  Authorization: `Bearer ${SB_ADMIN_KEY}`,
};
// keep isLegacyJwt export for any external callers
void isLegacyJwt;

// v101 — SB_H is now service-role-when-available. Was previously plain
// anon. Existing imports require no change.
export const SB_H: Record<string, string> = {
  ...ADMIN_HEADERS_BASE,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
export const SB_READ: Record<string, string> = { ...ADMIN_HEADERS_BASE };

// SB_ADMIN_H / SB_ADMIN_READ are now identical to SB_H / SB_READ. Kept for
// backwards compatibility with v100 callers that adopted them explicitly.
export const SB_ADMIN_H = SB_H;
export const SB_ADMIN_READ = SB_READ;

// Plain anon header — use ONLY when you deliberately want anon behaviour
// (e.g. testing RLS). Almost never the right choice; prefer SB_H above.
// SB_KEY is always the legacy JWT anon (still kept as fallback constant).
export const SB_H_ANON_ONLY = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
export const SB_READ_ANON_ONLY = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export function decodeJwt(t: string): any | null {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export function tokenFromReq(req: Request): string {
  return (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
}

export function userFromReq(req: Request): { id: string; role?: string; phone?: string; email?: string } | null {
  const t = tokenFromReq(req);
  if (!t) return null;
  const p = decodeJwt(t);
  return p?.id ? p : null;
}
