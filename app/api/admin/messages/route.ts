// Admin Messages moderation API.
// GET /api/admin/messages                    list conversations (grouped by bid_id)
// GET /api/admin/messages?bidId=X            full conversation for that bid
// PATCH /api/admin/messages                  hide / unhide a message
//        body: { messageId, action: "hide" | "unhide" }

import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const bidId = searchParams.get("bidId");
  const flaggedOnly = searchParams.get("flagged") === "1";
  const search = searchParams.get("search");

  try {
    if (bidId) {
      // Full conversation including hidden ones (admin moderator view)
      const messages = await sbGet(`booking_messages?bid_id=eq.${encodeURIComponent(bidId)}&order=created_at.asc&limit=500`) as any[];
      // Enrich with customer + hotel info
      const bidRows = await sbGet(`bids?id=eq.${encodeURIComponent(bidId)}&select=id,hotelId,customerId,status`) as any[];
      const bid = bidRows[0];
      let customer: any = null;
      let hotel: any = null;
      if (bid?.customerId) {
        const u = await sbGet(`users?id=eq.${encodeURIComponent(bid.customerId)}&select=id,name,phone,email`) as any[];
        customer = u[0] || null;
      }
      if (bid?.hotelId) {
        const h = await sbGet(`hotels?id=eq.${encodeURIComponent(bid.hotelId)}&select=id,name,city`) as any[];
        hotel = h[0] || null;
      }
      return NextResponse.json({ messages, bid, customer, hotel });
    }

    // Conversation list — group by bid_id, latest message per bid
    let all = await sbGet(`booking_messages?order=created_at.desc&limit=1000`) as any[];
    if (flaggedOnly) {
      // Flagged = body contains the sanitizer placeholder
      all = all.filter((m: any) => typeof m.body === "string" && m.body.includes("•••••"));
    }
    if (search) {
      const s = search.toLowerCase();
      all = all.filter((m: any) =>
        m.body?.toLowerCase().includes(s) ||
        m.bid_id?.toLowerCase().includes(s) ||
        m.customer_id?.toLowerCase().includes(s)
      );
    }
    const conversationMap: Record<string, any> = {};
    for (const m of all) {
      if (!conversationMap[m.bid_id]) {
        conversationMap[m.bid_id] = {
          bid_id: m.bid_id,
          hotel_id: m.hotel_id,
          customer_id: m.customer_id,
          last_message: m,
          message_count: 0,
          hidden_count: 0,
          flagged_count: 0,
        };
      }
      conversationMap[m.bid_id].message_count += 1;
      if (m.hidden_at) conversationMap[m.bid_id].hidden_count += 1;
      if (typeof m.body === "string" && m.body.includes("•••••")) conversationMap[m.bid_id].flagged_count += 1;
    }
    let conversations = Object.values(conversationMap);

    // Enrich with customer + hotel names (bounded join)
    const customerIds = Array.from(new Set(conversations.map((c: any) => c.customer_id))).slice(0, 100);
    const hotelIds = Array.from(new Set(conversations.map((c: any) => c.hotel_id))).slice(0, 100);
    const [users, hotels] = await Promise.all([
      customerIds.length ? sbGet(`users?id=in.(${encodeURIComponent(customerIds.map(i => `"${i}"`).join(","))})&select=id,name,phone`) : Promise.resolve([]),
      hotelIds.length    ? sbGet(`hotels?id=in.(${encodeURIComponent(hotelIds.map(i => `"${i}"`).join(","))})&select=id,name,city`) : Promise.resolve([]),
    ]) as any[][];
    const userById: Record<string, any> = {}; for (const u of users) userById[u.id] = u;
    const hotelById: Record<string, any> = {}; for (const h of hotels) hotelById[h.id] = h;
    conversations = conversations.map((c: any) => ({
      ...c,
      customer: userById[c.customer_id] || null,
      hotel:    hotelById[c.hotel_id] || null,
    }));
    // Sort by most recent message
    conversations.sort((a: any, b: any) => new Date(b.last_message.created_at).getTime() - new Date(a.last_message.created_at).getTime());

    return NextResponse.json({ conversations });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { messageId, action } = await req.json();
    if (!messageId || !action) return NextResponse.json({ error: "messageId + action required" }, { status: 400 });
    const patch =
      action === "hide" ? { hidden_at: new Date().toISOString() } :
      action === "unhide" ? { hidden_at: null } :
      null;
    if (!patch) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const r = await fetch(
      `${SB_URL}/rest/v1/booking_messages?id=eq.${encodeURIComponent(messageId)}`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify(patch) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
