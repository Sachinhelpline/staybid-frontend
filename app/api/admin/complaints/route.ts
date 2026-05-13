import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";



export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  let q = "complaints?select=*&order=createdAt.desc&limit=200";
  if (type && type !== "all") q += `&type=eq.${type}`;
  if (status && status !== "all") q += `&status=eq.${status}`;
  const res = await fetch(`${SB_URL}/rest/v1/${q}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ complaints: data, total: data.length });
}
