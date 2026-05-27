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

// Find all user IDs sharing the same human (phone variants + email).
//
// v240 — Widened from phone-only matching to also walk email + reject
// Firebase `unknown_<uid>` placeholder phones. Same root cause as the
// v132.10 social-profile fix: a single human signs in via Google
// Firebase one day (`Ld6xDB42…` UID, `phone=unknown_Ld6xDB42…`) and
// Phone OTP another day (`cmnr4b8ol…`, `phone=+918881555188`). Old
// resolver matched only on phone, so /my-bids signed in via phone-OTP
// missed every Firebase-authored bid (and vice versa) — the "Place Bid
// section empty" feedback cycle that has recurred 4+ times (v233, v234,
// v240). Server-authoritative cross-identity is the future-proof fix.
//
// New algorithm walks THREE axes, returning the union:
//   1. Direct primary id (always included).
//   2. Phone variants (caller's stored phone + JWT phone, normalized).
//      Skips `unknown_*` placeholder phones entirely.
//   3. Email (caller's stored email + JWT email).
//
// Callers that pass only `jwtPhone` keep working — `jwtEmail` is
// optional. Phone-only matching still happens; email is additive.
export async function resolveUserIds(
  primaryId: string,
  jwtPhone?: string,
  jwtEmail?: string,
): Promise<string[]> {
  const ids = new Set<string>([primaryId]);

  // 1. Firebase prefix-twin axis (v240).
  //    Bids table got customerIds WITHOUT normalization, so the same
  //    human has 120 bids under `fb_Ld6xDB42…` (Facebook session) and
  //    52 under `Ld6xDB42…` (Google session). The social profile path
  //    normalizes via `normalizeAuthId` (lib/social/auth-helper.ts)
  //    but /api/bids/place doesn't. Bridge both variants at read time.
  //    Limited to plausible Firebase UIDs (≥20 alphanumeric chars) so
  //    we never accidentally append fb_ to phone-OTP CUIDs.
  if (primaryId.startsWith("fb_")) {
    ids.add(primaryId.slice(3));        // stripped twin
  } else if (primaryId.startsWith("firebase_")) {
    ids.add(primaryId.slice(9));
  } else if (/^[A-Za-z0-9]{20,}$/.test(primaryId)) {
    // Plain Firebase UID → also check the fb_-prefixed twin row.
    ids.add(`fb_${primaryId}`);
    ids.add(`firebase_${primaryId}`);
  }

  // 2. Read caller's own row(s) for stored phone + email. We read ALL
  //    rows we've already accumulated (primary + Firebase twin) so a
  //    Google session can pick up the Facebook row's phone/email too.
  let userPhone = "";
  let userEmail = "";
  try {
    const idList = Array.from(ids).map(encodeURIComponent).join(",");
    const uRes = await fetch(`${SB_URL}/rest/v1/users?id=in.(${idList})&select=phone,email`, { headers: SB_H });
    const arr = await uRes.json();
    if (Array.isArray(arr)) {
      for (const u of arr) {
        if (!userPhone && u?.phone) userPhone = String(u.phone);
        if (!userEmail && u?.email) userEmail = String(u.email);
      }
    }
  } catch {}

  // 3. Phone variants. Skip `unknown_<uid>` placeholders.
  const phoneVariants = new Set<string>();
  for (const candidate of [userPhone, jwtPhone].filter(Boolean) as string[]) {
    const t = String(candidate).trim();
    if (!t || /^unknown_/i.test(t)) continue;
    const digits = t.replace(/\D/g, "");
    if (digits.length < 10) continue;
    const last10 = digits.slice(-10);
    phoneVariants.add(t);
    phoneVariants.add(digits);
    phoneVariants.add(last10);
    phoneVariants.add(`+91${last10}`);
    phoneVariants.add(`91${last10}`);
  }
  if (phoneVariants.size) {
    const inList = Array.from(phoneVariants).map(encodeURIComponent).join(",");
    try {
      const r = await fetch(`${SB_URL}/rest/v1/users?phone=in.(${inList})&select=id`, { headers: SB_H });
      const arr = await r.json();
      if (Array.isArray(arr)) arr.forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  // 4. Email match (case-insensitive via PostgREST `ilike`). Covers OAuth
  //    ↔ phone-OTP cases where the Google email also lives on a
  //    phone-OTP users row (and handles uppercase / lowercase drift).
  const emailCandidates = new Set<string>();
  if (userEmail && /@/.test(userEmail)) emailCandidates.add(userEmail.toLowerCase());
  if (jwtEmail  && /@/.test(jwtEmail))  emailCandidates.add(jwtEmail.toLowerCase());
  // Array.from() iterator — v94-era trap: `for (const x of someSet)` fails
  // Vercel's strict TS build (tsconfig lacks downlevelIteration).
  for (const email of Array.from(emailCandidates)) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/users?email=ilike.${encodeURIComponent(email)}&select=id`, { headers: SB_H });
      const arr = await r.json();
      if (Array.isArray(arr)) arr.forEach((u: any) => u?.id && ids.add(String(u.id)));
    } catch {}
  }

  return Array.from(ids);
}

export function genId(prefix: string = "b"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
