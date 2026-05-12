// Admin: CRUD for commission_rules.
//
// GET /api/admin/commission-rules
//   → { global: <rule>, overrides: [<rule>...], creators: [{id, handle, status}] }
//     (creators side-load includes ONLY active influencers so the override
//     dropdown lists them.)
//
// PATCH /api/admin/commission-rules
//   Body: { scope: 'global', slabs, loyaltyBonuses?, note?, updatedBy? }
//   → upserts the single active global rule.
//
// POST /api/admin/commission-rules
//   Body: { scope: 'creator', creatorId, slabs, loyaltyBonuses?, note?, updatedBy? }
//   → upserts (or activates) the creator's override row.
//
// DELETE /api/admin/commission-rules?creatorId=<id>
//   → deactivates the creator's override (sets active=false). Subsequent
//     bookings fall back to the global default.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { DEFAULT_RULE, validateRule, type CommissionRule } from "@/lib/commission";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ, cache: "no-store" });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}

function shapeRow(row: any): CommissionRule | null {
  if (!row) return null;
  return {
    id: row.id, scope: row.scope, creator_id: row.creator_id,
    slabs: row.slabs || [], loyaltyBonuses: row.loyalty_bonuses || [],
    note: row.note, updatedAt: row.updated_at,
  };
}

export async function GET(_req: NextRequest) {
  try {
    const [globalRows, overrideRows, creators] = await Promise.all([
      sbGet(`commission_rules?scope=eq.global&active=eq.true&select=*&order=updated_at.desc&limit=1`),
      sbGet(`commission_rules?scope=eq.creator&active=eq.true&select=*&order=updated_at.desc&limit=200`),
      sbGet(`influencers?status=eq.active&select=id,user_id,display_name,status&order=created_at.desc&limit=500`),
    ]) as any[][];

    const g = shapeRow(globalRows[0]);
    const overrides = overrideRows.map(shapeRow).filter(Boolean) as CommissionRule[];

    // Side-load handles via users.name lookup so the admin UI can render
    // "Hotel Owner Sachin" or "@riya_traveller" instead of opaque IDs.
    const userIds = creators.map(c => c.user_id).filter(Boolean);
    let users: any[] = [];
    if (userIds.length) {
      users = await sbGet(`users?id=in.(${userIds.map(encodeURIComponent).join(",")})&select=id,name,phone`) as any[];
    }
    const userById = Object.fromEntries((users as any[]).map(u => [u.id, u]));

    const creatorList = creators.map(c => ({
      id: c.id,
      userId: c.user_id,
      displayName: c.display_name || userById[c.user_id]?.name || "Creator",
      phone: userById[c.user_id]?.phone || null,
    }));

    return NextResponse.json({
      global: g || { ...DEFAULT_RULE, id: null, note: "Platform default (no row yet — apply v95 migration to persist)" },
      overrides,
      creators: creatorList,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.scope !== "global") {
      return NextResponse.json({ error: "PATCH only supports scope='global'. Use POST for creator overrides." }, { status: 400 });
    }
    const err = validateRule(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const patch = {
      scope: "global",
      slabs: body.slabs,
      loyalty_bonuses: body.loyaltyBonuses || [],
      note: body.note || null,
      updated_at: new Date().toISOString(),
      updated_by: body.updatedBy || "admin",
      active: true,
    };

    // Upsert via REST: try PATCH first; if no row, POST a new one.
    const existing = await sbGet(`commission_rules?scope=eq.global&active=eq.true&select=id&limit=1`);
    if (Array.isArray(existing) && existing[0]?.id) {
      const r = await fetch(`${SB_URL}/rest/v1/commission_rules?id=eq.${existing[0].id}`, {
        method: "PATCH", headers: SB_H, body: JSON.stringify(patch),
      });
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: 500 });
    } else {
      const r = await fetch(`${SB_URL}/rest/v1/commission_rules`, {
        method: "POST", headers: SB_H, body: JSON.stringify(patch),
      });
      if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: 500 });
    }
    return NextResponse.json({ updated: true, scope: "global" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.scope !== "creator" || !body.creatorId) {
      return NextResponse.json({ error: "POST requires scope='creator' + creatorId." }, { status: 400 });
    }
    const err = validateRule(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    // Deactivate any older active override for this creator (the unique
    // partial index would reject a second active row otherwise).
    await fetch(
      `${SB_URL}/rest/v1/commission_rules?scope=eq.creator&creator_id=eq.${encodeURIComponent(body.creatorId)}&active=eq.true`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }) }
    ).catch(() => {});

    const row = {
      scope: "creator",
      creator_id: body.creatorId,
      slabs: body.slabs,
      loyalty_bonuses: body.loyaltyBonuses || [],
      note: body.note || null,
      active: true,
      updated_at: new Date().toISOString(),
      updated_by: body.updatedBy || "admin",
    };
    const r = await fetch(`${SB_URL}/rest/v1/commission_rules`, {
      method: "POST", headers: SB_H, body: JSON.stringify(row),
    });
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: 500 });
    return NextResponse.json({ updated: true, scope: "creator", creatorId: body.creatorId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const creatorId = new URL(req.url).searchParams.get("creatorId");
    if (!creatorId) return NextResponse.json({ error: "creatorId required" }, { status: 400 });
    const r = await fetch(
      `${SB_URL}/rest/v1/commission_rules?scope=eq.creator&creator_id=eq.${encodeURIComponent(creatorId)}&active=eq.true`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }) }
    );
    if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: 500 });
    return NextResponse.json({ deactivated: true, creatorId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 });
  }
}
