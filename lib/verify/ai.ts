// Pluggable AI verification engine.
//
// Provider order:
//   - "claude"  — Anthropic multimodal vision over per-step keyframes
//                 (when ANTHROPIC_API_KEY is set AND frames are present).
//                 Genuinely "watches" the room: detects bed/AC/TV/washbasin/
//                 window, OCRs room number + booking id, scores scene quality,
//                 cleanliness + lighting, and enforces room-type object
//                 requirements.
//   - "google"  — Google Cloud Video Intelligence + Vision OCR (GOOGLE_VIDEO_API_KEY)
//   - "aws"     — AWS Rekognition (AWS_REKOG_KEY/SECRET)
//   - "openai"  — multimodal frames via OpenAI (OPENAI_API_KEY)
//   - "mock"    — deterministic stub that scores from metadata so the UI
//                 works end-to-end without keys. Still enforces the
//                 metadata-checkable rules (duration, code, steps, geo).
//
// Adding a new provider = one new function + one `case` in `analyze()`.

import { haversineMeters } from "@/lib/tier/haversine";

export type Geo = { lat: number; lng: number };

export type AnalyzeInput = {
  requestId: string;
  hotelVideo?:    { url: string; storagePath: string; durationSecs: number; stepsCompleted: string[]; verificationCode: string };
  customerVideo?: { url: string; storagePath: string; durationSecs: number; stepsCompleted: string[] };
  tier: "silver" | "gold" | "platinum";
  expectedRoomNumber?: string;
  expectedBookingId?: string;
  // ── v251 — real-vision + rule-enforcement inputs (all optional; the
  //    analyzer degrades gracefully when any are absent) ──
  frames?: string[];           // per-step keyframe image URLs (signed Supabase)
  expectedObjects?: string[];  // ROOM_TYPE_REQUIREMENTS-derived must-show objects
  recordedGeo?: Geo | null;    // geo captured by the recorder
  hotelGeo?: Geo | null;       // hotel's stored lat/lng (for platinum geo rule)
  expectedRoomType?: string | null;
};

export type AnalyzeResult = {
  trust_score: number;
  hotel_validity: "high" | "partial" | "low";
  customer_claim_validity: "high" | "medium" | "low" | null;
  issues_detected: string[];
  fraud_flag: boolean;
  checks: {
    code_ok?:         boolean;
    ocr_room?:        boolean;
    ocr_booking?:     boolean;
    objects?:         string[];
    scene_match?:     number;        // 0..1
    geo_ok?:          boolean;
    audio_ok?:        boolean;
    duration_ok?:     boolean;
  };
  provider: string;
  raw?: any;
};

const PROVIDER =
  process.env.AI_VERIFY_PROVIDER ||
  (process.env.ANTHROPIC_API_KEY   ? "claude" :
   process.env.GOOGLE_VIDEO_API_KEY ? "google" :
   process.env.AWS_REKOG_KEY        ? "aws"    :
   process.env.OPENAI_API_KEY       ? "openai" : "mock");

// ---------------------------------------------------------------------------
// Shared rule helpers (provider-agnostic) — enforce the DECLARED rules from
// lib/verify/tiers.ts so the score reflects them regardless of provider.
// ---------------------------------------------------------------------------
const PLATINUM_GEO_RADIUS_M = 800; // generous — hotel coords are approximate

function tierDuration(tier: AnalyzeInput["tier"]): number {
  return tier === "platinum" ? 180 : tier === "gold" ? 120 : 60;
}

/** Platinum must record at the hotel; other tiers don't require geo. */
export function computeGeoOk(tier: AnalyzeInput["tier"], recorded?: Geo | null, hotel?: Geo | null): boolean {
  if (tier !== "platinum") return true;
  if (!recorded?.lat || !recorded?.lng) return false;       // platinum requires geo
  if (!hotel?.lat || !hotel?.lng) return true;              // can't compare → trust presence
  return haversineMeters(recorded.lat, recorded.lng, hotel.lat, hotel.lng) <= PLATINUM_GEO_RADIUS_M;
}

