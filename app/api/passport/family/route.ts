// /api/passport/family — Family Passport (v266, Phase 2b).
//   GET    → the caller's family (as owner or member) + members (each with
//            rank/XP/stamps) + combined stats.
//   POST   → create a family for the caller (owner) if they don't have one.
//   DELETE → disband (owner-only) — removes the family + all member rows.
//
// A user belongs to at most one family (UNIQUE index on member user_id).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, sbSelect, authPayload, resolveUserIds, genId } from "@/lib/sb-server";
import { rankForXp } from "@/lib/passport/engine";

export const dynamic = "force-dynamic";

// Resolve the caller's canonical passport user_id (the profile's user_id, or
// the primary id if no profile yet).
async function canonicalUserId(payload: any): Promise<{ canonical: string; userIds: string[] } | null> {
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return null;
  const userIds = await resolveUserIds(primaryId, payload?.phone, payload?.email);
  const inList = userIds.map(encodeURIComponent).join(",");
  const profiles = await sbSelect(
    `passport_profiles?user_id=in.(${inList})&select=user_id&order=created_at.asc&limit=1`,
  );
  return { canonical: profiles[0]?.user_id || primaryId, userIds };
}

// Build the member view rows (rank/XP/stamps) for a family.
async function buildMembers(familyId: string, meId: string) {
  const rows = await sbSelect(
    `passport_family_members?family_id=eq.${encodeURIComponent(familyId)}&select=*&order=added_at.asc`,
  );
  const ids = rows.map((r: any) => r.user_id);
  if (!ids.length) return { members: [], combined: { stamps: 0, cities: 0, members: 0 } };
  const inIds = ids.map(encodeURIComponent).join(",");
  const [profiles, users] = await Promise.all([
    sbSelect(`passport_profiles?user_id=in.(${inIds})&select=user_id,explorer_id,display_name,xp,stamps_count,cities_visited`),
    sbSelect(`users?id=in.(${inIds})&select=id,name`),
  ]);
  const profBy = new Map(profiles.map((p: any) => [p.user_id, p]));
  const userBy = new Map(users.map((u: any) => [u.id, u]));

  let combinedStamps = 0;
  let combinedCities = 0;
  const members = rows.map((r: any) => {
    const prof: any = profBy.get(r.user_id) || {};
    const u: any = userBy.get(r.user_id) || {};
    const xp = Number(prof.xp || 0);
    const rank = rankForXp(xp);
    const stamps = Number(prof.stamps_count || 0);
    combinedStamps += stamps;
    combinedCities += Number(prof.cities_visited || 0);
    return {
      userId: r.user_id,
      role: r.role,
      name: prof.display_name || r.display_name || u.name || "Explorer",
      explorerId: prof.explorer_id || null,
      rankKey: rank.rank.key,
      rankLabel: rank.rank.label,
      rankEmoji: rank.rank.emoji,
      rankGradient: rank.rank.gradient,
      xp,
      stamps,
      isYou: r.user_id === meId,
    };
  });
  return { members, combined: { stamps: combinedStamps, cities: combinedCities, members: members.length } };
}

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const me = await canonicalUserId(payload);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Is the caller already in a family (any of their ids)?
  const inList = me.userIds.map(encodeURIComponent).join(",");
  const membership = await sbSelect(
    `passport_family_members?user_id=in.(${inList})&select=*&limit=1`,
  );
  if (!membership[0]) {
    return NextResponse.json({ family: null });
  }
  const familyRows = await sbSelect(
    `passport_families?id=eq.${encodeURIComponent(membership[0].family_id)}&select=*&limit=1`,
  );
  const family = familyRows[0] || null;
  if (!family) return NextResponse.json({ family: null });

  const { members, combined } = await buildMembers(family.id, me.canonical);
  return NextResponse.json({
    family: { id: family.id, name: family.name, ownerUserId: family.owner_user_id, isOwner: family.owner_user_id === me.canonical || members.some((m: any) => m.isYou && m.role === "owner") },
    members,
    combined,
  });
}

export async function POST(req: NextRequest) {
  const payload = authPayload(req);
  const me = await canonicalUserId(payload);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const name = String(body?.name || "My Family").slice(0, 60);

  // Already in a family? Return it.
  const inList = me.userIds.map(encodeURIComponent).join(",");
  const existing = await sbSelect(`passport_family_members?user_id=in.(${inList})&select=family_id&limit=1`);
  if (existing[0]) {
    return NextResponse.json({ ok: true, alreadyMember: true, familyId: existing[0].family_id });
  }

  // Create the family + the owner member row.
  const familyId = genId("pfm");
  const famRes = await fetch(`${SB_URL}/rest/v1/passport_families`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify({ id: familyId, owner_user_id: me.canonical, name }),
  });
  const famJson = await famRes.json().catch(() => null);
  const created = Array.isArray(famJson) ? famJson[0] : famJson;
  if (!created?.id) {
    return NextResponse.json({ error: "Couldn't create family" }, { status: 500 });
  }

  const myName = payload?.name || null;
  await fetch(`${SB_URL}/rest/v1/passport_family_members`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ id: genId("pfmm"), family_id: created.id, user_id: me.canonical, role: "owner", display_name: myName }),
  }).catch(() => {});

  return NextResponse.json({ ok: true, familyId: created.id });
}

export async function DELETE(req: NextRequest) {
  const payload = authPayload(req);
  const me = await canonicalUserId(payload);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Owner disbands their own family.
  const families = await sbSelect(
    `passport_families?owner_user_id=eq.${encodeURIComponent(me.canonical)}&select=id&limit=1`,
  );
  const family = families[0];
  if (!family) return NextResponse.json({ error: "You don't own a family." }, { status: 400 });

  await fetch(`${SB_URL}/rest/v1/passport_family_members?family_id=eq.${encodeURIComponent(family.id)}`, {
    method: "DELETE",
    headers: SB_H,
  }).catch(() => {});
  await fetch(`${SB_URL}/rest/v1/passport_families?id=eq.${encodeURIComponent(family.id)}`, {
    method: "DELETE",
    headers: SB_H,
  }).catch(() => {});

  return NextResponse.json({ ok: true, disbanded: true });
}
