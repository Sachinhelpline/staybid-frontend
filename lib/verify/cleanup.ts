// v127.1 — Storage + DB cleanup for the stay-feedback lifecycle.
//
// User rule: only the smiley initials persist long-term. Any actual video
// (hotel verification recording OR customer evidence recording) gets
// purged from:
//   1. Supabase Storage bucket "verification-videos"
//   2. public.vp_videos table
//
// "Dump data" in the user spec refers to the Storage bucket — Supabase
// doesn't keep a separate dump, the bucket IS the dump. RLS-protected
// admin key handles the DELETE in both layers.
//
// Helpers are idempotent — calling twice on the same id is safe.

import { SB_URL, SB_KEY } from "@/lib/sb";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const BUCKET = "verification-videos";

/**
 * Delete one Storage object by its full path inside the bucket.
 * Failures bubble up to the caller — the cron / hook decides whether
 * to mark `videoCleanedAt` (success) or retry next sweep (partial fail).
 */
async function deleteStorageObject(path: string): Promise<boolean> {
  if (!path) return true;
  try {
    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
      method: "DELETE",
      headers: SB_H,
    });
    // 200 or 404 — both fine. 404 means it was already gone, idempotent.
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

/**
 * Extract the Storage path from a signed/public URL we wrote to vp_videos
 * (or to complaints.feedback.evidenceVideoUrls). The URLs we mint in
 * /verification/record look like:
 *   https://uxxhbdqedazpmvbvaosh.supabase.co/storage/v1/object/verification-videos/<requestId>/<type>/<stepId>-<ts>.webm
 *   https://uxxhbdqedazpmvbvaosh.supabase.co/storage/v1/sign/verification-videos/<...>?token=...
 * Both forms share the same path after `verification-videos/`.
 */
function extractBucketPath(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/verification-videos\/(.+?)(?:\?|$)/);
  return m ? decodeURI(m[1]) : null;
}

/**
 * Delete all video assets for a vp_request: the verification video that
 * the HOTEL uploaded (proving the room) AND any segments. Removes the
 * Storage objects, then the vp_videos rows, then resets the vp_requests
 * pointers so a re-request would create fresh rows.
 *
 * Returns the number of Storage objects + DB rows deleted (best-effort).
 */
