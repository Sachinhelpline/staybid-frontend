import { NextRequest, NextResponse } from "next/server";

// POST /api/kiosk/send-otp  { phone }
// Thin server proxy to the Railway OTP provider. Keeps the kiosk booking flow
// fully server-mediated (the shared kiosk device never talks to Railway or
// stores a token). Mirrors the customer site's send-otp.
const RAILWAY = "https://staybid-live-production.up.railway.app";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body?.phone || "").trim();
  if (!/^(\+?91)?[6-9]\d{9}$/.test(phone.replace(/\s/g, ""))) {
    return NextResponse.json({ error: "Enter a valid 10-digit mobile number" }, { status: 400 });
  }
  try {
    const r = await fetch(`${RAILWAY}/api/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ error: j?.error || "Could not send OTP" }, { status: r.status });
    }
    // Never echo a dev OTP to the shared kiosk screen.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "OTP service unavailable. Try again." }, { status: 502 });
  }
}
