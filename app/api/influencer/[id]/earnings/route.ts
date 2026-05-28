import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function resolveInfluencerId(id: string): Promise<string | null> {
  const a = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(id)}&select=id`, { headers: SB_H }).then(r => r.json()).catch(() => []);
  if (Array.isArray(a) && a[0]) return a[0].id;
  const b = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(id)}&select=id`, { headers: SB_H }).then(r => r.json()).catch(() => []);
  return Array.isArray(b) && b[0] ? b[0].id : null;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const infId = await resolveInfluencerId(params.id);
  if (!infId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const status = req.nextUrl.searchParams.get("status");
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : "";

  const rows = await fetch(
    `${SB_URL}/rest/v1/influencer_commissions?influencer_id=eq.${infId}${filter}&select=*&order=created_at.desc&limit=200`,
    { headers: SB_H }
  ).then(r => r.json()).catch(() => []);
  const list: any[] = Array.isArray(rows) ? rows : [];

  const totals = {
    pending: list.filter(c => c.status === "pending").reduce((s, c) => s + Number(c.commission_amount || 0), 0),
    paid:    list.filter(c => c.status === "paid").reduce((s, c) => s + Number(c.commission_amount || 0), 0),
    total:   list.reduce((s, c) => s + Number(c.commission_amount || 0), 0),
  };

  return NextResponse.json({ commissions: list, totals });
}
