import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET() {
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals?select=*&order=createdAt.desc&limit=200`, { headers: H });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ deals: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const data = res.ok ? await res.json() : null;
  return NextResponse.json({ ok: res.ok, deal: data?.[0] || null });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals?id=eq.${id}`, { method: "DELETE", headers: H });
  return NextResponse.json({ ok: res.ok });
}
