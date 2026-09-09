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
// AUTHORIZATION (SEC-00B strict): a verified identity ALONE is NOT partner
// authority. After the server-verified exchange, admission requires a fresh,
// NON-client-writable canonical partner authorization — an ACTIVE binding in the
// protected verified_partner_hotel_scope table for this EXACT verified subject.
// The client-writable hotels.ownerId / hotel_room_units.owner_user_id / mutable
// users.role mappings NEVER establish authority, and there is NO role:"hotel_owner"
// fallback. A normal signed CUSTOMER identity with no active binding is REJECTED.
// If the protected authority is unconfigured (missing migration/table/service-role)
// admission FAILS CLOSED. The bound hotels are loaded (by the binding's hotel ids)
// only AFTER authorization, for DISPLAY. The returned token is the REAL signed
// Railway token; the same protected binding independently gates the evidence
// writer (/api/partner/checkin|checkout), so this token cannot create evidence
// for any hotel it is not actively bound to.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import {
  partnerScopeConfigured,
  readActivePartnerScopeRows,
} from "@/lib/auth/verified-partner-hotel-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = "https://staybid-live-production.up.railway.app";
const H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

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

  // The exchange MUST return a real signed token + a verified canonical SUBJECT.
  // The protected partner binding keys on the canonical subject id, so an
  // exchange without one cannot be authorized (fail closed).
  const verifiedEmail =
    verified && typeof verified.email === "string" ? verified.email.trim().toLowerCase() : "";
  const verifiedId = verified && verified.id ? String(verified.id) : "";
  if (!token || !verifiedId) {
    return NextResponse.json(
      { ok: false, error: "Could not verify your Google sign-in. Please try again." },
      { status: 401 }
    );
  }

  // 3. AUTHORIZATION (NOT identity). A verified identity ALONE is not partner
  //    authority. The caller must hold a fresh, NON-client-writable canonical
  //    partner authorization: an ACTIVE binding in the protected
  //    verified_partner_hotel_scope table for this EXACT verified subject. The
  //    client-writable hotels.ownerId / hotel_room_units.owner_user_id / mutable
  //    users.role mappings are NEVER consulted to ESTABLISH authority, and there
  //    is NO role:"hotel_owner" fallback. Fails closed if the protected authority
  //    is unconfigured (missing migration/table/service-role key).
  if (!partnerScopeConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Partner sign-in is not available yet. Please contact support@staybid.in." },
      { status: 503 }
    );
  }
  let scopeRows: Array<{ hotel_id: string; role: string }> = [];
  try {
    scopeRows = await readActivePartnerScopeRows(verifiedId);
  } catch {
    scopeRows = [];
  }
  if (!scopeRows.length) {
    // Verified Google identity, but NOT an authorized partner. Fail closed.
    return NextResponse.json({
      ok: false,
      error: `${verifiedEmail || "This Google account"} is verified but is not authorized as a StayBid partner. Contact support@staybid.in.`,
    });
  }

  // 4. DISPLAY-ONLY: load the bound hotels (by the protected binding's hotel ids)
  //    to show the dashboard. This runs AFTER authorization and never establishes
  //    it — a forged public ownership row cannot add a hotel here because the ids
  //    come from the protected binding, and the role comes from the binding, not
  //    a hardcoded "hotel_owner".
  try {
    const boundHotelIds = Array.from(new Set(scopeRows.map((r) => r.hotel_id).filter(Boolean)));
    const bindingRole = scopeRows[0]?.role || "hotel_partner";
    const hotelRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${boundHotelIds.map(encodeURIComponent).join(",")})&select=*`,
      { headers: H }
    );
    const hotels = await hotelRes.json().catch(() => []);
    const firstHotel = Array.isArray(hotels) && hotels.length ? hotels[0] : null;

    // 5. Return the REAL signed token from the verified exchange + the verified
    //    identity + the binding-derived (non-authoritative) display role. No stub.
    return NextResponse.json({
      ok: true,
      token,
      user: {
        id: verifiedId,
        name: verified.name || (verifiedEmail ? verifiedEmail.split("@")[0] : ""),
        phone: verified.phone || "",
        email: verifiedEmail || "",
        role: bindingRole,
        hotel: firstHotel,
      },
      hotelsCount: boundHotelIds.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed" },
      { status: 500 }
    );
  }
}
