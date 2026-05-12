import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Public — used by the /r/[code] redirect handler AND by the hotel page on
// mount (so a customer who came in via a referral link gets their booking
// attributed to the creator). Returns:
//   { code: null }                                          → code unknown/inactive
//   { code: {…}, target: {…}, creator: { userId, handle } } → ready to attribute
//
// The creator side-load (user_id + display_name) is what enables the v94
// attribution flow to build a `creator` source even when no URL params are
// present (cookie-driven attribution).
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const rows = await fetch(
    `${SB_URL}/rest/v1/influencer_referral_codes?code=eq.${encodeURIComponent(params.code)}&active=eq.true&select=*`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  const code = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!code) return NextResponse.json({ code: null });

  // Side-load the creator's user_id + handle so the caller can construct a
  // full v94 attribution payload (creator source needs creatorUserId + handle).
  let creator: { id: string; userId: string | null; handle: string | null } | null = null;
  try {
    const infRows = await fetch(
      `${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(code.influencer_id)}&select=id,user_id,display_name`,
      { headers: SB_READ }
    ).then(r => r.json()).catch(() => []);
    const inf = Array.isArray(infRows) && infRows[0] ? infRows[0] : null;
    if (inf) {
      let handle: string | null = inf.display_name || null;
      // Fall back to the user's name if the influencer hasn't set a display
      // name yet — keeps the partner/admin Source pill from showing a UUID.
      if (!handle && inf.user_id) {
        const userRows = await fetch(
          `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(inf.user_id)}&select=name`,
          { headers: SB_READ }
        ).then(r => r.json()).catch(() => []);
        handle = Array.isArray(userRows) && userRows[0] ? userRows[0].name : null;
      }
      creator = { id: inf.id, userId: inf.user_id, handle };
    }
  } catch { /* graceful — code resolution still works without creator side-load */ }

  const target = code.hotel_id
    ? { type: "hotel", url: `/hotels/${code.hotel_id}` }
    : { type: "home",  url: "/" };

  return NextResponse.json({
    code: { id: code.id, code: code.code, label: code.label, hotelId: code.hotel_id, influencerId: code.influencer_id },
    target,
    creator,
  });
}
