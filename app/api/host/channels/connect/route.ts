import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { HOST_CHANNELS } from "@/lib/host/modules";

export const dynamic = "force-dynamic";

const VALID = new Set(HOST_CHANNELS.map((c) => c.key));

// POST /api/host/channels/connect — a host requests to connect a listing to an OTA.
// Body: { channel, name, phone, propertyRef?, listingUrl?, message? }
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const channel = String(body?.channel || "").trim();
  const name = String(body?.name || "").trim().slice(0, 120);
  const phone = String(body?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!VALID.has(channel as any)) {
    return NextResponse.json({ error: "Pick a valid channel." }, { status: 400 });
  }
  if (!name || phone.length < 8) {
    return NextResponse.json({ error: "Name and a valid phone are required." }, { status: 400 });
  }

  const user = userFromReq(req);
  const row = {
    user_id: user?.id || null,
    channel,
    property_ref: String(body?.propertyRef || "").trim().slice(0, 200) || null,
    listing_url: String(body?.listingUrl || "").trim().slice(0, 500) || null,
    contact: { name, phone },
    notes: String(body?.message || "").trim().slice(0, 1000) || null,
    status: "requested",
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/host_channels`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save request", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    return NextResponse.json({ ok: true, id: saved?.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Network error", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
