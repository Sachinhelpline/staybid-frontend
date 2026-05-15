// v126.3 — vp_videos uses created_at (not uploadedAt). Previous version
// queried order=uploadedAt.desc → PostgREST 42703 → empty response.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET() {
  const res = await fetch(
    `${SB_URL}/rest/v1/vp_videos?select=*&order=created_at.desc&limit=200`,
    { headers: SB_H },
  );
  const list = res.ok ? await res.json() : [];
  // Back-compat: add `uploadedAt` alias for any UI consumer.
  const enriched = (Array.isArray(list) ? list : []).map((v: any) => ({
    ...v,
    uploadedAt: v.created_at,
  }));
  return NextResponse.json({ videos: enriched, total: enriched.length });
}
