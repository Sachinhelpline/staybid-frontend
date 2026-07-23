import { NextRequest, NextResponse } from "next/server";
import { sbInsert, genId } from "@/lib/sb-server";
import { socialUserFromReq } from "@/lib/social/auth-helper";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/report
//
// "Report this reel" files a real content report here (was a dead button) so
// admin/ops can review it under /admin/content · /admin/fraud. Auth is OPTIONAL
// (a logged-out browser can still report); we attach the reporter when a token
// is present. Reason is clamped to a known enum.
// ─────────────────────────────────────────────────────────────────────────────
const REASONS = new Set(["spam", "inappropriate", "misleading", "offplatform", "other"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const postId = body?.postId ? String(body.postId).slice(0, 200) : null;
    const hotelId = body?.hotelId ? String(body.hotelId).slice(0, 200) : null;
    if (!postId && !hotelId) {
      return NextResponse.json({ ok: false, error: "no_target" }, { status: 400 });
    }
    const reason = REASONS.has(String(body?.reason)) ? String(body.reason) : "other";
    const user = socialUserFromReq(req);

    await sbInsert("content_reports", {
      id: genId("crpt"),
      post_id: postId,
      hotel_id: hotelId,
      hotel_name: body?.hotelName ? String(body.hotelName).slice(0, 200) : null,
      author_handle: body?.authorHandle ? String(body.authorHandle).slice(0, 120) : null,
      reporter_id: user?.id || null,
      reason,
      note: body?.note ? String(body.note).slice(0, 500) : null,
      surface: body?.surface ? String(body.surface).slice(0, 40) : "reel",
      status: "open",
    });
    return NextResponse.json({ ok: true });
  } catch {
    // Best-effort — never surface an error to the reporter UI.
    return NextResponse.json({ ok: true });
  }
}
