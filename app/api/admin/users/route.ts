import { NextRequest, NextResponse } from "next/server";
import { logAdminAction, adminFromReq } from "@/lib/admin/audit";
import { SB_URL, SB_KEY } from "@/lib/sb";



async function sb(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tier = searchParams.get("tier");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let query = "users?select=id,phone,name,email,tier,totalSpend,role,status,createdAt&order=createdAt.desc&limit=200";
  if (tier && tier !== "all") query += `&tier=eq.${tier}`;
  if (status && status !== "all") query += `&status=eq.${status}`;

  try {
    let users = (await sb(query)) as any[];
    if (search) {
      const s = search.toLowerCase();
      users = users.filter(
        (u) =>
          u.phone?.includes(s) ||
          u.name?.toLowerCase().includes(s) ||
          u.email?.toLowerCase().includes(s)
      );
    }
    return NextResponse.json({ users, total: users.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { userId, action, value } = await req.json();
  const SB_SERVICE = SB_KEY;

  try {
    let update: Record<string, unknown> = {};
    if (action === "tier") update = { tier: value };
    else if (action === "status") update = { status: value };
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: {
        apikey: SB_SERVICE,
        Authorization: `Bearer ${SB_SERVICE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(update),
    });
    const data = await res.json();

    // v98 — record audit trail (fire-and-forget)
    logAdminAction({
      admin: adminFromReq(req),
      action: `user.${action}`,
      targetType: "user",
      targetId: userId,
      details: { value },
    });

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
