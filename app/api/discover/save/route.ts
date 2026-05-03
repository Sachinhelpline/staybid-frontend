import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

const ALLOWED = new Set(["hotel", "video", "influencer", "deal"]);

export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const target_type = String(body?.targetType || "").trim();
  const target_id   = String(body?.targetId || "").trim();
  if (!target_id || !ALLOWED.has(target_type)) {
    return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  }
  const ins = await fetch(`${SB_URL}/rest/v1/user_saves`, {
    method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: u.id, target_type, target_id }),
  });
  if (!ins.ok) return NextResponse.json({ error: "Save failed", detail: await ins.text() }, { status: 500 });
  const row = await ins.json().catch(() => null);
  return NextResponse.json({ save: Array.isArray(row) ? row[0] : row, saved: true });
}

export async function DELETE(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const target_type = String(body?.targetType || "").trim();
  const target_id   = String(body?.targetId || "").trim();
  if (!target_id || !ALLOWED.has(target_type)) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  const del = await fetch(
    `${SB_URL}/rest/v1/user_saves?user_id=eq.${encodeURIComponent(u.id)}&target_type=eq.${encodeURIComponent(target_type)}&target_id=eq.${encodeURIComponent(target_id)}`,
    { method: "DELETE", headers: SB_H }
  );
  if (!del.ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  return NextResponse.json({ unsaved: true });
}
