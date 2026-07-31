import { NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(
    `${SB_URL}/rest/v1/admin_action_logs?select=*&order=timestamp.desc&limit=200`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ logs: data, total: data.length });
}
