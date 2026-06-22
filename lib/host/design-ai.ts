// ============================================================================
// AI Setup & Design Studio — design generation (server-side)
// Provider auto-select: Gemini (free) → Claude (paid backup) → curated mock.
// Mirrors lib/verify/ai.ts contract: graceful fallback on no-key / no-image /
// any error, so the studio is fully functional WITHOUT any AI key.
// ============================================================================

export interface DesignProductSuggestion {
  name: string;
  category: string;       // furniture | appliance | decor | lighting | bedbath | amenity
  price: number;          // INR
  qty: number;
}
export interface DesignOption {
  style: string;
  title: string;
  description: string;
  estCost: number;
  products: DesignProductSuggestion[];
}
export interface DesignInput {
  images?: string[];      // public image URLs (optional)
  style?: string;         // requested style ("" = let AI pick a variety)
  roomType?: string;      // e.g. "Bedroom", "Living Room", "Studio"
  budgetMin?: number;
  budgetMax?: number;
}
export interface DesignResult { options: DesignOption[]; provider: string }

const CATEGORIES = ["furniture", "appliance", "decor", "lighting", "bedbath", "amenity", "outdoor"];
const GEMINI_MODEL = process.env.GEMINI_DESIGN_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_DESIGN_MODEL || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

export function pickProvider(): "gemini" | "claude" | "mock" {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return "mock";
}

// ---------------------------------------------------------------------------
// Curated mock — realistic India-priced setups. Products are ordered
// essentials-first so budget-trim drops luxuries from the end.
// ---------------------------------------------------------------------------
const STYLE_PRESETS: Omit<DesignOption, "estCost">[] = [
  {
    style: "Modern Luxury",
    title: "Modern Luxury — warm & premium",
    description: "Rich textures, warm wood tones and statement lighting for a high-end boutique feel guests love.",
    products: [
      { name: "King Size Bed (upholstered)", category: "furniture", price: 35000, qty: 1 },
      { name: "Premium Mattress (orthopedic)", category: "bedbath", price: 22000, qty: 1 },
      { name: "2-door Wardrobe", category: "furniture", price: 24000, qty: 1 },
      { name: "Smart TV 55\"", category: "appliance", price: 40000, qty: 1 },
      { name: "Bedside Tables (pair)", category: "furniture", price: 9000, qty: 1 },
      { name: "Designer Pendant Light", category: "lighting", price: 6500, qty: 2 },
      { name: "Blackout Curtains", category: "decor", price: 5500, qty: 1 },
      { name: "Wall Art Set", category: "decor", price: 4500, qty: 1 },
    ],
  },
  {
    style: "Minimalist",
    title: "Minimalist — clean & calm",
    description: "Neutral palette, clutter-free lines and functional pieces. Easy to maintain, photographs beautifully.",
    products: [
      { name: "Platform Queen Bed", category: "furniture", price: 22000, qty: 1 },
      { name: "Foam Mattress (medium-firm)", category: "bedbath", price: 14000, qty: 1 },
      { name: "Open Wardrobe Rack", category: "furniture", price: 8000, qty: 1 },
      { name: "Smart TV 43\"", category: "appliance", price: 26000, qty: 1 },
      { name: "Floating Nightstand", category: "furniture", price: 4500, qty: 2 },
      { name: "Warm LED Strip Lighting", category: "lighting", price: 2500, qty: 1 },
      { name: "Sheer Curtains", category: "decor", price: 3000, qty: 1 },
    ],
  },
  {
    style: "Boho Chic",
    title: "Boho Chic — cozy & characterful",
    description: "Layered textiles, rattan accents and earthy tones for a homely, Instagrammable stay.",
    products: [
      { name: "Wooden Queen Bed", category: "furniture", price: 20000, qty: 1 },
      { name: "Coir Mattress", category: "bedbath", price: 12000, qty: 1 },
      { name: "Cane Wardrobe", category: "furniture", price: 16000, qty: 1 },
      { name: "Macramé Wall Hanging", category: "decor", price: 2200, qty: 1 },
      { name: "Rattan Floor Lamp", category: "lighting", price: 4000, qty: 1 },
      { name: "Layered Cushions & Throw", category: "decor", price: 3500, qty: 1 },
      { name: "Jute Area Rug", category: "decor", price: 4500, qty: 1 },
      { name: "Potted Plants (set)", category: "decor", price: 2500, qty: 1 },
    ],
  },
  {
    style: "Urban Premium",
    title: "Urban Premium — sleek city stay",
    description: "Dark accents, smart appliances and space-saving furniture for the modern business traveller.",
    products: [
      { name: "Storage Queen Bed", category: "furniture", price: 26000, qty: 1 },
      { name: "Pocket-spring Mattress", category: "bedbath", price: 18000, qty: 1 },
      { name: "Sliding Wardrobe", category: "furniture", price: 28000, qty: 1 },
      { name: "Smart TV 50\"", category: "appliance", price: 34000, qty: 1 },
      { name: "Work Desk + Chair", category: "furniture", price: 11000, qty: 1 },
      { name: "1.5 Ton Inverter AC", category: "appliance", price: 36000, qty: 1 },
      { name: "Track Lighting", category: "lighting", price: 5000, qty: 1 },
    ],
  },
  {
    style: "Budget Friendly",
    title: "Budget Friendly — smart & complete",
    description: "Everything a guest needs at the best value. Durable, comfortable and quick to set up.",
    products: [
      { name: "Engineered-wood Double Bed", category: "furniture", price: 12000, qty: 1 },
      { name: "Bonded-foam Mattress", category: "bedbath", price: 8000, qty: 1 },
      { name: "2-shelf Wardrobe", category: "furniture", price: 9000, qty: 1 },
      { name: "LED TV 32\"", category: "appliance", price: 14000, qty: 1 },
      { name: "Bedside Table", category: "furniture", price: 2800, qty: 1 },
      { name: "Tube + Bedside Lamp", category: "lighting", price: 1800, qty: 1 },
      { name: "Curtains (pair)", category: "decor", price: 2200, qty: 1 },
    ],
  },
];