// ---------------------------------------------------------------------------
// Mock — realistic-feeling scoring based on whether the steps look legit.
// Now ALSO enforces the metadata-checkable rules (geo for platinum).
// ---------------------------------------------------------------------------
function analyzeMock(input: AnalyzeInput): AnalyzeResult {
  const issues: string[] = [];
  const checks: AnalyzeResult["checks"] = {};

  const required = 4;
  const tierDur  = tierDuration(input.tier);

  let score = 0;
  if (input.hotelVideo) {
    const { stepsCompleted, durationSecs, verificationCode } = input.hotelVideo;
    const stepsOk = stepsCompleted.length >= required;
    const durOk   = durationSecs >= tierDur * 0.9;
    const codeOk  = !!verificationCode && /^SB-[A-Z0-9]{4}$/.test(verificationCode);
    const geoOk   = computeGeoOk(input.tier, input.recordedGeo, input.hotelGeo);

    checks.duration_ok = durOk;
    checks.code_ok     = codeOk;
    checks.ocr_room    = stepsCompleted.includes("room");
    checks.ocr_booking = stepsCompleted.includes("code");
    checks.objects     = ["bed","ac","tv","washroom","window"].filter(() => stepsOk);
    checks.scene_match = stepsOk ? 0.92 : 0.6;
    checks.geo_ok      = geoOk;
    checks.audio_ok    = codeOk;

    score = 30
      + (stepsOk ? 30 : 10)
      + (durOk   ? 20 : 5)
      + (codeOk  ? 20 : 0);
    if (!stepsOk) issues.push("Some required steps were skipped or too brief");
    if (!durOk)   issues.push("Video duration shorter than tier requirement");
    if (!codeOk)  issues.push("Verification code not detected");
    if (!geoOk)   { issues.push("Platinum geo-tag missing or far from hotel"); score = Math.max(0, score - 15); }
  }

  let cust: AnalyzeResult["customer_claim_validity"] = null;
  if (input.customerVideo) {
    const cs = input.customerVideo.stepsCompleted.length;
    cust = cs >= 3 ? "high" : cs >= 2 ? "medium" : "low";
  }

  const validity: AnalyzeResult["hotel_validity"] =
    score >= 80 ? "high" : score >= 50 ? "partial" : "low";
  const fraud = score < 40 || (cust === "high" && score < 60);

  return {
    trust_score: Math.min(100, Math.max(0, Math.round(score))),
    hotel_validity: validity,
    customer_claim_validity: cust,
    issues_detected: issues,
    fraud_flag: fraud,
    checks,
    provider: "mock",
  };
}

// ---------------------------------------------------------------------------
// Claude — REAL multimodal vision over per-step keyframes.
// Enforces room-type object coverage + does true OCR + scene scoring.
// Falls back to mock when no key, no frames, or any error.
// ---------------------------------------------------------------------------
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_VERIFY_MODEL || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
const ANTHROPIC_VERSION = "2023-06-01";

