// POST /api/verify/location/verify-otp
// Community Contributor flow — step 2.
// Body: { verificationId, otp }
//
// Validates the OTP against the stored hash. On success, transitions the
// row to status='VERIFIED' and bumps otp_attempts. After 5 failed attempts
// the row goes to 'FAILED' and can no longer be unlocked.
//
// Auth: any signed-in customer (must own the verification row).
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { createHash } from "crypto";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const MAX_OTP_ATTEMPTS = 5;

// Phase 3 feature flag (must match send-otp route). When OFF, no OTP
// would have been issued in the first place, but we still guard the
// verify path so a stale OTP from a previous flag-on window doesn't
// leak through.
const LOCATION_OTP_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LOCATION_OTP === "1";

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

export async function POST(req: Request) {
  if (!LOCATION_OTP_ENABLED) {
    return NextResponse.json(
      {
        error: "Location verification is not yet available",
        code: "LOCATION_OTP_DISABLED",
      },
      { status: 503 }
    );
  }

  const user = socialUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const verificationId = String(body.verificationId || "").trim();
  const otp = String(body.otp || "").trim();
  if (!verificationId || !/^\d{4,8}$/.test(otp)) {
    return NextResponse.json(
      { error: "verificationId + 4-8 digit otp required" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const r = await fetch(
    `${SB_URL}/rest/v1/location_verifications` +
      `?id=eq.${encodeURIComponent(verificationId)}` +
      `&user_id=eq.${encodeURIComponent(user.id)}` +
      `&select=id,status,otp_hash,otp_attempts,expires_at,hotel_id&limit=1`,
    {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }
  );
  if (!r.ok) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  const rows = (await r.json().catch(() => [])) as any[];
  const verification = rows[0];
  if (!verification) {
    return NextResponse.json(
      { error: "Verification not found" },
      { status: 404 }
    );
  }
  if (verification.status === "VERIFIED") {
    return NextResponse.json({
      ok: true,
      verification_id: verification.id,
      hotel_id: verification.hotel_id,
      already_verified: true,
    });
  }
  if (verification.status === "FAILED") {
    return NextResponse.json(
      { error: "This verification was locked after too many failed attempts" },
      { status: 403 }
    );
  }
  if (verification.expires_at && verification.expires_at < now) {
    // Soft-expire the row so cleanup is auditable
    void fetch(
      `${SB_URL}/rest/v1/location_verifications?id=eq.${encodeURIComponent(verificationId)}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status: "EXPIRED" }),
      }
    );
    return NextResponse.json({ error: "OTP expired" }, { status: 410 });
  }

  const matched = verification.otp_hash === hashOtp(otp);
  const newAttempts = (verification.otp_attempts || 0) + 1;

  if (matched) {
    const pr = await fetch(
      `${SB_URL}/rest/v1/location_verifications?id=eq.${encodeURIComponent(verificationId)}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          status: "VERIFIED",
          verified_at: now,
          otp_attempts: newAttempts,
        }),
      }
    );
    if (!pr.ok) {
      return NextResponse.json(
        { error: "Could not finalize verification" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      verification_id: verification.id,
      hotel_id: verification.hotel_id,
    });
  }

  // Wrong OTP — bump attempts; lock at MAX_OTP_ATTEMPTS
  const status = newAttempts >= MAX_OTP_ATTEMPTS ? "FAILED" : "OTP_SENT";
  await fetch(
    `${SB_URL}/rest/v1/location_verifications?id=eq.${encodeURIComponent(verificationId)}`,
    {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ otp_attempts: newAttempts, status }),
    }
  );
  return NextResponse.json(
    {
      error: "Incorrect OTP",
      attempts_left: Math.max(0, MAX_OTP_ATTEMPTS - newAttempts),
      locked: newAttempts >= MAX_OTP_ATTEMPTS,
    },
    { status: 401 }
  );
}
