// Customer ↔ Hotel chat for confirmed bookings.
// Pre-booking comms are anti-bypass blocked (v25 rule); this is the
// post-booking trip-coordination channel that's gated to the actual
// booking owner ↔ booked property.
//
// Auth: customer uses sb_token (Bearer). Hotel partner uses sb_partner_token
//       (separate header `x-partner-token`). Admin can read all via
//       sb_admin_token (separate API at /api/admin/messages — TODO).
//
// GET  /api/booking-messages?bidId=X    list conversation for a single bid
// POST /api/booking-messages             send a message
//        body: { bidId, body }
//        sender is auto-detected from which token is provided.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";
import { sanitizeText } from "@/lib/sanitize-text";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

// Resolve the sender from incoming headers. Customer + hotel sides are
// auth-separated so the same endpoint serves both.
async function resolveSender(req: NextRequest): Promise<
  | { kind: "customer"; userId: string }
  | { kind: "hotel"; hotelId: string; partnerUserId: string }
  | null
> {
  // Customer-side: standard sb_token Bearer
  const customer = userFromReq(req);
  if (customer?.id) return { kind: "customer", userId: customer.id };

  // Hotel-side: sb_partner_token — decode same JWT format
  const partnerTok = req.headers.get("x-partner-token") || "";
  if (partnerTok) {
    try {
      const payload = JSON.parse(
        Buffer.from(partnerTok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
      );
      if (payload?.id) {
        // Find a hotel owned by this user (matches partner-panel resolveOwnerIds pattern)
        const hotelId = req.headers.get("x-partner-hotel-id");
        if (hotelId) return { kind: "hotel", hotelId, partnerUserId: payload.id };
      }
    } catch {}
  }
  return null;
}

// Verify the sender has access to this bid (customer owns it OR
// hotel owns the property the bid is on).
async function authorizedFor(bidId: string, sender: NonNullable<Awaited<ReturnType<typeof resolveSender>>>): Promise<{ ok: boolean; bid?: any }> {
  const rows = await sbGet(`bids?id=eq.${encodeURIComponent(bidId)}&select=id,status,hotelId,customerId`);
  const bid = (rows as any[])[0];
  if (!bid) return { ok: false };

  if (sender.kind === "customer" && bid.customerId === sender.userId) return { ok: true, bid };
  if (sender.kind === "hotel" && bid.hotelId === sender.hotelId)     return { ok: true, bid };
  return { ok: false };
}

const CONFIRMED_STATUSES = new Set(["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);

export async function GET(req: NextRequest) {
  const sender = await resolveSender(req);
  if (!sender) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const bidId = searchParams.get("bidId");
  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });

  const auth = await authorizedFor(bidId, sender);
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const rows = await sbGet(`booking_messages?bid_id=eq.${encodeURIComponent(bidId)}&order=created_at.asc&limit=200`);
    // Strip hidden messages from non-admin response
    const visible = (rows as any[]).filter((m) => !m.hidden_at);
    return NextResponse.json({ messages: visible });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sender = await resolveSender(req);
  if (!sender) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { bidId, body } = await req.json();
    if (!bidId || !body || typeof body !== "string") {
      return NextResponse.json({ error: "bidId + body required" }, { status: 400 });
    }
    if (body.length > 1000) {
      return NextResponse.json({ error: "Message too long (max 1000 chars)" }, { status: 400 });
    }

    const auth = await authorizedFor(bidId, sender);
    if (!auth.ok || !auth.bid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Only confirmed bookings get a chat channel
    if (!CONFIRMED_STATUSES.has(auth.bid.status)) {
      return NextResponse.json(
        { error: "Chat available only on confirmed bookings. Pay first to unlock." },
        { status: 409 }
      );
    }

    const { clean, blocked } = sanitizeText(body.trim());
    if (!clean || clean.length === 0) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    const row = {
      bid_id:      bidId,
      hotel_id:    auth.bid.hotelId,
      customer_id: auth.bid.customerId,
      sender:      sender.kind,
      sender_id:   sender.kind === "customer" ? sender.userId : sender.partnerUserId,
      body:        clean,
    };

    const r = await fetch(`${SB_URL}/rest/v1/booking_messages`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify(row),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data?.message || "Send failed" }, { status: 500 });

    return NextResponse.json({ ok: true, message: (data as any[])[0] || data, sanitized: blocked });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH /api/booking-messages   body { bidId, markRead: true }
// Marks all messages from the OTHER side as read on this conversation.
export async function PATCH(req: NextRequest) {
  const sender = await resolveSender(req);
  if (!sender) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { bidId, markRead } = await req.json();
    if (!bidId || !markRead) return NextResponse.json({ error: "bidId + markRead required" }, { status: 400 });
    const auth = await authorizedFor(bidId, sender);
    if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const otherSide = sender.kind === "customer" ? "hotel" : "customer";
    const r = await fetch(
      `${SB_URL}/rest/v1/booking_messages?bid_id=eq.${encodeURIComponent(bidId)}&sender=eq.${otherSide}&read_at=is.null`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ read_at: new Date().toISOString() }) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Mark-read failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
