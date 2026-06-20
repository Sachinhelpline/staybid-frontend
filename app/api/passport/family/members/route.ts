// /api/passport/family/members — Family Passport membership (v266, Phase 2b).
//   POST   { explorerId } → owner adds a member by their Explorer ID.
//   DELETE ?userId=...    → owner removes a member; OR a member leaves (self).
//
// Add-by-Explorer-ID is the privacy-friendly path: the owner must know the
// member's printed Explorer ID (SB-EXP-######), so nobody can be pulled into
// a family by phone-number guessing.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, sbSelect, authPayload, resolveUserIds, genId } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

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

// The family the caller OWNS (members can only be managed by the owner).
async function ownedFamily(canonical: string) {
  const rows = await sbSelect(
    `passport_families?owner_user_id=eq.${encodeURIComponent(canonical)}&select=*&limit=1`,
  );
  return rows[0] || null;
}

const MAX_MEMBERS = 8;

export async function POST(req: NextRequest) {
  const payload = authPayload(req);
  const me = await canonicalUserId(payload);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const explorerId = String(body?.explorerId || "").trim().toUpperCase();
  if (!/^SB-EXP-\d{6}$/.test(explorerId)) {
    return NextResponse.json({ error: "Enter a valid Explorer ID (SB-EXP-######)." }, { status: 400 });
  }

  const family = await ownedFamily(me.canonical);
  if (!family) {
    return NextResponse.json({ error: "Create a family first." }, { status: 400 });
  }

  // Capacity guard.
  const current = await sbSelect(`passport_family_members?family_id=eq.${encodeURIComponent(family.id)}&select=id`);
  if (current.length >= MAX_MEMBERS) {
    return NextResponse.json({ error: `A family can have up to ${MAX_MEMBERS} members.` }, { status: 400 });
  }

  // Resolve the invitee by Explorer ID.
  const prof = await sbSelect(
    `passport_profiles?explorer_id=eq.${encodeURIComponent(explorerId)}&select=user_id,display_name&limit=1`,
  );
  if (!prof[0]) {
    return NextResponse.json({ error: "No Explorer found with that ID." }, { status: 404 });
  }
  const memberUserId = prof[0].user_id;
  if (memberUserId === me.canonical) {
    return NextResponse.json({ error: "You're already in this family." }, { status: 400 });
  }

  // Already in a family (any)? UNIQUE(user_id) guards it, but message nicely.
  const already = await sbSelect(`passport_family_members?user_id=eq.${encodeURIComponent(memberUserId)}&select=family_id&limit=1`);
  if (already[0]) {
    return NextResponse.json({ error: "That Explorer is already in a family." }, { status: 400 });
  }

  const res = await fetch(`${SB_URL}/rest/v1/passport_family_members`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      id: genId("pfmm"),
      family_id: family.id,
      user_id: memberUserId,
      role: "member",
      display_name: prof[0].display_name || null,
    }),
  });
  const j = await res.json().catch(() => null);
  const created = Array.isArray(j) ? j[0] : j;
  if (!created) {
    return NextResponse.json({ error: "That Explorer is already in a family." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const payload = authPayload(req);
  const me = await canonicalUserId(payload);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = String(new URL(req.url).searchParams.get("userId") || "").trim();
  if (!target) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // A member leaving themselves — always allowed (but the owner can't "leave",
  // they disband via DELETE /api/passport/family).
  if (me.userIds.includes(target) || target === me.canonical) {
    const owned = await ownedFamily(me.canonical);
    if (owned) {
      return NextResponse.json({ error: "Owners disband the family instead of leaving." }, { status: 400 });
    }
    await fetch(`${SB_URL}/rest/v1/passport_family_members?user_id=eq.${encodeURIComponent(me.canonical)}`, {
      method: "DELETE",
      headers: SB_H,
    }).catch(() => {});
    return NextResponse.json({ ok: true, left: true });
  }

  // Otherwise the caller must OWN the family the target belongs to.
  const family = await ownedFamily(me.canonical);
  if (!family) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (target === family.owner_user_id) {
    return NextResponse.json({ error: "Owners disband the family instead." }, { status: 400 });
  }
  await fetch(
    `${SB_URL}/rest/v1/passport_family_members?family_id=eq.${encodeURIComponent(family.id)}&user_id=eq.${encodeURIComponent(target)}`,
    { method: "DELETE", headers: SB_H },
  ).catch(() => {});
  return NextResponse.json({ ok: true, removed: true });
}
