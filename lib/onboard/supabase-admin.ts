// Server-only Supabase REST helper for onboarding tables.
// Uses service-role key when present, falls back to JWT anon key (RLS is disabled
// on onboarding_users / otp_codes / agents / hotel_drafts so anon key works).
//
// To upgrade later: set SUPABASE_SERVICE_ROLE_KEY in env. No code change needed.

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://uxxhbdqedazpmvbvaosh.supabase.co";

// JWT anon key (from CLAUDE.md). Bypassed by service-role key when provided.
const FALLBACK_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_JWT_ANON ||
  FALLBACK_ANON;

const headers = (extra: Record<string, string> = {}) => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

export async function sbSelect<T = any>(
  table: string,
  query: string = ""
): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? "?" + query : ""}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`sbSelect ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function sbInsert<T = any>(table: string, row: any): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`sbInsert ${table} failed: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  return Array.isArray(arr) ? arr[0] : arr;
}

export async function sbUpdate(table: string, query: string, patch: any) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`sbUpdate ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function sbRpc<T = any>(fn: string, args: any = {}): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`sbRpc ${fn} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export const SB = { url: SUPABASE_URL, key: KEY };
