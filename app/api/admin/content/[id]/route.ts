// POST /api/admin/content/[id]
// Admin action on a PENDING_ADMIN_REVIEW or FLAGGED post.
// Body: { action: "approve" | "reject" | "flag" | "unflag" | "delete",
//         notes?, reason? }
//
// Auth: x-admin-token. Identity logged via logAdminAction every mutation.
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { logAdminAction } from "@/lib/admin/audit";
import { queueNotification } from "@/lib/notify-server";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const VALID_ACTIONS = new Set([
  "approve",
  "reject",
  "flag",
  "unflag",
  "delete",
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = await props.params;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !VALID_ACTIONS.has(body.action)) {
    return NextResponse.json(
      {
        error:
          "action must be approve | reject | flag | unflag | delete",
      },
      { status: 400 }
    );
  }
  if (body.action === "reject" && !body.reason) {
    return NextResponse.json(
      { error: "reason required for reject" },
      { status: 400 }
    );
  }

  // Fetch the post
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

  const now = new Date().toISOString();
  let patch: Record<string, any> = {};
  let template = "";
  const auditNotes: Record<string, any> = {
    reason: body.reason || null,
    notes: body.notes || null,
    previous_status: post.moderation_status,
  };

  if (body.action === "approve") {
    // Allowed from PENDING_ADMIN_REVIEW or FLAGGED
    patch = {
      moderation_status: "APPROVED",
      admin_reviewed_at: now,
      admin_reviewed_by: admin.id || null,
      admin_review_decision: "approve",
      admin_review_notes: body.notes || null,
    };
    template = "content_approved";
  } else if (body.action === "reject") {
    patch = {
      moderation_status: "REJECTED",
      admin_reviewed_at: now,
      admin_reviewed_by: admin.id || null,
      admin_review_decision: "reject",
      admin_review_notes: body.notes || null,
      rejection_reason: String(body.reason).slice(0, 500),
    };
    template = "content_rejected";
  } else if (body.action === "flag") {
    patch = { moderation_status: "FLAGGED" };
    template = "content_flagged";
  } else if (body.action === "unflag") {
    patch = { moderation_status: "APPROVED" };
    template = "content_approved";
  } else if (body.action === "delete") {
    patch = { moderation_status: "DELETED" };
    template = "content_deleted";
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

  // Audit log
  logAdminAction({
    admin,
    action: `content.${body.action}`,
    targetType: "social_post",
    targetId: post.id,
    details: auditNotes,
  });

  // Notify the author
  try {
    const apr = await fetch(
      `${SB_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(post.author_id)}&select=user_id&limit=1`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    const auth = ((await apr.json().catch(() => [])) as any[])[0];
    if (auth?.user_id) {
      // Fans out to enabled channels (in_app now; +sms/+whatsapp when the
      // paid-plan flag flips — no change here). See lib/notify-server.
      void queueNotification({
        userId: auth.user_id,
        template,
        payload: { post_id: post.id, reason: body.reason || null, by: "admin" },
      });
    }
  } catch {}

  return NextResponse.json({ post: updated, action: body.action });
}
