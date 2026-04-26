import { NextResponse } from "next/server";
import { STEPS } from "@/lib/verify/tiers";

// POST /api/verify/step-check
//   multipart: file (segment blob) + stepId + bookingId? + verificationCode?
// Returns AI per-step pass/fail + score so the recorder can lock-in or
// force a re-record before moving on.
//
// In mock mode the score is derived from blob size / duration heuristics so
// the UI demos all states. Plug in a real provider via AI_VERIFY_PROVIDER
// (google/aws/openai) — same lib/verify/ai.ts switching point.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const stepId = String(form.get("stepId") || "");
    const code = String(form.get("verificationCode") || "");
    const step = STEPS.find((s) => s.id === stepId);
    if (!step) return NextResponse.json({ error: "unknown stepId" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });

    // Mock heuristic: a "good enough" recording is at least ~min size + min duration.
    const sizeKb = file.size / 1024;
    const baseScore = Math.min(1, sizeKb / (step.minSecs * 80));   // ~80 KB per sec target
    const codeBonus = step.id === "code" && /SB-[A-Z0-9]{4}/.test(code) ? 0.15 : 0;
    const score = Math.min(1, baseScore + codeBonus);

    const passed = score >= step.min_pass_score;
    // Detected labels (mock) — server returns the full ai_checks list, marking
    // each as detected when the score crosses the threshold. Real providers
    // would return per-label confidences.
    const detected = passed ? step.ai_checks : step.ai_checks.slice(0, Math.max(1, Math.floor(step.ai_checks.length / 2)));
    const missing = step.ai_checks.filter((c) => !detected.includes(c));

    const feedback = !passed
      ? (step.id === "room" && missing.includes("bed_detected") ? "🛏️ Bed dikhao — frame me laao"
        : step.id === "washroom" && missing.includes("washbasin_detected") ? "🚿 Washbasin frame me laao"
        : step.id === "view" && missing.includes("window_detected") ? "🪟 Window/balcony dikhao"
        : step.id === "code" ? "🎙️ Code aur Booking ID clearly bolein"
        : "Step incomplete — re-record karein")
      : "✅ Achha! Step approved";

    return NextResponse.json({
      stepId,
      passed,
      score: Math.round(score * 100) / 100,
      detected,
      missing,
      feedback,
      provider: process.env.AI_VERIFY_PROVIDER || "mock",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "step-check failed" }, { status: 500 });
  }
}
