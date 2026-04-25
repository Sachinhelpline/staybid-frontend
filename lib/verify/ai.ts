// Pluggable AI verification engine.
//
// Provider order:
//   - "google"  — Google Cloud Video Intelligence + Vision OCR (when GOOGLE_VIDEO_API_KEY set)
//   - "aws"     — AWS Rekognition (when AWS_REKOG_KEY/SECRET set)
//   - "openai"  — multimodal image/video frames via Anthropic/OpenAI (when set)
//   - "mock"    — deterministic stub that scores realistically based on
//                 metadata so the UI works end-to-end without keys.
//
// Adding a new provider = one new function + one `case` in `analyze()`.

export type AnalyzeInput = {
  requestId: string;
  hotelVideo?:    { url: string; storagePath: string; durationSecs: number; stepsCompleted: string[]; verificationCode: string };
  customerVideo?: { url: string; storagePath: string; durationSecs: number; stepsCompleted: string[] };
  tier: "silver" | "gold" | "platinum";
  expectedRoomNumber?: string;
  expectedBookingId?: string;
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
  (process.env.GOOGLE_VIDEO_API_KEY ? "google" :
   process.env.AWS_REKOG_KEY        ? "aws"    :
   process.env.OPENAI_API_KEY       ? "openai" : "mock");

// ---------------------------------------------------------------------------
// Mock — realistic-feeling scoring based on whether the steps look legit.
// Defaults to "high" trust if duration is within 10% of target and all steps
// fired. Otherwise drops the score predictably so the UI can demo all states.
// ---------------------------------------------------------------------------
function analyzeMock(input: AnalyzeInput): AnalyzeResult {
  const issues: string[] = [];
  const checks: AnalyzeResult["checks"] = {};

  const required = input.tier === "platinum" ? 9 : input.tier === "gold" ? 7 : 6;
  const tierDur  = input.tier === "platinum" ? 180 : input.tier === "gold" ? 120 : 60;

  let score = 0;
  if (input.hotelVideo) {
    const { stepsCompleted, durationSecs, verificationCode } = input.hotelVideo;
    const stepsOk = stepsCompleted.length >= required;
    const durOk   = durationSecs >= tierDur * 0.9;
    const codeOk  = !!verificationCode && /^SB-[A-Z0-9]{4}$/.test(verificationCode);

    checks.duration_ok = durOk;
    checks.code_ok     = codeOk;
    checks.ocr_room    = stepsCompleted.includes("room_no");
    checks.ocr_booking = stepsCompleted.includes("booking_id") || input.tier === "silver";
    checks.objects     = ["bed","ac","tv","washroom","window"].filter(() => stepsOk);
    checks.scene_match = stepsOk ? 0.92 : 0.6;
    checks.geo_ok      = input.tier !== "platinum" ? true : stepsCompleted.includes("geo_capture");
    checks.audio_ok    = codeOk;

    score = 30
      + (stepsOk ? 30 : 10)
      + (durOk   ? 20 : 5)
      + (codeOk  ? 20 : 0);
    if (!stepsOk) issues.push("Some required steps were skipped or too brief");
    if (!durOk)   issues.push("Video duration shorter than tier requirement");
    if (!codeOk)  issues.push("Verification code not detected");
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

// Real-provider stubs — defer to mock until keys are wired.
// Each can be filled in independently without touching callers.
async function analyzeGoogle(input: AnalyzeInput): Promise<AnalyzeResult> {
  // TODO: wire google video intelligence (LABEL_DETECTION, TEXT_DETECTION,
  //       SHOT_CHANGE_DETECTION) + speech-to-text for code/booking-id.
  return { ...analyzeMock(input), provider: "google-stub" };
}
async function analyzeAws(input: AnalyzeInput): Promise<AnalyzeResult> {
  // TODO: wire Rekognition Video + Transcribe.
  return { ...analyzeMock(input), provider: "aws-stub" };
}
async function analyzeOpenAi(input: AnalyzeInput): Promise<AnalyzeResult> {
  // TODO: extract keyframes, feed to multimodal model with structured prompt.
  return { ...analyzeMock(input), provider: "openai-stub" };
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  try {
    switch (PROVIDER) {
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
