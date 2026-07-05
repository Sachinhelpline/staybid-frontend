import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── StayCircle™ investor KYC (v294.18, Phase 4) ──────────────────────────
// Circle's OWN identity + payout KYC. Completely separate from the hotel
// video-verification flow (vp_requests / vp_videos). One row per user in
// public.circle_kyc.
//
// GET  /api/circle/kyc  → the caller's KYC row (or a not_started stub)
// POST /api/circle/kyc  → upsert the KYC details, flips status → 'submitted'

const EMPTY = {
  status: "not_started",
  full_name: "", pan: "", aadhaar_last4: "",
  bank_account: "", bank_ifsc: "", bank_holder: "",
  submitted_at: null, reviewed_at: null, review_note: null,
};

export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const uid = encodeURIComponent(user.id);
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_kyc?user_id=eq.${uid}&select=*&limit=1`,
      { headers: SB_H, cache: "no-store" },
    );
    const rows = r.ok ? await r.json() : [];
    const kyc = Array.isArray(rows) && rows[0] ? rows[0] : { user_id: user.id, ...EMPTY };
    return NextResponse.json({ kyc });
  } catch {
    return NextResponse.json({ kyc: { user_id: user.id, ...EMPTY } });
  }
}

const digits = (s: string) => String(s || "").replace(/\D/g, "");

export async function POST(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const full_name = String(body?.full_name || "").trim().slice(0, 120);
  const pan = String(body?.pan || "").trim().toUpperCase().slice(0, 10);
  const aadhaar_last4 = digits(body?.aadhaar_last4).slice(-4);
  const bank_account = digits(body?.bank_account).slice(0, 20);
  const bank_ifsc = String(body?.bank_ifsc || "").trim().toUpperCase().slice(0, 11);
  const bank_holder = String(body?.bank_holder || "").trim().slice(0, 120);

  // Light validation — enough to keep obviously-broken rows out, not a full
  // compliance gate (that's the reviewer's job).
  if (!full_name) return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return NextResponse.json({ error: "PAN looks invalid (e.g. ABCDE1234F)." }, { status: 400 });
  }
  if (bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank_ifsc)) {
    return NextResponse.json({ error: "IFSC looks invalid (e.g. HDFC0001234)." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const row = {
    user_id: user.id,
    full_name, pan, aadhaar_last4, bank_account, bank_ifsc, bank_holder,
    status: "submitted",
    submitted_at: now,
    updated_at: now,
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/circle_kyc?on_conflict=user_id`, {
      method: "POST",
      headers: { ...SB_H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save KYC.", detail: t.slice(0, 160) }, { status: 502 });
    }
    const saved = await r.json();
    return NextResponse.json({ ok: true, kyc: Array.isArray(saved) ? saved[0] : saved });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
