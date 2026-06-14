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
  const key = process.env.GEMINI_API_KEY;
  if (!key || !name.trim()) return null;

  const prompt = `You are a hotel data researcher. Use Google Search to find the real, currently-operating property named "${name}" in ${city || "India"}, India.

Return ONLY one JSON object (no prose, no markdown) with exactly these fields. Use null for anything you cannot verify — DO NOT invent values:
{
  "name": string,
  "description": string (2-3 factual sentences about this specific property),
  "full_address": string,
  "city": string,
  "state": string,
  "country": string,
  "lat": number,
  "lng": number,
  "star_rating": integer 1-5,
  "guest_rating": number 0-5,
  "review_count": integer,
  "amenities": string[] (real facilities this hotel offers),
  "contact_phone": string,
  "contact_email": string,
  "website": string,
  "room_types": [{ "type": string, "capacity": integer, "base_price_inr": integer }],
  "check_in_time": string "HH:MM",
  "check_out_time": string "HH:MM"
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
        checkIn: str(j.check_in_time) || "14:00",
        checkOut: str(j.check_out_time) || "11:00",
      },
    };

    // Require at least a usable signal (description OR address OR coords),
    // otherwise treat as a miss so the caller keeps the mock draft.
    if (!hotel.description && !hotel.address && hotel.lat === undefined) return null;

    return { provider: `gemini:${GEMINI_MODEL}`, hotel };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[gemini-scraper] error:", e);
    return null;
  }
}
