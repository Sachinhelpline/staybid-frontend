import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = await props.params;
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  const payload = token ? decodeJwt(token) : null;
  const verifierId = payload?.id || "admin";

  const body = await req.json().catch(() => ({}));
  const reason = (body?.reason || "").toString().trim() || "Did not meet content guidelines";

  const upd = await fetch(`${SB_URL}/rest/v1/hotel_videos?id=eq.${encodeURIComponent(params.id)}`, {
    method: "PATCH", headers: SB_H,
    body: JSON.stringify({
      verification_status: "rejected",
      verified_by: verifierId,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!upd.ok) return NextResponse.json({ error: "Reject failed", detail: await upd.text() }, { status: 500 });
  const row = await upd.json().catch(() => []);
  return NextResponse.json({ video: Array.isArray(row) ? row[0] : row, rejected: true });
}
