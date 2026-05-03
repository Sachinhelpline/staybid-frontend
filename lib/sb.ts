// Shared Supabase REST helpers used by every Next.js API route added in
// Sessions 1–6. Keeps URL/key/header definitions in one place so future
// rotations touch a single file.
export const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
export const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
export const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
export const SB_READ = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

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
