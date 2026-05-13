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

// v104.5 — fix /admin/users showing 0 users.
// Route was selecting `totalSpend` + `status` columns that don't exist on
// the actual users table (real columns: id, email, name, phone, role,
// avatarUrl, createdAt, isBlocked, updatedAt, password, tier,
// tier_updated_at). PostgREST returned 400 + 42703 for the whole SELECT
// → sb() helper returned [] → page showed 0 users. Pre-existing bug
// surfaced only now because nobody opened /admin/users in production.
//
// Fix: select only real columns; map `isBlocked` → virtual `status`
// pill in the response so the existing UI continues to work.
//   isBlocked = true  → status = "banned"
//   isBlocked = false → status = "active"
// `totalSpend` is derived from bookings — for now we ship 0 and a
// future pass can compute it from public.bookings or wallets.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tier = searchParams.get("tier");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let query = `users?select=id,phone,name,email,tier,role,"isBlocked","createdAt"&order=%22createdAt%22.desc&limit=200`;
  if (tier && tier !== "all") query += `&tier=eq.${tier}`;
  if (status && status !== "all") {
    if (status === "banned")        query += `&"isBlocked"=eq.true`;
    else if (status === "active")   query += `&"isBlocked"=eq.false`;
    // "suspended" has no equivalent column → ignore filter
  }

  try {
    const raw = (await sb(query)) as any[];
    let users = raw.map((u) => ({
      id:         u.id,
      phone:      u.phone,
      name:       u.name,
      email:      u.email,
      tier:       u.tier || "silver",
      role:       u.role || "customer",
      status:     u.isBlocked ? "banned" : "active",   // virtual status
      totalSpend: 0,                                   // TODO: derive from bookings/wallets
      createdAt:  u.createdAt,
    }));
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
    if (action === "tier") {
      update = { tier: value };
    } else if (action === "status") {
      // v104.5 — map virtual status → real isBlocked column
      if (value === "banned")        update = { isBlocked: true };
      else if (value === "active")   update = { isBlocked: false };
      else if (value === "suspended") update = { isBlocked: true };  // best-effort: treat as banned
      else return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

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
