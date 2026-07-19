// v375 — Save a signed-in user's phone number WITHOUT OTP. Used when phone-OTP
// is disabled (NEXT_PUBLIC_ENABLE_PHONE_OTP != 1) so Google/Firebase users can
// add a reachable number in one quick step before bidding/booking, instead of
// being blocked by the (currently non-functional) OTP round-trip.
//
// Auth: accepts a Firebase RS256 or backend HS256 token (socialUserFromReq).
// No-clobber: only fills the phone when the row's current phone is empty or a
// placeholder (`unknown_…`) — never overwrites a real, previously-verified phone.
import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = socialUserFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const digits = String(body.phone || "").replace(/\D/g, "");
  // Accept a bare 10-digit number or a +91-prefixed one.
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return NextResponse.json({ error: "Enter a valid 10-digit number." }, { status: 400 });
  const phone = `+91${last10}`;

  // No-clobber PATCH on the caller's own row: only when phone is null/empty or a
  // placeholder. A real phone already on file is left untouched (success is fine).
  try {
    await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(auth.id)}&or=(phone.is.null,phone.like.unknown*,phone.eq.)`,
      { method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify({ phone }) },
    );
  } catch { /* best-effort — the client also carries the number into the booking/bid */ }

  return NextResponse.json({ ok: true, phone });
}
