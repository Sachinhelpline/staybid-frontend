import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

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
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
