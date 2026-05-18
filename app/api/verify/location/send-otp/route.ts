// POST /api/verify/location/send-otp
// Community Contributor flow — step 1.
// Body: { hotelId, deviceLat, deviceLng, deviceAccuracyM? }
//
// Validates that the customer's device is within LOCATION_OTP_RADIUS_M (250m)
// of the hotel via haversine. Generates a 6-digit OTP. Persists a row in
// location_verifications with status='OTP_SENT' + SHA-256 hash of the OTP.
//
// SMS dispatch path (Phase 3 — Sachin pastes Railway endpoint):
//   - The Railway endpoint POST /api/auth/send-location-otp is the canonical
//     dispatcher. Once it ships, this route forwards the (phone, otp) there.
//   - Until Railway ships it, this route returns dev_otp in the response body
//     so the frontend Phase 4 build can be tested end-to-end without SMS.
//     dev_otp is gated behind NODE_ENV !== 'production'.
//
// Auth: any signed-in customer.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import {
  haversineMeters,
  LOCATION_OTP_RADIUS_M,
} from "@/lib/tier/haversine";
import { createHash } from "crypto";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const RAILWAY = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

// Phase 3 feature flag. Default OFF — frontend Phase 4 hides the Community
// Contributor card unless this is "1". Flip once Railway OTP dispatcher is
// pasted + an active OTP delivery plan (MSG91 / WhatsApp Business) exists.
// Mirror of v132.12's NEXT_PUBLIC_ENABLE_PHONE_OTP pattern.
const LOCATION_OTP_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LOCATION_OTP === "1";

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  // Hard-gate the entire flow behind the feature flag. Without an active
  // SMS/WhatsApp delivery plan + Railway dispatcher, no OTP will reach the
  // user, so returning 503 here is honest. Frontend reads the error code
  // to render "Coming soon" on the Community Contributor card.
  if (!LOCATION_OTP_ENABLED) {
    return NextResponse.json(
      {
        error: "Location verification is not yet available",
        code: "LOCATION_OTP_DISABLED",
        hint: "Use the booking-based Verified Guest path instead",
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

  const hotelId = String(body.hotelId || "").trim();
  const deviceLat = Number(body.deviceLat);
  const deviceLng = Number(body.deviceLng);
  if (!hotelId) {
    return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  }
  if (!Number.isFinite(deviceLat) || !Number.isFinite(deviceLng)) {
    return NextResponse.json(
      { error: "deviceLat + deviceLng required (numeric)" },
      { status: 400 }
    );
  }

  // Look up hotel coords
  const hr = await fetch(
    `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(hotelId)}&select=id,name,lat,lng`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: "no-store" }
  );
  if (!hr.ok) {
    return NextResponse.json({ error: "Hotel lookup failed" }, { status: 500 });
  }
  const hotels = (await hr.json().catch(() => [])) as any[];
  const hotel = hotels[0];
  if (!hotel) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }
  if (!Number.isFinite(hotel.lat) || !Number.isFinite(hotel.lng)) {
    return NextResponse.json(
      {
        error:
          "This hotel has no registered coordinates yet. Location verification not available.",
      },
      { status: 422 }
    );
  }

  const distance = haversineMeters(deviceLat, deviceLng, hotel.lat, hotel.lng);
  if (distance > LOCATION_OTP_RADIUS_M) {
    return NextResponse.json(
      {
        error: "Too far from hotel",
        distance_m: Math.round(distance),
        max_allowed_m: LOCATION_OTP_RADIUS_M,
      },
      { status: 403 }
    );
  }

  // Generate OTP, persist hashed
  const otp = generateOtp();
  const insertRes = await fetch(
    `${SB_URL}/rest/v1/location_verifications`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        user_id: user.id,
        hotel_id: hotelId,
        device_lat: deviceLat,
        device_lng: deviceLng,
        device_accuracy_m:
          typeof body.deviceAccuracyM === "number" ? body.deviceAccuracyM : null,
        hotel_lat: hotel.lat,
        hotel_lng: hotel.lng,
        distance_m: distance,
        status: "OTP_SENT",
        otp_hash: hashOtp(otp),
      }),
    }
  );
  if (!insertRes.ok) {
    return NextResponse.json(
      { error: "Could not start verification", detail: await insertRes.text() },
      { status: 500 }
    );
  }
  const rows = (await insertRes.json().catch(() => [])) as any[];
  const verification = rows[0];

  // Dispatch SMS via Railway (Phase 3 paste). For now, if the endpoint
  // doesn't exist, swallow the error and return dev_otp in dev mode so
  // the Phase 4 frontend can still be exercised.
  let dispatched = false;
  let dispatchError: string | null = null;
  if (user.phone) {
    try {
      const fwd = await fetch(`${RAILWAY}/api/auth/send-location-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: user.phone,
          otp,
          hotelName: hotel.name,
        }),
      });
      dispatched = fwd.ok;
      if (!fwd.ok) {
        dispatchError = `Railway endpoint not yet live (status ${fwd.status})`;
      }
    } catch (e: any) {
      dispatchError = e?.message || "dispatch failed";
    }
  } else {
    dispatchError = "user has no phone — falling back to dev OTP";
  }

  const payload: Record<string, any> = {
    verification_id: verification?.id,
    distance_m: Math.round(distance),
    expires_at: verification?.expires_at,
    dispatched,
  };
  if (dispatchError) payload.dispatch_error = dispatchError;

  // Dev-mode fallback so Phase 4 UI can be tested before Phase 3 lands.
  if (!dispatched && process.env.NODE_ENV !== "production") {
    payload.dev_otp = otp;
  }

  return NextResponse.json(payload);
}
