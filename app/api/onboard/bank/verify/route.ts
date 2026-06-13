import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert } from "@/lib/onboard/supabase-admin";
import { lookupIfsc, verifyBankPennyDrop, KYC_PROVIDER_NAME } from "@/lib/onboard/kyc-provider";

// POST /api/onboard/bank/verify
// Body: { mode: "ifsc" | "penny_drop", ifsc, account_number?, account_holder?, hotel_id? }
//  - "ifsc": real RBI directory lookup (no key needed) → bank/branch/address
//  - "penny_drop": account-exists + name-match (registry when a provider key
//    exists, else format-only with payouts held)
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const mode = String(body.mode || "ifsc").toLowerCase();

    if (mode === "ifsc") {
      const r = await lookupIfsc(body.ifsc);
      return NextResponse.json({ ...r, providerName: "razorpay-ifsc" });
    }

    if (mode === "penny_drop") {
      if (!body.account_number || !body.ifsc || !body.account_holder) {
        return NextResponse.json({ error: "account_number, ifsc and account_holder required" }, { status: 400 });
      }
      const r = await verifyBankPennyDrop(body.account_number, body.ifsc, body.account_holder);
      try {
        await sbInsert("onboarding_events", {
          user_id: claims.sub,
          hotel_id: body.hotel_id || null,
          event: "bank_penny_drop",
          payload: { ok: r.ok, provider: r.provider, level: r.level, nameMatchScore: r.data?.nameMatchScore, detail: r.detail },
          ip_address: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
          user_agent: req.headers.get("user-agent") || null,
        });
      } catch {}
      return NextResponse.json({ ...r, providerName: KYC_PROVIDER_NAME });
    }

    return NextResponse.json({ error: "mode must be ifsc | penny_drop" }, { status: 400 });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "bank verify failed" }, { status: 500 });
  }
}
