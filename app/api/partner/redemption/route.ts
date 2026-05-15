// Partner-side redemption endpoints — single route, two actions.
//
// GET /api/partner/redemption?code=XXX
//   Validate a code as a partner (only amenity-kind codes can be fulfilled
//   at a hotel; coupon/wallet are checkout-side). Includes the customer
//   user_id so the partner UI can show the customer's name if they want.
//
// POST /api/partner/redemption
//   Body: { code, hotelId, partnerId? }
//   Marks an amenity code as used (used_at + used_by_hotel_id + used_by_partner_id).
//   Confirms the partner owns the hotel via x-partner-token (same JWT shape
//   the rest of /api/partner/* uses).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, decodeJwt } from "@/lib/sb";
import { normalizeCodeInput } from "@/lib/redemption";

export const dynamic = "force-dynamic";

function partnerFromReq(req: NextRequest): { id: string; phone?: string; email?: string } | null {
  const token = req.headers.get("x-partner-token") || "";
  if (!token) return null;
  const p = decodeJwt(token);
  return p?.id ? p : null;
}

async function resolvePartnerHotels(partnerId: string, partnerPhone?: string): Promise<string[]> {
  // Cross-pool resolver: same phone may have two user records (with/without +91).
  // We grab all user ids with that phone, then list hotels for any of them.
  const ids = new Set<string>([partnerId]);
  if (partnerPhone) {
    const variants = [partnerPhone, partnerPhone.replace(/^\+91/, ""), `+91${partnerPhone.replace(/^\+91/, "")}`];
    const usersRes = await fetch(
      `${SB_URL}/rest/v1/users?phone=in.(${variants.map(encodeURIComponent).join(",")})&select=id`,
      { headers: SB_READ },
    ).then((r) => r.json()).catch(() => []);
    if (Array.isArray(usersRes)) for (const u of usersRes) if (u?.id) ids.add(u.id);
  }
  const ownerIds = Array.from(ids);
  const hotelsRes = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id`,
    { headers: SB_READ },
  ).then((r) => r.json()).catch(() => []);
  return Array.isArray(hotelsRes) ? hotelsRes.map((h: any) => h.id).filter(Boolean) : [];
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("code") || "";
  const code = normalizeCodeInput(raw);
  if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });

  const partner = partnerFromReq(req);
  if (!partner) return NextResponse.json({ error: "Partner auth required" }, { status: 401 });

  const isNumeric = /^\d+$/.test(code);
  const filter = isNumeric
    ? `barcode_value=eq.${encodeURIComponent(code)}`
    : `code=eq.${encodeURIComponent(code)}`;
  const rows = await fetch(`${SB_URL}/rest/v1/redemption_codes?${filter}&select=*`, { headers: SB_READ })
    .then((r) => r.json()).catch(() => []);
  const c: any = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!c) return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });

  // Auto-expire stale
  if (c.status === "active" && new Date(c.expires_at).getTime() < Date.now()) {
    c.status = "expired";
  }

  // Side-load customer name for partner display
  const userRes = await fetch(
    `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(c.user_id)}&select=id,name,phone`,
    { headers: SB_READ },
  ).then((r) => r.json()).catch(() => []);
  const customer = Array.isArray(userRes) && userRes[0] ? userRes[0] : null;

  return NextResponse.json({
    ok: c.status === "active",
    code: c,
    customer: customer ? { id: customer.id, name: customer.name || "Guest", phone: customer.phone || null } : null,
    canFulfill: c.kind === "amenity" && c.status === "active",
  });
}

export async function POST(req: NextRequest) {
  const partner = partnerFromReq(req);
  if (!partner) return NextResponse.json({ error: "Partner auth required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const codeRaw: string | undefined = body?.code;
  const hotelId: string | undefined = body?.hotelId;
  if (!codeRaw) return NextResponse.json({ error: "code required" }, { status: 400 });
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  // Verify partner owns this hotel
  const ownedHotels = await resolvePartnerHotels(partner.id, partner.phone);
  if (!ownedHotels.includes(hotelId)) {
    return NextResponse.json({ error: "You don't own this hotel" }, { status: 403 });
  }

  const code = normalizeCodeInput(codeRaw);
  const isNumeric = /^\d+$/.test(code);
  const filter = isNumeric
    ? `barcode_value=eq.${encodeURIComponent(code)}`
    : `code=eq.${encodeURIComponent(code)}`;
  const rows = await fetch(`${SB_URL}/rest/v1/redemption_codes?${filter}&select=*`, { headers: SB_READ })
    .then((r) => r.json()).catch(() => []);
  const c: any = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!c) return NextResponse.json({ error: "Code not found" }, { status: 404 });
  if (c.status !== "active") return NextResponse.json({ error: `Code is ${c.status}` }, { status: 400 });
  if (c.kind !== "amenity") return NextResponse.json({ error: "Only amenity codes are fulfilled at the hotel" }, { status: 400 });
  if (new Date(c.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Code expired" }, { status: 400 });
  }

  const upd = await fetch(`${SB_URL}/rest/v1/redemption_codes?id=eq.${encodeURIComponent(c.id)}`, {
    method: "PATCH",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify({
      status: "used",
      used_at: new Date().toISOString(),
      used_by_hotel_id: hotelId,
      used_by_partner_id: partner.id,
    }),
  });
  if (!upd.ok) {
    const txt = await upd.text().catch(() => "");
    return NextResponse.json({ error: "Failed to mark fulfilled", details: txt }, { status: 500 });
  }
  const updated = await upd.json().catch(() => null);
  return NextResponse.json({ ok: true, code: Array.isArray(updated) ? updated[0] : updated });
}
