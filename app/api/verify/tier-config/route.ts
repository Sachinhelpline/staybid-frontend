import { NextResponse } from "next/server";
import { stepsForTier, durationForTier, normaliseTier, SLA_HOURS } from "@/lib/verify/tiers";

// GET /api/verify/tier-config?tier=silver|gold|platinum&code=SB-XXXX
// Returns the step list (with the dynamic code substituted in) + duration + SLA.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const tier = normaliseTier(u.searchParams.get("tier"));
  const code = u.searchParams.get("code") || "";
  const steps = stepsForTier(tier).map((s) => ({
    ...s,
    prompt: s.prompt.replace("{{code}}", code),
  }));
  return NextResponse.json({
    tier,
    durationSecs: durationForTier(tier),
    slaHours: SLA_HOURS[tier],
    steps,
  });
}
