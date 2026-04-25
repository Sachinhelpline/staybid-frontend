import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/verify/one?id=<vp_requests.id>
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const rows = await sbSelect<any>("vp_requests", `id=eq.${id}&limit=1`);
  return NextResponse.json({ request: rows[0] || null });
}
