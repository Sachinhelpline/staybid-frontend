// PATCH /api/social/posts/[postId]/sound — only the sound_owner can update
// the soundtrack. Body: { soundTrack, soundUrl? }
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { getProfileByUserId, canChangeSound } from "@/lib/social/social-profile.service";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

export async function PATCH(req: Request, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  const user = socialUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const postId = decodeURIComponent(params.postId);

  const body = await req.json().catch(() => ({}));
  if (!body?.soundTrack) return NextResponse.json({ error: "soundTrack required" }, { status: 400 });

  const pr = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}&select=*&limit=1`,
    { headers: HEADERS, cache: "no-store" }
  );
  const arr = pr.ok ? await pr.json().catch(() => []) : [];
  const post = Array.isArray(arr) && arr[0];
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const profile = await getProfileByUserId(user.id);
  if (!canChangeSound(post, profile)) {
    return NextResponse.json({ error: "Only the sound owner can change the soundtrack" }, { status: 403 });
  }

  await fetch(`${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`, {
    method: "PATCH", headers: HEADERS,
    body: JSON.stringify({
      sound_track: body.soundTrack,
      sound_url:   body.soundUrl || null,
      sound_owner_id: profile?.id || post.sound_owner_id,
    }),
  });
  return NextResponse.json({ updated: true });
}
