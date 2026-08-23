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
  const raw: any[] = res.ok ? await res.json() : [];
  const data = raw.map((log: any) => ({
    ...log,
    details: log.details == null
      ? null
      : typeof log.details === "string"
        ? log.details
        : JSON.stringify(log.details),
  }));
  return NextResponse.json({ logs: data, total: data.length });
}
