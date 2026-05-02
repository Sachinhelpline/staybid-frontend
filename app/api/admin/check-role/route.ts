import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

// Look up the user's role in Supabase directly by phone number.
// Tries both `+91XXXXXXXXXX` and `XXXXXXXXXX` variants because the
// `users` table sometimes has duplicates from different signup paths.
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ ok: false, error: "phone required" }, { status: 400 });

    const norm = String(phone).replace(/\D/g, "").slice(-10); // last 10 digits
    const variants = [`+91${norm}`, norm];

    // PostgREST "in" filter: phone=in.("+918881555188","8881555188")
    const inList = variants.map((v) => `"${v}"`).join(",");
    const url = `${SB_URL}/rest/v1/users?select=id,phone,role,name,email&phone=in.(${encodeURIComponent(inList)})`;

    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const rows = (await res.json().catch(() => [])) as any[];

    // Pick the row with the highest role (super_admin > admin > anything else)
    const order: Record<string, number> = { super_admin: 3, admin: 2, agent: 1, customer: 0 };
    const best = (Array.isArray(rows) ? rows : []).sort(
      (a, b) => (order[b?.role] ?? -1) - (order[a?.role] ?? -1)
    )[0];

    if (!best) {
      return NextResponse.json({
        ok: false,
        error: `No user found in Supabase with phone matching ${variants.join(" or ")}`,
        variants,
      });
    }

    const isAdmin = best.role === "admin" || best.role === "super_admin";
    return NextResponse.json({
      ok: isAdmin,
      role: best.role,
      user: best,
      error: isAdmin
        ? null
        : `Your role is "${best.role || "customer"}". Run in Supabase: UPDATE users SET role='super_admin' WHERE phone='${best.phone}';`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
