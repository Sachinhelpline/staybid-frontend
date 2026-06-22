import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

// POST /api/host/properties/inquiry — a host expresses interest in a property.
// Body: { propertyId, name, phone, message? }
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const propertyId = String(body?.propertyId || "").trim();
  const name = String(body?.name || "").trim().slice(0, 120);
  const phone = String(body?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!propertyId || !name || phone.length < 8) {
    return NextResponse.json({ error: "Property, name and a valid phone are required." }, { status: 400 });
  }

  const user = userFromReq(req);
  const row = {
    property_id: propertyId,
    user_id: user?.id || null,
    name,
    phone,
    message: String(body?.message || "").trim().slice(0, 1000) || null,
    status: "new",
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/discovery_inquiries`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save inquiry", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    return NextResponse.json({ ok: true, id: saved?.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Network error", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
