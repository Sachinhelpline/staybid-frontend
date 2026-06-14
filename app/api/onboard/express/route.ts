import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { searchHotels, SEARCH_PROVIDER } from "@/lib/onboard/search-provider";
import { fetchHotelDetails } from "@/lib/onboard/details-fetcher";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { generateHotelPublicId } from "@/lib/onboard/hotel-id";

// POST /api/onboard/express
// The 30-second engine. Body: { query, city, hit? }
//   - If `hit` is provided (user picked a specific search result) → use it.
//   - Else → search by name+city, auto-pick the best match.
// Then: deep-fetch the full digital footprint, create/update a DRAFT hotel +
// rooms + persist images, and return the editable draft. The user reviews +
// tweaks anything; nothing is public until they consent + publish.
//
// Side-effects (all best-effort, never fatal):
//   - hotels row (status='draft') created or reused for this owner
//   - rooms rows (basePrice → mrp mapping handled by wizard saves)
//   - hotel_images rows from the sourced photos
//   - onboarding_consents row for data-sourcing (implicit at search time —
//     the user explicitly typed their hotel name to pull its footprint;
//     an explicit re-confirm is still required before publish)
//   - onboarding_events audit row
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const query = String(body.query || "").trim();
    const city = String(body.city || "").trim();
    let hit = body.hit || null;

    if (!hit && !query) {
      return NextResponse.json({ error: "Hotel name (query) or a search result (hit) is required." }, { status: 400 });
    }

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") || null;

    // 1. Find the property if no explicit hit
    let searchProvider = SEARCH_PROVIDER;
    if (!hit) {
      const out = await searchHotels(query, city);
      searchProvider = out.provider;
      // v262 — REAL-DATA fix: when no live search key is configured, the mock
      // provider fabricates a name ("The {query} Grand") that doesn't exist —
      // so the Gemini scraper then pulls garbage for a hotel that isn't real.
      // In that case we build the hit from the user's EXACT typed name + city
      // so the scraper grounds on the property they actually own.
      const isReal = out.provider === "serpapi" || out.provider === "tavily";
      hit = (isReal && out.results[0]) || {
        source: "manual",
        sourceRef: `manual-${Date.now()}`,
        name: query,
        city: city || "India",
        country: "India",
      };
    }

    // 2. Deep-fetch the digital footprint
    const { provider: detailsProvider, draft } = await fetchHotelDetails(hit);

    // 3. Create or reuse a draft hotel for this owner
    let hotel: any = null;
    const existing = await sbSelect<any>(
      "hotels",
      `"ownerId"=eq.${claims.sub}&status=eq.draft&order="createdAt".desc&limit=1`
    ).catch(() => []);

    const hotelPatch: any = {
      name: draft.name,
      description: draft.description ?? null,
      city: draft.city,
      state: draft.state ?? null,
      country: draft.country ?? "India",
      starRating: draft.starRating ?? 4,
      // lat/lng are NOT NULL (default 0) — only set when the scraper found them.
      ...(typeof draft.lat === "number" ? { lat: draft.lat } : {}),
      ...(typeof draft.lng === "number" ? { lng: draft.lng } : {}),
      formatted_address: draft.address ?? null,
      contact_phone: draft.contact?.phone ?? null,
      contact_email: draft.contact?.email ?? null,
      contact_website: draft.contact?.website ?? null,
      amenities: draft.amenities ?? [],
      photos: draft.photos ?? [],
      ownerId: claims.sub,
      onboarded_via: body.onboardedVia || "self",
      onboarded_by: claims.sub,
      onboarding_agent: body.agentCode || null,
      source: detailsProvider,
    };

    if (existing[0]) {
      const upd = await sbUpdate("hotels", `id=eq.${encodeURIComponent(existing[0].id)}`, hotelPatch);
      hotel = Array.isArray(upd) ? upd[0] : upd;
    } else {
      const newId = await generateHotelPublicId();
      try {
        hotel = await sbInsert("hotels", { id: newId, public_id: newId, status: "draft", ...hotelPatch });
      } catch {
        // Minimal-schema fallback
        hotel = await sbInsert("hotels", { id: newId, name: draft.name, city: draft.city, starRating: draft.starRating || 4, ownerId: claims.sub });
      }
    }
    const hotelId = hotel?.id;

    // 4. Persist sourced photos as hotel_images (best-effort)
    let imageCount = 0;
    if (hotelId) {
      // Avoid duplicating on re-run
      const already = await sbSelect<any>("hotel_images", `hotel_id=eq.${encodeURIComponent(hotelId)}&limit=1`).catch(() => []);
      if (!already.length) {
        for (let i = 0; i < (draft.photos || []).slice(0, 12).length; i++) {
          try {
            await sbInsert("hotel_images", { hotel_id: hotelId, url: draft.photos[i], sort_order: i, kind: "sourced" });
            imageCount++;
          } catch {}
        }
      } else {
        imageCount = already.length;
      }
    }

    // 5. Seed rooms from the draft (best-effort; wizard lets owner edit)
    let roomCount = 0;
    if (hotelId) {
      const existingRooms = await sbSelect<any>("rooms", `"hotelId"=eq.${encodeURIComponent(hotelId)}&limit=1`).catch(() => []);
      if (!existingRooms.length) {
        for (const r of (draft.rooms || []).slice(0, 6)) {
          try {
            await sbInsert("rooms", {
              hotelId,
              type: r.type,
              capacity: r.capacity || 2,
              mrp: r.basePrice,
              floorPrice: r.floorPrice || Math.round((r.basePrice || 4999) * 0.78),
              amenities: r.amenities || [],
              quantity: 1,
            });
            roomCount++;
          } catch {}
        }
      } else {
        roomCount = (await sbSelect<any>("rooms", `"hotelId"=eq.${encodeURIComponent(hotelId)}`).catch(() => [])).length;
      }
    }

    // 6. Audit
    try {
      await sbInsert("onboarding_events", {
        user_id: claims.sub, hotel_id: hotelId,
        event: "express_footprint",
        payload: {
          query, city, searchProvider, detailsProvider,
          matchedName: draft.name, photos: imageCount, rooms: roomCount,
        },
        ip_address: ip, user_agent: ua,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      hotelId,
      searchProvider,
      detailsProvider,
      draft,
      counts: { photos: imageCount, rooms: roomCount },
      hotel: { id: hotelId, name: draft.name, city: draft.city, status: "draft" },
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "express onboarding failed" }, { status: 500 });
  }
}
