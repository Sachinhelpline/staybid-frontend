// POST /api/partner/content/[id]
// v160 — hotel partner "report" action on a PUBLISHED guest post.
// Body: { action: "report", reason }
//
// The hotel no longer approves/rejects guest content (booking ID is the
// proof — guest posts publish directly). The only thing a partner can do is
// REPORT an abusive post: that escalates it to admin
// (moderation_status='PENDING_ADMIN_REVIEW'), which immediately removes it
// from the public feed pending admin review. The hotel cannot block a
// publish on its own — it can only flag for admin.
//
// Auth: x-partner-token. Authorization: partner must own the hotel the
// post is tagged to. Only acts when the post is currently published
// (AUTO_APPROVED | APPROVED); other states return 409.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { resolveUserIds } from "@/lib/sb-server";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

function decodeJwt(t: string): any {
  try {
    return JSON.parse(
      Buffer.from(
        t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString()
    );
  } catch {
    return null;
  }
}

const VALID_ACTIONS = new Set(["report"]);
const PUBLISHED = new Set(["AUTO_APPROVED", "APPROVED"]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const tok = req.headers.get("x-partner-token") || "";
  if (!tok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = decodeJwt(tok);
  if (!payload?.id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !VALID_ACTIONS.has(body.action)) {
    return NextResponse.json(
      { error: "action must be report" },
      { status: 400 }
    );
  }
  if (!body.reason || !String(body.reason).trim()) {
    return NextResponse.json(
      { error: "reason required to report content" },
      { status: 400 }
    );
  }

  // Fetch the post and verify partner owns the hotel
  const pr = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(params.id)}&select=id,hotel_id,author_id,moderation_status&limit=1`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!pr.ok) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  const posts = (await pr.json().catch(() => [])) as any[];
  const post = posts[0];
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Verify hotel ownership across the user's dual-id space
  const ownerIds = await resolveUserIds(payload.id, payload.phone);
  const inOwners = ownerIds.map(encodeURIComponent).join(",");
  const hr = await fetch(
    `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(post.hotel_id)}&ownerId=in.(${inOwners})&select=id,name,ownerId&limit=1`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  const hotels = (hr.ok ? await hr.json().catch(() => []) : []) as any[];
  if (!hotels[0]) {
    return NextResponse.json(
      { error: "Forbidden — you don't own this hotel" },
      { status: 403 }
    );
  }
  const hotel = hotels[0];

  // Guard: only report a currently-published post. Already-reported posts
  // (PENDING_ADMIN_REVIEW) or removed ones return 409 — no double report.
  if (!PUBLISHED.has(post.moderation_status)) {
    return NextResponse.json(
      {
        error: `Post can't be reported (current: ${post.moderation_status})`,
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const patch = {
    moderation_status: "PENDING_ADMIN_REVIEW",
    escalated_to_admin_at: now,
    escalated_by: payload.id,
  };

  const upd = await fetch(
    `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(params.id)}`,
    { method: "PATCH", headers: HEADERS, body: JSON.stringify(patch) }
  );
  if (!upd.ok) {
    return NextResponse.json(
      { error: "Update failed", detail: await upd.text() },
      { status: 500 }
    );
  }
  const updated = ((await upd.json().catch(() => [])) as any[])[0];

  // Notify ADMIN — the post is now off the public feed pending admin review.
  // Routed to the user_id='ADMIN' sentinel that /admin/content listens for.
  try {
    await fetch(`${SB_URL}/rest/v1/notification_queue`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify([
        {
          user_id: "ADMIN",
          channel: "in_app",
          template: "content_reported_by_hotel",
          payload: {
            post_id: post.id,
            hotel_name: hotel.name,
            reported_by: payload.id,
            reason: String(body.reason).slice(0, 500),
          },
          status: "pending",
        },
      ]),
    });
  } catch {}

  return NextResponse.json({ post: updated, action: "report" });
}
