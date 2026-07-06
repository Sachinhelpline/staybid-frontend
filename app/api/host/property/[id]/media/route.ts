import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";
import { resolveUserIds } from "@/lib/sb-server";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

// ============================================================================
// v285 — Per-property content feed (reels + photos).
// Only the property OWNER (discovery_properties.submitted_by, resolved across
// the caller's identities) OR a StayBid ADMIN may upload / delete. Everyone
// else gets a read-only public showcase.
// ============================================================================

// Public-safe columns — NEVER expose owner_contact / submitted_by.
const PUBLIC_COLS =
  "id,title,city,locality,state,property_type,bhk,area_sqft,furnishing," +
  "rent_monthly,deposit,score,images,amenities,lat,lng,formatted_address," +
  "details,source,status,featured,created_at";

async function fetchProperty(id: string, includePrivate = false) {
  const sel = includePrivate ? PUBLIC_COLS + ",submitted_by" : PUBLIC_COLS;
  const r = await fetch(
    `${SB_URL}/rest/v1/discovery_properties?id=eq.${encodeURIComponent(id)}&select=${sel}&limit=1`,
    { headers: SB_READ, cache: "no-store" },
  );
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

// Returns { role } if the caller may manage this property's content, else null.
async function authorize(req: Request, propertyRow: any): Promise<{ role: "admin" | "owner"; admin: any } | null> {
  const admin = adminFromReq(req);
  if (admin?.id) return { role: "admin", admin };

  const user = userFromReq(req);
  if (!user?.id) return null;
  const owner = String(propertyRow?.submitted_by || "");
  if (!owner) return null;
  if (owner === user.id) return { role: "owner", admin: null };
  try {
    const ids = await resolveUserIds(user.id, (user as any).phone, (user as any).email);
    if (ids.includes(owner)) return { role: "owner", admin: null };
  } catch { /* fall through */ }
  return null;
}

// GET — public showcase. Returns the property (public subset), active media,
// and canManage (whether THIS caller may add/remove content).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const property = await fetchProperty(id, true);
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    const mr = await fetch(
      `${SB_URL}/rest/v1/property_media?property_id=eq.${encodeURIComponent(id)}&status=eq.active`
        + `&select=id,media_type,media_url,thumbnail_url,caption,uploaded_role,created_at`
        + `&order=sort_order.desc,created_at.desc`,
      { headers: SB_READ, cache: "no-store" },
    );
    const media = mr.ok ? await mr.json() : [];

    const auth = await authorize(req, property);
    const { submitted_by, ...pub } = property; // strip private field from output
    void submitted_by;

    return NextResponse.json({ property: pub, media, canManage: !!auth, role: auth?.role || null });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}

// POST — add one media asset. Owner or admin only.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const property = await fetchProperty(id, true);
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const auth = await authorize(req, property);
  if (!auth) return NextResponse.json({ error: "Only the property owner or a StayBid admin can add content." }, { status: 403 });

  const mediaType = body?.mediaType === "video" ? "video" : body?.mediaType === "photo" ? "photo" : "";
  const mediaUrl = String(body?.mediaUrl || "").trim();
  if (!mediaType || !mediaUrl.startsWith("http")) {
    return NextResponse.json({ error: "mediaType (video|photo) and a valid mediaUrl are required." }, { status: 400 });
  }

  const user = userFromReq(req);
  const row = {
    id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    property_id: id,
    media_type: mediaType,
    media_url: mediaUrl.slice(0, 1000),
    thumbnail_url: String(body?.thumbnailUrl || "").trim().slice(0, 1000) || null,
    caption: String(body?.caption || "").trim().slice(0, 600) || null,
    uploaded_by: auth.role === "admin" ? (auth.admin?.id || "admin") : (user?.id || null),
    uploaded_role: auth.role,
    status: "active",
    sort_order: Date.now() % 2_000_000_000,
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/property_media`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save media", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    if (auth.role === "admin") {
      logAdminAction({ admin: auth.admin, action: "host.property.media.add", targetType: "property", targetId: id, details: { mediaType } });
    }
    return NextResponse.json({ ok: true, media: saved });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}

// DELETE ?mediaId=<id> — remove one asset. Owner or admin only.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mediaId = new URL(req.url).searchParams.get("mediaId");
  if (!mediaId) return NextResponse.json({ error: "mediaId required" }, { status: 400 });

  const property = await fetchProperty(id, true);
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const auth = await authorize(req, property);
  if (!auth) return NextResponse.json({ error: "Only the property owner or a StayBid admin can remove content." }, { status: 403 });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/property_media?id=eq.${encodeURIComponent(mediaId)}&property_id=eq.${encodeURIComponent(id)}`,
      { method: "DELETE", headers: SB_H },
    );
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not delete media", detail: t.slice(0, 200) }, { status: 502 });
    }
    if (auth.role === "admin") {
      logAdminAction({ admin: auth.admin, action: "host.property.media.delete", targetType: "property", targetId: id, details: { mediaId } });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
