import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function GET() {
  const res = await fetch(
    `${SB_URL}/rest/v1/vp_requests?select=*&status=eq.pending&order=createdAt.desc`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ pending: data, total: data.length });
}
