import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { requireVerifiedAdmin } from "@/lib/admin/verify";



export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(
    `${SB_URL}/rest/v1/feedback_tracking?select=*&submitted=eq.true&order=submittedAt.desc&limit=200`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ feedback: data, total: data.length });
}
