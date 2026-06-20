// GET /api/partner/passport-guests — the hotel partner's "Passport Guests"
// view (v265, Phase 2a). For every hotel the partner owns, lists the Explorer
// Passport holders who have collected a stamp at that property — with their
// rank/XP, stamps-at-this-hotel, and lifetime stamps. Read-only; the partner
// can't mint or edit stamps from here. Auth mirrors /api/partner/hotel.
import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { rankForXp } from "@/lib/passport/engine";

export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

function decodeJwt(t: string) {
  try {
    return JSON.parse(
      Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
  } catch {
    return null;
  }
}

function maskPhone(p?: string | null): string {
  const s = String(p || "").replace(/\D/g, "");
  if (s.length < 4) return "";
  return `••• ${s.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const headerPhone = req.headers.get("x-phone") || "";
  const headerEmail = req.headers.get("x-email") || "";
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || headerPhone,
    payload.email || headerEmail,
  );

  // 1. Owned hotels
  const hotels = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id,name`,
    { headers: SB_H },
  ).then((r) => r.json()).catch(() => []);
  const hotelList: any[] = Array.isArray(hotels) ? hotels : [];
  if (!hotelList.length) {
    return NextResponse.json({ guests: [], summary: { guests: 0, stamps: 0, hotels: 0 } });
  }
  const hotelIds = hotelList.map((h) => h.id);
  const hotelNameById = new Map(hotelList.map((h) => [h.id, h.name]));

  // 2. Stamps earned at any of these hotels
  const inIds = hotelIds.map(encodeURIComponent).join(",");
  const stamps = await fetch(
    `${SB_URL}/rest/v1/passport_stamps?hotel_id=in.(${inIds})&select=user_id,hotel_id,stay_date,earned_at&order=earned_at.desc&limit=2000`,
    { headers: SB_H },
  ).then((r) => r.json()).catch(() => []);
  const stampList: any[] = Array.isArray(stamps) ? stamps : [];

  if (!stampList.length) {
    return NextResponse.json({ guests: [], summary: { guests: 0, stamps: 0, hotels: hotelList.length } });
  }

  // 3. Group by guest (canonical passport user_id)
  type Acc = { user_id: string; here: number; lastVisit: string | null; hotelsHere: Set<string> };
  const byUser = new Map<string, Acc>();
  for (const s of stampList) {
    const uid = String(s.user_id || "");
    if (!uid) continue;
    let a = byUser.get(uid);
    if (!a) {
      a = { user_id: uid, here: 0, lastVisit: null, hotelsHere: new Set() };
      byUser.set(uid, a);
    }
    a.here++;
    if (s.hotel_id) a.hotelsHere.add(s.hotel_id);
    const when = s.stay_date || s.earned_at || null;
    if (when && (!a.lastVisit || new Date(when) > new Date(a.lastVisit))) a.lastVisit = when;
  }

  const userIds = Array.from(byUser.keys());
  const inUsers = userIds.map(encodeURIComponent).join(",");

  // 4. Profiles (rank/xp/lifetime stamps) + user names in parallel
  const [profiles, users] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/passport_profiles?user_id=in.(${inUsers})&select=user_id,explorer_id,display_name,xp,stamps_count,cities_visited,member_since`,
      { headers: SB_H },
    ).then((r) => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/users?id=in.(${inUsers})&select=id,name,phone`, { headers: SB_H })
      .then((r) => r.json()).catch(() => []),
  ]);
  const profById = new Map((Array.isArray(profiles) ? profiles : []).map((p: any) => [p.user_id, p]));
  const userById = new Map((Array.isArray(users) ? users : []).map((u: any) => [u.id, u]));

  const guests = userIds.map((uid) => {
    const a = byUser.get(uid)!;
    const prof: any = profById.get(uid) || {};
    const u: any = userById.get(uid) || {};
    const xp = Number(prof.xp || 0);
    const rank = rankForXp(xp);
    const name = prof.display_name || u.name || "Explorer";
    return {
      userId: uid,
      explorerId: prof.explorer_id || null,
      name,
      phoneMasked: maskPhone(u.phone),
      rankKey: rank.rank.key,
      rankLabel: rank.rank.label,
      rankEmoji: rank.rank.emoji,
      rankColor: rank.rank.color,
      rankGradient: rank.rank.gradient,
      xp,
      progressPct: rank.progressPct,
      stampsHere: a.here,
      lifetimeStamps: Number(prof.stamps_count || a.here),
      citiesVisited: Number(prof.cities_visited || 0),
      lastVisit: a.lastVisit,
      memberSince: prof.member_since || null,
    };
  });

  // Sort: most stamps at this property first, then highest XP.
  guests.sort((x, y) => (y.stampsHere - x.stampsHere) || (y.xp - x.xp));

  return NextResponse.json({
    guests,
    summary: {
      guests: guests.length,
      stamps: stampList.length,
      hotels: hotelList.length,
      hotelNames: hotelList.map((h) => h.name),
    },
  });
}
