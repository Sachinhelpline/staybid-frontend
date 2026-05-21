// v170 — Folio line-item charges (partner panel, Phase 2).
//
//   POST              → add a charge to a folio
//   DELETE ?id=...    → remove a charge
//
// kind ∈ room | food | laundry | service | misc | payment
//   • non-payment kinds add to the bill subtotal
//   • payment rows record money received
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

const VALID_KIND = new Set(["room", "food", "laundry", "service", "misc", "payment"]);

async function ownedHotelIds(req: NextRequest): Promise<{ ids: string[]; userId: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [], userId: payload.id };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id), userId: payload.id };
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, folioId } = body;
  if (!hotelId || !folioId) return NextResponse.json({ error: "hotelId, folioId required" }, { status: 400 });
  if (!owned.ids.includes(hotelId)) return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!String(body.label || "").trim()) return NextResponse.json({ error: "Label required" }, { status: 400 });

  const kind = VALID_KIND.has(String(body.kind)) ? String(body.kind) : "misc";
  const qty = Number(body.qty) || 1;
  const unitPrice = Number(body.unitPrice) || 0;
  const amount = body.amount != null ? Number(body.amount) : qty * unitPrice;

  const row = {
    id: genId("chg"),
    folio_id: folioId,
    hotel_id: hotelId,
    kind,
    label: String(body.label).trim(),
    qty,
    unit_price: unitPrice,
    amount,
    created_by: owned.userId,
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/folio_charges`, {
      method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json({ error: "Billing tables not provisioned yet." }, { status: 412 });
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    return NextResponse.json({ ok: true, charge: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Add charge failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`folio_charges?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your charge" }, { status: 403 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/folio_charges?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE", headers: SB_H,
    });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
