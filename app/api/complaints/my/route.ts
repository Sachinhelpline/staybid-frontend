// GET /api/complaints/my
//   Returns the signed-in customer's complaint history. Used by the
//   /complaints page so users can see what they've raised + admin
//   status updates.
// Auth: Bearer sb_token
import { NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export async function GET(req: Request) {
  const u = userFromReq(req);
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = `complaints?customerId=eq.${encodeURIComponent(u.id)}&select=*&order=createdAt.desc&limit=100`;
  const res = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: SB_READ, cache: "no-store" });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ complaints: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 });
}
