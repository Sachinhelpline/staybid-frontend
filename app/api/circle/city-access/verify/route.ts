// v348 — Circle Model 2 city-access verify. HMAC-verifies the payment, then
// flips the pending row → active (lifetime). 4-key idempotent PATCH: matched on
// id + razorpay_order_id + status=pending_payment + user ownership → a re-verify
// is a 0-row no-op (already active). Auth: customer sb_token → cross-pool ids.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb-server";
import { userFromReq } from "@/lib/sb";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { normalizeCity, cityAccessId } from "@/lib/circle/city-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const city = normalizeCity(body?.city);
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();
  if (!city || !rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing payment fields" }, { status: 400 });
  }

  const ownerIds = await resolveOwnerIdsCrossPool(user.id, user.phone, user.email);
  if (!ownerIds.length) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const idsCsv = ownerIds.map((x) => encodeURIComponent(x)).join(",");

  // HMAC verify.
  const origin = new URL(req.url).origin;
  let verified = false;
  try {
    const vr = await fetch(`${origin}/api/razorpay/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    });
    verified = !!(await vr.json().catch(() => ({})))?.verified;
  } catch {
    return NextResponse.json({ ok: false, error: "Verification unreachable" }, { status: 502 });
  }
  if (!verified) return NextResponse.json({ ok: false, error: "Payment signature mismatch" }, { status: 400 });

  const id = cityAccessId(String(user.id), city);
  const nowIso = new Date().toISOString();
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_city_access?id=eq.${encodeURIComponent(id)}` +
        `&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
        `&status=eq.pending_payment&user_id=in.(${idsCsv})`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "active", razorpay_payment_id: paymentId, activated_at: nowIso, updated_at: nowIso }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      // Already active (re-verify) or not-yours → idempotent success.
      return NextResponse.json({ ok: true, alreadyProcessed: true, city });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }

  return NextResponse.json({ ok: true, city });
}
