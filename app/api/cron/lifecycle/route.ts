import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";

// GET /api/cron/lifecycle?token=$CRON_SECRET
// Periodic sweep of video_lifecycle. Run by Vercel Cron (added to vercel.json).
// Three actions per active row, decided by elapsed minutes since checkout:
//   • now+120m  → reminder_2h_sent  (push notification)
//   • now+210m  → reminder_35h_sent (push notification, more urgent)
//   • now>= expiry_time → status='deleted_after_timeout', delete vp_videos
//                          attached to this booking, lock complaint window
//
// Idempotent — never sends a reminder twice.
export const maxDuration = 60;

export async function GET(req: Request) {
  const tokenIn = new URL(req.url).searchParams.get("token") || req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "staybid-cron-dev";
  if (tokenIn !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const out: any = { reminded2h: 0, reminded35h: 0, expired: 0, errors: [] };
  const now = new Date();

  const active = await sbSelect<any>("video_lifecycle", `status=eq.active&limit=500`);

  for (const row of active) {
    try {
      const expiry = new Date(row.expiry_time);
      const elapsedMs = now.getTime() - new Date(row.created_at).getTime();
      const elapsedMin = elapsedMs / 60_000;

      // Reminder 1 — at 2 hours
      if (!row.reminder_2h_sent && elapsedMin >= 120) {
        await notify(row.customer_id, "feedback_reminder_2h",
          "2 hours left to share feedback",
          "Submit feedback to keep your verification video on file + earn StayPoints.",
          { bookingId: row.booking_id });
        await sbUpdate("video_lifecycle", `id=eq.${row.id}`, { reminder_2h_sent: true, updated_at: now.toISOString() });
        out.reminded2h++;
      }

      // Reminder 2 — at 3.5 hours
      if (!row.reminder_35h_sent && elapsedMin >= 210) {
        await notify(row.customer_id, "feedback_reminder_35h",
          "Only 30 minutes left!",
          "Your verification video will be deleted in 30 minutes if no feedback is submitted.",
          { bookingId: row.booking_id });
        await sbUpdate("video_lifecycle", `id=eq.${row.id}`, { reminder_35h_sent: true, updated_at: now.toISOString() });
        out.reminded35h++;
      }

      // Expiry → delete videos + lock window
      if (now >= expiry) {
        // Pull vp_videos for this booking and delete from storage + DB
        const videos = await sbSelect<any>("vp_videos", `booking_id=eq.${row.booking_id}&select=id,storage_path`);
        for (const v of videos) {
          if (v.storage_path) {
            try {
              await fetch(`${SB.url}/storage/v1/object/verification-videos/${v.storage_path}`, {
                method: "DELETE",
                headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` },
              });
            } catch { /* file may not exist */ }
          }
          try {
            await fetch(`${SB.url}/rest/v1/vp_videos?id=eq.${v.id}`, {
              method: "DELETE",
              headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` },
            });
          } catch {}
        }
        await sbUpdate("video_lifecycle", `id=eq.${row.id}`, { status: "deleted_after_timeout", updated_at: now.toISOString() });
        out.expired++;
      }
    } catch (e: any) {
      out.errors.push({ booking: row.booking_id, error: e?.message });
    }
  }

  return NextResponse.json(out);
}

async function notify(userId: string | null, type: string, title: string, body: string, meta: any) {
  if (!userId) return;
  try {
    await sbInsert("notifications", { userId, type, title, body, meta });
  } catch { /* schema may differ */ }
}
