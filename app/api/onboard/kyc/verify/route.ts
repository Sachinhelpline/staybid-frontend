import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert } from "@/lib/onboard/supabase-admin";
import { verifyPan, verifyGstin, verifyAadhaar, KYC_PROVIDER_NAME, KYC_IS_REGISTRY } from "@/lib/onboard/kyc-provider";

// POST /api/onboard/kyc/verify
// Body: { field: "pan" | "gstin" | "aadhaar", value, name?, hotel_id? }
// Runs the digital verifier (registry when a provider key exists, else
// government-format + checksum). Never stores the full Aadhaar — only last4.
// Logs an onboarding_event for the audit trail.
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const field = String(body.field || "").toLowerCase();
    const value = String(body.value || "");
    if (!value) return NextResponse.json({ error: "value required" }, { status: 400 });

    let result;
    if (field === "pan") result = await verifyPan(value, body.name);
    else if (field === "gstin") result = await verifyGstin(value);
    else if (field === "aadhaar") result = await verifyAadhaar(value);
    else return NextResponse.json({ error: "field must be pan | gstin | aadhaar" }, { status: 400 });

    // Audit (never log the raw Aadhaar number)
    try {
      await sbInsert("onboarding_events", {
        user_id: claims.sub,
        hotel_id: body.hotel_id || null,
        event: `kyc_verify_${field}`,
        payload: {
          ok: result.ok, provider: result.provider, level: result.level,
          last4: field === "aadhaar" ? (result as any).last4 : undefined,
          detail: result.detail,
        },
        ip_address: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
        user_agent: req.headers.get("user-agent") || null,
      });
    } catch {}

    return NextResponse.json({
      ...result,
      providerName: KYC_PROVIDER_NAME,
      isRegistry: KYC_IS_REGISTRY,
    });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "verify failed" }, { status: 500 });
  }
}
