import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ influencer: null, registered: false });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ influencer: null, registered: false });

  const rows = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(payload.id)}&select=*`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  const inf = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return NextResponse.json({ influencer: inf, registered: !!inf });
}
