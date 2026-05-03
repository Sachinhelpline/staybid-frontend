import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Admin platform-systems widget — counts only (cheap). Powers the new card
// row on /admin without disturbing the existing dashboard data shape.
export async function GET() {
  async function count(path: string): Promise<number> {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...SB_READ, Prefer: "count=exact" } });
    const range = res.headers.get("content-range") || "";
    const total = range.split("/").pop();
    return Number(total) || 0;
  }

  const [influencers, influencersActive, videosPending, videosApproved, savesAll, notifPending, pointWallets] = await Promise.all([
    count("influencers?select=id"),
    count("influencers?select=id&status=eq.active"),
    count("hotel_videos?select=id&verification_status=eq.pending"),
    count("hotel_videos?select=id&verification_status=eq.approved"),
    count("user_saves?select=id"),
    count("notification_queue?select=id&status=eq.pending"),
    count("user_points?select=user_id"),
  ]);

  return NextResponse.json({
    widgets: {
      influencersTotal: influencers,
      influencersActive,
      videosPending,
      videosApproved,
      savesTotal: savesAll,
      notifPending,
      pointWallets,
    },
  });
}
