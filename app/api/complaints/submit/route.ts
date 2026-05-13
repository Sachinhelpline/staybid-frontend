// POST /api/complaints/submit
//   Customer-side complaint creation. Writes to the `complaints` table
//   that /admin/complaints has been reading since Session 1 of the
//   admin-panel build. Until v98, that admin page was always empty —
//   only `vp_complaints` (video evidence) had a customer surface.
//
// Body: { type, subject, description, priority?, bookingId?, hotelId?,
//         bidId?, paymentId? }
// Auth: Bearer sb_token (customer JWT)
import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { ensureUser } from "@/lib/sb-server";

const VALID_TYPES = new Set(["bid", "booking", "payment", "service", "refund", "video", "general", "other"]);
const VALID_PRIORITY = new Set(["low", "medium", "high"]);

export async function POST(req: Request) {
  try {
    const u = userFromReq(req);
    if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const type = VALID_TYPES.has(body.type) ? body.type : "general";
    const priority = VALID_PRIORITY.has(body.priority) ? body.priority : "low";

    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 180) : "";
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";
    if (!description) {
      return NextResponse.json({ error: "Description required" }, { status: 400 });
    }

    const row: Record<string, any> = {
      customerId: u.id,
      customerPhone: u.phone || null,
      type,
      priority,
      subject: subject || null,
      description,
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // v106.1 — defensive id routing. The customer-side composer collapses
    // bookings + accepted bids into one dropdown (because /api/bookings/my
    // returns bids-as-bookings in this codebase — public.bookings has 0
    // rows in prod, every "booking" the customer sees is actually a row
    // from public.bids). So `body.bookingId` may actually be a bid id
    // (prefix "bid_"). complaints.bookingId has a strict FK to
    // public.bookings(id) — inserting "bid_xxx" there returns 23503 and
    // produces the visible "Failed to save complaint" error.
    //
    // Fix: classify by id prefix server-side AND verify presence in the
    // bookings table before keeping it as bookingId. Mis-routed ids fall
    // back to bidId which has no FK in this schema (soft reference only).
    const rawBookingId = body.bookingId ? String(body.bookingId).trim() : "";
    const rawBidId     = body.bidId     ? String(body.bidId).trim()     : "";

    if (rawBookingId) {
      const looksLikeBid = /^bid[_-]/i.test(rawBookingId);
      if (looksLikeBid) {
        // Route to bidId, skip bookings FK entirely.
        if (!rawBidId) row.bidId = rawBookingId;
      } else {
        // Validate against bookings table before trusting the FK.
        try {
          const check = await fetch(
            `${SB_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(rawBookingId)}&select=id&limit=1`,
            { headers: SB_H },
          );
          const found = await check.json().catch(() => []);
          if (Array.isArray(found) && found.length > 0) {
            row.bookingId = rawBookingId;
          } else {
            // Booking id doesn't exist in bookings table — store as bid
            // reference (most likely scenario in this codebase) so the
            // complaint isn't lost just because the FK target was wrong.
            if (!rawBidId) row.bidId = rawBookingId;
          }
        } catch {
          if (!rawBidId) row.bidId = rawBookingId;
        }
      }
    }
    if (rawBidId) row.bidId = rawBidId;
    if (body.hotelId)   row.hotelId   = String(body.hotelId);
    if (body.paymentId) row.paymentId = String(body.paymentId);

    // v105.1 — complaints.customerId has a FK constraint pointing at
    // public.users.id. Firebase Google-sign-in customers may not have a
    // mirrored users row (the /api/auth/social-login backend route was
    // never deployed — see CLAUDE.md), so the FK fails for them and the
    // insert errors out with code 23503 "Key is not present in table users".
    // ensureUser() upserts the users row first (resolution=merge-duplicates),
    // so subsequent customers get a placeholder row + the complaint
    // submission succeeds. Idempotent — safe to call every time.
    await ensureUser(u.id, u.phone, (u as any).name);

    const res = await fetch(`${SB_URL}/rest/v1/complaints?select=*`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: "Failed to save complaint", detail }, { status: 500 });
    }
    const created = (await res.json().catch(() => []))[0];

    // Best-effort queue an admin notification (notification_queue is read
    // by the existing notification worker; failure is non-fatal).
    fetch(`${SB_URL}/rest/v1/notification_queue`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({
        kind: "complaint_new",
        target: "admin",
        priority: priority === "high" ? "high" : "normal",
        payload: { complaintId: created?.id, type, subject, fromUserId: u.id },
        status: "pending",
      }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, complaint: created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "submit failed" }, { status: 500 });
  }
}
