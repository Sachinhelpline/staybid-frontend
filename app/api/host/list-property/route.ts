import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

// ============================================================================
// Property-for-lease/rent SUBMISSION (sourcing side — Concept A).
// A property owner offers their property TO StayBid to be leased/rented/managed.
// Distinct from /onboard (Concept B — a hotel partner running their OWN
// property live). Submissions land in discovery_properties status='pending_review'
// and only appear in the public /host/properties feed after admin approval.
// ============================================================================

// POST /api/host/list-property — owner submits a property for lease/rent.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const title = String(body?.title || "").trim().slice(0, 160);
  const city = String(body?.city || "").trim().slice(0, 80);
  const name = String(body?.name || "").trim().slice(0, 120);
  const phone = String(body?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);

  if (!title || !city || !name || phone.length < 8) {
    return NextResponse.json(
      { error: "Property title, city, your name and a valid phone are required." },
      { status: 400 },
    );
  }

  const user = userFromReq(req);
  const num = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const coord = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const cleanArr = (v: any, cap = 30) =>
    Array.isArray(v) ? v.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, cap) : [];

  // v285 — flexible detail bag (floor / facing / lease terms / landmarks …).
  const d = body?.details && typeof body.details === "object" ? body.details : {};
  const details: Record<string, any> = {};
  const keepStr = (k: string, cap = 200) => { const s = String(d[k] ?? "").trim().slice(0, cap); if (s) details[k] = s; };
  const keepNum = (k: string) => { const n = Number(d[k]); if (Number.isFinite(n) && n >= 0) details[k] = n; };
  keepStr("floor", 40); keepNum("totalFloors"); keepStr("facing", 20); keepNum("ageYears");
  keepStr("availableFrom", 20); keepStr("leaseType", 40); keepNum("maintenanceMonthly");
  keepStr("tenantPref", 40); keepStr("landmarks", 400); keepNum("carpetArea"); keepStr("areaUnit", 10);
  if (d?.negotiable === true) details.negotiable = true;

  const row: any = {
    title,
    city,
    locality: String(body?.locality || "").trim().slice(0, 120) || null,
    state: String(body?.state || "").trim().slice(0, 80) || null,
    property_type: String(body?.propertyType || "").trim().slice(0, 60) || null,
    bhk: String(body?.bhk || "").trim().slice(0, 20) || null,
    area_sqft: num(body?.areaSqft),
    furnishing: String(body?.furnishing || "").trim().slice(0, 40) || null,
    rent_monthly: num(body?.rentMonthly),
    deposit: num(body?.deposit),
    amenities: cleanArr(body?.amenities),
    images: cleanArr(body?.images, 12),
    lat: coord(body?.lat),
    lng: coord(body?.lng),
    formatted_address: String(body?.formattedAddress || "").trim().slice(0, 400) || null,
    details: Object.keys(details).length ? details : null,
    source: "owner",
    submitted_by: user?.id || null,
    owner_contact: {
      name,
      phone,
      email: String(body?.email || "").trim().slice(0, 160) || null,
      note: String(body?.message || "").trim().slice(0, 1000) || null,
    },
    // Owner submissions start UNPUBLISHED — admin reviews before they go live.
    status: "pending_review",
    featured: false,
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/discovery_properties`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save your listing", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    return NextResponse.json({ ok: true, id: saved?.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Network error", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}

// GET /api/host/list-property — the signed-in owner's own submissions + status.
export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ submissions: [] });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/discovery_properties?submitted_by=eq.${encodeURIComponent(user.id)}`
        + `&select=id,title,city,property_type,rent_monthly,status,created_at`
        + `&order=created_at.desc&limit=50`,
      { headers: SB_READ, cache: "no-store" },
    );
    const submissions = r.ok ? await r.json() : [];
    return NextResponse.json({ submissions });
  } catch (e: any) {
    return NextResponse.json({ submissions: [], error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
