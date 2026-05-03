import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

async function resolveInfluencerId(idOrUserId: string): Promise<{ id: string; user_id: string } | null> {
  const a = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(idOrUserId)}&select=id,user_id`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  if (Array.isArray(a) && a[0]) return a[0];
  const b = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(idOrUserId)}&select=id,user_id`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  return Array.isArray(b) && b[0] ? b[0] : null;
}

// Generate a short, mostly-unambiguous referral code (~7 chars).
function genCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 7; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const inf = await resolveInfluencerId(params.id);
  if (!inf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const codes = await fetch(
    `${SB_URL}/rest/v1/influencer_referral_codes?influencer_id=eq.${encodeURIComponent(inf.id)}&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  return NextResponse.json({ codes: Array.isArray(codes) ? codes : [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inf = await resolveInfluencerId(params.id);
  if (!inf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (inf.user_id !== u.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  let code = (body?.code ? String(body.code).trim() : genCode()).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (code.length < 4) code = genCode();

  // Avoid collision (best-effort — UNIQUE constraint is the source of truth)
  for (let i = 0; i < 5; i++) {
    const dupe = await fetch(`${SB_URL}/rest/v1/influencer_referral_codes?code=eq.${encodeURIComponent(code)}&select=id`, { headers: SB_READ })
      .then(r => r.json()).catch(() => []);
    if (Array.isArray(dupe) && dupe.length === 0) break;
    code = genCode();
  }

  const ins = await fetch(`${SB_URL}/rest/v1/influencer_referral_codes`, {
    method: "POST", headers: SB_H,
    body: JSON.stringify({
      influencer_id: inf.id, code,
      hotel_id: body.hotelId || null, label: body.label || null,
    }),
  });
  if (!ins.ok) return NextResponse.json({ error: "Insert failed", detail: await ins.text() }, { status: 500 });
  const created = await ins.json().catch(() => null);
  return NextResponse.json({ code: Array.isArray(created) ? created[0] : created, created: true });
}
