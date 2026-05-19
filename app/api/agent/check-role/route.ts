import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

// POST { phone } OR (after OTP verify) Bearer JWT in Authorization header
//
// MODE 1 — Bearer JWT verification (called after Railway OTP verify):
//   Reads the JWT user id, fetches role from Supabase. Allows roles:
//     admin · super_admin · support_agent
//   Returns ok + user object on success.
//
// MODE 2 — Phone-only check (used by the agent login form to pre-validate
//   before sending OTP; saves the user from receiving an OTP they can't use):
//   Body: { phone }. Resolves phone → user → checks role. Read-only.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const phone = String(body?.phone || "").trim();

    let user: any = null;

    // MODE 1 — Bearer JWT
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (auth) {
      const payload = decode(auth);
      if (payload?.id) {
        user = await fetchUser({ id: payload.id });
      }
    }

    // MODE 2 — phone lookup fallback
    if (!user && phone) {
      const norm = phone.replace(/\D/g, "").slice(-10);
      if (norm.length !== 10) {
        return NextResponse.json(
          { ok: false, error: "Enter a valid 10-digit phone number" },
          { status: 400 }
        );
      }
      user = await fetchUser({ phoneVariants: [`+91${norm}`, norm] });
    }

    if (!user) {
      return NextResponse.json({
        ok: false,
        error: "Account not found. Aapka phone number Supabase mein add hai?",
      });
    }

    const role = String(user.role || "").toLowerCase();
    const allowed = role === "admin" || role === "super_admin" || role === "support_agent";
    if (!allowed) {
      return NextResponse.json({
        ok: false,
        error: `Access denied. Aapka role "${role || "customer"}" hai. Run in Supabase: UPDATE users SET role='support_agent' WHERE id='${user.id}';`,
      });
    }

    return NextResponse.json({
      ok: true,
      role,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        role,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function decode(token: string): any {
  try {
    const p = token.split(".")[1];
    if (!p) return null;
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch {
    return null;
  }
}

async function fetchUser(query: { id?: string; phoneVariants?: string[] }): Promise<any | null> {
  // Highest-priority role wins when multiple rows match (common case:
  // same human has +91 variant AND no-prefix variant on different user
  // rows with different roles — see CLAUDE.md "Dual User ID Fix").
  const ROLE_RANK: Record<string, number> = {
    super_admin: 4,
    admin: 3,
    support_agent: 2,
    agent: 1,
  };

  let url = `${SB_URL}/rest/v1/users?select=id,phone,name,email,role`;
  if (query.id) {
    url += `&id=eq.${encodeURIComponent(query.id)}&limit=1`;
  } else if (query.phoneVariants && query.phoneVariants.length > 0) {
    const inList = query.phoneVariants.map((v) => `"${v}"`).join(",");
    url += `&phone=in.(${encodeURIComponent(inList)})&limit=10`;
  } else {
    return null;
  }
  const r = await fetch(url, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as any[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Pick row with highest agent-allowed role
  const sorted = rows.slice().sort((a, b) => {
    const ra = ROLE_RANK[String(a?.role || "").toLowerCase()] ?? -1;
    const rb = ROLE_RANK[String(b?.role || "").toLowerCase()] ?? -1;
    return rb - ra;
  });
  return sorted[0];
}
