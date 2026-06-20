// GET /api/passport — the unified Explorer Passport payload.
//
// On every load it lazily + idempotently:
//   1. resolves the caller's cross-identity user ids (v240 resolver)
//   2. reads confirmed stays (ACCEPTED+ bids + bookings)
//   3. ensures a passport_profiles row (Explorer ID + member-since)
//   4. awards a stamp for any stay not yet stamped (UNIQUE-guarded)
//   5. evaluates achievement badges + persists new ones
//   6. recomputes XP + rank and caches them on the profile
//   7. returns profile + stamps + badges + stats + rank + reward ladder
//
// Pure rules live in lib/passport/engine.ts so server + client never drift.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, sbSelect, authPayload, resolveUserIds } from "@/lib/sb-server";
import {
  computeStats,
  evaluateBadges,
  computeXp,
  rankForXp,
  regionForCity,
  genExplorerId,
  rewardStates,
  BADGES,
  type StampRow,
} from "@/lib/passport/engine";

export const dynamic = "force-dynamic";

// Stays we treat as "you stayed here" → eligible for a stamp.
const STAMP_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

function dowOf(d?: string | null): number | null {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.getDay(); // 0=Sun … 6=Sat
}

async function bulkInsertIgnore(table: string, rows: any[]) {
  if (!rows.length) return;
  await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userIds = await resolveUserIds(primaryId, payload?.phone, payload?.email);
  const inList = userIds.map(encodeURIComponent).join(",");

  // ── 1. Read confirmed stays from both sources ───────────────────────
  const [bids, bookings] = await Promise.all([
    sbSelect(`bids?customerId=in.(${inList})&status=in.(${STAMP_STATUSES.join(",")})&select=*`),
    sbSelect(`bookings?customerId=in.(${inList})&select=*`),
  ]);

  const reqIds = Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)));
  const hotelIds = Array.from(
    new Set([...bids, ...bookings].map((b: any) => b.hotelId).filter(Boolean)),
  );
  const [requests, hotels] = await Promise.all([
    reqIds.length ? sbSelect(`bid_requests?id=in.(${reqIds.join(",")})&select=id,checkIn,guests`) : Promise.resolve([]),
    hotelIds.length ? sbSelect(`hotels?id=in.(${hotelIds.join(",")})&select=id,name,city`) : Promise.resolve([]),
  ]);
  const reqById = new Map(requests.map((r: any) => [r.id, r]));
  const hotelById = new Map(hotels.map((h: any) => [h.id, h]));

  // Normalize every eligible stay into a stamp candidate.
  type Stay = {
    source_type: string;
    source_id: string;
    hotel_id: string | null;
    hotel_name: string | null;
    city: string | null;
    region: string;
    stay_date: string | null;
    created_at: string | null;
    guests: number | null;
    dow: number | null;
  };
  const stays: Stay[] = [];

  for (const b of bids) {
    const r = reqById.get(b.requestId);
    const h = hotelById.get(b.hotelId);
    const city = h?.city || null;
    const checkIn = r?.checkIn || null;
    stays.push({
      source_type: "bid",
      source_id: String(b.id),
      hotel_id: b.hotelId || null,
      hotel_name: h?.name || null,
      city,
      region: regionForCity(city),
      stay_date: checkIn,
      created_at: b.updatedAt || b.createdAt || null,
      guests: r?.guests != null ? Number(r.guests) : null,
      dow: dowOf(checkIn),
    });
  }
  for (const bk of bookings) {
    const h = hotelById.get(bk.hotelId);
    const city = h?.city || null;
    const checkIn = bk.checkIn || null;
    stays.push({
      source_type: "booking",
      source_id: String(bk.id),
      hotel_id: bk.hotelId || null,
      hotel_name: h?.name || null,
      city,
      region: regionForCity(city),
      stay_date: checkIn,
      created_at: bk.createdAt || null,
      guests: bk.guests != null ? Number(bk.guests) : null,
      dow: dowOf(checkIn),
    });
  }
  // Dedup a stay that exists as both a real booking AND an accepted bid for
  // the same hotel (mirrors /api/bookings/my): keep the booking projection.
  const bookingKeys = new Set(
    stays.filter((s) => s.source_type === "booking").map((s) => `${s.hotel_id}`),
  );
  const dedupStays = stays.filter(
    (s) => s.source_type === "booking" || !bookingKeys.has(`${s.hotel_id}`),
  );

  // ── 2. Ensure profile row ──────────────────────────────────────────
  let profileRows = await sbSelect(
    `passport_profiles?user_id=in.(${inList})&select=*&order=created_at.asc&limit=1`,
  );
  let profile = profileRows[0] || null;
  if (!profile) {
    // member_since = earliest stay, else now.
    const earliest = dedupStays
      .map((s) => s.created_at)
      .filter(Boolean)
      .sort()[0];
    const insertRow = {
      user_id: primaryId,
      explorer_id: genExplorerId(),
      member_since: earliest || new Date().toISOString(),
      display_name: payload?.name || null,
    };
    try {
      const r = await fetch(`${SB_URL}/rest/v1/passport_profiles`, {
        method: "POST",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify(insertRow),
      });
      const j = await r.json();
      profile = Array.isArray(j) ? j[0] : j;
    } catch {}
    if (!profile) {
      // explorer_id collision (rare) — retry once with a fresh id.
      try {
        const r = await fetch(`${SB_URL}/rest/v1/passport_profiles`, {
          method: "POST",
          headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify({ ...insertRow, explorer_id: genExplorerId() }),
        });
        const j = await r.json();
        profile = Array.isArray(j) ? j[0] : j;
      } catch {}
    }
  }
  // Last-resort in-memory profile so the UI never breaks.
  if (!profile) {
    profile = {
      user_id: primaryId,
      explorer_id: genExplorerId(),
      member_since: new Date().toISOString(),
      rank_key: "explorer",
      xp: 0,
    };
  }
  const ownerId = profile.user_id || primaryId;

  // ── 3. Award stamps for stays not yet stamped ──────────────────────
  const stampRows = dedupStays.map((s) => ({
    user_id: ownerId,
    hotel_id: s.hotel_id,
    hotel_name: s.hotel_name,
    city: s.city,
    region: s.region,
    source_type: s.source_type,
    source_id: s.source_id,
    xp_awarded: 150,
    stay_date: s.stay_date,
  }));
  await bulkInsertIgnore("passport_stamps", stampRows);

  // ── 4. Re-read persisted stamps (authoritative) + analytics merge ──
  const persisted = await sbSelect(
    `passport_stamps?user_id=eq.${encodeURIComponent(ownerId)}&select=*&order=earned_at.desc`,
  );
  // Attach per-stay analytics from the live stays (guests / dow) by source key.
  const stayByKey = new Map(dedupStays.map((s) => [`${s.source_type}|${s.source_id}`, s]));
  const stamps: StampRow[] = persisted.map((p: any) => {
    const live = stayByKey.get(`${p.source_type}|${p.source_id}`);
    return {
      ...p,
      _guests: live?.guests ?? null,
      _checkInDow: live?.dow ?? dowOf(p.stay_date),
    };
  });

  // ── 5. Stats → badges → XP → rank ──────────────────────────────────
  const stats = computeStats(stamps);
  const earnedBadges = evaluateBadges(stats);
  await bulkInsertIgnore(
    "passport_badges",
    earnedBadges.map((k) => ({ user_id: ownerId, badge_key: k })),
  );
  const xp = computeXp(stats, earnedBadges);
  const rank = rankForXp(xp);

  // Cache the denormalizations (best-effort; UI uses computed values anyway).
  fetch(`${SB_URL}/rest/v1/passport_profiles?user_id=eq.${encodeURIComponent(ownerId)}`, {
    method: "PATCH",
    headers: { ...SB_H, Prefer: "return=minimal" },
    body: JSON.stringify({
      xp,
      rank_key: rank.rank.key,
      stamps_count: stats.stampCount,
      properties_visited: stats.propertiesVisited,
      cities_visited: stats.citiesVisited,
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  // ── 6. Reward ladder claim state ───────────────────────────────────
  const claims = await sbSelect(
    `passport_reward_claims?user_id=eq.${encodeURIComponent(ownerId)}&select=reward_key,code,kind,value_inr,claimed_at`,
  );
  const claimedMap: Record<string, { code?: string | null }> = {};
  for (const c of claims) claimedMap[c.reward_key] = { code: c.code };
  const rewards = rewardStates(stats.stampCount, claimedMap);

  // Full badge catalog — earned + locked, with progress, so the grid can
  // render every achievement and dim the unearned ones.
  const badgeCatalog = BADGES.map((b) => {
    const g = b.goal(stats);
    return {
      key: b.key,
      label: b.label,
      emoji: b.emoji,
      blurb: b.blurb,
      earned: g.earned,
      have: g.have,
      need: g.need,
      hint: g.hint,
    };
  });

  return NextResponse.json({
    profile: {
      explorer_id: profile.explorer_id,
      member_since: profile.member_since,
      display_name: profile.display_name || payload?.name || null,
      rank_key: rank.rank.key,
      xp,
    },
    rank,
    stats,
    stamps,
    badges: badgeCatalog,
    rewards,
  });
}
