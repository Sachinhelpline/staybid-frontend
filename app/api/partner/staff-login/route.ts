// v170 — Staff login (partner panel, Phase 3).
//
// A staff member signs in with the login code + PIN their hotel owner
// created. On success we mint a hotel-scoped session token (carrying the
// owner's user id, so the existing /api/partner/* routes resolve the
// right hotel) tagged with the staff role. Role-based tab visibility is
// enforced in the dashboard.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, sbSelect } from "@/lib/sb-server";
import { pinHash } from "../staff/route";

export const dynamic = "force-dynamic";

const b64url = (o: any) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const loginCode = String(body.loginCode || "").trim().toUpperCase();
  const pin = String(body.pin || "").trim();
  if (!loginCode || !pin)
    return NextResponse.json({ error: "Login code aur PIN dono daalo" }, { status: 400 });

  let staffRows: any[] = [];
  try {
    staffRows = await sbSelect(`hotel_staff?login_code=eq.${encodeURIComponent(loginCode)}&select=*`);
  } catch {
    return NextResponse.json({ error: "Staff login abhi available nahi (table setup pending)" }, { status: 412 });
  }
  const staff = staffRows?.[0];
  if (!staff) return NextResponse.json({ error: "Galat login code" }, { status: 401 });
  if (staff.active === false) return NextResponse.json({ error: "Yeh staff account band hai" }, { status: 403 });
  if (staff.pin_hash !== pinHash(pin, staff.id))
    return NextResponse.json({ error: "Galat PIN" }, { status: 401 });

  const hotels = await sbSelect(`hotels?id=eq.${encodeURIComponent(staff.hotel_id)}&select=id,name,ownerId`).catch(() => []);
  const hotel = hotels?.[0];
  if (!hotel) return NextResponse.json({ error: "Hotel nahi mila" }, { status: 404 });

  // Mint a session token. The /api/partner/* routes decode (not verify)
  // the payload — id resolves the hotel via the owner-id resolver.
  const now = Math.floor(Date.now() / 1000);
  const token =
    b64url({ alg: "none", typ: "JWT" }) + "." +
    b64url({
      id: hotel.ownerId, sub: hotel.ownerId,
      staff: true, staffId: staff.id, staffRole: staff.role, staffName: staff.name,
      hotelId: hotel.id, iat: now, exp: now + 60 * 60 * 24 * 30,
    }) + ".";

  // best-effort last_login stamp
  try {
    await fetch(`${SB_URL}/rest/v1/hotel_staff?id=eq.${encodeURIComponent(staff.id)}`, {
      method: "PATCH", headers: SB_H, body: JSON.stringify({ last_login_at: new Date().toISOString() }),
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    token,
    user: { name: staff.name, staffRole: staff.role, staffId: staff.id, hotelName: hotel.name },
  });
}
