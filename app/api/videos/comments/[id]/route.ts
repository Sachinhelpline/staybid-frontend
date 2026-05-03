import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

// GET  — list comments for video
// POST — add comment
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = `${SB_URL}/rest/v1/video_comments?video_id=eq.${encodeURIComponent(params.id)}&order=created_at.asc&limit=100`;
  const res = await fetch(url, { headers: SB_READ });
  const comments = await res.json().catch(() => []);
  return NextResponse.json({ comments: Array.isArray(comments) ? comments : [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.body?.trim()) return NextResponse.json({ error: "Comment body required" }, { status: 400 });

  const row = {
    video_id:  params.id,
    user_id:   user.id,
    body:      String(body.body).slice(0, 500),
    parent_id: body.parentId || null,
  };

  const ins = await fetch(`${SB_URL}/rest/v1/video_comments`, {
    method: "POST",
    headers: SB_H,
    body: JSON.stringify(row),
  });
  if (!ins.ok) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  const created = await ins.json().catch(() => null);
  return NextResponse.json({ comment: Array.isArray(created) ? created[0] : created });
}

// DELETE — remove own comment
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const commentId = body.commentId;
  if (!commentId) return NextResponse.json({ error: "commentId required" }, { status: 400 });

  await fetch(
    `${SB_URL}/rest/v1/video_comments?id=eq.${encodeURIComponent(commentId)}&user_id=eq.${encodeURIComponent(user.id)}`,
    { method: "DELETE", headers: SB_H }
  );
  return NextResponse.json({ deleted: true });
}
