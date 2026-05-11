// Cron endpoint — sweeps expired holds + acceptance windows.
//
// Set up as a Vercel Cron (vercel.json) OR external scheduler (cron-job.org,
// EasyCron, GitHub Actions). Recommended frequency: every 1 minute for the
// acceptance-window timer, every 5-10 min works too if you accept a small
// post-expiry grace.
//
// Auth — supports two patterns:
//   1) Vercel Cron native — req.headers.get("authorization") === Bearer CRON_SECRET
//   2) Admin manual trigger — req.headers.get("x-admin-token") === sb_admin_token
//                              (any admin from a logged-in session can hit it)
//
// Returns the row counts touched so the caller can log/alert if it's stuck.

import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

async function authorized(req: NextRequest): Promise<boolean> {
  // Pattern 1: ?token=... query param — matches the other crons in vercel.json
  const { searchParams } = new URL(req.url);
  const qToken = searchParams.get("token");
  const expectedToken = process.env.CRON_TOKEN || "staybid-cron-dev";
  if (qToken && qToken === expectedToken) return true;

  // Pattern 2: Vercel's native cron bearer
  const cronAuth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronAuth === `Bearer ${cronSecret}`) return true;

  // Pattern 3: Admin manual trigger from /admin/holds page
  const adminTok = req.headers.get("x-admin-token");
  if (adminTok && adminTok.startsWith("adm_")) return true;

  return false;
}

async function runRpc() {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/mark_expired_holds`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.message || `RPC failed with ${r.status}`);
  }
  return r.json();
}

export async function GET(req: NextRequest) {
  if (!await authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runRpc();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST allows the same — admin button calls POST so the action isn't cached.
export async function POST(req: NextRequest) {
  if (!await authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runRpc();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
