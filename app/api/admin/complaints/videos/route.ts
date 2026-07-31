// v127 — Side-by-side video lookup for the /admin/complaints detail panel.
//
// GET /api/admin/complaints/videos?requestId=...&evidenceVideoId=...
//
// Either / both query params are optional. Returns:
//   {
//     hotelVideo:    { id, url, urls?, segments?, type, status } | null,
//     customerVideo: { id, url, urls?, segments?, type, status } | null
//   }
//
// hotelVideo is resolved from vp_requests.hotel_video_id (the verification
// video the hotel uploaded for that booking). customerVideo is resolved
// directly from vp_videos by id when the stay-feedback flow uploaded one;
// when the customer-side video lives only on complaints.feedback.evidenceVideoUrls
// (no vp_videos row), the caller can fall back to that URL list — that
// path is handled in the UI, not here.
import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const VIDEO_FIELDS = "id,url,urls,segments,type,status,actual_secs,created_at";

export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const u = new URL(req.url);
    const requestId       = u.searchParams.get("requestId") || "";
    const evidenceVideoId = u.searchParams.get("evidenceVideoId") || "";

    let hotelVideo: any = null;
    let customerVideo: any = null;

    if (requestId) {
      const reqRes = await fetch(
        `${SB_URL}/rest/v1/vp_requests?id=eq.${encodeURIComponent(requestId)}&select=hotel_video_id,customer_video_id&limit=1`,
        { headers: SB_H, cache: "no-store" },
      );
      const rows = reqRes.ok ? await reqRes.json().catch(() => []) : [];
      const row = Array.isArray(rows) ? rows[0] : null;
      const hvId = row?.hotel_video_id;
      const cvId = row?.customer_video_id;

      if (hvId) {
        const r = await fetch(
          `${SB_URL}/rest/v1/vp_videos?id=eq.${encodeURIComponent(hvId)}&select=${VIDEO_FIELDS}&limit=1`,
          { headers: SB_H, cache: "no-store" },
        );
        const vs = r.ok ? await r.json().catch(() => []) : [];
        hotelVideo = Array.isArray(vs) ? vs[0] || null : null;
      }
      if (cvId) {
        const r = await fetch(
          `${SB_URL}/rest/v1/vp_videos?id=eq.${encodeURIComponent(cvId)}&select=${VIDEO_FIELDS}&limit=1`,
          { headers: SB_H, cache: "no-store" },
        );
        const vs = r.ok ? await r.json().catch(() => []) : [];
        customerVideo = Array.isArray(vs) ? vs[0] || null : null;
      }
    }

    if (!customerVideo && evidenceVideoId) {
      const r = await fetch(
        `${SB_URL}/rest/v1/vp_videos?id=eq.${encodeURIComponent(evidenceVideoId)}&select=${VIDEO_FIELDS}&limit=1`,
        { headers: SB_H, cache: "no-store" },
      );
      const vs = r.ok ? await r.json().catch(() => []) : [];
      customerVideo = Array.isArray(vs) ? vs[0] || null : null;
    }

    return NextResponse.json({ hotelVideo, customerVideo });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "videos fetch failed", hotelVideo: null, customerVideo: null });
  }
}
