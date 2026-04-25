import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbSelect } from "@/lib/onboard/supabase-admin";

export async function GET(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const rows = await sbSelect<any>("onboarding_users", `id=eq.${claims.sub}&limit=1`);
    const u = rows[0];
    if (!u) return NextResponse.json({ error: "user gone" }, { status: 404 });
    return NextResponse.json({
      user: {
        id: u.id, email: u.email, phone: u.phone, name: u.name, role: u.role,
        emailVerified: !!u.email_verified, phoneVerified: !!u.phone_verified,
        agentCode: u.agent_code,
      },
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