function cost(o: { products: DesignProductSuggestion[] }): number {
  return o.products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);
}

function budgetTrim(products: DesignProductSuggestion[], budgetMax?: number): DesignProductSuggestion[] {
  if (!budgetMax || budgetMax <= 0) return products;
  const list = [...products];
  while (list.length > 3 && cost({ products: list }) > budgetMax) list.pop();
  return list;
}

export function generateMock(input: DesignInput): DesignOption[] {
  const want = (input.style || "").trim().toLowerCase();
  let presets = STYLE_PRESETS;
  if (want) {
    const match = STYLE_PRESETS.filter((p) => p.style.toLowerCase().includes(want) || want.includes(p.style.toLowerCase()));
    const rest = STYLE_PRESETS.filter((p) => !match.includes(p));
    presets = [...match, ...rest].slice(0, match.length ? 3 : 5);
  } else {
    presets = STYLE_PRESETS.slice(0, 5);
  }
  return presets.map((p) => {
    const products = budgetTrim(p.products, input.budgetMax);
    return { ...p, products, estCost: cost({ products }) };
  });
}

// ---------------------------------------------------------------------------
// AI plumbing
// ---------------------------------------------------------------------------
function prompts(input: DesignInput): { sys: string; user: string } {
  const sys =
    "You are an expert interior designer for budget hotels, BnBs and serviced apartments in India. " +
    "You produce practical, fully-shoppable room setups. Prices must be realistic for India in INR. " +
    "Respond ONLY with strict JSON, no prose.";
  const styleLine = input.style ? `Target style: ${input.style}.` : "Suggest a variety of distinct styles.";
  const budgetLine =
    input.budgetMin || input.budgetMax
      ? `Budget per option: ₹${input.budgetMin || 0} to ₹${input.budgetMax || "open"}. Keep each option's total within budget.`
      : "No fixed budget — keep it practical.";
  const user =
    `Room type: ${input.roomType || "Hotel room"}. ${styleLine} ${budgetLine}\n` +
    (input.images?.length ? "Use the attached photos of the actual space to tailor suggestions.\n" : "") +
    `Return JSON shape exactly: {"options":[{"style":"","title":"","description":"","estCost":0,` +
    `"products":[{"name":"","category":"furniture|appliance|decor|lighting|bedbath|amenity|outdoor","price":0,"qty":1}]}]}\n` +
    "Give 3-5 options, each with 5-9 products. estCost must equal the sum of price*qty.";
  return { sys, user };
}

