// GET /api/admin/content/pending-review
// Admin queue — every social_posts row with moderation_status='PENDING_ADMIN_REVIEW'.
// Cross-hotel: admins see all escalations from every partner.
//
// Auth: x-admin-token (sb_admin_token from localStorage). The admin panel
// layout already gates by role before pages mount; this endpoint trusts
// the token presence per the v98 audit pattern. Identity logged via
// logAdminAction on every mutation.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { adminFromReq } from "@/lib/admin/audit";

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  // adminFromReq returns null only when there's no header AND no token.
  // For pre-Phase-2 admins the layout sets x-admin-* headers, so null here
  // is a genuine unauth.
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pr = await fetch(
    `${SB_URL}/rest/v1/social_posts` +
      `?moderation_status=eq.PENDING_ADMIN_REVIEW` +
      `&select=*&order=escalated_to_admin_at.asc.nullsfirst,created_at.asc&limit=200`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!pr.ok) {
    return NextResponse.json(
      { error: "Lookup failed" },
      { status: 500 }
    );
  }
  const posts = (await pr.json().catch(() => [])) as any[];

  // Side-load author handles + hotel names
  let authors: Map<string, any> = new Map();
  let hotels: Map<string, any> = new Map();
  if (posts.length) {
    const authorIds = Array.from(
      new Set(posts.map((p) => p.author_id).filter(Boolean))
    );
    const hotelIds = Array.from(
      new Set(posts.map((p) => p.hotel_id).filter(Boolean))
    );
    const [ar, hr] = await Promise.all([
      authorIds.length
        ? fetch(
            `${SB_URL}/rest/v1/social_profiles?id=in.(${authorIds
              .map(encodeURIComponent)
              .join(",")})&select=id,username,display_name,avatar_url,user_type,user_id`,
            { headers: READ_HEADERS, cache: "no-store" }
          )
        : Promise.resolve(null),
      hotelIds.length
        ? fetch(
            `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds
              .map(encodeURIComponent)
              .join(",")})&select=id,name,city,ownerId`,
            { headers: READ_HEADERS, cache: "no-store" }
          )
        : Promise.resolve(null),
    ]);
    if (ar?.ok) {
      const rows = (await ar.json().catch(() => [])) as any[];
      authors = new Map(rows.map((r: any) => [r.id, r]));
    }
    if (hr?.ok) {
      const rows = (await hr.json().catch(() => [])) as any[];
      hotels = new Map(rows.map((r: any) => [r.id, r]));
    }
  }

  const enriched = posts.map((p) => ({
    ...p,
    author: authors.get(p.author_id) || null,
    hotel: hotels.get(p.hotel_id) || null,
  }));

  return NextResponse.json({ posts: enriched });
}