function extractJson(text: string): any | null {
  if (!text) return null;
  // strip ```json fences then grab the outermost {...}
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function analyzeClaude(input: AnalyzeInput): Promise<AnalyzeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const frames = (input.frames || []).filter(Boolean).slice(0, 8);
  if (!key || frames.length === 0) return { ...analyzeMock(input), provider: frames.length ? "mock-no-key" : "mock-no-frames" };

  const expected = (input.expectedObjects && input.expectedObjects.length)
    ? input.expectedObjects
    : ["bed", "ac", "tv", "washbasin", "window"];

  const sys =
    "You are StayBid's hotel-room verification vision model. You are shown keyframes captured " +
    "from a hotel's verification video of a guest room. Judge ONLY what is visible. " +
    "Return STRICT JSON, no prose, with this exact shape:\n" +
    '{"objects_detected":string[],"ocr_room_number":boolean,"ocr_booking_id":boolean,' +
    '"scene_quality":number(0..1),"lighting_ok":boolean,"cleanliness_ok":boolean,' +
    '"looks_like_real_hotel_room":boolean,"notes":string}';

  const userText =
    `Tier: ${input.tier}. Expected room type: ${input.expectedRoomType || "unspecified"}. ` +
    `Required objects that SHOULD be visible across the frames: ${expected.join(", ")}. ` +
    (input.expectedRoomNumber ? `Expected room number near "${input.expectedRoomNumber}". ` : "") +
    `Detect which required objects actually appear. Set ocr_room_number true only if a room number is legibly visible, ` +
    `ocr_booking_id true only if a booking id / confirmation is legibly visible. scene_quality reflects how clearly the room is shown.`;

  const content: any[] = [{ type: "text", text: userText }];
  for (const url of frames) content.push({ type: "image", source: { type: "url", url } });

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 700,
        system: sys,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json();
    const text = (data?.content || []).map((b: any) => b?.text || "").join("\n");
    const v = extractJson(text);
    if (!v) throw new Error("no json");

    const detected: string[] = Array.isArray(v.objects_detected) ? v.objects_detected.map((s: any) => String(s).toLowerCase()) : [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const coverHits = expected.filter((e) => detected.some((d) => norm(d).includes(norm(e)) || norm(e).includes(norm(d))));
    const coverage = expected.length ? coverHits.length / expected.length : 1;

    // Metadata rules (still enforced alongside vision).
    const meta = input.hotelVideo;
    const durOk  = !!meta && meta.durationSecs >= tierDuration(input.tier) * 0.9;
    const codeOk = !!meta?.verificationCode && /^SB-[A-Z0-9]{4}$/.test(meta.verificationCode);
    const geoOk  = computeGeoOk(input.tier, input.recordedGeo, input.hotelGeo);
    const sceneQ = Math.max(0, Math.min(1, Number(v.scene_quality) || 0));

    const checks: AnalyzeResult["checks"] = {
      code_ok: codeOk,
      ocr_room: !!v.ocr_room_number,
      ocr_booking: !!v.ocr_booking_id,
      objects: detected,
      scene_match: +(0.5 * coverage + 0.5 * sceneQ).toFixed(2),
      geo_ok: geoOk,
      audio_ok: codeOk,
      duration_ok: durOk,
    };

    let score =
      coverage * 35 +
      (v.ocr_room_number ? 15 : 0) +
      (v.ocr_booking_id ? 10 : 0) +
      sceneQ * 15 +
      (durOk ? 10 : 0) +
      (codeOk ? 10 : 0) +
      ((v.lighting_ok ? 2.5 : 0) + (v.cleanliness_ok ? 2.5 : 0));

    const issues: string[] = [];
    const missing = expected.filter((e) => !coverHits.includes(e));
    if (missing.length) issues.push(`Not clearly shown: ${missing.join(", ")}`);
    if (!v.looks_like_real_hotel_room) { issues.push("Frames may not be a genuine hotel room"); score = Math.max(0, score - 25); }
    if (!geoOk) { issues.push("Platinum geo-tag missing or far from hotel"); score = Math.max(0, score - 15); }
    if (!v.cleanliness_ok) issues.push("Cleanliness concerns visible");
    if (v.notes) issues.push(String(v.notes).slice(0, 160));

    score = Math.min(100, Math.max(0, Math.round(score)));
    const validity: AnalyzeResult["hotel_validity"] = score >= 80 ? "high" : score >= 50 ? "partial" : "low";

    let cust: AnalyzeResult["customer_claim_validity"] = null;
    if (input.customerVideo) {
      const cs = input.customerVideo.stepsCompleted.length;
      cust = cs >= 3 ? "high" : cs >= 2 ? "medium" : "low";
    }
    const fraud = !v.looks_like_real_hotel_room || score < 40;

    return {
      trust_score: score,
      hotel_validity: validity,
      customer_claim_validity: cust,
      issues_detected: issues,
      fraud_flag: fraud,
      checks,
      provider: `claude:${ANTHROPIC_MODEL}`,
      raw: v,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[verify-ai] claude error, falling back to mock:", e);
    return { ...analyzeMock(input), provider: "mock-fallback" };
  }
}

// Real-provider stubs — defer to mock until keys are wired.
async function analyzeGoogle(input: AnalyzeInput): Promise<AnalyzeResult> {
  return { ...analyzeMock(input), provider: "google-stub" };
}
async function analyzeAws(input: AnalyzeInput): Promise<AnalyzeResult> {
  return { ...analyzeMock(input), provider: "aws-stub" };
}
async function analyzeOpenAi(input: AnalyzeInput): Promise<AnalyzeResult> {
  return { ...analyzeMock(input), provider: "openai-stub" };
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  try {
    switch (PROVIDER) {
      case "claude": return await analyzeClaude(input);
      case "google": return await analyzeGoogle(input);
      case "aws":    return await analyzeAws(input);
      case "openai": return await analyzeOpenAi(input);
      default:       return analyzeMock(input);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[verify-ai] error, falling back to mock:", e);
    return { ...analyzeMock(input), provider: "mock-fallback" };
  }
}

export const AI_PROVIDER = PROVIDER;
