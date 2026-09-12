import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { resolveVerifiedPartnerScope } from "@/lib/auth/verified-partner-authority";
import { createPartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority-factory";
import {
  writeVerifiedStayEvidence,
  evidenceConfigured,
  readVerifiedStayEvidenceForSource,
} from "@/lib/stay/verified-stay-evidence";

export const runtime = "nodejs"; // JWT verify (jsonwebtoken) is server-only; never edge
export const dynamic = "force-dynamic";

const partnerAuthority = createPartnerAuthorityDeps();

// POST /api/partner/checkin/[bidId]
// Hotel partner marks the guest as checked in. SEC-00B hardened:
//   • the partner token is CRYPTOGRAPHICALLY verified (HS256) — decode-only /
//     forged / unsigned tokens are rejected;
//   • the partner must be AUTHORIZED for this bid's hotel via the PROTECTED,
//     forge-proof verified_partner_hotel_scope binding (service-role, deny-by-
//     default) — NOT the client-writable hotels.ownerId / hotel_room_units
//     mappings, so forging a public ownership row grants no scope;
//   • the AUTHORITATIVE result is a row in the protected verified_stay_evidence
//     table (service-role only, forge-proof) — this, not the mutable public
//     bids.status / checkin_checkout_logs, is what Verified-Guest trusts.
// The legacy status + log writes are kept as best-effort DISPLAY side-effects.
//
// HONEST BOUNDARY (owner follow-up): evidence creation requires ALL of —
//   (a) a genuinely HS256-signed customer-family token (an unsigned/alg:none
//       token, incl. any legacy stub, is rejected 401);
//   (b) an ACTIVE protected verified_partner_hotel_scope binding for this exact
//       (subject, hotel) — created only by a service-role ops/admin path; a
//       forged public hotels.ownerId / hotel_room_units row grants nothing;
//   (c) the service-role key set AND the v746 (evidence) + v747 (partner scope)
//       migrations applied.
// Until all three hold, Verified-Guest stays fail-closed (no evidence ⇒ no
// AUTO_APPROVE) — the intended safe default. This route never weakens to accept
// a stub or a client-writable ownership mapping.
//
// LIFECYCLE PRECONDITION (SEC-00B remediation): minting TRUSTED evidence also
// requires a legitimate pre-check-in bid state. An authorized partner must NOT
// be able to promote a not-yet-accepted bid straight to CHECKED_IN evidence, so
// a NEW check-in transition may be minted ONLY when the existing bid state is
// ACCEPTED. Why ACCEPTED (not "CONFIRMED"): the live bids schema has no CONFIRMED
// state, and a paid bid stays ACCEPTED (its "paid" markers are FORGEABLE, so they
// are NEVER an authorization requirement here — bid_paid_amounts / bids.message
// are not consulted); the accepted contract treats an authenticated partner
// CHECKED_IN/CHECKED_OUT as the strong physical-stay proof, so ACCEPTED is the
// smallest correct pre-state. PENDING / COUNTER / REJECTED / EXPIRED / CANCELLED /
// DECLINED / unknown / null are rejected 409 with ZERO evidence write. A repeated
// check-in of an already-CHECKED_IN bid is idempotent success ONLY when the
// matching protected evidence already records the checked_in proof (never a fresh
// mint); a mismatched/malformed pre-existing evidence row is a 409 conflict and is
// NEVER minted over. CHECKED_OUT is a completed stay, not a new check-in (409).
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

    // ── SEC-00B lifecycle precondition (before ANY authoritative write) ───────
    // A NEW check-in may mint trusted evidence ONLY from an ACCEPTED bid. The
    // forgeable payment markers (bid_paid_amounts / bids.message) are NOT read
    // and can never bypass this gate.
    const up = (s: unknown) => String(s ?? "").trim().toUpperCase();
    const status = up(bid.status);
    const custId = String(bid.customerId ?? "");
    const hotId = String(bid.hotelId);

    // The deterministic protected evidence row for THIS bid (service-role read;
    // fail-closed null). Enforces replay idempotency and refuses to ever mint
    // over a mismatched/malformed pre-existing row.
    const existingEvidence = await readVerifiedStayEvidenceForSource(
      "bid",
      String(params.bidId)
    );

    // Mismatched/malformed pre-existing evidence (not bound to THIS bid's
    // customer + hotel) is NEVER silently accepted or overwritten.
    if (
      existingEvidence &&
      (String(existingEvidence.customer_id) !== custId ||
        String(existingEvidence.hotel_id) !== hotId)
    ) {
      return NextResponse.json({ error: "verified_stay_conflict" }, { status: 409 });
    }

    // Replay: an already-CHECKED_IN source is idempotent success ONLY when the
    // matching protected evidence already records the checked_in proof — never a
    // fresh mint from the mutable bids.status alone.
    if (status === "CHECKED_IN") {
      if (existingEvidence && String(existingEvidence.proof_state) === "checked_in") {
        return NextResponse.json({
          ok: true,
          alreadyCheckedIn: true,
          checkin_time: existingEvidence.check_in_at || existingEvidence.verified_at,
        });
      }
      return NextResponse.json({ error: "verified_stay_conflict" }, { status: 409 });
    }

    // A completed stay is NOT a new check-in transition.
    if (status === "CHECKED_OUT") {
      return NextResponse.json({ error: "already_checked_out" }, { status: 409 });
    }

    // The ONLY pre-state from which a NEW check-in may be minted is ACCEPTED.
    // Everything else (PENDING / COUNTER / REJECTED / EXPIRED / CANCELLED /
    // DECLINED / unknown / null) is rejected with ZERO evidence write.
    if (status !== "ACCEPTED") {
      return NextResponse.json({ error: "bid_not_accepted", status }, { status: 409 });
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
