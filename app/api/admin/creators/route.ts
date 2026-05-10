import { NextRequest, NextResponse } from "next/server";

// Admin endpoint for creator (influencer) applications.
// GET   — list applications, optionally filtered by status (pending/active/blocked).
// PATCH — flip a single influencer's status. Body: { id, status }.
//
// Updates `influencers.status` directly via Supabase REST. The frontend
// uses this from /admin/creators to approve / block / re-activate
// applications submitted via /upgrade.

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const ALLOWED_STATUSES = new Set(["pending", "active", "blocked"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") || "all").toLowerCase();
  const search = (searchParams.get("search") || "").toLowerCase();

  // Fetch influencers + join the user's phone/name from `users` so admin
  // can identify applicants without a second lookup.
  let query =
    "influencers?select=id,user_id,bio,location,total_followers,interests,bank_name,bank_account_number,ifsc_code,aadhaar_verified,pan_verified,verification_tier,status,total_earnings,created_at,updated_at,users:user_id(phone,name,email)&order=created_at.desc&limit=300";
  if (ALLOWED_STATUSES.has(status)) {
    query += `&status=eq.${status}`;
  }

  try {
    const res = await fetch(`${SB_URL}/rest/v1/${query}`, { headers: SB_H });
    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: res.status });
    }
    let data = (await res.json()) as any[];
    if (search) {
      data = data.filter((i) => {
        const phone = i.users?.phone || "";
        const name  = i.users?.name || "";
        const bio   = i.bio || "";
        return (
          phone.toLowerCase().includes(search) ||
          name.toLowerCase().includes(search) ||
          bio.toLowerCase().includes(search) ||
          i.id?.toLowerCase().includes(search)
        );
      });
    }
    return NextResponse.json({ creators: data, total: data.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Fetch failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, status, aadhaar_verified, pan_verified } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    const s = String(status).toLowerCase();
    if (!ALLOWED_STATUSES.has(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = s;
  }
  if (aadhaar_verified !== undefined) update.aadhaar_verified = !!aadhaar_verified;
  if (pan_verified !== undefined) update.pan_verified = !!pan_verified;

  try {
    const res = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      return NextResponse.json({ error: await res.text() }, { status: res.status });
    }
    const data = await res.json().catch(() => null);
    return NextResponse.json({ ok: true, creator: Array.isArray(data) ? data[0] : data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}
