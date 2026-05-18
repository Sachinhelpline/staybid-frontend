import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

// Admin endpoint for creator (influencer) applications.
// GET   — list applications, optionally filtered by status (pending/active/blocked).
// PATCH — flip a single influencer's status. Body: { id, status }.
//
// Updates `influencers.status` directly via Supabase REST. The frontend
// uses this from /admin/creators to approve / block / re-activate
// applications submitted via /upgrade.



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

  // Fetch influencers + side-load the user's phone/name/email via a separate
  // request. We used to use the PostgREST embedded-resource syntax
  // (`users:user_id(...)`) but that requires a declared FK on
  // `influencers.user_id → users.id` which doesn't exist in this schema
  // (TEXT IDs, no FK constraint). Instead we do influencers + users in
  // parallel and merge in JS.
  let query =
    // Phase 7 — application_source + auto_eval_data added so admin sees
    // cron-driven candidates (auto_promote / auto_eval) alongside form
    // applicants. Default for legacy rows: 'form'.
    "influencers?select=id,user_id,bio,location,total_followers,interests,bank_name,bank_account_number,ifsc_code,aadhaar_verified,pan_verified,verification_tier,status,total_earnings,created_at,updated_at,application_source,auto_eval_data&order=created_at.desc&limit=300";
  if (ALLOWED_STATUSES.has(status)) {
    query += `&status=eq.${status}`;
  }

  try {
    const infRes = await fetch(`${SB_URL}/rest/v1/${query}`, { headers: SB_H });
    if (!infRes.ok) {
      return NextResponse.json({ error: await infRes.text() }, { status: infRes.status });
    }
    const influencers = (await infRes.json()) as any[];

    // Side-load the user rows so admin sees phone/name/email next to each
    // application. Skip the lookup if there are no rows.
    const userIds = Array.from(new Set(influencers.map((i) => i.user_id).filter(Boolean)));
    let userById: Record<string, any> = {};
    if (userIds.length > 0) {
      const inList = userIds.map((id) => encodeURIComponent(id)).join(",");
      const userRes = await fetch(
        `${SB_URL}/rest/v1/users?id=in.(${inList})&select=id,phone,name,email`,
        { headers: SB_H }
      );
      if (userRes.ok) {
        const users = (await userRes.json()) as any[];
        userById = Object.fromEntries(users.map((u) => [u.id, u]));
      }
    }

    // Attach the joined user under `users` (same shape the UI was reading
    // before, so no frontend change needed beyond the error going away).
    let data = influencers.map((i) => ({
      ...i,
      users: userById[i.user_id] || null,
    }));

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
