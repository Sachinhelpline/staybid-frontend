import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

const INTERESTS = ["list", "store", "workforce", "discovery", "studio", "channels", "general"];

// POST /api/host/lead — capture a host-interest lead from the /host landing CTAs.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const name = String(body?.name || "").trim().slice(0, 120);
  const phone = String(body?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!name || phone.length < 8) {
    return NextResponse.json({ error: "Name and a valid phone are required." }, { status: 400 });
  }

  const rawInterest = String(body?.interest || "").trim().slice(0, 40);
  const interest = INTERESTS.includes(rawInterest) ? rawInterest : "general";
  const tier = String(body?.tier || "").trim().slice(0, 40) || null;
  const user = userFromReq(req);

  const row = {
    user_id: user?.id || null,
    name,
    phone,
    email: String(body?.email || "").trim().slice(0, 160) || null,
    city: String(body?.city || "").trim().slice(0, 80) || null,
    interest,
    message: String(body?.message || "").trim().slice(0, 1000) || null,
    status: "new",
    metadata: {
      source: "host_landing",
      raw_interest: rawInterest || null,   // e.g. "invest" (budget-tier application)
      tier,                                // e.g. "Adventurer"
      ua: req.headers.get("user-agent")?.slice(0, 200) || null,
    },
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/host_leads`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save lead", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    return NextResponse.json({ ok: true, id: saved?.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Network error", detail: String(e?.message || e).slice(0, 200) }, { status: 502 });
  }
}
