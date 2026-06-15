// Real-AI property scraper — Google Gemini with web-search grounding.
//
// Given a hotel name + city, Gemini searches the public web (Google Maps /
// OTA listings / the hotel's own site) and returns a STRUCTURED property
// profile: description, full address, lat/lng, star rating, amenities, room
// types + typical prices, and contact details. This is the FREE "real AI"
// path — no SerpAPI / Tavily key needed, only GEMINI_API_KEY (same key the
// verification AI already uses, per the v251.1 era).
//
// Always best-effort: returns null on no-key / error so the caller falls back
// to the existing mock draft. Never throws to the route.

export type ScrapedRoom = {
  type: string;
  capacity: number;
  basePrice: number;
};

export type ScrapedHotel = {
  name: string;
  description: string;
  address: string;
  city: string;
  state?: string;
  country: string;
  lat?: number;
  lng?: number;
  starRating?: number;
  rating?: number;
  reviewCount?: number;
  amenities: string[];
  rooms: ScrapedRoom[];
  contact: { phone?: string; email?: string; website?: string };
  policies: { checkIn?: string; checkOut?: string };
  // TRUE only when Gemini positively located this exact property online with a
  // verifiable public listing. FALSE → caller treats the scrape as a miss and
  // NEVER auto-fills guessed data.
  found: boolean;
  // What Gemini grounded on ("Google Maps", "booking.com", …) — shown to the
  // user as proof of the match in the confirmation step.
  matchEvidence?: string;
};

const GEMINI_MODEL =
  process.env.GEMINI_ONBOARD_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

const num = (v: any): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^\d.-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const str = (v: any): string | undefined => {
  const s = (v ?? "").toString().trim();
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "unknown" ? s : undefined;
};

// Pull the first {...} JSON object out of a possibly-fenced model response.
function extractJson(text: string): any | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function geminiScrapeHotel(
  name: string,
  city: string,
): Promise<{ provider: string; hotel: ScrapedHotel } | null> {
  // Prefer the onboarding-dedicated key, fall back to the customer-support
  // chat key (GEMINI_CHAT_API_KEY) so a single Gemini key powers both flows.
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_CHAT_API_KEY;
  if (!key || !name.trim()) return null;

  const prompt = `You are a strict hotel-data verifier. Use Google Search to locate the REAL, currently-operating property named "${name}"${city ? ` in ${city}, India` : " in India"}.

CRITICAL RULES — follow exactly:
- Set "found": true ONLY if you actually located THIS specific property online with a real, verifiable public listing (its Google Maps page, an OTA listing like booking.com / MakeMyTrip / Goibibo / Agoda, or its own official website). If you are guessing, extrapolating, or cannot confirm the hotel genuinely exists, set "found": false.
- NEVER invent, guess, or fabricate any value. Use null for every field you cannot verify from a real source. A wrong real-looking value (fake address / fake phone / fake email) is far worse than null. Do NOT output placeholder values like "Heritage Lane", "+91 98XXXXXXXX", "stay@example.com", lat/lng 0, or template descriptions.
- "match_evidence": short phrase naming WHERE you found it (e.g. "Google Maps listing", "booking.com page", "official website"). null if not found.

Return ONLY one JSON object (no prose, no markdown):
{
  "found": boolean,
  "match_evidence": string | null,
  "name": string | null,
  "description": string | null (2-3 factual sentences about THIS specific property, from its real listing),
  "full_address": string | null,
  "city": string | null,
  "state": string | null,
  "country": string | null,
  "lat": number | null,
  "lng": number | null,
  "star_rating": integer 1-5 | null,
  "guest_rating": number 0-5 | null,
  "review_count": integer | null,
  "amenities": string[] (real facilities only; [] if unknown),
  "contact_phone": string | null,
  "contact_email": string | null,
  "website": string | null,
  "room_types": [{ "type": string, "capacity": integer, "base_price_inr": integer }] (real rooms only; [] if unknown),
  "check_in_time": string "HH:MM" | null,
  "check_out_time": string "HH:MM" | null
}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // google_search grounding lets Gemini read the live web (free tier).
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 1200 },
      }),
    });
    if (!res.ok) throw new Error(`gemini-onboard ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p?.text || "")
      .join("\n");
    const j = extractJson(text);
    if (!j) throw new Error("no json");

    const rooms: ScrapedRoom[] = Array.isArray(j.room_types)
      ? j.room_types
          .map((r: any) => ({
            type: str(r?.type) || "Standard Room",
            capacity: num(r?.capacity) || 2,
            basePrice: num(r?.base_price_inr) || 0,
          }))
          .filter((r: ScrapedRoom) => r.basePrice > 0)
          .slice(0, 6)
      : [];

    const hotel: ScrapedHotel = {
      name: str(j.name) || name,
      description: str(j.description) || "",
      address: str(j.full_address) || "",
      city: str(j.city) || city || "India",
      state: str(j.state),
      country: str(j.country) || "India",
      lat: num(j.lat),
      lng: num(j.lng),
      starRating: num(j.star_rating),
      rating: num(j.guest_rating),
      reviewCount: num(j.review_count),
      amenities: Array.isArray(j.amenities)
        ? j.amenities.map((a: any) => str(a)).filter(Boolean).slice(0, 24) as string[]
        : [],
      rooms,
      contact: {
        phone: str(j.contact_phone),
        email: str(j.contact_email),
        website: str(j.website),
      },
      policies: {
        // checkIn/Out left undefined when unverified — no fabricated default.
        checkIn: str(j.check_in_time),
        checkOut: str(j.check_out_time),
      },
      found: j.found === true,
      matchEvidence: str(j.match_evidence),
    };

    // Hard-confirm rule: trust the scrape ONLY when Gemini self-reports found
    // AND there is at least one VERIFIABLE anchor (real address, coords, or a
    // website). A bare description is not enough — descriptions are the easiest
    // thing for an LLM to hallucinate. Anything weaker is a miss → blank draft.
    const hasAnchor =
      !!hotel.address || hotel.lat !== undefined || !!hotel.contact.website;
    if (!hotel.found || !hasAnchor) return null;

    return { provider: `gemini:${GEMINI_MODEL}`, hotel };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[gemini-scraper] error:", e);
    return null;
  }
}
