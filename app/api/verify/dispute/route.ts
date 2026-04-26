import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { analyze } from "@/lib/verify/ai";

// POST /api/verify/dispute
//   { complaintId }   — runs AI dispute analyzer on the complaint, comparing
//                       the hotel's recorded proof video vs the customer's
//                       evidence video. Persists structured verdict to
//                       vp_complaints (ai_verdict / ai_confidence /
//                       discrepancies / recommended_resolution / auto_approvable).
//
// Resolution map (default): can be overridden by issue_type later.
const RESOLUTION_MAP: Record<string, Record<string, string>> = {
  customer_correct: {
    room_mismatch:   "refund",
    amenity_missing: "partial_refund",
    hygiene:         "partial_refund",
    other:           "partial_refund",
  },
  hotel_correct: {
    room_mismatch:   "denied",
    amenity_missing: "denied",
    hygiene:         "denied",
    other:           "denied",
  },
  inconclusive: {
    room_mismatch:   "review",
    amenity_missing: "review",
    hygiene:         "review",
    other:           "review",
  },
};

const AUTO_APPROVE_CONFIDENCE = 85;

export async function POST(req: Request) {
  try {
    const { complaintId } = await req.json();
    if (!complaintId) return NextResponse.json({ error: "complaintId required" }, { status: 400 });

    const cmps = await sbSelect<any>("vp_complaints", `id=eq.${complaintId}&limit=1`);
    const c = cmps[0];
    if (!c) return NextResponse.json({ error: "complaint not found" }, { status: 404 });

    // Pull both videos
    const reqs = c.request_id
      ? await sbSelect<any>("vp_requests", `id=eq.${c.request_id}&limit=1`)
      : [];
    const r = reqs[0];

    const [hVids, eVids] = await Promise.all([
      r?.hotel_video_id   ? sbSelect<any>("vp_videos", `id=eq.${r.hotel_video_id}&limit=1`)   : Promise.resolve([]),
      c.evidence_video_id ? sbSelect<any>("vp_videos", `id=eq.${c.evidence_video_id}&limit=1`) : Promise.resolve([]),
    ]);
    const hv = hVids[0];
    const ev = eVids[0];

    // Run analyzer (existing pluggable provider). We feed both videos.
    const ai = await analyze({
      requestId: r?.id || c.id,
      tier: r?.tier || "silver",
      hotelVideo: hv && {
        url: hv.url, storagePath: hv.storage_path,
        durationSecs: hv.actual_secs || 0,
        stepsCompleted: hv.steps_completed || [],
        verificationCode: hv.verification_code,
      },
      customerVideo: ev && {
        url: ev.url, storagePath: ev.storage_path,
        durationSecs: ev.actual_secs || 0,
        stepsCompleted: ev.steps_completed || [],
      },
    });

    // Map AI output → dispute verdict
    let verdict: "hotel_correct" | "customer_correct" | "inconclusive" = "inconclusive";
    if (ai.fraud_flag || (ai.customer_claim_validity === "high" && ai.trust_score < 60)) verdict = "customer_correct";
    else if (ai.hotel_validity === "high" && (!ai.customer_claim_validity || ai.customer_claim_validity === "low")) verdict = "hotel_correct";

    const confidence = Math.max(0, Math.min(100, ai.trust_score));
    const recommended = RESOLUTION_MAP[verdict][c.category || "other"] || "review";

    // Build discrepancies list from missing checks
    const discrepancies: any[] = [];
    if (ai.checks?.scene_match !== undefined && (ai.checks.scene_match || 0) < 0.7) {
      discrepancies.push({ field: "scene", message: "Hotel + customer videos depict different scenes" });
    }
    if (ai.issues_detected?.length) {
      ai.issues_detected.forEach((m) => discrepancies.push({ field: "general", message: m }));
    }

    // Persist verdict back on the complaint
    await sbUpdate("vp_complaints", `id=eq.${c.id}`, {
      ai_verdict: verdict,
      ai_confidence: confidence,
      discrepancies,
      recommended_resolution: recommended,
      auto_approvable: confidence >= AUTO_APPROVE_CONFIDENCE,
      status: c.status === "open" ? "reviewing" : c.status,
      updated_at: new Date().toISOString(),
    });

    // Also stash the raw AI report
    const reportRow = await sbInsert("vp_ai_reports", {
      request_id: r?.id || c.id,
      hotel_video_id: hv?.id || null,
      customer_video_id: ev?.id || null,
      trust_score: ai.trust_score,
      hotel_validity: ai.hotel_validity,
      customer_claim_validity: ai.customer_claim_validity,
      issues: ai.issues_detected,
      fraud_flag: ai.fraud_flag,
      checks: ai.checks,
      provider: ai.provider,
    });

    return NextResponse.json({
      complaintId,
      verdict,
      confidence,
      discrepancies,
      recommended_resolution: recommended,
      auto_approvable: confidence >= AUTO_APPROVE_CONFIDENCE,
      report_id: reportRow.id,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "dispute analysis failed" }, { status: 500 });
  }
}
