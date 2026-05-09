// DELETE /api/social/posts/[postId] — author or admin can soft-delete.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { getProfileByUserId, canDeletePost } from "@/lib/social/social-profile.service";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

export async function DELETE(req: Request, { params }: { params: { postId: string } }) {
  const user = socialUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const postId = decodeURIComponent(params.postId);
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  // Load post + viewer profile to check authorisation
  const pr = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}&select=*&limit=1`,
    { headers: HEADERS, cache: "no-store" }
  );
  const arr = pr.ok ? await pr.json().catch(() => []) : [];
  const post = Array.isArray(arr) && arr[0];
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  const profile = await getProfileByUserId(user.id);
  if (!canDeletePost(post, profile, user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft delete — keeps stats accurate, lets admins audit
  await fetch(`${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`, {
    method: "PATCH", headers: HEADERS, body: JSON.stringify({ is_active: false }),
  });
  return NextResponse.json({ deleted: true });
}
