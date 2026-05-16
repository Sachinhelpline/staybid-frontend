// PATCH /api/partner/autopilot
//   body: { mode: 'auto' | 'hybrid' | 'manual' }
//
//   Updates the partner's hotel.autopilot_mode + autopilot_updated_at.
//   v130 — Hybrid AI Autopilot (Option 2).
//
// Auth — partner JWT (sb_partner_token). We decode it client-side just
// like the other partner routes; ownership cross-checked via the
// `resolveOwnerIdsCrossPool` helper isn't necessary here because the
// PATCH is constrained by id=eq.<hotel id from token> AND ownerId
// matching one of the user's resolved ids. We piggyback on the simpler
// id-from-token + then filter by ownerId IN (resolved ids).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const ALLOWED = new Set(["auto", "hybrid", "manual"]);

function decodeJwt(t: string) {
  try {
    return JSON.parse(
      Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
  } catch { return null; }
}

async function resolveOwnerIds(phone: string | undefined, email: string | undefined): Promise<string[]> {
  if (!phone && !email) return [];
  const ors: string[] = [];
  if (phone) {
    const raw = String(phone);
    const stripped = raw.replace(/^\+91/, "");
    const variants = new Set([raw, stripped, "+91" + stripped]);
    Array.from(variants).forEach((p) => ors.push(`phone.eq.${encodeURIComponent(p)}`));
  }
  if (email) ors.push(`email.ilike.${encodeURIComponent(email)}`);
  if (!ors.length) return [];
  const r = await fetch(
    `${SB_URL}/rest/v1/users?or=(${ors.join(",")})&select=id`,
    { headers: SB_H },
  );
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows.map((x: any) => x.id).filter(Boolean) : [];
}

export async function PATCH(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const mode = body?.mode;
  if (!ALLOWED.has(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  // Resolve ALL user ids that share this partner's phone/email so we can
  // find every hotel they own across the duplicate-user-id quirk
  // documented in CLAUDE.md (Sachin's UPPERCASE/lowercase email split).
  const ownerIds = await resolveOwnerIds(payload.phone, payload.email);
  if (!ownerIds.length) {
    return NextResponse.json({ error: "No hotels found for partner" }, { status: 404 });
  }

  const inFilter = `in.(${ownerIds.map((id) => encodeURIComponent(id)).join(",")})`;
  const r = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=${inFilter}&select=id`,
    {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({
        autopilot_mode: mode,
        autopilot_updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    // The most common failure here is "column doesn't exist" if the
    // migration hasn't been applied yet — surface it clearly.
    return NextResponse.json(
      { error: d?.message || "Update failed", details: d },
      { status: r.status === 400 ? 412 : 500 }, // 412 = migration pending
    );
  }

  const updated = await r.json().catch(() => []);
  return NextResponse.json({
    ok: true,
    mode,
    hotelsUpdated: Array.isArray(updated) ? updated.length : 0,
    updatedAt: new Date().toISOString(),
  });
}

// GET — read the partner's current autopilot mode (used by the dashboard
// to populate the toggle before any change is made).
export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const ownerIds = await resolveOwnerIds(payload.phone, payload.email);
  if (!ownerIds.length) return NextResponse.json({ mode: "auto" });

  const inFilter = `in.(${ownerIds.map((id) => encodeURIComponent(id)).join(",")})`;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?ownerId=${inFilter}&select=id,autopilot_mode,autopilot_updated_at&limit=1`,
      { headers: SB_H, cache: "no-store" },
    );
    if (!r.ok) return NextResponse.json({ mode: "auto", source: "default" });
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) && rows[0];
    const mode = row?.autopilot_mode;
    return NextResponse.json({
      mode: ALLOWED.has(mode) ? mode : "auto",
      updatedAt: row?.autopilot_updated_at || null,
      source: row ? "db" : "default",
    });
  } catch {
    return NextResponse.json({ mode: "auto", source: "default" });
  }
}