function coerce(raw: any): DesignOption[] {
  const arr = Array.isArray(raw?.options) ? raw.options : Array.isArray(raw) ? raw : [];
  const out: DesignOption[] = [];
  for (const o of arr.slice(0, 6)) {
    const products: DesignProductSuggestion[] = (Array.isArray(o?.products) ? o.products : [])
      .slice(0, 12)
      .map((p: any) => ({
        name: String(p?.name || "").slice(0, 120) || "Item",
        category: CATEGORIES.includes(String(p?.category)) ? String(p.category) : "furniture",
        price: Math.max(0, Math.round(Number(p?.price) || 0)),
        qty: Math.max(1, Math.round(Number(p?.qty) || 1)),
      }))
      .filter((p: DesignProductSuggestion) => p.name && p.name !== "Item" || p.price > 0);
    if (!products.length) continue;
    const estCost = Number(o?.estCost) > 0 ? Math.round(Number(o.estCost)) : cost({ products });
    out.push({
      style: String(o?.style || "Custom").slice(0, 60),
      title: String(o?.title || o?.style || "Design option").slice(0, 140),
      description: String(o?.description || "").slice(0, 500),
      estCost,
      products,
    });
  }
  return out;
}

function extractJson(text: string): any | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}

async function fetchInlineImage(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > 4_500_000) return null;
    return { mime, data: buf.toString("base64") };
  } catch { return null; }
}

async function viaGemini(input: DesignInput): Promise<DesignResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const { sys, user } = prompts(input);
  const parts: any[] = [{ text: `${sys}\n\n${user}` }];
  for (const u of (input.images || []).slice(0, 4)) {
    const img = await fetchInlineImage(u);
    if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  }
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1600, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("\n");
    const options = coerce(extractJson(text));
    if (!options.length) throw new Error("no options");
    return { options, provider: `gemini:${GEMINI_MODEL}` };
  } catch (e) {
    console.error("[design-ai] gemini error → mock:", e);
    return null;
  }
}

async function viaClaude(input: DesignInput): Promise<DesignResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const { sys, user } = prompts(input);
  const content: any[] = [{ type: "text", text: user }];
  for (const u of (input.images || []).slice(0, 4)) content.push({ type: "image", source: { type: "url", url: u } });
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1600, system: sys, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json();
    const text = (data?.content || []).map((b: any) => b?.text || "").join("\n");
    const options = coerce(extractJson(text));
    if (!options.length) throw new Error("no options");
    return { options, provider: `claude:${ANTHROPIC_MODEL}` };
  } catch (e) {
    console.error("[design-ai] claude error → mock:", e);
    return null;
  }
}

export async function generateDesignOptions(input: DesignInput): Promise<DesignResult> {
  const provider = pickProvider();
  if (provider === "gemini") {
    const r = await viaGemini(input);
    if (r) return r;
  } else if (provider === "claude") {
    const r = await viaClaude(input);
    if (r) return r;
  }
  return { options: generateMock(input), provider: "mock" };
}

export const DESIGN_STYLES = STYLE_PRESETS.map((p) => p.style);
export const DESIGN_ROOM_TYPES = ["Bedroom", "Living Room", "Studio Apartment", "Kitchen", "Bathroom", "Balcony / Outdoor", "Reception / Lobby"];
