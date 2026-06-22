import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

// GET /api/host/workforce — available, active hospitality workers.
// Optional ?skill=<skill>, ?city=<city>.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const skill = url.searchParams.get("skill");
  const city = url.searchParams.get("city");

  let q = `${SB_URL}/rest/v1/workforce_workers?active=eq.true&available=eq.true`
    + `&select=id,name,skill,city,locality,rate,rate_unit,rating,jobs_done,verified,background_checked,avatar_url,bio,languages`
    + `&order=verified.desc,rating.desc.nullslast,jobs_done.desc`;
  if (skill) q += `&skill=eq.${encodeURIComponent(skill)}`;
  if (city) q += `&city=eq.${encodeURIComponent(city)}`;

  try {
    const r = await fetch(q, { headers: SB_READ, cache: "no-store" });
    const workers = r.ok ? await r.json() : [];
    // Distinct cities + skills for the filter chips.
    const fr = await fetch(
      `${SB_URL}/rest/v1/workforce_workers?active=eq.true&available=eq.true&select=city,skill`,
      { headers: SB_READ, cache: "no-store" },
    );
    const rows = fr.ok ? await fr.json() : [];
    const cities = Array.from(new Set(rows.map((x: any) => x.city).filter(Boolean))).sort();
    const skills = Array.from(new Set(rows.map((x: any) => x.skill).filter(Boolean))).sort();
    return NextResponse.json({ workers, cities, skills });
  } catch (e: any) {
    return NextResponse.json({ workers: [], cities: [], skills: [], error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
