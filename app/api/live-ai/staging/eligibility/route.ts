// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — PRODUCT-02 — founder-only REAL AI TEXT eligibility route.
//
// Answers ONE question for the Travel Buddy: may THIS verified admin see the founder
// TEXT opt-in? It mints NO assertion, contacts NO gateway/provider, and writes nothing.
// The decision is the pure, hermetically tested lib/live-ai/founder-text-eligibility.ts,
// which reuses the existing staging authority chain unchanged. Default OFF
// (LIVE_AI_FOUNDER_TEXT_ENABLED). The staging session route remains the ONLY place an
// auth:true assertion is minted.
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { decideFounderTextEligibility } from "@/lib/live-ai/founder-text-eligibility";
import { requireVerifiedAdmin } from "@/lib/admin/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const out = await decideFounderTextEligibility({
    env: process.env,
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    authorization: req.headers.get("authorization"),
    xAdminToken: req.headers.get("x-admin-token"),
    verifyAdmin: () => requireVerifiedAdmin(req),
  });
  return NextResponse.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}
