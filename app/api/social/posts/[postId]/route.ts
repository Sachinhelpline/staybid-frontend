// DELETE /api/social/posts/[postId] — author or admin can HARD-delete (v118).
//   Removes the social_posts row, every owned Storage object (media,
//   thumbnail, per-user audio), and best-effort cascades video_likes,
//   video_comments, user_saves. Invalidates the in-memory feed cache.
// PATCH  /api/social/posts/[postId] — author can edit caption / location.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCacheInvalidate } from "@/lib/sb-cache";
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

// ─── v118 — HARD delete ────────────────────────────────────────────────
// Removes the social_posts row AND every Storage object it owns
// (media + thumbnail + per-post audio if the audio sits in our own
// bucket). Previously this was a soft-delete (`is_active: false`)
// that left the Storage object orphaned forever — dump-data growth.
//
// What gets nuked:
//   • social_posts row                                  (DELETE on the table)
//   • Storage object at media_url                        (if /social-media/)
//   • Storage object at thumbnail_url                    (if /social-media/)
//   • Storage object at sound_url                        (if it's a per-user
//                                                        upload at /audio/<userId>/)
//   • Best-effort: video_likes / video_comments rows     (if those columns
//                                                        reference this post by id)
//
// Storage URLs in this codebase look like:
//   https://uxxhbdqedazpmvbvaosh.supabase.co/storage/v1/object/public/social-media/<key>
// We strip the prefix and issue:
//   DELETE https://uxxhbdqedazpmvbvaosh.supabase.co/storage/v1/object/social-media/<key>
// using the same anon JWT (the bucket policy is anon-write/delete).
//
// Failures on Storage do NOT block the DB delete — DB row going away is
// the primary correctness contract; an orphaned blob is a smaller leak
// than a phantom post showing in feeds. We still return the per-side
// outcome in the response so admins/observability can see what slipped.
const STORAGE_BUCKET   = "social-media";
const STORAGE_PUB_PREFIX = `${SB_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;

function storageKeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith(STORAGE_PUB_PREFIX)) return null;
  const key = url.slice(STORAGE_PUB_PREFIX.length).split("?")[0].split("#")[0];
  return key ? decodeURIComponent(key) : null;
}

async function deleteStorageObject(key: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SB_URL}/storage/v1/object/${STORAGE_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
      { method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    // 200 = deleted, 404 = already gone (treat as success — the goal is
    // "object no longer exists"), anything else = surface the failure.
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  const postId = decodeURIComponent(params.postId);
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const ctx = await loadPostAndProfile(req, postId);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  if (!canDeletePost(ctx.post, ctx.profile, ctx.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const post = ctx.post;
  // Collect every Storage object the post owns. We attempt each delete in
  // parallel — they're independent and failures don't cascade.
  const storageKeys = [
    storageKeyFromPublicUrl(post.media_url),
    storageKeyFromPublicUrl(post.thumbnail_url),
    storageKeyFromPublicUrl(post.sound_url), // may be null if track is from the library
  ].filter((k): k is string => !!k);
  const storageResults = await Promise.all(
    storageKeys.map(async (k) => ({ key: k, ok: await deleteStorageObject(k) }))
  );

  // Best-effort cascade on related rows. The columns may not exist in
  // every deployment (older social-feed schemas had separate tables);
  // a 4xx from PostgREST is fine — we just want to nuke what's there.
  await Promise.all([
    fetch(`${SB_URL}/rest/v1/video_likes?video_id=eq.${encodeURIComponent(postId)}`, {
      method: "DELETE", headers: HEADERS,
    }).catch(() => {}),
    fetch(`${SB_URL}/rest/v1/video_comments?video_id=eq.${encodeURIComponent(postId)}`, {
      method: "DELETE", headers: HEADERS,
    }).catch(() => {}),
    fetch(`${SB_URL}/rest/v1/user_saves?target_type=eq.video&target_id=eq.${encodeURIComponent(postId)}`, {
      method: "DELETE", headers: HEADERS,
    }).catch(() => {}),
  ]);

  // Hard delete the post row itself. We attempt this AFTER Storage cleanup
  // so that if the DELETE wins but Storage fails, the orphan is
  // recoverable via a later sweep; the inverse would leave a phantom
  // post pointing at a missing object — worst-case UX.
  const dbResp = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(postId)}`,
    { method: "DELETE", headers: HEADERS }
  );

  if (!dbResp.ok) {
    return NextResponse.json({
      error: "Could not delete post row",
      detail: await dbResp.text().catch(() => ""),
      storageResults,
    }, { status: 500 });
  }

  // v118 — invalidate the in-memory feed cache so subsequent /api/social/feed
  // requests don't return the just-deleted row from the 15s warm-cache
  // window. sbCacheInvalidate is prefix-based so this drops every cached
  // feed permutation (per-author, per-type, per-filter) in one sweep.
  try { sbCacheInvalidate("social:"); } catch {}

  return NextResponse.json({
    deleted: true,
    hardDelete: true,
    storage: storageResults, // [{ key, ok }] per nuked object
  });
}

// v111 — edit caption / location / sound / hotel-tag on an existing post.
// Author-only. Cannot change media_url, media_type, author_id (those are
// immutable for integrity of the feed + idempotency contract).
export async function PATCH(req: Request, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
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
  // v112.2 — IG-style toggles persisted server-side so consumers (the
  // feed, the profile grid, the post drawer) can hide the like count or
  // disable comments accordingly.
  if (typeof body.hide_likes === "boolean")        patch.hide_likes        = body.hide_likes;
  if (typeof body.disable_comments === "boolean")  patch.disable_comments  = body.disable_comments;
  // v112.2 — let the author re-categorise a post into / out of a
  // highlight bucket via the same edit sheet.
  if (typeof body.highlight_key === "string") {
    patch.highlight_key = body.highlight_key.trim().slice(0, 64) || null;
  } else if (body.highlight_key === null) {
    patch.highlight_key = null;
  }
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
