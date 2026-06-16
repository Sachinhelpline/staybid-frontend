import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { geminiSearchHotels } from "@/lib/onboard/gemini-scraper";

// POST /api/onboard/express/search  — PHASE 1 of the two-phase onboard flow.
// Body: { query, city }  (BOTH required).
// Gemini first narrows to the city, then lists REAL hotels matching the name so
// the owner can CONFIRM which one is theirs before we deep-scrape. NO DB write,
// NO fabrication: returns an empty candidate list when nothing real is found,
// and the wizard then offers a manual-fill path.
export async function POST(req: Request) {
  try {
    requireOnboardUser(req);
    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    const city = String(body.city || "").trim();

    if (!query || !city) {
      return NextResponse.json(
        { error: "Both hotel name and city are required.", code: "NAME_AND_CITY_REQUIRED" },
        { status: 400 },
      );
    }

    // Optional real geotag from the onboarding LocationPicker — tightens the
    // city-scoped search to the owner's exact locality + coordinates.
    const loc = body.location && typeof body.location === "object"
      ? {
          area: body.location.area ? String(body.location.area) : undefined,
          state: body.location.state ? String(body.location.state) : undefined,
          lat: Number.isFinite(body.location.lat) ? Number(body.location.lat) : undefined,
          lng: Number.isFinite(body.location.lng) ? Number(body.location.lng) : undefined,
        }
      : undefined;

    const out = await geminiSearchHotels(query, city, loc);

    // out === null → no Gemini key OR the model returned no parseable JSON.
    // Either way the UI shows "couldn't find — fill manually". `available`
    // tells the wizard whether real AI search was even possible.
    if (!out) {
      return NextResponse.json({
        ok: true,
        available: false,
        provider: "none",
        candidates: [],
        query,
        city,
      });
    }

    return NextResponse.json({
      ok: true,
      available: true,
      provider: out.provider,
      candidates: out.candidates,
      query,
      city,
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    return NextResponse.json({ error: e?.message || "search failed" }, { status: 500 });
  }
}
