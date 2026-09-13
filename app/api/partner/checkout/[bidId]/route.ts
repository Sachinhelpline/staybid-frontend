import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { resolveVerifiedPartnerScope } from "@/lib/auth/verified-partner-authority";
import { createPartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority-factory";
import {
  writeVerifiedStayEvidence,
  evidenceConfigured,
  readVerifiedStayEvidenceForSource,
  evidenceBindingMatches,
} from "@/lib/stay/verified-stay-evidence";
import { istDateISO, evaluateCheckOutTiming } from "@/lib/stay/stay-dates";

export const runtime = "nodejs"; // JWT verify (jsonwebtoken) is server-only; never edge
export const dynamic = "force-dynamic";

const FEEDBACK_WINDOW_HOURS = 4;
const partnerAuthority = createPartnerAuthorityDeps();

/** Deterministic id for the one feedback-window notification per stay (idempotent). */
function feedbackWindowNotificationId(bidId: string): string {
  return `ntf_fbwin_${bidId}`;
}

// POST /api/partner/checkout/[bidId]
// Hotel partner marks check-out. SEC-00B hardened exactly like check-in: the
// partner token is cryptographically verified, the partner must be authorized
// for this bid's hotel via the PROTECTED verified_partner_hotel_scope binding
// (service-role, deny-by-default; NOT the client-writable hotels.ownerId /
// hotel_room_units mappings), and the AUTHORITATIVE result is a protected
// verified_stay_evidence row (proof_state='checked_out'). The existing display
// side-effects (log / bids.status / video_lifecycle / feedback / notification)
// are preserved as best-effort, non-authority writes.
//
// HONEST BOUNDARY (owner follow-up): same as check-in — evidence requires a
// signed HS256 token AND an ACTIVE protected verified_partner_hotel_scope
// binding for this exact (subject, hotel) AND the service-role key + the v746
// (evidence) & v747 (partner scope) migrations applied. A forged public
// ownership row or an unsigned stub grants nothing; Verified-Guest stays
// fail-closed until all hold. This route never weakens to accept them.
//
// LIFECYCLE PRECONDITION (SEC-00B remediation): CHECKED_OUT is itself a trusted
// Verified-Guest state, so minting it must NOT be an alternate bypass of the
// check-in pre-state gate. A NEW checkout may write proof_state='checked_out'
// ONLY when ALL hold: the bid is genuinely CHECKED_IN; the protected evidence
// read SUCCEEDED; a deterministic evidence row exists for THIS bid; its complete
// immutable binding (source_type=bid + source_id=bidId + customer_id + hotel_id)
// matches; and its existing proof_state is 'checked_in'. Then checked_out is
// merged onto that row. PENDING / COUNTER / ACCEPTED / REJECTED / EXPIRED /
// CANCELLED / DECLINED / unknown / null → 409 with ZERO evidence write; a
// CHECKED_IN bid with no/mismatched/malformed checked_in evidence → 409; a
// matching checked_out row → idempotent success with ZERO rewrite. The protected
// read is TRI-STATE: a read FAILURE fails closed (503) and is never conflated with
// "no evidence". The forgeable payment markers (bid_paid_amounts / bids.message)
// are NEVER read and can never bypass this gate.
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

    // ── SEC-00B lifecycle precondition (before ANY authoritative write) ───────
    // A NEW checkout may mint checked_out evidence ONLY when the bid is genuinely
    // CHECKED_IN AND a protected checked_in evidence row already exists for THIS
    // exact reservation. This closes the alternate bypass where an authorized
    // partner could mint a trusted CHECKED_OUT (itself a Verified-Guest state)
    // directly from any pre-state. The forgeable payment markers are NOT read.
    const up = (s: unknown) => String(s ?? "").trim().toUpperCase();
    const status = up(bid.status);
    const custId = String(bid.customerId ?? "");
    const hotId = String(bid.hotelId);

    // Tri-state protected read — a read FAILURE fails closed (503), never treated
    // as "no evidence".
    const read = await readVerifiedStayEvidenceForSource("bid", String(params.bidId));
    if (read.status === "error") {
      return NextResponse.json({ error: "verified_stay_unavailable" }, { status: 503 });
    }
    const existingEvidence = read.status === "found" ? read.row : null;

    // Any pre-existing protected row MUST match THIS bid's complete immutable
    // binding, else it is malformed / a different reservation → NEVER touched.
    if (
      existingEvidence &&
      !evidenceBindingMatches(existingEvidence, {
        sourceType: "bid",
        sourceId: String(params.bidId),
        customerId: custId,
        hotelId: hotId,
      })
    ) {
      return NextResponse.json({ error: "verified_stay_conflict" }, { status: 409 });
    }
    const ps = existingEvidence ? String(existingEvidence.proof_state) : null;

    // Replay: a matching checked_out row is idempotent success — ZERO rewrite.
    if (existingEvidence && ps === "checked_out") {
      return NextResponse.json({
        ok: true,
        alreadyCheckedOut: true,
        checkout_time: existingEvidence.check_out_at || existingEvidence.verified_at,
      });
    }

    // A NEW checkout requires a genuinely CHECKED_IN bid. PENDING / COUNTER /
    // ACCEPTED / REJECTED / EXPIRED / CANCELLED / DECLINED / unknown / null (and a
    // CHECKED_OUT bid with no matching checked_out evidence) mint ZERO evidence.
    if (status !== "CHECKED_IN") {
      return NextResponse.json({ error: "bid_not_checked_in", status }, { status: 409 });
    }
    // …AND that CHECKED_IN bid must be backed by a VALID checked_in protected row.
    // The mutable bids.status alone can never authorize minting checked_out.
    if (ps !== "checked_in") {
      return NextResponse.json({ error: "verified_stay_conflict" }, { status: 409 });
    }

    // ── STAY-LIFECYCLE-OPS-01 — EARLY checkout is EXPLICIT + AUDITABLE ───────
    // A genuinely checked-in guest may leave before the scheduled check-out
    // date, so the date never BLOCKS a checkout. But an early departure must
    // not be indistinguishable from a normal one: when today(IST) is before the
    // scheduled checkOut, the caller must explicitly confirm (`confirmEarly`),
    // and the fact + optional reason is recorded on the lifecycle log. Dates are
    // read server-side; a read FAILURE fails closed (never "not early").
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const confirmEarly = body?.confirmEarly === true;
    const earlyReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    const today = istDateISO();
    let request: any = null;
    if (bid.requestId) {
      try {
        request = (await sbSelect<any>(
          "bid_requests",
          `id=eq.${encodeURIComponent(String(bid.requestId))}&select=id,checkIn,checkOut&limit=1`
        ))[0] || null;
      } catch {
        return NextResponse.json({ error: "stay_dates_unavailable" }, { status: 503 });
      }
    }
    const timing = evaluateCheckOutTiming({ checkOut: request?.checkOut, todayISO: today });
    if (timing.early && !confirmEarly) {
      return NextResponse.json(
        { error: "early_checkout_confirmation_required", scheduledCheckOut: timing.scheduledCheckOut, today },
        { status: 409 }
      );
    }
    const earlyNote = timing.early
      ? `early checkout: scheduled ${timing.scheduledCheckOut}, actual ${today}${earlyReason ? ` — ${earlyReason}` : ""}`
      : null;

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
      // Audit trail: an early checkout is recorded explicitly in `notes`.
      const notesPatch = earlyNote ? { notes: earlyNote } : {};
      if (existing) {
        await sbUpdate("checkin_checkout_logs", `booking_id=eq.${params.bidId}`, {
          checkout_time: nowIso, marked_by: scope.subject, updated_at: nowIso, ...notesPatch,
        });
      } else {
        await sbInsert("checkin_checkout_logs", {
          booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
          checkout_time: nowIso, marked_by: scope.subject, ...notesPatch,
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

    // 5. queue the feedback-window notification (best-effort, but HONEST).
    //    STAY-LIFECYCLE-OPS-01: the live `notifications` schema has `id TEXT NOT
    //    NULL` with NO default, so the previous id-less insert failed on every
    //    checkout and the failure was silently swallowed — the guest never got
    //    the "How was your stay?" prompt. The insert now carries a DETERMINISTIC
    //    id (one notification per stay → idempotent on replay, never duplicated)
    //    and a failure is logged with its reason instead of being hidden. It
    //    still never blocks an already-verified checkout.
    let notificationQueued = false;
    const nid = feedbackWindowNotificationId(String(params.bidId));
    let alreadyQueued = false;
    try {
      alreadyQueued = !!(await sbSelect<any>("notifications", `id=eq.${encodeURIComponent(nid)}&select=id&limit=1`))[0];
    } catch { /* unknown → attempt the insert; the deterministic PK prevents a duplicate */ }
    if (alreadyQueued) {
      notificationQueued = true;
    } else {
      try {
        await sbInsert("notifications", {
          id: nid,
          userId: bid.customerId,
          type: "feedback_window_opened",
          title: "How was your stay?",
          body: `You have ${FEEDBACK_WINDOW_HOURS} hours to submit feedback. Your verification video will be deleted after that.`,
          meta: { bookingId: params.bidId, expiry: expiry.toISOString() },
        });
        notificationQueued = true;
      } catch (e: any) {
        console.warn(`[checkout] feedback_window_opened notification NOT queued for ${params.bidId}: ${e?.message || e}`);
      }
    }

    return NextResponse.json({
      ok: true,
      checkout_time: nowIso,
      expiry_time: expiry.toISOString(),
      earlyCheckout: timing.early,
      scheduledCheckOut: timing.scheduledCheckOut,
      notificationQueued,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "checkout failed" }, { status: 500 });
  }
}
