// v170 — Guest Billing / Folio CRUD (partner panel, Phase 2).
//
//   GET    ?hotelId=...   → { folios, charges }   (everything for the hotel)
//   POST                  → create a folio
//   PATCH                 → update a folio (tax %, discount, status, guest)
//   DELETE ?id=...        → delete a folio + its charges
//
// Charges line-items live in ./charges. Degrades gracefully until the
// migration (migrations/2026-05-21-guest-folios.sql) is applied.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

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

const tableMissing = (txt: string, status: number) =>
  status === 404 || /does not exist/i.test(txt);

export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });

  try {
    const [fRes, cRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/guest_folios?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.desc`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/folio_charges?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.asc`, { headers: SB_H }),
    ]);
    if (!fRes.ok) return NextResponse.json({ folios: [], charges: [], provisioned: false });
    const folios  = await fRes.json().catch(() => []);
    const charges = cRes.ok ? await cRes.json().catch(() => []) : [];
    return NextResponse.json({
      folios: Array.isArray(folios) ? folios : [],
      charges: Array.isArray(charges) ? charges : [],
      provisioned: true,
    });
  } catch {
    return NextResponse.json({ folios: [], charges: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.hotelId || !owned.ids.includes(body.hotelId))
    return NextResponse.json({ error: "Hotel not yours" }, { status: 403 });
  if (!String(body.guestName || "").trim())
    return NextResponse.json({ error: "Guest name required" }, { status: 400 });

  const row: any = {
    id: genId("fol"),
    hotel_id: body.hotelId,
    guest_name: String(body.guestName).trim(),
    guest_phone: body.guestPhone || null,
    guest_email: body.guestEmail || null,
    ref_type: body.refType || "manual",
    ref_id: body.refId || null,
    check_in: body.checkIn || null,
    check_out: body.checkOut || null,
    room_label: body.roomLabel || null,
    status: "open",
    tax_pct: body.taxPct != null ? Number(body.taxPct) : 12,
    discount: body.discount != null ? Number(body.discount) : 0,
    gst_mode: body.gstMode === "inclusive" ? "inclusive" : "exclusive",
    note: body.note || null,
    created_by: owned.userId,
  };
  try {
    const doInsert = (r: any) =>
      fetch(`${SB_URL}/rest/v1/guest_folios`, { method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(r) });
    let r = await doInsert(row);
    let txt = await r.text();
    // gst_mode column not migrated yet — retry without it (graceful).
    if (!r.ok && /gst_mode/i.test(txt)) {
      const { gst_mode, ...slim } = row;
      r = await doInsert(slim);
      txt = await r.text();
    }
    if (!r.ok) {
      if (tableMissing(txt, r.status))
        return NextResponse.json({ error: "Billing tables not provisioned yet. Apply migrations/2026-05-21-guest-folios.sql." }, { status: 412 });
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    const folio = Array.isArray(j) ? j[0] : j;

    // v171 — online-booking folios seed a locked room charge from the booking.
    if (folio?.id && body.roomCharge && body.roomCharge.label) {
      const rc = body.roomCharge;
      const qty = Number(rc.qty) || 1;
      const unitPrice = Number(rc.unitPrice) || 0;
      try {
        await fetch(`${SB_URL}/rest/v1/folio_charges`, {
          method: "POST", headers: SB_H_REPRESENT,
          body: JSON.stringify({
            id: genId("chg"), folio_id: folio.id, hotel_id: body.hotelId,
            kind: "room", label: String(rc.label), qty, unit_price: unitPrice,
            amount: qty * unitPrice, created_by: owned.userId,
          }),
        });
      } catch { /* best-effort — folio still created */ }
    }
    return NextResponse.json({ ok: true, folio });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Create failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`guest_folios?id=eq.${encodeURIComponent(body.id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Folio not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your folio" }, { status: 403 });

  const patch: any = {};
  if (body.guestName  !== undefined) patch.guest_name  = String(body.guestName || "");
  if (body.guestPhone !== undefined) patch.guest_phone = body.guestPhone || null;
  if (body.guestEmail !== undefined) patch.guest_email = body.guestEmail || null;
  if (body.roomLabel  !== undefined) patch.room_label  = body.roomLabel || null;
  if (body.checkIn    !== undefined) patch.check_in    = body.checkIn || null;
  if (body.checkOut   !== undefined) patch.check_out   = body.checkOut || null;
  if (body.note       !== undefined) patch.note        = body.note || null;
  if (body.taxPct     !== undefined) patch.tax_pct     = Number(body.taxPct) || 0;
  if (body.discount   !== undefined) patch.discount    = Number(body.discount) || 0;
  if (body.gstMode === "inclusive" || body.gstMode === "exclusive") patch.gst_mode = body.gstMode;
  if (body.status === "open" || body.status === "settled") {
    patch.status = body.status;
    patch.settled_at = body.status === "settled" ? new Date().toISOString() : null;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const doPatch = (p: any) =>
      fetch(`${SB_URL}/rest/v1/guest_folios?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(p),
      });
    let r = await doPatch(patch);
    // gst_mode column not migrated yet — retry without it (graceful).
    if (!r.ok && patch.gst_mode !== undefined) {
      const txt = await r.text();
      if (/gst_mode/i.test(txt)) {
        const { gst_mode, ...slim } = patch;
        if (Object.keys(slim).length) r = await doPatch(slim);
      } else throw new Error(txt);
    }
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, folio: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`guest_folios?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Folio not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your folio" }, { status: 403 });

  try {
    await fetch(`${SB_URL}/rest/v1/folio_charges?folio_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    const r = await fetch(`${SB_URL}/rest/v1/guest_folios?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
