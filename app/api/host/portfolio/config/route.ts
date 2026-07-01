import { NextResponse } from "next/server";
import { resolveWizardConfig } from "@/lib/host/wizard-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/host/portfolio/config
// Public — returns the resolved wizard config (admin overrides merged over
// defaults) so the client wizard's live preview matches the server charge.
// Short CDN cache; the server /checkout always re-resolves authoritatively.
export async function GET() {
  const config = await resolveWizardConfig();
  return NextResponse.json(
    { ok: true, config },
    {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
