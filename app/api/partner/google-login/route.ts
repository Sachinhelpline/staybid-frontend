// Partner Gmail sign-in — SEC-00B hardened (server-verified identity, fail closed).
//
// ⚠ PRIOR HOLE (removed): this route used to accept a CLAIMED { email, name }
// from the client and mint an UNSIGNED alg:none stub "partner token" from it —
// i.e. it trusted a client-supplied email and never established a server-verified
// Google/Firebase identity. Anyone could POST any email and, if it matched a
// hotel owner, receive a partner session.
//
// NOW: a partner session may be established ONLY from a Firebase `idToken` that
// the CANONICAL Railway auth path (/api/auth/social-login) verifies SERVER-SIDE
// (signature/expiry/issuer/audience). Identity comes ONLY from that verified
// exchange; the client-claimed email/name is never trusted, and no unsigned stub
// is ever minted. Any missing idToken / failed or unavailable verification FAILS
// CLOSED.
//
// HONEST BOUNDARY (owner follow-up): the canonical exchange requires the backend
// social-login to accept + verify a Firebase idToken (Railway env
// FIREBASE_PROJECT_ID + JWT_ACCESS_SECRET). Until that backend is deployed, the
// exchange fails closed and partner Google sign-in is unavailable — the intended
// safe state, per the SEC-00B fail-closed posture. This route never falls back to
// the old claimed-email stub.
//
// Also note: the partner session this returns is a DASHBOARD-admission credential
// only. It is NOT sufficient to create verified-stay evidence — that requires the
// separate protected verified_partner_hotel_scope binding (see the hardened
// /api/partner/checkin|checkout routes). The hotel-ownership lookup below is
// DISPLAY-level admission (using the VERIFIED identity), never the evidence
// authority.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = "https://staybid-live-production.up.railway.app";
const H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const PARTNER_ROLES = new Set(["hotel_owner", "admin", "super_admin"]);

export async function POST(req: NextRequest) {
  // 1. Require a Firebase idToken. A claimed email/name is NEVER trusted.
  let idToken = "";
  try {
    const body = await req.json();
    idToken = typeof body?.idToken === "string" ? body.idToken.trim() : "";
  } catch {
    /* fall through → fail closed */
  }
  if (!idToken) {
    return NextResponse.json(
      { ok: false, error: "Google sign-in requires a verified credential. Please try again." },
      { status: 401 }
    );
  }

  // 2. Canonical SERVER-SIDE verification: exchange the idToken through Railway
  //    /api/auth/social-login, which verifies the Google/Firebase credential and
  //    mints a real signed (HS256) access token bound to the verified identity.
  let token = "";
  let verified: any = null;
  try {
    const r = await fetch(`${BACKEND}/api/auth/social-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) {
      // Verification failed or the verifying backend is not yet available.
      return NextResponse.json(
        { ok: false, error: "Could not verify your Google sign-in. Please try again later." },
        { status: 401 }
      );
    }
    token = String(d.token || d.accessToken || "");
    verified = d.user || null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Sign-in service is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }

  // The exchange MUST return a real signed token + a verified identity.
  const verifiedEmail =
    verified && typeof verified.email === "string" ? verified.email.trim().toLowerCase() : "";
  const verifiedId = verified && verified.id ? String(verified.id) : "";
  if (!token || (!verifiedId && !verifiedEmail)) {
    return NextResponse.json(
      { ok: false, error: "Could not verify your Google sign-in. Please try again." },
      { status: 401 }
    );
  }

  // 3. DASHBOARD-admission check (display-level, NOT the evidence authority):
  //    does this VERIFIED identity own a hotel? Uses the verified email/id from
  //    the exchange — never a client-claimed email. The verified-stay evidence
  //    writer does NOT trust this read.
  try {
    // Look up users by the VERIFIED email (case-insensitive), then owned hotels.
    let partnerUserIds: string[] = [];
    let matchedUser: any = null;
    if (verifiedEmail) {
      const userRes = await fetch(
        `${SB_URL}/rest/v1/users?email=ilike.${encodeURIComponent(verifiedEmail)}&select=id,name,phone,email,role`,
        { headers: H }
      );
      const users = await userRes.json().catch(() => []);
      const partners = Array.isArray(users)
        ? users.filter((u: any) => PARTNER_ROLES.has(String(u.role || "").toLowerCase()))
        : [];
      partnerUserIds = partners.map((u: any) => String(u.id));
      matchedUser = partners[0] || null;
    }
    // Also allow the verified canonical id directly (owner rows keyed by it).
    if (verifiedId && !partnerUserIds.includes(verifiedId)) partnerUserIds.push(verifiedId);

    if (!partnerUserIds.length) {
      return NextResponse.json({
        ok: false,
        error: `No partner account found for ${verifiedEmail || "this Google account"}. Apply at support@staybid.in.`,
      });
    }

    const hotelRes = await fetch(
      `${SB_URL}/rest/v1/hotels?ownerId=in.(${partnerUserIds.map(encodeURIComponent).join(",")})&select=*`,
      { headers: H }
    );
    const hotels = await hotelRes.json().catch(() => []);
    if (!Array.isArray(hotels) || hotels.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `${verifiedEmail || "This account"} is verified but owns no hotels yet. Add one via /onboard or contact support.`,
      });
    }

    const firstHotel = hotels[0];
    const owner = matchedUser || {};

    // 4. Return the REAL signed token from the verified exchange + the verified
    //    identity. No stub is ever minted.
    return NextResponse.json({
      ok: true,
      token,
      user: {
        id: verifiedId || String(owner.id || ""),
        name: owner.name || verified.name || (verifiedEmail ? verifiedEmail.split("@")[0] : ""),
        phone: owner.phone || verified.phone || "",
        email: verifiedEmail || owner.email || "",
        role: owner.role || "hotel_owner",
        hotel: firstHotel,
      },
      hotelsCount: hotels.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed" },
      { status: 500 }
    );
  }
}
