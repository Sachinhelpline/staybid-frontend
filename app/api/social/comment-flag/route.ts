import { NextRequest, NextResponse } from "next/server";
import { sbInsert, genId } from "@/lib/sb-server";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { sanitizeText } from "@/lib/sanitize-text";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/social/comment-flag
//
// Fired (best-effort, fire-and-forget) by the reel comment box when a comment
// trips the anti-bypass sanitizer (contact info). Records the attempt in
// `comment_flags` so admin/ops can review repeat offenders. The comment itself
// is ALWAYS masked client-side regardless of whether this call succeeds — this
// is the audit/alert trail, not the block itself.
//
// Auth is OPTIONAL (a comment box may run for a logged-out browser); we attach
// the author when a token is present. The server RE-RUNS the sanitizer on the
// raw text (never trusts the client's masked/reasons) so the stored record is
// authoritative and tamper-safe.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawText = String(body?.rawText || "").slice(0, 2000);
    if (!rawText.trim()) {
      return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
    }

    // Server-authoritative sanitize — do NOT trust client-provided masked/reasons.
    const { clean, blocked, reasons } = sanitizeText(rawText);
    if (!blocked) {
      // Nothing contact-like actually present — no flag needed.
      return NextResponse.json({ ok: true, flagged: false });
    }

    const user = socialUserFromReq(req);
    const row = {
      id: genId("cflag"),
      hotel_id: body?.hotelId ? String(body.hotelId).slice(0, 200) : null,
      hotel_name: body?.hotelName ? String(body.hotelName).slice(0, 200) : null,
      author_id: user?.id || null,
      author_name: user?.name || (body?.authorName ? String(body.authorName).slice(0, 120) : null),
      raw_text: rawText,
      masked_text: clean,
      reasons,
      surface: body?.surface ? String(body.surface).slice(0, 40) : "reel_comment",
      status: "open",
    };

    await sbInsert("comment_flags", row);
    return NextResponse.json({ ok: true, flagged: true, reasons });
  } catch {
    // Never surface an error to the UI — the block already happened client-side.
    return NextResponse.json({ ok: true, flagged: false });
  }
}
