// GET /api/social/feed/creator/[creatorId] — posts by a specific creator.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const READ = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(_req: Request, props: { params: Promise<{ creatorId: string }> }) {
  const params = await props.params;
  const creatorId = decodeURIComponent(params.creatorId || "");
  if (!creatorId) return NextResponse.json({ error: "creatorId required" }, { status: 400 });

  const pr = await fetch(
    `${SB_URL}/rest/v1/social_profiles?creator_id=eq.${encodeURIComponent(creatorId)}&select=id&limit=1`,
    { headers: READ, cache: "no-store" }
  );
  const profiles = pr.ok ? await pr.json().catch(() => []) : [];
  if (!Array.isArray(profiles) || !profiles[0]) {
    return NextResponse.json({ posts: [], note: "Creator profile not found" });
  }
  const profileId = profiles[0].id;

  const r = await fetch(
    `${SB_URL}/rest/v1/social_posts?author_id=eq.${encodeURIComponent(profileId)}&is_active=eq.true&order=created_at.desc&limit=50&select=*`,
    { headers: READ, cache: "no-store" }
  );
  const posts = r.ok ? await r.json().catch(() => []) : [];
  return NextResponse.json({ posts });
}
