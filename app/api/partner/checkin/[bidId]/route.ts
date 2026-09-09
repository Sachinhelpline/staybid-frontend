import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { resolveVerifiedPartnerScope } from "@/lib/auth/verified-partner-authority";
import { createPartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority-factory";
import { writeVerifiedStayEvidence, evidenceConfigured } from "@/lib/stay/verified-stay-evidence";

export const runtime = "nodejs"; // JWT verify (jsonwebtoken) is server-only; never edge
export const dynamic = "force-dynamic";

const partnerAuthority = createPartnerAuthorityDeps();

// POST /api/partner/checkin/[bidId]
// Hotel partner marks the guest as checked in. SEC-00B hardened:
//   • the partner token is CRYPTOGRAPHICALLY verified (HS256) — decode-only /
//     forged / unsigned tokens are rejected;
//   • the partner must be AUTHORIZED for this bid's hotel (owns/operates it);
//   • the AUTHORITATIVE result is a row in the protected verified_stay_evidence
//     table (service-role only, forge-proof) — this, not the mutable public
//     bids.status / checkin_checkout_logs, is what Verified-Guest trusts.
// The legacy status + log writes are kept as best-effort DISPLAY side-effects.
//
// HONEST BOUNDARY (owner follow-up): the current PRIMARY partner login
// (/api/partner/google-login) mints an UNSIGNED `alg:none` stub token — that
// decode-only trust is exactly the hole this route closes, so such a token is
// now REJECTED (401) here. Evidence creation is therefore reachable only by a
// genuinely HS256-signed customer-family partner token; Verified-Guest stays
// fail-closed (no evidence ⇒ no AUTO_APPROVE) until partner sessions are
// upgraded to signed tokens AND the v746 migration is applied. This route does
// NOT weaken to accept the stub — that would reopen the forgery.
export async function POST(req: Request, props: { params: Promise<{ bidId: string }> }) {
  const params = await props.params;
  try {
    // Read the bid first (service-role read, no side effect) to learn the hotel
    // + customer this check-in is for.
    const bid = (await sbSelect<any>("bids", `id=eq.${params.bidId}&limit=1`))[0];
    if (!bid) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    // Cryptographic partner authority (reject decode-only / forged tokens).
    const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
    if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The partner must be authorized for THIS bid's hotel (never another's).
    if (!bid.hotelId || !scope.hotelIds.includes(String(bid.hotelId))) {
      return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
    }

    const now = new Date().toISOString();

    // AUTHORITATIVE write. Evidence is the ONLY Verified-Guest authority, so a
    // check-in that cannot record it must fail closed (503) rather than silently
    // relying on the forgeable bids.status.
    if (!evidenceConfigured()) {
      return NextResponse.json({ error: "verified_stay_unconfigured" }, { status: 503 });
    }
    const ev = await writeVerifiedStayEvidence({
      customerId: String(bid.customerId),
      hotelId: String(bid.hotelId),
      sourceType: "bid",
      sourceId: String(params.bidId),
      proofState: "checked_in",
      verifierType: "partner",
      verifierId: scope.subject,
      at: now,
    });
    if (!ev.ok) return NextResponse.json({ error: "verified_stay_write_failed" }, { status: 503 });

    // ── Legacy DISPLAY side-effects (best-effort; NOT authority) ──────────────
    try {
      const existing = (await sbSelect<any>("checkin_checkout_logs", `booking_id=eq.${params.bidId}&limit=1`))[0];
      if (existing) {
        await sbUpdate("checkin_checkout_logs", `booking_id=eq.${params.bidId}`, {
          checkin_time: now, marked_by: scope.subject, updated_at: now,
        });
      } else {
        await sbInsert("checkin_checkout_logs", {
          booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
          checkin_time: now, marked_by: scope.subject,
        });
      }
    } catch {}
    try {
      await fetch(`${SB.url}/rest/v1/bids?id=eq.${params.bidId}`, {
        method: "PATCH",
        headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CHECKED_IN" }),
      });
    } catch {}

    return NextResponse.json({ ok: true, checkin_time: now });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "checkin failed" }, { status: 500 });
  }
}
