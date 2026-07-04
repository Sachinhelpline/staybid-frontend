import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// StayCircle — property locks (the "🔒 Lock Property" action on Discover).
// GET    → the signed-in user's active locks (with property snapshot)
// POST   → { propertyId } lock a property (idempotent via unique partial index)
// DELETE → ?propertyId= release a lock

export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ locks: [] });
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_locks?user_id=eq.${encodeURIComponent(user.id)}&status=eq.locked&select=*&order=created_at.desc`,
      { headers: SB_H },
    );
    const locks = r.ok ? await r.json() : [];
    return NextResponse.json({ locks });
  } catch {
    return NextResponse.json({ locks: [] });
  }
}

export async function POST(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const propertyId = String(body?.propertyId || "").trim();
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  try {
    // Property must exist + be active.
    const pr = await fetch(
      `${SB_URL}/rest/v1/circle_properties?id=eq.${encodeURIComponent(propertyId)}&status=eq.active&select=id`,
      { headers: SB_H },
    );
    const props = pr.ok ? await pr.json() : [];
    if (!props.length) {
      return NextResponse.json({ error: "Property not available to lock" }, { status: 404 });
    }

    const r = await fetch(`${SB_URL}/rest/v1/circle_locks`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify({ user_id: user.id, property_id: propertyId, status: "locked" }),
    });
    if (!r.ok) {
      // Unique partial index (user, property, locked) — treat conflict as ok.
      if (r.status === 409) return NextResponse.json({ ok: true, alreadyLocked: true });
      const t = await r.text();
      return NextResponse.json({ error: "Lock failed", detail: t.slice(0, 160) }, { status: 502 });
    }
    const rows = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, lock: rows[0] || null, alreadyLocked: !rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const url = new URL(req.url);
  const propertyId = String(url.searchParams.get("propertyId") || "").trim();
  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  try {
    await fetch(
      `${SB_URL}/rest/v1/circle_locks?user_id=eq.${encodeURIComponent(user.id)}&property_id=eq.${encodeURIComponent(propertyId)}&status=eq.locked`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "released" }) },
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
