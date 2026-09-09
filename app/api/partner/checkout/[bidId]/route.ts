import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { resolveVerifiedPartnerScope } from "@/lib/auth/verified-partner-authority";
import { createPartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority-factory";
import { writeVerifiedStayEvidence, evidenceConfigured } from "@/lib/stay/verified-stay-evidence";

export const runtime = "nodejs"; // JWT verify (jsonwebtoken) is server-only; never edge
export const dynamic = "force-dynamic";

const FEEDBACK_WINDOW_HOURS = 4;
const partnerAuthority = createPartnerAuthorityDeps();

// POST /api/partner/checkout/[bidId]
// Hotel partner marks check-out. SEC-00B hardened exactly like check-in: the
// partner token is cryptographically verified, the partner must be authorized
// for this bid's hotel, and the AUTHORITATIVE result is a protected
// verified_stay_evidence row (proof_state='checked_out'). The existing display
// side-effects (log / bids.status / video_lifecycle / feedback / notification)
// are preserved as best-effort, non-authority writes.
//
// HONEST BOUNDARY (owner follow-up): same as check-in — the unsigned `alg:none`
// google-login stub token is REJECTED (401) here by design, so evidence is
// reachable only via a signed HS256 partner token; Verified-Guest stays
// fail-closed until partner sessions are signed AND the v746 migration is
// applied. This route does NOT weaken to accept the stub.
export async function POST(req: Request, props: { params: Promise<{ bidId: string }> }) {
  const params = await props.params;
  try {
    const bid = (await sbSelect<any>("bids", `id=eq.${params.bidId}&limit=1`))[0];
    if (!bid) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
    if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!bid.hotelId || !scope.hotelIds.includes(String(bid.hotelId))) {
      return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiry = new Date(now.getTime() + FEEDBACK_WINDOW_HOURS * 3600_000);

    // AUTHORITATIVE verified-stay evidence (service-role; fail closed).
    if (!evidenceConfigured()) {
      return NextResponse.json({ error: "verified_stay_unconfigured" }, { status: 503 });
    }
    const ev = await writeVerifiedStayEvidence({
      customerId: String(bid.customerId),
      hotelId: String(bid.hotelId),
      sourceType: "bid",
      sourceId: String(params.bidId),
      proofState: "checked_out",
      verifierType: "partner",
      verifierId: scope.subject,
      at: nowIso,
    });
    if (!ev.ok) return NextResponse.json({ error: "verified_stay_write_failed" }, { status: 503 });

    // ── Legacy DISPLAY / lifecycle side-effects (best-effort; NOT authority) ──
    // 1. checkin_checkout_logs
    try {
      const existing = (await sbSelect<any>("checkin_checkout_logs", `booking_id=eq.${params.bidId}&limit=1`))[0];
      if (existing) {
        await sbUpdate("checkin_checkout_logs", `booking_id=eq.${params.bidId}`, {
          checkout_time: nowIso, marked_by: scope.subject, updated_at: nowIso,
        });
      } else {
        await sbInsert("checkin_checkout_logs", {
          booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
          checkout_time: nowIso, marked_by: scope.subject,
        });
      }
    } catch {}

    // 2. bids.status
    try {
      await fetch(`${SB.url}/rest/v1/bids?id=eq.${params.bidId}`, {
        method: "PATCH",
        headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CHECKED_OUT" }),
      });
    } catch {}

    // 3. video_lifecycle (idempotent)
    try {
      const vlcExisting = (await sbSelect<any>("video_lifecycle", `booking_id=eq.${params.bidId}&limit=1`))[0];
      const vp = (await sbSelect<any>("vp_requests", `booking_id=eq.${params.bidId}&order=created_at.desc&limit=1`))[0];
      if (!vlcExisting) {
        await sbInsert("video_lifecycle", {
          booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
          vp_request_id: vp?.id || null,
          expiry_time: expiry.toISOString(),
          status: "active",
        });
      }
    } catch {}

    // 4. feedback_tracking
    try {
      const fbExisting = (await sbSelect<any>("feedback_tracking", `booking_id=eq.${params.bidId}&limit=1`))[0];
      if (!fbExisting) {
        await sbInsert("feedback_tracking", {
          booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
          submitted: false,
        });
      }
    } catch {}

    // 5. queue initial notification (best-effort)
    try {
      await sbInsert("notifications", {
        userId: bid.customerId,
        type: "feedback_window_opened",
        title: "How was your stay?",
        body: `You have ${FEEDBACK_WINDOW_HOURS} hours to submit feedback. Your verification video will be deleted after that.`,
        meta: { bookingId: params.bidId, expiry: expiry.toISOString() },
      });
    } catch { /* notifications table schema may differ — non-fatal */ }

    return NextResponse.json({ ok: true, checkout_time: nowIso, expiry_time: expiry.toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "checkout failed" }, { status: 500 });
  }
}
