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
  // ── v251.3 — spoken-code verification (Gemini audio). The "code" step's
  //    short clip is fed to Gemini to TRANSCRIBE the spoken words and check
  //    the dynamic code / room number / booking id were actually said aloud.
  //    Optional — absent → falls back to the metadata code check. ──
  codeClipUrl?: string | null; // signed URL of the spoken "code" step clip
  expectedCode?: string | null;
};

// Result of the spoken-audio pass (Gemini transcribes the code step).
type SpokenResult = {
  spoken_code_ok: boolean;
  spoken_room_ok: boolean;
  spoken_booking_ok: boolean;
  transcript: string;
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

// Provider auto-select order (v251.1): Gemini is the FREE primary, Anthropic
// is the paid backup kept fully wired for the future. To force one explicitly,
// set AI_VERIFY_PROVIDER=gemini|claude|google|aws|openai|mock.
const PROVIDER =
  process.env.AI_VERIFY_PROVIDER ||
  (process.env.GEMINI_API_KEY      ? "gemini" :   // ← FREE primary (Google AI Studio)
   process.env.ANTHROPIC_API_KEY   ? "claude" :   // ← paid backup (future switch)
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

// Default object set every room must show when no room-type rule applies.
function expectedObjectsFor(input: AnalyzeInput): string[] {
  return input.expectedObjects && input.expectedObjects.length
    ? input.expectedObjects
    : ["bed", "ac", "tv", "washbasin", "window"];
}

// Shared system + user prompt for any vision provider (Claude / Gemini / …).
function visionPrompts(input: AnalyzeInput) {
  const expected = expectedObjectsFor(input);
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
  return { sys, userText, expected };
}

// Shared scoring — turns a vision provider's parsed JSON into an AnalyzeResult.
// Used by BOTH Claude and Gemini so the score is identical across providers.
// `spoken` (optional, v251.3) carries the Gemini audio-transcription result
// for the spoken "code" step.
function buildVisionResult(input: AnalyzeInput, v: any, providerLabel: string, spoken?: SpokenResult | null): AnalyzeResult {
  const expected = expectedObjectsFor(input);
  const detected: string[] = Array.isArray(v.objects_detected) ? v.objects_detected.map((s: any) => String(s).toLowerCase()) : [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const coverHits = expected.filter((e) => detected.some((d) => norm(d).includes(norm(e)) || norm(e).includes(norm(d))));
  const coverage = expected.length ? coverHits.length / expected.length : 1;

  const meta = input.hotelVideo;
  const durOk  = !!meta && meta.durationSecs >= tierDuration(input.tier) * 0.9;
  const codeWellFormed = !!meta?.verificationCode && /^SB-[A-Z0-9]{4}$/.test(meta.verificationCode);
  // v251.3 — if we have a spoken-audio result, the code is "ok" only when it
  // was ACTUALLY SPOKEN ALOUD correctly. Without audio, fall back to the
  // well-formed metadata check (previous behaviour).
  const codeOk = spoken ? spoken.spoken_code_ok : codeWellFormed;
  const geoOk  = computeGeoOk(input.tier, input.recordedGeo, input.hotelGeo);
  const sceneQ = Math.max(0, Math.min(1, Number(v.scene_quality) || 0));
  // audio_ok reflects whether the spoken-code step's audio genuinely carried
  // the code; without an audio pass it mirrors the metadata code check.
  const audioOk = spoken ? spoken.spoken_code_ok : codeWellFormed;

  const checks: AnalyzeResult["checks"] = {
    code_ok: codeOk,
    // OCR can be confirmed by EITHER the visible frame OR the spoken word.
    ocr_room: !!v.ocr_room_number || !!spoken?.spoken_room_ok,
    ocr_booking: !!v.ocr_booking_id || !!spoken?.spoken_booking_ok,
    objects: detected,
    scene_match: +(0.5 * coverage + 0.5 * sceneQ).toFixed(2),
    geo_ok: geoOk,
    audio_ok: audioOk,
    duration_ok: durOk,
  };

  let score =
    coverage * 35 +
    (checks.ocr_room ? 15 : 0) +
    (checks.ocr_booking ? 10 : 0) +
    sceneQ * 15 +
    (durOk ? 10 : 0) +
    (codeOk ? 10 : 0) +
    ((v.lighting_ok ? 2.5 : 0) + (v.cleanliness_ok ? 2.5 : 0));

  const issues: string[] = [];
  const missing = expected.filter((e) => !coverHits.includes(e));
  if (missing.length) issues.push(`Not clearly shown: ${missing.join(", ")}`);
  if (!v.looks_like_real_hotel_room) { issues.push("Frames may not be a genuine hotel room"); score = Math.max(0, score - 25); }
  if (!geoOk) { issues.push("Platinum geo-tag missing or far from hotel"); score = Math.max(0, score - 15); }
  // v251.3 — anti-fraud: code step exists but the code was NOT spoken aloud.
  if (spoken && !spoken.spoken_code_ok) { issues.push("Verification code was not spoken aloud correctly"); score = Math.max(0, score - 15); }
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
    provider: providerLabel,
    raw: spoken ? { ...v, spoken_transcript: spoken.transcript, spoken } : v,
  };
}

async function analyzeClaude(input: AnalyzeInput): Promise<AnalyzeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const frames = (input.frames || []).filter(Boolean).slice(0, 8);
  if (!key || frames.length === 0) return { ...analyzeMock(input), provider: frames.length ? "mock-no-key" : "mock-no-frames" };

  const { sys, userText } = visionPrompts(input);
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
    return buildVisionResult(input, v, `claude:${ANTHROPIC_MODEL}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[verify-ai] claude error, falling back to mock:", e);
    return { ...analyzeMock(input), provider: "mock-fallback" };
  }
}

// ---------------------------------------------------------------------------
// Gemini — FREE multimodal vision (Google AI Studio). v251.1 primary provider.
// Gemini's generateContent takes inline base64 image parts (not arbitrary
// URLs), so we fetch each signed keyframe and inline it. Falls back to mock
// when no key, no frames, or any error — identical contract to Claude.
// Get a free key (no card) at: https://aistudio.google.com → "Get API key".
// ---------------------------------------------------------------------------
const GEMINI_MODEL = process.env.GEMINI_VERIFY_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function fetchAsInlineImage(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > 4_500_000) return null; // skip empty / oversized
    return { mime: mime.split(";")[0].trim(), data: buf.toString("base64") };
  } catch { return null; }
}

// v251.3 — fetch the short spoken "code" clip as inline base64 for Gemini.
// The clip is a webm/mp4 video with audio; Gemini reads the audio track too.
async function fetchAsInlineMedia(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") || "video/webm").split(";")[0].trim();
    const buf = Buffer.from(await r.arrayBuffer());
    // The code step is ~5-10s; cap at ~18 MB to stay well within inline limits.
    if (buf.length === 0 || buf.length > 18_000_000) return null;
    return { mime, data: buf.toString("base64") };
  } catch { return null; }
}

// v251.3 — Gemini audio pass: transcribe the spoken code step + check the
// dynamic code / room number / booking id were actually SAID ALOUD. Returns
// null on any failure so the caller falls back to the metadata code check.
async function geminiTranscribeCode(input: AnalyzeInput): Promise<SpokenResult | null> {
  const key = process.env.GEMINI_API_KEY;
  const clipUrl = input.codeClipUrl;
  const expectedCode = (input.expectedCode || input.hotelVideo?.verificationCode || "").trim();
  if (!key || !clipUrl) return null;

  const media = await fetchAsInlineMedia(clipUrl);
  if (!media) return null;

  const sys =
    "You transcribe a short hotel-staff verification clip and verify what was spoken. " +
    "Return STRICT JSON only: " +
    '{"transcript":string,"spoken_code_ok":boolean,"spoken_room_ok":boolean,"spoken_booking_ok":boolean}';
  const userText =
    `Listen to the audio. The staff was asked to speak aloud: a room number, a booking id, and the ` +
    `verification code "${expectedCode || "SB-XXXX"}". Transcribe what you hear into "transcript". ` +
    `Set spoken_code_ok=true ONLY if the verification code "${expectedCode}" (letters/digits, ignore spaces, ` +
    `case-insensitive, "SB" may be said as "S B" / "es bee") is clearly spoken. ` +
    `Set spoken_room_ok=true if a room number is spoken, spoken_booking_ok=true if a booking id / confirmation number is spoken.`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: userText }, { inline_data: { mime_type: media.mime, data: media.data } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) throw new Error(`gemini-audio ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("\n");
    const v = extractJson(text);
    if (!v) return null;

    // Defensive double-check: confirm the expected code really appears in the
    // transcript (normalised) — don't blindly trust the model's boolean.
    const transcript = String(v.transcript || "");
    let codeOk = !!v.spoken_code_ok;
    if (expectedCode) {
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
      codeOk = codeOk && norm(transcript).includes(norm(expectedCode));
    }
    return {
      spoken_code_ok: codeOk,
      spoken_room_ok: !!v.spoken_room_ok,
      spoken_booking_ok: !!v.spoken_booking_ok,
      transcript: transcript.slice(0, 400),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[verify-ai] gemini audio error (non-fatal):", e);
    return null;
  }
}

async function analyzeGemini(input: AnalyzeInput): Promise<AnalyzeResult> {
  const key = process.env.GEMINI_API_KEY;
  const frameUrls = (input.frames || []).filter(Boolean).slice(0, 8);
  if (!key || frameUrls.length === 0) return { ...analyzeMock(input), provider: frameUrls.length ? "mock-no-key" : "mock-no-frames" };

  const { sys, userText } = visionPrompts(input);

  // Inline the frames (Gemini needs base64, not URLs). Drop any that fail.
  const inlined = (await Promise.all(frameUrls.map(fetchAsInlineImage))).filter(Boolean) as { mime: string; data: string }[];
  if (inlined.length === 0) return { ...analyzeMock(input), provider: "mock-no-frames" };

  const parts: any[] = [{ text: userText }];
  for (const img of inlined) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    // v251.3 — run vision + spoken-audio transcription in parallel. The audio
    // pass is fully optional: null result → metadata code check (no regression).
    const [res, spoken] = await Promise.all([
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0, maxOutputTokens: 700, responseMimeType: "application/json" },
        }),
      }),
      geminiTranscribeCode(input).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("\n");
    const v = extractJson(text);
    if (!v) throw new Error("no json");
    return buildVisionResult(input, v, `gemini:${GEMINI_MODEL}`, spoken);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[verify-ai] gemini error, falling back to mock:", e);
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
      case "gemini": return await analyzeGemini(input);
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
