// POST /api/passport/claim-reward  { rewardKey }
//
// Mints a redemption_code for an unlocked stamp-count reward (3→voucher,
// 7→breakfast, 11→upgrade, 20→free night) and records the claim. The
// passport_reward_claims UNIQUE(user_id, reward_key) makes it idempotent —
// a double-tap returns the already-issued code instead of minting twice.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, sbSelect, authPayload, resolveUserIds, genId } from "@/lib/sb-server";
import { STAMP_REWARDS } from "@/lib/passport/engine";
import { generateCouponCode, generateBarcodeValue } from "@/lib/redemption";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const rewardKey = String(body?.rewardKey || "");
  const reward = STAMP_REWARDS.find((r) => r.key === rewardKey);
  if (!reward) return NextResponse.json({ error: "Unknown reward" }, { status: 400 });

  const userIds = await resolveUserIds(primaryId, payload?.phone, payload?.email);
  const inList = userIds.map(encodeURIComponent).join(",");

  // Owner id = the passport profile's user_id (canonical), else primary.
  const profileRows = await sbSelect(
    `passport_profiles?user_id=in.(${inList})&select=user_id&order=created_at.asc&limit=1`,
  );
  const ownerId = profileRows[0]?.user_id || primaryId;

  // Already claimed? Return the existing code (idempotent).
  const existing = await sbSelect(
    `passport_reward_claims?user_id=eq.${encodeURIComponent(ownerId)}&reward_key=eq.${encodeURIComponent(rewardKey)}&select=*&limit=1`,
  );
  if (existing[0]) {
    return NextResponse.json({ ok: true, alreadyClaimed: true, code: existing[0].code, claim: existing[0] });
  }

  // Eligibility — must have collected enough stamps.
  const stampRows = await sbSelect(
    `passport_stamps?user_id=eq.${encodeURIComponent(ownerId)}&select=id`,
  );
  const stampCount = stampRows.length;
  if (stampCount < reward.stamps) {
    return NextResponse.json(
      { error: `Need ${reward.stamps - stampCount} more stamp(s) to unlock this reward.` },
      { status: 400 },
    );
  }

  // Mint the redemption_code so it appears in My Codes / is usable at checkout.
  const code = generateCouponCode("STAY");
  const barcode = generateBarcodeValue();
  const validityDays = 180;
  const now = new Date();
  const expires = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const codeRow = {
    code,
    barcode_value: barcode,
    user_id: ownerId,
    rule_id: `passport_${reward.key}`,
    rule_slug: `passport-${reward.key}`,
    kind: reward.kind,
    title: reward.title,
    value_inr: reward.value_inr,
    points_spent: 0,
    status: "active",
    issued_at: now.toISOString(),
    expires_at: expires.toISOString(),
    notes: `Earned at ${reward.stamps} passport stamps`,
  };

  let codeId: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/redemption_codes`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(codeRow),
    });
    const j = await r.json();
    const created = Array.isArray(j) ? j[0] : j;
    codeId = created?.id || null;
  } catch {}

  // Record the claim. UNIQUE(user_id, reward_key) guards double-mint races —
  // ignore-duplicates means a concurrent claim silently no-ops here.
  const claimRow = {
    id: genId("prc"),
    user_id: ownerId,
    reward_key: reward.key,
    threshold_stamps: reward.stamps,
    code_id: codeId,
    code,
    kind: reward.kind,
    value_inr: reward.value_inr,
  };
  await fetch(`${SB_URL}/rest/v1/passport_reward_claims`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(claimRow),
  }).catch(() => {});

  return NextResponse.json({ ok: true, code, claim: claimRow });
}
