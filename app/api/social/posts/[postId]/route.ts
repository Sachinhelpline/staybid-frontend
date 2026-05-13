// DELETE /api/social/posts/[postId] — author or admin can soft-delete.
// PATCH  /api/social/posts/[postId] — author can edit caption / location.
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

async function loadPostAndProfile(req: Request, postId: string) {
  const user = socialUserFromReq(req);
  if (!user) return { error: "Unauthorized", status: 401 } as const;

  const pr = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}&select=*&limit=1`,
    { headers: HEADERS, cache: "no-store" }
  );
  const arr = pr.ok ? await pr.json().catch(() => []) : [];
  const post = Array.isArray(arr) && arr[0];
  if (!post) return { error: "Post not found", status: 404 } as const;

  const profile = await getProfileByUserId(user.id);
  if (!profile) return { error: "Forbidden", status: 403 } as const;

  return { user, post, profile } as const;
}

export async function DELETE(req: Request, { params }: { params: { postId: string } }) {
  const postId = decodeURIComponent(params.postId);
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const ctx = await loadPostAndProfile(req, postId);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  if (!canDeletePost(ctx.post, ctx.profile, ctx.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft delete — keeps stats accurate, lets admins audit
  await fetch(`${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`, {
    method: "PATCH", headers: HEADERS, body: JSON.stringify({ is_active: false }),
  });
  return NextResponse.json({ deleted: true });
}

// v111 — edit caption / location / sound / hotel-tag on an existing post.
// Author-only. Cannot change media_url, media_type, author_id (those are
// immutable for integrity of the feed + idempotency contract).
export async function PATCH(req: Request, { params }: { params: { postId: string } }) {
  const postId = decodeURIComponent(params.postId);
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const ctx = await loadPostAndProfile(req, postId);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  // Only the author OR an admin can edit
  const isAuthor = ctx.post.author_id === ctx.profile.id;
  const isAdmin  = ctx.user.role === "admin" || ctx.user.role === "super_admin";
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, any> = {};
  if (typeof body.caption === "string")        patch.caption        = body.caption.slice(0, 2200) || null;
  if (typeof body.location_name === "string")  patch.location_name  = body.location_name.slice(0, 120) || null;
  if (typeof body.locationLat === "number")    patch.location_lat   = body.locationLat;
  if (typeof body.locationLng === "number")    patch.location_lng   = body.locationLng;
  if (typeof body.sound_track === "string")    patch.sound_track    = body.sound_track.slice(0, 200) || null;
  if (typeof body.sound_url === "string")      patch.sound_url      = body.sound_url.slice(0, 1000) || null;
  // hotel_id can be unset (null) or set to a different hotel — re-validate
  // ownership for hotel-type profiles to mirror the POST rules.
  if (body.hotel_id === null) {
    patch.hotel_id = null;
  } else if (typeof body.hotel_id === "string" && body.hotel_id) {
    if (ctx.profile.user_type === "HOTEL") {
      if (ctx.profile.hotel_id === body.hotel_id) patch.hotel_id = body.hotel_id;
    } else {
      patch.hotel_id = body.hotel_id;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ post: ctx.post, updated: false });
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`,
    { method: "PATCH", headers: HEADERS, body: JSON.stringify(patch) }
  );
  if (!r.ok) {
    return NextResponse.json({ error: "Could not update post", detail: await r.text() }, { status: 500 });
  }
  const arr = await r.json().catch(() => []);
  const updated = Array.isArray(arr) && arr[0] ? arr[0] : ctx.post;
  return NextResponse.json({ post: updated, updated: true });
}
