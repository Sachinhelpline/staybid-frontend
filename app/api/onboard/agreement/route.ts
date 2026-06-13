import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import {
  CURRENT_VERSION, COMMISSION_DEFAULT, COMMISSION_MIN, COMMISSION_MAX, clampCommission,
  CANCELLATION_POLICY, COMMISSION_RULES, SETTLEMENT_CLAUSE, COMPLIANCE_CLAUSE,
  DATA_CLAUSE, LIABILITY_CLAUSE, TERMINATION_CLAUSE, DISPUTE_CLAUSE, ESIGN_CLAUSE,
  CONSENT_ITEMS, fullAgreementText, hashAgreement,
} from "@/lib/onboard/legal";

// GET /api/onboard/agreement?commission=10
//   → full versioned terms, with commission baked into the preview text.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pct = clampCommission(url.searchParams.get("commission") ?? COMMISSION_DEFAULT);
  return NextResponse.json({
    version: CURRENT_VERSION,
    commissionPercent: pct,
    commissionMin: COMMISSION_MIN,
    commissionMax: COMMISSION_MAX,
    commissionDefault: COMMISSION_DEFAULT,
    consentItems: CONSENT_ITEMS.map((c) => ({ key: c.key, label: c.label, detail: c.detail })),
    clauses: {
      commissionRules: COMMISSION_RULES,
      settlement: SETTLEMENT_CLAUSE,
      cancellation: CANCELLATION_POLICY,
      compliance: COMPLIANCE_CLAUSE,
      data: DATA_CLAUSE,
      liability: LIABILITY_CLAUSE,
      termination: TERMINATION_CLAUSE,
      dispute: DISPUTE_CLAUSE,
      esign: ESIGN_CLAUSE,
    },
    fullText: fullAgreementText(pct),
  });
}

// POST /api/onboard/agreement
//   { hotel_id, commission_percent, signature_name, onboarded_via?, agent_code? }
//   Records a signed, hashed acceptance + persists the negotiated commission
//   onto the hotel. Idempotent per (user, hotel, version, commission).
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const pct = clampCommission(body.commission_percent ?? COMMISSION_DEFAULT);
    const sigName = String(body.signature_name || "").trim();
    if (!sigName || sigName.length < 3) {
      return NextResponse.json({ error: "Please type your full legal name to e-sign." }, { status: 400 });
    }

    const text = fullAgreementText(pct);
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") || null;

    // Return existing identical signature if present
    if (body.hotel_id) {
      const prev = await sbSelect<any>(
        "host_agreements",
        `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(body.hotel_id)}&version=eq.${encodeURIComponent(CURRENT_VERSION)}&commission_percent=eq.${pct}&limit=1`
      );
      if (prev[0]) return NextResponse.json({ agreement: prev[0], existed: true });
    }

    const row = await sbInsert("host_agreements", {
      user_id: claims.sub,
      hotel_id: body.hotel_id || null,
      version: CURRENT_VERSION,
      commission_percent: pct,
      cancellation_policy: CANCELLATION_POLICY,
      liability_clause: LIABILITY_CLAUSE,
      dispute_clause: DISPUTE_CLAUSE,
      full_text_hash: hashAgreement(text),
      signature_name: sigName,
      signed_method: "clickwrap",
      onboarded_via: body.onboarded_via || "self",
      agent_code: body.agent_code || null,
      ip_address: ip,
      user_agent: ua,
    });

    // Persist negotiated commission onto the hotel (drives payouts platform-wide)
    if (body.hotel_id) {
      try { await sbUpdate("hotels", `id=eq.${encodeURIComponent(body.hotel_id)}`, { commission_percent: pct }); } catch {}
      try {
        await sbInsert("onboarding_events", {
          user_id: claims.sub, hotel_id: body.hotel_id,
          event: "agreement_signed",
          payload: { version: CURRENT_VERSION, commission: pct, signature_name: sigName, hash: hashAgreement(text) },
          ip_address: ip, user_agent: ua,
        });
      } catch {}
    }

    return NextResponse.json({ agreement: row });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "agreement failed" }, { status: 500 });
  }
}
