// GET /api/redemption/validate?code=STAY-XXXX-XXXX[&bookingTotal=N]
//
// Look up a code by its alphanumeric value OR its barcode_value. Returns
// just enough info for the BookingReview / partner panel to decide whether
// to apply it — no PII, no other-user state.
//
// Auth-optional: customer can validate their own code pre-checkout; partner
// can validate any code (the partner panel sends an x-partner-token header
// so we can verify they own the hotel before fulfilling, but the validate
// step itself is harmless — only reveals existence + status + amount).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { normalizeCodeInput, applyCodeToBooking } from "@/lib/redemption";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("code") || "";
  const code = normalizeCodeInput(raw);
  if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });

  // Match either column — accept both human-typed code or 12-digit barcode value
  const isNumeric = /^\d+$/.test(code);
  const filter = isNumeric
    ? `barcode_value=eq.${encodeURIComponent(code)}`
    : `code=eq.${encodeURIComponent(code)}`;
  const rows = await fetch(`${SB_URL}/rest/v1/redemption_codes?${filter}&select=*`, { headers: SB_READ })
    .then((r) => r.json()).catch(() => []);
  const c: any = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!c) return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });

  // Auto-expire if past expiry (same lazy housekeeping as /codes route)
  if (c.status === "active" && new Date(c.expires_at).getTime() < Date.now()) {
    c.status = "expired";
  }

  const bookingTotal = Number(req.nextUrl.searchParams.get("bookingTotal") || 0);
  const willApply = bookingTotal > 0
    ? applyCodeToBooking({ kind: c.kind, value_inr: c.value_inr, status: c.status, expires_at: c.expires_at }, { bookingTotalInr: bookingTotal })
    : null;

  return NextResponse.json({
    ok: c.status === "active",
    code: {
      id: c.id,
      code: c.code,
      barcode_value: c.barcode_value,
      kind: c.kind,
      title: c.title,
      value_inr: Number(c.value_inr || 0),
      status: c.status,
      issued_at: c.issued_at,
      expires_at: c.expires_at,
      used_at: c.used_at,
    },
    willApply,
  });
}
