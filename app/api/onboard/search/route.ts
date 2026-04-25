import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { searchHotels, SEARCH_PROVIDER } from "@/lib/onboard/search-provider";

// POST /api/onboard/search { query, city }
export async function POST(req: Request) {
  try {
    requireOnboardUser(req);
    const { query, city } = await req.json();
    const out = await searchHotels(query || "", city || "");
    return NextResponse.json({ ...out, configuredProvider: SEARCH_PROVIDER });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "search failed" }, { status: 500 });
  }
}
