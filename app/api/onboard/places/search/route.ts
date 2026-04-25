import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { placesAutocomplete } from "@/lib/onboard/maps";

// GET /api/onboard/places/search?q=...
export async function GET(req: Request) {
  try {
    requireOnboardUser(req);
    const q = new URL(req.url).searchParams.get("q") || "";
    const out = await placesAutocomplete(q);
    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "search failed" }, { status: 500 });
  }
}
