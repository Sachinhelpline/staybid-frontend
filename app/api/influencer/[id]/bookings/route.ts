// GET /api/influencer/[id]/bookings
// Returns every booking attributed to this creator, enriched with hotel
// name + bid status + paid total + the commission row (if any).
// Accepts EITHER the influencer.id OR the underlying users.id — partner
// linking uses both at different points so the route accepts both.
//
// Response shape:
//   {
//     bookings: [{
//       bidId, hotelId, hotelName, hotelCity, customerName?, customerPhone?,
//       amount, paidTotal?, status, flow, source, createdAt, checkIn, checkOut,
//       commissionAmount?, commissionStatus?
//     }],
//     totals: { count, gmv, commission, paid }
//   }
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ, cache: "no-store" });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}

async function resolveCreator(id: string): Promise<{ influencerId: string; userId: string } | null> {
  const a = await sbGet(`influencers?id=eq.${encodeURIComponent(id)}&select=id,user_id`);
  if (Array.isArray(a) && a[0]) return { influencerId: a[0].id, userId: a[0].user_id };
  const b = await sbGet(`influencers?user_id=eq.${encodeURIComponent(id)}&select=id,user_id`);
  if (Array.isArray(b) && b[0]) return { influencerId: b[0].id, userId: b[0].user_id };
  return null;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await resolveCreator(params.id);
  if (!c) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

  // Fetch every attribution row keyed to this creator (by either creator_id
  // OR creator_user_id — the user_id one catches bookings driven before the
  // creator's influencer row was created).
  const filter = `or=(creator_id.eq.${encodeURIComponent(c.influencerId)},creator_user_id.eq.${encodeURIComponent(c.userId)})`;
  const attrs = await sbGet(
    `bid_attributions?${filter}&select=*&order=created_at.desc&limit=200`
  ) as any[];

  if (!Array.isArray(attrs) || attrs.length === 0) {
    return NextResponse.json({ bookings: [], totals: { count: 0, gmv: 0, commission: 0, paid: 0 } });
  }

  const bidIds   = Array.from(new Set(attrs.map(a => a.bid_id).filter(Boolean)));
  const hotelIds = Array.from(new Set(attrs.map(a => a.hotel_id).filter(Boolean)));

  const [bids, hotels, paid, commissions, requests] = await Promise.all([
    bidIds.length   ? sbGet(`bids?id=in.(${bidIds.map(encodeURIComponent).join(",")})&select=id,amount,counterAmount,status,createdAt,customerId,requestId,roomId`) : Promise.resolve([]),
    hotelIds.length ? sbGet(`hotels?id=in.(${hotelIds.map(encodeURIComponent).join(",")})&select=id,name,city`) : Promise.resolve([]),
    bidIds.length   ? sbGet(`bid_paid_amounts?bid_id=in.(${bidIds.map(encodeURIComponent).join(",")})&select=bid_id,paid_total,flow`) : Promise.resolve([]),
    bidIds.length   ? sbGet(`influencer_commissions?bid_id=in.(${bidIds.map(encodeURIComponent).join(",")})&select=bid_id,commission_amount,status,commission_percentage`) : Promise.resolve([]),
    bidIds.length   ? sbGet(`bid_requests?select=id,checkIn,checkOut&limit=400`) : Promise.resolve([]),
  ]) as any[][];

  const bidById        = Object.fromEntries((bids        as any[]).map(b => [b.id, b]));
  const hotelById      = Object.fromEntries((hotels      as any[]).map(h => [h.id, h]));
  const paidByBid      = Object.fromEntries((paid        as any[]).map(p => [p.bid_id, p]));
  const commByBid      = Object.fromEntries((commissions as any[]).map(c => [c.bid_id, c]));
  const reqById        = Object.fromEntries((requests    as any[]).map(r => [r.id, r]));

  // Customer side-load
  const customerIds = Array.from(new Set((bids as any[]).map(b => b.customerId).filter(Boolean)));
  const users = customerIds.length
    ? await sbGet(`users?id=in.(${customerIds.map(encodeURIComponent).join(",")})&select=id,name,phone`) as any[]
    : [];
  const userById = Object.fromEntries(users.map(u => [u.id, u]));

  const bookings = attrs.map(a => {
    const bid    = bidById[a.bid_id] || {};
    const hotel  = hotelById[a.hotel_id] || {};
    const paidR  = paidByBid[a.bid_id];
    const comm   = commByBid[a.bid_id];
    const req    = bid.requestId ? reqById[bid.requestId] : null;
    const cust   = bid.customerId ? userById[bid.customerId] : null;
    return {
      bidId:           a.bid_id,
      hotelId:         a.hotel_id,
      hotelName:       hotel.name || a.hotel_id,
      hotelCity:       hotel.city || "",
      customerName:    cust?.name || null,
      customerPhone:   cust?.phone || null,
      amount:          Number(bid.amount || 0),
      paidTotal:       paidR ? Number(paidR.paid_total) : (a.paid_total ? Number(a.paid_total) : null),
      status:          bid.status || "—",
      flow:            a.flow || paidR?.flow || null,
      source:          a.source,
      videoId:         a.video_id,
      checkIn:         req?.checkIn || null,
      checkOut:        req?.checkOut || null,
      commissionAmount: comm ? Number(comm.commission_amount) : (a.commission_amount ? Number(a.commission_amount) : null),
      commissionStatus: comm?.status || null,
      commissionPct:    comm ? Number(comm.commission_percentage) : (a.commission_pct ? Number(a.commission_pct) : null),
      createdAt:       a.created_at,
    };
  });

  const totals = bookings.reduce(
    (s, b) => ({
      count: s.count + 1,
      gmv:   s.gmv + Number(b.paidTotal || b.amount || 0),
      commission: s.commission + Number(b.commissionAmount || 0),
      paid:  s.paid + (b.commissionStatus === "paid" ? Number(b.commissionAmount || 0) : 0),
    }),
    { count: 0, gmv: 0, commission: 0, paid: 0 }
  );

  return NextResponse.json({ bookings, totals });
}