export async function purgeVerificationVideos(requestId: string): Promise<{
  storageDeleted: number;
  rowsDeleted: number;
}> {
  let storageDeleted = 0;
  let rowsDeleted = 0;
  if (!requestId) return { storageDeleted, rowsDeleted };

  // 1. Resolve vp_request → its hotel_video_id + customer_video_id
  const reqRes = await fetch(
    `${SB_URL}/rest/v1/vp_requests?id=eq.${encodeURIComponent(requestId)}&select=hotel_video_id,customer_video_id&limit=1`,
    { headers: SB_H, cache: "no-store" },
  );
  const reqRows = reqRes.ok ? await reqRes.json().catch(() => []) : [];
  const reqRow = Array.isArray(reqRows) ? reqRows[0] : null;
  const videoIds = [reqRow?.hotel_video_id, reqRow?.customer_video_id].filter(Boolean) as string[];

  // 2. Pull each vp_video to discover Storage paths (segments may have multiple)
  for (const vid of videoIds) {
    const vRes = await fetch(
      `${SB_URL}/rest/v1/vp_videos?id=eq.${encodeURIComponent(vid)}&select=url,urls,segments&limit=1`,
      { headers: SB_H, cache: "no-store" },
    );
    const v = (vRes.ok ? await vRes.json().catch(() => []) : [])[0];
    if (!v) continue;
    const urls: string[] = [];
    if (typeof v.url === "string") urls.push(v.url);
    if (v.urls && typeof v.urls === "object") {
      for (const u of Object.values(v.urls)) if (typeof u === "string") urls.push(u);
    }
    if (Array.isArray(v.segments)) {
      for (const s of v.segments) if (s?.url) urls.push(String(s.url));
    }
    for (const u of urls) {
      const p = extractBucketPath(u);
      if (p && (await deleteStorageObject(p))) storageDeleted++;
    }
  }

  // 3. Delete the vp_videos rows
  if (videoIds.length) {
    const del = await fetch(
      `${SB_URL}/rest/v1/vp_videos?id=in.(${videoIds.map(encodeURIComponent).join(",")})`,
      { method: "DELETE", headers: { ...SB_H, Prefer: "return=representation" } },
    );
    if (del.ok) {
      const rows = await del.json().catch(() => []);
      rowsDeleted = Array.isArray(rows) ? rows.length : 0;
    }
  }

  // 4. Null out the FKs on vp_requests so it doesn't dangle. Mark expired
  //    so the customer-side /verification surface treats it as cleaned-up.
  await fetch(`${SB_URL}/rest/v1/vp_requests?id=eq.${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    headers: { ...SB_H, "Content-Type": "application/json" },
    body: JSON.stringify({
      hotel_video_id: null,
      customer_video_id: null,
      status: "expired",
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  return { storageDeleted, rowsDeleted };
}

/**
 * Delete every evidence-video file referenced by a complaint row. Pulls
 * paths from complaints.feedback.evidenceVideoUrls AND any vp_videos row
 * pointed to by complaints.evidenceVideoId.
 *
 * Returns the number of files deleted from Storage.
 */
export async function purgeEvidenceVideos(complaint: {
  id: string;
  feedback?: any;
  evidenceVideoId?: string | null;
}): Promise<{ storageDeleted: number; rowsDeleted: number }> {
  let storageDeleted = 0;
  let rowsDeleted = 0;
  const urls: string[] = [];

  // Pull URLs from the JSONB feedback payload (most-common path — set by
  // /verification/record's stay_feedback branch).
  const feedbackUrls = complaint.feedback?.evidenceVideoUrls;
  if (Array.isArray(feedbackUrls)) {
    for (const u of feedbackUrls) if (typeof u === "string") urls.push(u);
  }

  // Pull URLs from the vp_videos row if a separate evidenceVideoId was wired.
  if (complaint.evidenceVideoId) {
    const r = await fetch(
      `${SB_URL}/rest/v1/vp_videos?id=eq.${encodeURIComponent(complaint.evidenceVideoId)}&select=url,urls,segments&limit=1`,
      { headers: SB_H, cache: "no-store" },
    );
    const v = (r.ok ? await r.json().catch(() => []) : [])[0];
    if (v) {
      if (typeof v.url === "string") urls.push(v.url);
      if (v.urls && typeof v.urls === "object") {
        for (const u of Object.values(v.urls)) if (typeof u === "string") urls.push(u);
      }
      if (Array.isArray(v.segments)) {
        for (const s of v.segments) if (s?.url) urls.push(String(s.url));
      }
    }
  }

  for (const u of urls) {
    const p = extractBucketPath(u);
    if (p && (await deleteStorageObject(p))) storageDeleted++;
  }

  if (complaint.evidenceVideoId) {
    const del = await fetch(
      `${SB_URL}/rest/v1/vp_videos?id=eq.${encodeURIComponent(complaint.evidenceVideoId)}`,
      { method: "DELETE", headers: { ...SB_H, Prefer: "return=representation" } },
    );
    if (del.ok) {
      const rows = await del.json().catch(() => []);
      rowsDeleted = Array.isArray(rows) ? rows.length : 0;
    }
  }

  // Strip the URLs from the feedback JSONB so the admin panel no longer
  // tries to load dead links + mark videoCleanedAt for idempotency.
  const patchedFeedback = (() => {
    if (!complaint.feedback || typeof complaint.feedback !== "object") return null;
    const f = { ...complaint.feedback };
    delete f.evidenceVideoUrls;
    return f;
  })();

  await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(complaint.id)}`, {
    method: "PATCH",
    headers: { ...SB_H, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(patchedFeedback ? { feedback: patchedFeedback } : {}),
      evidenceVideoId: null,
      videoCleanedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  }).catch(() => {});

  return { storageDeleted, rowsDeleted };
}
