// GET /api/partner/content/pending
// v160 — repurposed. The hotel no longer gates guest content (booking ID is
// the proof — verified-guest posts publish directly). This endpoint now lists
// the PUBLISHED guest + community content tagged to the partner's hotels,
// read-only, so the hotel can SEE what guests are posting about them. The
// only action the partner can take is "report" (→ /api/partner/content/[id]),
// which escalates an abusive post to admin — it cannot block a publish.
//
// Auth: x-partner-token (sb_partner_token from localStorage).
//       Optional x-partner-hotel-id to scope to a single hotel; else all
//       hotels owned by the partner are included.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { resolveUserIds } from "@/lib/sb-server";

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

function decodeJwt(t: string): any {
  try {
    return JSON.parse(
      Buffer.from(
        t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString()
    );
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const tok = req.headers.get("x-partner-token") || "";
  if (!tok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = decodeJwt(tok);
  if (!payload?.id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Dual-id resolver (handles +91 vs no-prefix per CLAUDE.md history)
  const ownerIds = await resolveUserIds(payload.id, payload.phone);

  // Hotels owned by this partner (across all linked user ids)
  const inOwners = ownerIds.map(encodeURIComponent).join(",");
  const hr = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${inOwners})&select=id,name`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!hr.ok) {
    return NextResponse.json(
      { error: "Hotel lookup failed" },
      { status: 500 }
    );
  }
  const hotels = (await hr.json().catch(() => [])) as any[];
  if (!hotels.length) {
    return NextResponse.json({ posts: [], hotels: [] });
  }

  // Optional scope to a single hotel
  const scopeHotel = req.headers.get("x-partner-hotel-id");
  const scoped = scopeHotel
    ? hotels.filter((h) => h.id === scopeHotel)
    : hotels;
  if (!scoped.length) {
    return NextResponse.json({ posts: [], hotels: [] });
  }
  const inHotels = scoped.map((h) => encodeURIComponent(h.id)).join(",");

  // Fetch published guest + community content for those hotels.
  // verification_method in (booking, location_otp) keeps this to guest-driven
  // content — CREATOR / HOTEL uploads are not surfaced here.
  const pr = await fetch(
    `${SB_URL}/rest/v1/social_posts` +
      `?hotel_id=in.(${inHotels})` +
      `&moderation_status=in.(APPROVED,AUTO_APPROVED)` +
      `&verification_method=in.(booking,location_otp)` +
      `&is_active=eq.true` +
      `&select=*&order=created_at.desc&limit=200`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!pr.ok) {
    return NextResponse.json(
      { error: "Guest content lookup failed" },
      { status: 500 }
    );
  }
  const posts = (await pr.json().catch(() => [])) as any[];

  // Side-load author handles for display
  let authors: Map<string, any> = new Map();
  if (posts.length) {
    const authorIds = Array.from(
      new Set(posts.map((p) => p.author_id).filter(Boolean))
    );
    if (authorIds.length) {
      const ar = await fetch(
        `${SB_URL}/rest/v1/social_profiles?id=in.(${authorIds
          .map(encodeURIComponent)
          .join(",")})&select=id,username,display_name,avatar_url,user_type`,
        { headers: READ_HEADERS, cache: "no-store" }
      );
      if (ar.ok) {
        const rows = (await ar.json().catch(() => [])) as any[];
        authors = new Map(rows.map((r: any) => [r.id, r]));
      }
    }
  }

  const enriched = posts.map((p) => ({
    ...p,
    author: authors.get(p.author_id) || null,
    hotel_name: scoped.find((h) => h.id === p.hotel_id)?.name || null,
  }));

  return NextResponse.json({ posts: enriched, hotels: scoped });
}
