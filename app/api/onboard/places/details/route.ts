import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { placeDetails } from "@/lib/onboard/maps";

// POST /api/onboard/places/details { placeId }
export async function POST(req: Request) {
  try {
    requireOnboardUser(req);
    const { placeId } = await req.json();
    if (!placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 });
    const out = await placeDetails(placeId);
    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "details failed" }, { status: 500 });
  }
}
