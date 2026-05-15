// GET /api/redemption/rules — public catalog of redemption rules.
// No auth required; UI uses tier to grey-out locked rows but the list itself
// is non-sensitive. Filtered to active=true. Ordered by display_order.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const r = await fetch(
    `${SB_URL}/rest/v1/redemption_rules?active=eq.true&select=*&order=display_order.asc,points_cost.asc`,
    { headers: SB_READ, next: { revalidate: 30 } },
  ).then((x) => x.json()).catch(() => []);
  return NextResponse.json({ rules: Array.isArray(r) ? r : [] });
}
