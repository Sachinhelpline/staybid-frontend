import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";


const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [config, team] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/platform_config?select=*&limit=1`, { headers: H }).then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/users?select=id,name,phone,email,role,createdAt&role=in.(admin,super_admin,agent)`, { headers: H }).then((r) =>
      r.ok ? r.json() : []
    ),
  ]);
  return NextResponse.json({ config: (config as any[])[0] || {}, team });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const res = await fetch(`${SB_URL}/rest/v1/platform_config?id=not.is.null`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify(body),
  });
  return NextResponse.json({ ok: res.ok });
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Promote/demote team member: { userId, role: "admin"|"agent"|"customer" }
  const { userId, role } = await req.json();
  if (!userId || !role) return NextResponse.json({ error: "userId and role required" }, { status: 400 });
  const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ role }),
  });
  return NextResponse.json({ ok: res.ok });
}
