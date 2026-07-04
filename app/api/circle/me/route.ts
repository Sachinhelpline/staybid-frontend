import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/circle/me — the Community Partner dashboard payload:
// active locks (with property snapshots), bundles, payouts + rollup KPIs.
export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const uid = encodeURIComponent(user.id);
  try {
    const [locksR, bundlesR, payoutsR] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/circle_locks?user_id=eq.${uid}&status=eq.locked&select=*&order=created_at.desc&limit=50`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_bundles?user_id=eq.${uid}&select=*&order=created_at.desc&limit=50`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_payouts?user_id=eq.${uid}&select=*&order=created_at.desc&limit=100`, { headers: SB_H }),
    ]);
    const locks = locksR.ok ? await locksR.json() : [];
    const bundles = bundlesR.ok ? await bundlesR.json() : [];
    const payouts = payoutsR.ok ? await payoutsR.json() : [];

    // Side-load property snapshots for the locks (manual side-load — no FK embed).
    const propIds: string[] = [];
    (Array.isArray(locks) ? locks : []).forEach((l: any) => {
      const pid = String(l.property_id || "");
      if (pid && !propIds.includes(pid)) propIds.push(pid);
    });
    let props: any[] = [];
    if (propIds.length) {
      const pr = await fetch(
        `${SB_URL}/rest/v1/circle_properties?id=in.(${propIds.map((i) => `"${i}"`).join(",")})&select=id,title,city,images,monthly_rate,roi_min_pct,roi_max_pct,rooms_label,status`,
        { headers: SB_H },
      );
      props = pr.ok ? await pr.json() : [];
    }
    const propById = Object.fromEntries(props.map((p: any) => [String(p.id), p]));

    const activeBundles = (Array.isArray(bundles) ? bundles : []).filter((b: any) => b.status === "active");
    const investedMonthly = activeBundles.reduce((s: number, b: any) => s + (Number(b.monthly_total) || 0), 0);
    const expectedMonthlyIncome = activeBundles.reduce((s: number, b: any) => s + (Number(b.expected_monthly_income) || 0), 0);
    const totalPaidOut = (Array.isArray(payouts) ? payouts : [])
      .filter((p: any) => p.status === "paid")
      .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);

    return NextResponse.json({
      locks: (Array.isArray(locks) ? locks : []).map((l: any) => ({
        ...l,
        property: propById[String(l.property_id)] || null,
      })),
      bundles,
      payouts,
      kpis: {
        activeBundles: activeBundles.length,
        investedMonthly,
        expectedMonthlyIncome,
        totalPaidOut,
        lockedProperties: (Array.isArray(locks) ? locks : []).length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { locks: [], bundles: [], payouts: [], kpis: null, error: String(e?.message || e).slice(0, 160) },
      { status: 200 },
    );
  }
}
