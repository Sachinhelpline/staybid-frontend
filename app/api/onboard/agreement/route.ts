import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect } from "@/lib/onboard/supabase-admin";
import {
  CURRENT_VERSION, COMMISSION_PERCENT, CANCELLATION_POLICY,
  LIABILITY_CLAUSE, DISPUTE_CLAUSE, fullAgreementText, hashAgreement,
} from "@/lib/onboard/legal";

// GET /api/onboard/agreement
//   → { version, commissionPercent, cancellation, liability, dispute, fullText }
export async function GET() {
  return NextResponse.json({
    version: CURRENT_VERSION,
    commissionPercent: COMMISSION_PERCENT,
    cancellation: CANCELLATION_POLICY,
    liability: LIABILITY_CLAUSE,
    dispute: DISPUTE_CLAUSE,
    fullText: fullAgreementText(),
  });
}

// POST /api/onboard/agreement { hotel_id }   → records signed acceptance
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const text = fullAgreementText();
    const ipHeader = req.headers.get("x-forwarded-for") || "";
    const ip = ipHeader.split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") || null;

    // Already signed for this hotel + version? return that record.
    if (body.hotel_id) {
      const prev = await sbSelect<any>(
        "host_agreements",
        `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(body.hotel_id)}&version=eq.${encodeURIComponent(CURRENT_VERSION)}&limit=1`
      );
      if (prev[0]) return NextResponse.json({ agreement: prev[0], existed: true });
    }

    const row = await sbInsert("host_agreements", {
      user_id: claims.sub,
      hotel_id: body.hotel_id || null,
      version: CURRENT_VERSION,
      commission_percent: COMMISSION_PERCENT,
      cancellation_policy: CANCELLATION_POLICY,
      liability_clause: LIABILITY_CLAUSE,
      dispute_clause: DISPUTE_CLAUSE,
      full_text_hash: hashAgreement(text),
      ip_address: ip,
      user_agent: ua,
    });
    return NextResponse.json({ agreement: row });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "agreement failed" }, { status: 500 });
  }
}
