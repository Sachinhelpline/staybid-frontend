// v329 — Circle Phase C3: list / unlist an OWNED inventory block for resale.
//
// POST   /api/circle/inventory/[id]/list   { resalePricePerNight }
//   Owner-verified. Flips an `owned` (or already `listed`, to re-price) block to
//   `listed` at the investor's resale price → it now surfaces on the consumer
//   feed via GET /api/circle/resale. Price is per-night; total = ×nights.
// DELETE /api/circle/inventory/[id]/list
//   Pulls a `listed` block back to `owned` (off the market). The room stays HELD
//   (the pre-buy hold is untouched — the investor still owns those nights).
//
// Auth: partner Bearer JWT → cross-pool owner ids. Guarded PATCH on
// ownership + status so a race can't list someone else's / a sold block.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

async function loadOwnedBlock(blockId: string, ownerIds: string[]): Promise<any | null> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&select=*`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const b = Array.isArray(rows) ? rows[0] : null;
    if (!b || !ownerIds.map(String).includes(String(b.investor_user_id))) return null;
    return b;
  } catch { return null; }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blockId = String(id || "").trim();
  if (!blockId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const resalePerNight = Math.round(Number(body?.resalePricePerNight));
  if (!Number.isFinite(resalePerNight) || resalePerNight <= 0) {
    return NextResponse.json({ error: "A resale price per night (> ₹0) is required." }, { status: 400 });
  }
  if (resalePerNight > 1_000_000) {
    return NextResponse.json({ error: "That resale price looks too high — check the figure." }, { status: 400 });
  }

  const block = await loadOwnedBlock(blockId, ownerIds);
  if (!block) return NextResponse.json({ error: "Forbidden — not your block" }, { status: 403 });
  // Only a block the investor actually owns (money in) can be listed.
  // `listed` is allowed too so they can RE-PRICE without unlisting first.
  if (!["owned", "listed"].includes(String(block.status))) {
    return NextResponse.json(
      { error: `A ${String(block.status).replace(/_/g, " ")} block can't be listed.` },
      { status: 409 },
    );
  }
  // Guard against listing a stay that's already in the past.
  const today = new Date().toISOString().slice(0, 10);
  if (String(block.date_to) <= today) {
    return NextResponse.json({ error: "These nights have already passed." }, { status: 409 });
  }

  const idsCsv = ownerIds.map((x) => encodeURIComponent(x)).join(",");
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
        `&status=in.(owned,listed)&investor_user_id=in.(${idsCsv})`,
      {
        method: "PATCH",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({
          status: "listed",
          resale_price_per_night: resalePerNight,
          listed_at: block.listed_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = res.ok ? await res.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, block: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "List failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blockId = String(id || "").trim();
  if (!blockId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const block = await loadOwnedBlock(blockId, ownerIds);
  if (!block) return NextResponse.json({ error: "Forbidden — not your block" }, { status: 403 });
  if (String(block.status) !== "listed") {
    return NextResponse.json({ error: "Only a listed block can be unlisted." }, { status: 409 });
  }

  const idsCsv = ownerIds.map((x) => encodeURIComponent(x)).join(",");
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
        `&status=eq.listed&investor_user_id=in.(${idsCsv})`,
      {
        method: "PATCH",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({ status: "owned", listed_at: null, updated_at: new Date().toISOString() }),
      },
    );
    const rows = res.ok ? await res.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, block: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unlist failed" }, { status: 500 });
  }
}
