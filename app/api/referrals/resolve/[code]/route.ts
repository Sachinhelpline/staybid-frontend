import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Public — used by the /r/[code] redirect handler to know where to send the
// click and which influencer to attribute. Returns null influencer if code
// doesn't exist (so the redirect still works as a graceful fallback).
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const rows = await fetch(
    `${SB_URL}/rest/v1/influencer_referral_codes?code=eq.${encodeURIComponent(params.code)}&active=eq.true&select=*`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  const code = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!code) return NextResponse.json({ code: null });

  const target = code.hotel_id
    ? { type: "hotel", url: `/hotels/${code.hotel_id}` }
    : { type: "home",  url: "/" };

  return NextResponse.json({
    code: { id: code.id, code: code.code, label: code.label, hotelId: code.hotel_id, influencerId: code.influencer_id },
    target,
  });
}
