// POST /api/partner/content/[id]
// Hotel partner action on a pending social_posts row.
// Body: { action: "approve" | "reject" | "escalate", reason?, notes? }
//
// Auth: x-partner-token. Authorization: partner must own the hotel the
// post is tagged to. Only acts when moderation_status='PENDING_HOTEL_APPROVAL';
// other states return 409.
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

const VALID_ACTIONS = new Set(["approve", "reject", "escalate"]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
      { error: "action must be approve | reject | escalate" },
      { status: 400 }
    );
  }
  if (body.action === "reject" && !body.reason) {
    return NextResponse.json(
      { error: "reason required for reject" },
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

  // Guard: only act on a still-pending post
  if (post.moderation_status !== "PENDING_HOTEL_APPROVAL") {
    return NextResponse.json(
      {
        error: `Post is no longer pending (current: ${post.moderation_status})`,
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  let patch: Record<string, any> = {};
  let template = "";
  let notifyAuthor = true;

  if (body.action === "approve") {
    patch = {
      moderation_status: "APPROVED",
      approved_at: now,
      approved_by: payload.id,
    };
    template = "content_approved";
  } else if (body.action === "reject") {
    patch = {
      moderation_status: "REJECTED",
      rejected_at: now,
      rejected_by: payload.id,
      rejection_reason: String(body.reason).slice(0, 500),
    };
    template = "content_rejected";
  } else if (body.action === "escalate") {
    patch = {
      moderation_status: "PENDING_ADMIN_REVIEW",
      escalated_to_admin_at: now,
      escalated_by: payload.id,
    };
    // Don't notify the author on escalation — they still see the post as pending
    notifyAuthor = false;
    template = "content_escalated_to_admin";
  }

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

  // Notify author (or admins for escalation)
  try {
    if (notifyAuthor) {
      // social_posts.author_id → social_profiles.id → social_profiles.user_id
      const apr = await fetch(
        `${SB_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(post.author_id)}&select=user_id&limit=1`,
        { headers: READ_HEADERS, cache: "no-store" }
      );
      const auth = ((await apr.json().catch(() => [])) as any[])[0];
      if (auth?.user_id) {
        await fetch(`${SB_URL}/rest/v1/notification_queue`, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify([
            {
              user_id: auth.user_id,
              channel: "in_app",
              template,
              payload: {
                post_id: post.id,
                hotel_name: hotel.name,
                reason: body.reason || null,
              },
              status: "pending",
            },
          ]),
        });
      }
    } else {
      // Escalation — notify admins so they see the queue. Admin user list is
      // not known here; Phase 6 admin notification preferences will refine
      // this. For now, we INSERT a row keyed to a sentinel user_id='ADMIN'
      // that the admin panel can listen for, plus log to audit later.
      await fetch(`${SB_URL}/rest/v1/notification_queue`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify([
          {
            user_id: "ADMIN",
            channel: "in_app",
            template,
            payload: {
              post_id: post.id,
              hotel_name: hotel.name,
              escalated_by: payload.id,
              notes: body.notes || null,
            },
            status: "pending",
          },
        ]),
      });
    }
  } catch {}

  return NextResponse.json({ post: updated, action: body.action });
}
