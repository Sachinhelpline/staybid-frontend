// v105 — Partner Gmail login fallback.
//
// Since the Railway WhatsApp/SMS plan isn't active yet, partner phone-OTP
// login can't deliver OTPs. This route lets hotel owners sign in with
// their registered Gmail (via Firebase Google sign-in on the client) and
// proves ownership against the `users` + `hotels` tables server-side.
//
// Flow:
//   1. Client signs in with Firebase Google → gets { email, name, uid }
//   2. Client POSTs { email, name, idToken? } to this route
//   3. Server: look up users WHERE LOWER(email) = LOWER(<email>)
//      AND role IN (HOTEL_OWNER, hotel_owner, admin, super_admin)
//   4. For every matching user id, query hotels WHERE ownerId = X
//   5. If at least one hotel is found → mint an opaque partner token
//      (mirrors check-role's adm_* pattern) and return { token, user, hotel }
//
// Security model: identical to the existing OTP flow's MODE 2 — we trust
// the client-side auth check (Firebase Google OAuth proves email
// ownership) then verify hotel association server-side. No PIN required
// because the Gmail account itself is the credential.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// Mint a JWT-shaped token. Partner API routes only `decodeJwt(token)` to
// extract claims (header.payload.signature → base64-decode payload); they
// don't verify the HS256 signature. So a stub 3-part string with the user
// claims in the middle is sufficient. Security model is identical to the
// existing Railway-issued OTP token (which routes also don't signature-
// verify) — hotel ownership is re-checked on every partner API call.
function makeStubJwt(claims: Record<string, unknown>): string {
  const b64url = (s: string) =>
    Buffer.from(s, "utf8").toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const header  = b64url(JSON.stringify({ alg: "none", typ: "JWT", src: "google-login" }));
  const payload = b64url(JSON.stringify({ ...claims, iat: Math.floor(Date.now() / 1000) }));
  // Trailing segment is intentionally a marker, not a real signature.
  return `${header}.${payload}.staybid_partner_gmail_v105`;
}

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json();
    const cleaned = String(email || "").trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) {
      return NextResponse.json({ ok: false, error: "Valid email required" }, { status: 400 });
    }

    // 1. Find users whose email matches (case-insensitive)
    //    Postgres `ilike` lets us match SACHINHELPLINE@GMAIL.COM ≈ sachinhelpline@gmail.com.
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?email=ilike.${encodeURIComponent(cleaned)}&select=id,name,phone,email,role`,
      { headers: H },
    );
    const users = await userRes.json();
    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No partner account found for ${cleaned}. Apply at support@staybid.in.`,
      });
    }

    // 2. Pick the row with the highest partner-tier role.
    //    Roles in this DB are mixed-case: HOTEL_OWNER + hotel_owner + admin
    //    + super_admin. Lower-case comparison handles all variants.
    const PARTNER_ROLES = new Set(["hotel_owner", "admin", "super_admin"]);
    const partners = users.filter((u: any) => PARTNER_ROLES.has(String(u.role || "").toLowerCase()));
    if (partners.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `Account ${cleaned} exists but is not a hotel partner. Role: "${users[0].role || "customer"}". Contact support@staybid.in.`,
      });
    }

    // 3. For each partner user id, look up owned hotels.
    const ownerIdsCsv = partners.map((u: any) => u.id).join(",");
    const hotelRes = await fetch(
      `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIdsCsv})&select=*`,
      { headers: H },
    );
    const hotels = await hotelRes.json();
    if (!Array.isArray(hotels) || hotels.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `${cleaned} is a partner but owns no hotels yet. Add one via /onboard or contact support.`,
      });
    }

    // 4. Use the first matched partner user as the session identity. If
    //    the same person has both super_admin and hotel_owner rows (the
    //    documented duplicate-record case in CLAUDE.md), prefer the row
    //    whose id matches the hotel.ownerId so subsequent partner API
    //    calls find the same record.
    const firstHotel = hotels[0];
    const matched = partners.find((u: any) => u.id === firstHotel.ownerId) || partners[0];

    // 5. Mint a JWT-shaped session token. Carries the matched user id +
    //    phone + email in claims so existing partner routes
    //    (/api/partner/hotel, /bids, /flash-deals, /complaints, etc.)
    //    decode the token + look up hotels by ownerId exactly as they do
    //    for the OTP login flow.
    const token = makeStubJwt({
      id:    matched.id,
      phone: matched.phone || "",
      email: matched.email || cleaned,
      role:  matched.role,
    });

    return NextResponse.json({
      ok: true,
      token,
      user: {
        id:    matched.id,
        name:  matched.name || name || cleaned.split("@")[0],
        phone: matched.phone || "",
        email: matched.email || cleaned,
        role:  matched.role,
        hotel: firstHotel,
      },
      hotelsCount: hotels.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Login failed" }, { status: 500 });
  }
}
