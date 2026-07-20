// v390 — Circle settlement S3 foundation: owner PAYOUT ACCOUNT self-service.
//
//   GET  /api/circle/payout-account   → the caller's saved payout account (masked)
//   POST /api/circle/payout-account   { method, accountHolder, accountNumber, ifsc, upiId }
//        → upsert the caller's payout account (where they get paid).
//
// This is where a Circle owner tells us where to send their earnings — the hard
// prerequisite for the RazorpayX fund-account created in the money-out phase.
// Saving details does NOT move money. Auth: customer sb_token → cross-pool ids;
// a caller can only read/write their OWN account.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const csv = (xs: string[]) => xs.map((x) => encodeURIComponent(x)).join(",");
const mask = (s: string) => { const v = String(s || ""); return v.length <= 4 ? v : `••••${v.slice(-4)}`; };
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;

function present(a: any) {
  if (!a) return null;
  return {
    id: a.id,
    method: a.method,
    accountHolder: a.account_holder || "",
    accountNumberMasked: a.account_number ? mask(a.account_number) : "",
    ifsc: a.ifsc || "",
    upiId: a.upi_id || "",
    status: a.status,
    linked: !!a.razorpayx_fund_account_id,
    updatedAt: a.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ account: null });
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_payout_accounts?user_id=in.(${csv(ownerIds)})&select=*&order=updated_at.desc&limit=1`,
      { headers: SB_H },
    );
    const row = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
    return NextResponse.json({ account: present(row) });
  } catch {
    return NextResponse.json({ account: null });
  }
}

export async function POST(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const method = String(body?.method || "bank").trim().toLowerCase();
  if (!["bank", "upi"].includes(method)) return NextResponse.json({ error: "method must be bank or upi." }, { status: 400 });

  const accountHolder = String(body?.accountHolder || "").trim().slice(0, 120);
  const accountNumber = String(body?.accountNumber || "").replace(/\s+/g, "").slice(0, 40);
  const ifsc = String(body?.ifsc || "").trim().toUpperCase().slice(0, 20);
  const upiId = String(body?.upiId || "").trim().slice(0, 120);

  // Validate by method — enough to create a RazorpayX fund account later.
  if (method === "bank") {
    if (!accountHolder) return NextResponse.json({ error: "Account holder name is required." }, { status: 400 });
    if (!/^\d{6,20}$/.test(accountNumber)) return NextResponse.json({ error: "Enter a valid bank account number." }, { status: 400 });
    if (!IFSC_RE.test(ifsc)) return NextResponse.json({ error: "Enter a valid IFSC code." }, { status: 400 });
  } else {
    if (!UPI_RE.test(upiId)) return NextResponse.json({ error: "Enter a valid UPI ID (e.g. name@bank)." }, { status: 400 });
  }

  // Resolve the caller's primary id (stable upsert key = the caller's own id).
  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const primaryId = String(userId);
  const nowIso = new Date().toISOString();

  // Find an existing account across the caller's identities (so a twin id doesn't
  // create a duplicate); update it in place if present, else insert on primaryId.
  let existing: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_payout_accounts?user_id=in.(${csv(ownerIds.length ? ownerIds : [primaryId])})&select=id&limit=1`,
      { headers: SB_H },
    );
    existing = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
  } catch { /* fall through to insert */ }

  // Changing the details resets verification to pending (and clears any stale
  // RazorpayX fund-account link so it's re-created against the new details).
  const payload: any = {
    user_id: existing ? undefined : primaryId,
    method,
    account_holder: method === "bank" ? accountHolder : "",
    account_number: method === "bank" ? accountNumber : "",
    ifsc: method === "bank" ? ifsc : "",
    upi_id: method === "upi" ? upiId : "",
    status: "pending",
    razorpayx_fund_account_id: null,
    updated_at: nowIso,
  };

  try {
    if (existing) {
      const r = await fetch(`${SB_URL}/rest/v1/circle_payout_accounts?id=eq.${encodeURIComponent(existing.id)}`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      const row = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
      if (!row) return NextResponse.json({ error: "Couldn't save — try again." }, { status: 502 });
      return NextResponse.json({ ok: true, account: present(row) });
    }
    const r = await fetch(`${SB_URL}/rest/v1/circle_payout_accounts`, {
      method: "POST", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ id: `payacc_${primaryId}_${Date.now().toString(36)}`.slice(0, 190), created_at: nowIso, ...payload }),
    });
    const row = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
    if (!row) return NextResponse.json({ error: "Couldn't save — try again." }, { status: 502 });
    return NextResponse.json({ ok: true, account: present(row) });
  } catch {
    return NextResponse.json({ error: "Network error." }, { status: 502 });
  }
}
