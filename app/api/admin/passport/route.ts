// /api/admin/passport — admin config/issue/adjust for the Explorer Passport
// (Phase 2c, v267).
//
//   GET                       → search profiles (explorer_id / display_name
//                               ilike), each enriched with the owner's users
//                               row (phone / name).
//   GET ?userId= / ?explorerId= → single profile + its persisted stamps.
//   POST { action }           → admin mutations, all audit-logged:
//       grant_stamp  { userId, city?, hotelName?, stayDate? }
//       remove_stamp { userId, stampId }
//       set_bonus_xp { userId, bonusXp }
//
// The passport engine is deterministic (stamps → XP → rank), so an admin can
// only durably change a passport in two ways: (a) add/remove a real stamp row
// — which the derivation naturally counts — or (b) set the additive
// `passport_profiles.bonus_xp`, which /api/passport adds on top of the
// computed XP so it survives every recompute.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { regionForCity, rankForXp } from "@/lib/passport/engine";

export const dynamic = "force-dynamic";

const PROFILE_COLS =
  "user_id,explorer_id,display_name,member_since,xp,bonus_xp,rank_key,stamps_count,properties_visited,cities_visited,created_at,updated_at";

function genStampSourceId(): string {
  return `admin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Attach each profile's users-row (phone/name) without a PostgREST FK embed
// (no FK constraints exist in this schema — same pattern as /api/admin/creators).
async function attachUsers(profiles: any[]): Promise<any[]> {
  const ids = Array.from(new Set(profiles.map((p) => p.user_id).filter(Boolean)));
  if (!ids.length) return profiles.map((p) => ({ ...p, user: null }));
  const inList = ids.map((id) => encodeURIComponent(String(id))).join(",");
  let users: any[] = [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?id=in.(${inList})&select=id,name,phone,email`,
      { headers: SB_READ, cache: "no-store" },
    );
    users = (await r.json().catch(() => [])) as any[];
  } catch {}
  const byId = new Map(users.map((u) => [u.id, u]));
  return profiles.map((p) => {
    const u: any = byId.get(p.user_id) || null;
    const xp = Number(p.xp || 0);
    const rank = rankForXp(xp);
    return {
      ...p,
      user: u ? { name: u.name || null, phone: u.phone || null, email: u.email || null } : null,
      rankKey: rank.rank.key,
      rankLabel: rank.rank.label,
      rankEmoji: rank.rank.emoji,
    };
  });
}

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const explorerId = url.searchParams.get("explorerId");
  const q = (url.searchParams.get("q") || "").trim();

  // ── Single profile + stamps ──────────────────────────────────────────
  if (userId || explorerId) {
    const filter = userId
      ? `user_id=eq.${encodeURIComponent(userId)}`
      : `explorer_id=eq.${encodeURIComponent(String(explorerId))}`;
    const pr = await fetch(
      `${SB_URL}/rest/v1/passport_profiles?${filter}&select=${PROFILE_COLS}&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    const rows = (await pr.json().catch(() => [])) as any[];
    const [profile] = await attachUsers(rows);
    if (!profile) return NextResponse.json({ profile: null, stamps: [] });

    const sr = await fetch(
      `${SB_URL}/rest/v1/passport_stamps?user_id=eq.${encodeURIComponent(profile.user_id)}&select=*&order=earned_at.desc`,
      { headers: SB_READ, cache: "no-store" },
    );
    const stamps = (await sr.json().catch(() => [])) as any[];
    return NextResponse.json({ profile, stamps });
  }

  // ── Search / list ────────────────────────────────────────────────────
  let listUrl = `${SB_URL}/rest/v1/passport_profiles?select=${PROFILE_COLS}&order=updated_at.desc.nullslast&limit=50`;
  if (q) {
    const safe = q.replace(/[(),*]/g, " ").trim();
    const pat = `*${encodeURIComponent(safe)}*`;
    listUrl = `${SB_URL}/rest/v1/passport_profiles?select=${PROFILE_COLS}&or=(explorer_id.ilike.${pat},display_name.ilike.${pat})&order=updated_at.desc.nullslast&limit=50`;
  }
  const lr = await fetch(listUrl, { headers: SB_READ, cache: "no-store" });
  const rows = (await lr.json().catch(() => [])) as any[];
  const profiles = await attachUsers(rows);

  // If the query looks like a phone number, also resolve via users → profiles.
  if (q && /\d{6,}/.test(q) && profiles.length === 0) {
    try {
      const ur = await fetch(
        `${SB_URL}/rest/v1/users?phone=ilike.*${encodeURIComponent(q)}*&select=id&limit=20`,
        { headers: SB_READ, cache: "no-store" },
      );
      const us = (await ur.json().catch(() => [])) as any[];
      const ids = us.map((u) => u.id).filter(Boolean);
      if (ids.length) {
        const inList = ids.map((id: string) => encodeURIComponent(id)).join(",");
        const pr = await fetch(
          `${SB_URL}/rest/v1/passport_profiles?user_id=in.(${inList})&select=${PROFILE_COLS}&limit=50`,
          { headers: SB_READ, cache: "no-store" },
        );
        const prows = (await pr.json().catch(() => [])) as any[];
        return NextResponse.json({ profiles: await attachUsers(prows) });
      }
    } catch {}
  }

  return NextResponse.json({ profiles });
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const userId = String(body?.userId || "").trim();
  if (!action || !userId) {
    return NextResponse.json({ error: "action and userId are required" }, { status: 400 });
  }

  // ── Grant a manual stamp ─────────────────────────────────────────────
  if (action === "grant_stamp") {
    const city = body?.city ? String(body.city).slice(0, 80) : null;
    const hotelName = body?.hotelName ? String(body.hotelName).slice(0, 120) : null;
    const stayDate = body?.stayDate ? String(body.stayDate).slice(0, 10) : null;
    const row = {
      user_id: userId,
      hotel_id: null,
      hotel_name: hotelName,
      city,
      region: regionForCity(city),
      source_type: "admin",
      source_id: genStampSourceId(),
      xp_awarded: 150,
      stay_date: stayDate,
    };
    const r = await fetch(`${SB_URL}/rest/v1/passport_stamps`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      return NextResponse.json({ error: "Couldn't grant stamp", detail: await r.text() }, { status: 500 });
    }
    const created = ((await r.json().catch(() => [])) as any[])[0] || null;
    logAdminAction({
      admin,
      action: "passport.grant_stamp",
      targetType: "passport_profile",
      targetId: userId,
      details: { city, hotelName, stayDate, stampId: created?.id || null },
    });
    return NextResponse.json({ ok: true, stamp: created });
  }

  // ── Remove a stamp ───────────────────────────────────────────────────
  if (action === "remove_stamp") {
    const stampId = String(body?.stampId || "").trim();
    if (!stampId) return NextResponse.json({ error: "stampId required" }, { status: 400 });
    const r = await fetch(
      `${SB_URL}/rest/v1/passport_stamps?id=eq.${encodeURIComponent(stampId)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: SB_H },
    );
    if (!r.ok) {
      return NextResponse.json({ error: "Couldn't remove stamp", detail: await r.text() }, { status: 500 });
    }
    logAdminAction({
      admin,
      action: "passport.remove_stamp",
      targetType: "passport_profile",
      targetId: userId,
      details: { stampId },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Set additive bonus XP ────────────────────────────────────────────
  if (action === "set_bonus_xp") {
    const bonusXp = Math.max(0, Math.floor(Number(body?.bonusXp)));
    if (!Number.isFinite(bonusXp)) {
      return NextResponse.json({ error: "bonusXp must be a non-negative number" }, { status: 400 });
    }
    const r = await fetch(
      `${SB_URL}/rest/v1/passport_profiles?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: SB_H,
        body: JSON.stringify({ bonus_xp: bonusXp, updated_at: new Date().toISOString() }),
      },
    );
    if (!r.ok) {
      return NextResponse.json({ error: "Couldn't set bonus XP", detail: await r.text() }, { status: 500 });
    }
    const updated = ((await r.json().catch(() => [])) as any[])[0] || null;
    logAdminAction({
      admin,
      action: "passport.set_bonus_xp",
      targetType: "passport_profile",
      targetId: userId,
      details: { bonusXp },
    });
    return NextResponse.json({ ok: true, profile: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
