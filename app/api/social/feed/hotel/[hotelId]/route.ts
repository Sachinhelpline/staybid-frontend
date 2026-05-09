// GET /api/social/feed/hotel/[hotelId] — posts authored by a specific hotel.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const READ = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(_req: Request, { params }: { params: { hotelId: string } }) {
  const hotelId = decodeURIComponent(params.hotelId || "");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  // Find this hotel's social profile id
  const pr = await fetch(
    `${SB_URL}/rest/v1/social_profiles?hotel_id=eq.${encodeURIComponent(hotelId)}&select=id&limit=1`,
    { headers: READ, cache: "no-store" }
  );
  const profiles = pr.ok ? await pr.json().catch(() => []) : [];
  if (!Array.isArray(profiles) || !profiles[0]) {
    return NextResponse.json({ posts: [], note: "Hotel profile not found" });
  }
  const profileId = profiles[0].id;

  const r = await fetch(
    `${SB_URL}/rest/v1/social_posts?author_id=eq.${encodeURIComponent(profileId)}&is_active=eq.true&order=created_at.desc&limit=50&select=*`,
    { headers: READ, cache: "no-store" }
  );
  const posts = r.ok ? await r.json().catch(() => []) : [];
  return NextResponse.json({ posts });
}
