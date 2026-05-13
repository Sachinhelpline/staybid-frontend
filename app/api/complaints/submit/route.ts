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
    if (body.bookingId) row.bookingId = String(body.bookingId);
    if (body.hotelId)   row.hotelId   = String(body.hotelId);
    if (body.bidId)     row.bidId     = String(body.bidId);
    if (body.paymentId) row.paymentId = String(body.paymentId);

    const res = await fetch(`${SB_URL}/rest/v1/complaints`, {
      method: "POST",
      headers: SB_H,
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
