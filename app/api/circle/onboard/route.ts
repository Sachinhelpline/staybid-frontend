import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { sbCacheInvalidate } from "@/lib/sb-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/circle/onboard — customer-facing StayCircle property onboarding.
// Mirrors the admin /api/admin/circle property+rooms create, EXCEPT the row is
// saved status='pending' (needs admin approval before it enters the /circle
// feed). Same shared form (components/circle/CircleOnboardForm) drives both.
//
// GET  → the signed-in owner's own submissions.
// POST → { property fields..., roomTypes: [...], owner_contact: { name, phone } }

const PROPERTY_FIELDS = new Set([
  "title", "city", "state", "location_label", "tagline", "description",
  "images", "video_url", "rooms_label", "monthly_rate",
  "roi_min_pct", "roi_max_pct", "occupancy_label", "operation_model",
  "property_type", "star_rating", "amenities", "available_from",
]);

function pick(data: any, allowed: Set<string>): Record<string, any> {
  const out: Record<string, any> = {};
  if (!data || typeof data !== "object") return out;
  Object.keys(data).forEach((k) => { if (allowed.has(k)) out[k] = data[k]; });
  return out;
}

function normalizeRoom(r: any, propertyId: string, idx: number): Record<string, any> {
  return {
    property_id: propertyId,
    name: String(r?.name || "").trim().slice(0, 120),
    monthly_rate: Math.max(0, Number(r?.monthly_rate) || 0),
    total_units: Math.max(1, Math.floor(Number(r?.total_units) || 1)),
    locked_units: 0,
    capacity: Math.max(1, Math.floor(Number(r?.capacity) || 2)),
    bed_type: String(r?.bed_type || "").trim().slice(0, 60),
    view_label: String(r?.view_label || "").trim().slice(0, 60),
    description: String(r?.description || "").trim().slice(0, 400),
    amenities: Array.isArray(r?.amenities) ? r.amenities.map((x: any) => String(x)).slice(0, 40) : [],
    images: Array.isArray(r?.images) ? r.images.map((x: any) => String(x)).slice(0, 20) : [],
    active: true,
    sort_order: (idx + 1) * 10,
  };
}

export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_properties?submitted_by=eq.${encodeURIComponent(user.id)}&select=id,title,city,status,monthly_rate,created_at&order=created_at.desc&limit=50`,
      { headers: SB_H },
    );
    const submissions = r.ok ? await r.json() : [];
    return NextResponse.json({ submissions: Array.isArray(submissions) ? submissions : [] });
  } catch (e: any) {
    return NextResponse.json({ submissions: [], error: String(e?.message || e).slice(0, 160) }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const data = pick(body, PROPERTY_FIELDS);
  if (!String(data.title || "").trim()) return NextResponse.json({ error: "Property title is required." }, { status: 400 });
  if (!String(data.city || "").trim()) return NextResponse.json({ error: "City is required." }, { status: 400 });

  const rooms = Array.isArray(body?.roomTypes)
    ? body.roomTypes.filter((r: any) => String(r?.name || "").trim() && (Number(r?.total_units) || 0) > 0)
    : [];
  if (!rooms.length) return NextResponse.json({ error: "Add at least one room category with a name, room count and monthly rate." }, { status: 400 });

  // owner contact (name + phone) for the admin review
  const contact = body?.owner_contact && typeof body.owner_contact === "object" ? {
    name: String(body.owner_contact.name || "").trim().slice(0, 120),
    phone: String(body.owner_contact.phone || user.phone || "").trim().slice(0, 20),
    email: String(body.owner_contact.email || user.email || "").trim().slice(0, 120),
  } : { name: "", phone: user.phone || "", email: user.email || "" };

  const propRow: Record<string, any> = {
    ...data,
    status: "pending",           // needs admin approval before hitting the feed
    submitted_by: user.id,
    owner_contact: contact,
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/circle_properties`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(propRow),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Submission failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [row] = await r.json();
    // room categories (all new on a customer submission)
    if (row?.id && rooms.length) {
      const inserts = rooms.map((rm: any, i: number) => normalizeRoom(rm, String(row.id), i));
      await fetch(`${SB_URL}/rest/v1/circle_room_types`, {
        method: "POST", headers: SB_H, body: JSON.stringify(inserts),
      }).catch(() => {});
    }
    try { sbCacheInvalidate("circle:"); } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, id: row?.id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
