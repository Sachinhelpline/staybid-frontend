import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/onboard/agent/verify?code=AGT-XXXX
export async function GET(req: Request) {
  try {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
    const rows = await sbSelect<any>(
      "agents",
      `agent_code=eq.${encodeURIComponent(code.trim())}&active=eq.true&limit=1`
    );
    const a = rows[0];
    if (!a) return NextResponse.json({ valid: false }, { status: 200 });
    return NextResponse.json({
      valid: true,
      agent: { code: a.agent_code, name: a.full_name, city: a.city },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "verify failed" }, { status: 500 });
  }
}
