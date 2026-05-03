import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

// POST /api/videos/track-view — record a video watch event
// Body: { videoId, watchSeconds, completed, hotelId?, creatorInfluencerId? }
// Writes a row to referral_events with event_type="video_view".
// Reuses the existing referral_events infra so analytics queries already work.
export async function POST(req: NextRequest) {
  const user = userFromReq(req);
  const body = await req.json().catch(() => ({}));
  const { videoId, watchSeconds, completed, hotelId, creatorInfluencerId, code } = body;
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || null;
  const ua = req.headers.get("user-agent") || null;

  const row = {
    code:           code || null,
    influencer_id:  creatorInfluencerId || null,
    event_type:     completed ? "video_complete" : "video_view",
    user_id:        user?.id || null,
    target_type:    "video",
    target_id:      String(videoId),
    ip,
    user_agent:     ua,
    metadata: {
      watch_seconds: Number(watchSeconds) || 0,
      completed:     !!completed,
      hotel_id:      hotelId || null,
    },
  };

  // Fire-and-forget — don't block the client on the response
  fetch(`${SB_URL}/rest/v1/referral_events`, {
    method: "POST", headers: SB_H, body: JSON.stringify(row),
  }).catch(() => {});

  // Bump views_count on the video itself (best-effort)
  if (!completed) {
    fetch(`${SB_URL}/rest/v1/rpc/increment_video_view`, {
      method: "POST", headers: SB_H, body: JSON.stringify({ p_video_id: videoId }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
