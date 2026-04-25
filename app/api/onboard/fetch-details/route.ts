import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { fetchHotelDetails } from "@/lib/onboard/details-fetcher";
import { sbInsert } from "@/lib/onboard/supabase-admin";

// POST /api/onboard/fetch-details
// Body: { hit: HotelSearchResult }   — produces a HotelDraftPayload + persists a draft.
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const { hit } = await req.json();
    if (!hit?.name) return NextResponse.json({ error: "hit required" }, { status: 400 });

    const { provider, draft } = await fetchHotelDetails(hit);

    const row = await sbInsert("hotel_drafts", {
      user_id: claims.sub,
      search_query: hit.name,
      search_city: hit.city,
      selected_source: provider,
      source_ref: hit.sourceRef,
      payload: draft,
      status: "draft",
    });

    return NextResponse.json({ provider, draftId: row.id, draft });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
