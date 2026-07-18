"use client";

// v327 — Circle Phase C1: Model 3 "Pre-buy Inventory" (foundation UI).
// v328 — C2: buy the room-nights (Razorpay) → owned + inventory hold.
// v329 — C3: list/unlist an owned block on the guest feed at a resale price;
//        a guest reserve settles (StayBid fee + investor net) via
//        <ResaleOffers/> on the flash-deals surface.
//
// A Circle investor who owns physical rooms takes commercial control of a DATE
// RANGE of an owned room: get a live Pricing-Spine quote (wholesale buy +
// suggested retail + their margin), buy the nights, then list them for resale.
//
// Reads/writes /api/circle/inventory (owner-scoped server-side). Mounted under
// the "My Rooms" operator tab, below CircleUnitsTab.

import { useCallback, useEffect, useMemo, useState } from "react";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import { CIRCLE_RESALE_RISK_NOTE } from "@/lib/circle/disclosure";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
// v343 (M4) — hotel_owner listings have no pre-assigned unit (unit_id NULL); a
// free unit is auto-assigned to the BUYER at checkout. Show a friendly label.
const unitLabel = (l: { unit_number?: string | null; unit_id?: string | null; source?: string | null }) =>
  l.unit_number ? `#${l.unit_number}` : (String(l.source) === "hotel_owner" ? "Own inventory" : `#${l.unit_id}`);

type Unit = { id: string; hotelId: string; roomId: string; roomNumber?: string | null; title?: string | null };
type BlockMeta = {
  // v330 (C4) — set on (re-)list; the lifecycle cron marks down from this frozen baseline.
  listResalePerNight?: number | null;
  markdownPct?: number | null;
  markedDownAt?: string | null;
} & Record<string, any>;
type Block = {
  id: string; unit_id: string; room_id: string; date_from: string; date_to: string;
  nights: number; buy_price_per_night?: number | null; buy_total?: number | null;
  resale_price_per_night?: number | null; platform_fee_pct?: number | null; status: string;
  unit_number?: string | null; hotel_name?: string | null;
  // v330 (C4) — auto-markdown + optional platform buyback.
  buyback_enabled?: boolean | null; metadata?: BlockMeta | null;
};
type Quote = {
  nights: number; buyTotal: number; avgBuyPerNight: number; suggestedResaleTotal: number;
  avgResalePerNight: number; feePct: number; estFeeOnSuggested: number; estInvestorNetOnSuggested: number;
};
type AtResale = { resaleTotal: number; feeTotal: number; buyTotal: number; investorNet: number };
// v331 (D1) — Model 4 B2B exchange: a listing of an OWNED block for another investor.
type B2bSplit = {
  nights: number; askPerNight: number; askTotal: number; platformFeePct: number;
  platformFee: number; sellerNet: number; buyTotal: number; sellerMargin: number;
  // v347 — dual commission (5% buyer + 5% seller).
  buyerFeePct?: number; sellerFeePct?: number; buyerFee?: number; sellerFee?: number; buyerPays?: number;
};
type B2bListing = {
  id: string; block_id: string | null; unit_id: string | null; date_from: string; date_to: string;
  nights: number; ask_per_night: number; ask_total: number; platform_fee_pct: number;
  status: string; unit_number?: string | null; hotel_name?: string | null; split?: B2bSplit;
  // v343 (M4) — 'investor_block' (owned-block resale) | 'hotel_owner' (own-inventory supply).
  source?: string | null; room_id?: string | null;
  metadata?: { markdownPct?: number; listAskPerNight?: number; [k: string]: any } | null;
};
// v332 (D2) — a completed/pending B2B trade (as buyer or seller).
type B2bTrade = {
  id: string; listing_id: string; block_id: string; unit_id: string;
  date_from: string; date_to: string; nights: number;
  ask_total: number; platform_fee: number; seller_net: number; status: string;
  unit_number?: string | null; hotel_name?: string | null;
};
// v333 (D3) — an OTHER investor's active listing on the marketplace (browse + buy).
type MarketListing = B2bListing & { hotel_city?: string | null };

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  quoted: "bg-slate-100 text-slate-600",
  pending_payment: "bg-amber-100 text-amber-700",
  owned: "bg-blue-100 text-blue-700",
  listed: "bg-emerald-100 text-emerald-700",
  sold: "bg-emerald-100 text-emerald-700",
  expired: "bg-slate-100 text-slate-400",
  cancelled: "bg-rose-100 text-rose-600",
  refunded: "bg-rose-100 text-rose-600",
  withdrawn: "bg-slate-100 text-slate-400",
};

export default function CircleInventoryTab({
  hotelId,
  initialUnits,
}: {
  hotelId: string;
  initialUnits?: Unit[];
}) {
  const units = useMemo(
    () => (initialUnits || []).filter((u) => String(u.hotelId) === String(hotelId)),
    [initialUnits, hotelId],
  );
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [unitId, setUnitId] = useState<string>(units[0]?.id || "");
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>("");
  const [resale, setResale] = useState<string>("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [atResale, setAtResale] = useState<AtResale | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  // v329 — C3: per-block resale-price draft for the "List for resale" input.
  const [listDraft, setListDraft] = useState<Record<string, string>>({});
  // v331 — D1: Model 4 B2B exchange — my listings + per-block ask/night draft.
  const [b2bListings, setB2bListings] = useState<B2bListing[]>([]);
  // v343 — M4: hotel-owner SUPPLY — list room-nights from OWN inventory (no
  // pre-bought block; a free unit is auto-assigned to the buyer at checkout).
  const [ownRoomId, setOwnRoomId] = useState<string>("");
  const [ownFrom, setOwnFrom] = useState<string>(todayISO());
  const [ownTo, setOwnTo] = useState<string>("");
  // v349 — regulated-price preview for the own-inventory supply form.
  const [ownQuote, setOwnQuote] = useState<{ askPerNight: number; askTotal: number; nights: number; split?: B2bSplit } | null>(null);
  // v332 — D2: my B2B trades (as buyer / as seller).
  const [b2bTrades, setB2bTrades] = useState<{ asBuyer: B2bTrade[]; asSeller: B2bTrade[] }>({ asBuyer: [], asSeller: [] });
  // v333 — D3: OTHER investors' active listings I can buy (this hotel).
  const [market, setMarket] = useState<MarketListing[]>([]);

  useEffect(() => { if (!unitId && units[0]) setUnitId(units[0].id); }, [units, unitId]);

  // v343 — M4: distinct room CATEGORIES on this hotel (derived from the owner's
  // physical units) — a hotel_owner listing is per room category, not per unit.
  const roomOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const u of units) {
      if (u.roomId && !seen.has(u.roomId)) seen.set(u.roomId, u.title || u.roomId);
    }
    return Array.from(seen.entries()).map(([roomId, title]) => ({ roomId, title }));
  }, [units]);

  useEffect(() => { if (!ownRoomId && roomOptions[0]) setOwnRoomId(roomOptions[0].roomId); }, [roomOptions, ownRoomId]);

  // v349 — preview the StayBid-regulated price whenever room/dates are valid.
  useEffect(() => {
    if (!ownRoomId || !ownFrom || !ownTo || ownTo <= ownFrom) { setOwnQuote(null); return; }
    let cancelled = false;
    fetch(`/api/b2b/regulated-quote?roomId=${encodeURIComponent(ownRoomId)}&from=${ownFrom}&to=${ownTo}`, {
      headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setOwnQuote(d?.ok ? d : null); })
      .catch(() => { if (!cancelled) setOwnQuote(null); });
    return () => { cancelled = true; };
  }, [ownRoomId, ownFrom, ownTo]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const loadBlocks = useCallback(async () => {
    const token = getToken();
    if (!token || !hotelId) return;
    try {
      const r = await fetch(`/api/circle/inventory?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d.blocks)) setBlocks(d.blocks);
    } catch { /* ignore */ }
  }, [hotelId]);

  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  // v331 — D1: load the caller's B2B exchange listings for this hotel.
  const loadB2b = useCallback(async () => {
    const token = getToken();
    if (!token || !hotelId) return;
    try {
      const r = await fetch(`/api/b2b/listings?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d.listings)) setB2bListings(d.listings);
    } catch { /* ignore */ }
  }, [hotelId]);

  useEffect(() => { loadB2b(); }, [loadB2b]);

  // v332 — D2: load the caller's B2B trades (as buyer + as seller).
  const loadTrades = useCallback(async () => {
    const token = getToken();
    if (!token || !hotelId) return;
    try {
      const r = await fetch(`/api/b2b/trades?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setB2bTrades({ asBuyer: Array.isArray(d.asBuyer) ? d.asBuyer : [], asSeller: Array.isArray(d.asSeller) ? d.asSeller : [] });
    } catch { /* ignore */ }
  }, [hotelId]);

  useEffect(() => { loadTrades(); }, [loadTrades]);

  // v333 — D3: load OTHER investors' active listings on this hotel (buy-side).
  const loadMarket = useCallback(async () => {
    const token = getToken();
    if (!token || !hotelId) return;
    try {
      const r = await fetch(`/api/b2b/marketplace?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setMarket(Array.isArray(d.listings) ? d.listings : []);
    } catch { /* ignore */ }
  }, [hotelId]);

  useEffect(() => { loadMarket(); }, [loadMarket]);

  // v333 — D3: buy another investor's listing. Server re-validates listing/block
  // + freezes the split, creates a Razorpay order (client never sets the amount),
  // we open checkout, then verify completes the trade + transfers the block.
  async function buyExchange(l: MarketListing) {
    setBusy(true);
    try {
      const token = getToken();
      const cr = await fetch(`/api/b2b/listings/${encodeURIComponent(l.id)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { flash(cd?.error || "Couldn't start payment"); loadMarket(); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({
          keyId: cd.keyId,
          orderId: cd.order.id,
          amountPaise: cd.order.amount,
          description: `Buy ${l.nights} night${l.nights === 1 ? "" : "s"} · ${unitLabel(l)} · ${l.date_from}→${l.date_to}`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { flash("Payment cancelled"); return; }
        flash(e instanceof Error ? e.message : "Payment failed");
        return;
      }

      const vr = await fetch(`/api/b2b/listings/${encodeURIComponent(l.id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          razorpay_order_id: cd.order.id,
          razorpay_payment_id: pay?.razorpay_payment_id,
          razorpay_signature: pay?.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { flash(vd?.error || "Payment verify failed — contact support"); loadMarket(); return; }
      flash("Block acquired ✓ — it's yours to manage");
      // The bought block is now owned by the caller → refresh every panel.
      loadBlocks(); loadTrades(); loadMarket(); loadB2b();
    } catch { flash("Purchase failed"); }
    finally { setBusy(false); }
  }

  // v331 — D1: list an OWNED block on the B2B exchange at the seller's ask.
  async function listB2b(b: Block) {
    setBusy(true);
    try {
      // Price is StayBid-regulated (Spine cost × admin markup) — server-computed.
      const r = await fetch(`/api/b2b/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ blockId: b.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "List failed"); return; }
      flash("Listed on the B2B exchange ✓");
      loadB2b();
    } catch { flash("List failed"); }
    finally { setBusy(false); }
  }

  // v343 — M4: list room-nights from OWN inventory on the B2B exchange (supply
  // side). No pre-bought block — server auto-assigns a free unit to the BUYER at
  // checkout. buy_total = the owner's Spine floor (server-frozen); ask is theirs.
  async function listOwnInventory() {
    if (!ownRoomId || !ownFrom || !ownTo || ownTo <= ownFrom) { flash("Pick a room and a valid date range."); return; }
    setBusy(true);
    try {
      // Price is StayBid-regulated — computed server-side; no ask input.
      const r = await fetch(`/api/b2b/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ source: "hotel_owner", hotelId, roomId: ownRoomId, dateFrom: ownFrom, dateTo: ownTo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "List failed"); return; }
      flash("Listed on the B2B exchange ✓");
      setOwnTo(""); setOwnQuote(null);
      loadB2b();
    } catch { flash("List failed"); }
    finally { setBusy(false); }
  }

  // v331 — D1: withdraw an active B2B listing (frees the block to re-list).
  async function withdrawB2b(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/b2b/listings?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Withdraw failed"); return; }
      flash("Withdrawn from exchange");
      loadB2b();
    } catch { flash("Withdraw failed"); }
    finally { setBusy(false); }
  }

  // Block ids that already have an active (listed/draft) B2B listing — used to
  // show "already on exchange" instead of the list input on an owned block.
  const activeB2bByBlock = useMemo(() => {
    const m: Record<string, B2bListing> = {};
    for (const l of b2bListings) {
      // hotel_owner listings have no block_id (null) — they're not tied to an
      // owned block row, so they never key this owned-block lookup.
      if (l.block_id && ["draft", "listed"].includes(String(l.status))) m[l.block_id] = l;
    }
    return m;
  }, [b2bListings]);

  async function getQuote() {
    if (!unitId || !from || !to || to <= from) { flash("Pick a room and a valid date range."); return; }
    setBusy(true); setQuote(null); setAtResale(null);
    try {
      const r = await fetch(`/api/circle/inventory/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ unitId, from, to, resalePricePerNight: Number(resale) || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Quote failed"); return; }
      setQuote(d.quote || null);
      setAtResale(d.atResale || null);
    } catch { flash("Quote failed"); }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!unitId || !from || !to || to <= from) { flash("Pick a room and a valid date range."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/circle/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ unitId, from, to, resalePricePerNight: Number(resale) || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Save failed"); return; }
      flash("Draft block saved");
      setQuote(null); setAtResale(null); setResale("");
      loadBlocks();
    } catch { flash("Save failed"); }
    finally { setBusy(false); }
  }

  // v328 — C2: buy the room-nights. Server re-quotes + freezes the buy, creates
  // a Razorpay order (client never sets the amount), we open checkout, then
  // verify flips the block to `owned` + writes the inventory hold.
  async function buyNights(b: Block) {
    setBusy(true);
    try {
      const token = getToken();
      const cr = await fetch(`/api/circle/inventory/${encodeURIComponent(b.id)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { flash(cd?.error || "Couldn't start payment"); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({
          keyId: cd.keyId,
          orderId: cd.order.id,
          amountPaise: cd.order.amount,
          description: `Pre-buy ${b.nights} night${b.nights === 1 ? "" : "s"} · ${b.date_from}→${b.date_to}`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { flash("Payment cancelled"); return; }
        flash(e instanceof Error ? e.message : "Payment failed");
        return;
      }

      const vr = await fetch(`/api/circle/inventory/${encodeURIComponent(b.id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          razorpay_order_id: cd.order.id,
          razorpay_payment_id: pay?.razorpay_payment_id,
          razorpay_signature: pay?.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { flash(vd?.error || "Payment verify failed — contact support"); return; }
      flash(vd.held === false ? "Bought — hold syncing…" : "Room-nights secured ✓");
      loadBlocks();
    } catch { flash("Purchase failed"); }
    finally { setBusy(false); }
  }

  // v329 — C3: list an OWNED block on the guest feed at the investor's price.
  async function listResale(b: Block) {
    const raw = listDraft[b.id] ?? String(b.resale_price_per_night || "");
    const price = Math.round(Number(raw));
    if (!Number.isFinite(price) || price <= 0) { flash("Enter a resale price per night."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/circle/inventory/${encodeURIComponent(b.id)}/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ resalePricePerNight: price }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "List failed"); return; }
      flash("Listed on the guest feed ✓");
      loadBlocks();
    } catch { flash("List failed"); }
    finally { setBusy(false); }
  }

  // v329 — C3: pull a listed block back off the market (stays owned + held).
  async function unlist(b: Block) {
    setBusy(true);
    try {
      const r = await fetch(`/api/circle/inventory/${encodeURIComponent(b.id)}/list`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Unlist failed"); return; }
      flash("Unlisted");
      loadBlocks();
    } catch { flash("Unlist failed"); }
    finally { setBusy(false); }
  }

  // v330 — C4: opt this owned/listed block into platform buyback. When on,
  // StayBid may buy the block back (admin-triggered) if it goes unsold near
  // check-in — the investor recovers their wholesale cost instead of expiring.
  async function toggleBuyback(b: Block, next: boolean) {
    setBusy(true);
    // optimistic
    setBlocks((cur) => cur.map((x) => (x.id === b.id ? { ...x, buyback_enabled: next } : x)));
    try {
      const r = await fetch(`/api/circle/inventory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ id: b.id, buybackEnabled: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBlocks((cur) => cur.map((x) => (x.id === b.id ? { ...x, buyback_enabled: !next } : x)));
        flash(d?.error || "Couldn't update buyback");
        return;
      }
      flash(next ? "Platform buyback on" : "Platform buyback off");
    } catch {
      setBlocks((cur) => cur.map((x) => (x.id === b.id ? { ...x, buyback_enabled: !next } : x)));
      flash("Couldn't update buyback");
    } finally { setBusy(false); }
  }

  async function del(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/circle/inventory?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Delete failed"); return; }
      setBlocks((b) => b.filter((x) => x.id !== id));
    } catch { flash("Delete failed"); }
    finally { setBusy(false); }
  }

  if (!units.length) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed p-6 text-sm text-slate-500"
           style={{ borderColor: "var(--border-soft)" }}>
        Pre-buy Inventory (Model 2) becomes available once you own rooms on this hotel.
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="mb-3">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-base)" }}>
          🧾 Pre-buy Inventory <span className="text-xs font-normal opacity-60">· Model 2</span>
        </h3>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          Buy specific room-nights wholesale, then <b>list them on the guest feed</b> at your own resale
          price and keep the margin. Bought nights stay held until a guest reserves. Listed nights
          <b> auto-mark-down</b> as check-in nears (never below your cost); opt into <b>platform buyback</b>
          to recover your wholesale cost if a block stays unsold.
        </p>
        <p className="text-[11px] mt-1.5 leading-snug" style={{ color: "var(--text-muted)" }}>
          ⚠ {CIRCLE_RESALE_RISK_NOTE}
        </p>
      </div>

      {/* Quote builder */}
      <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-xs">
            <span className="block mb-1 opacity-70">Room</span>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>#{u.roomNumber || u.id}{u.title ? ` · ${u.title}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block mb-1 opacity-70">From</span>
            <input type="date" value={from} min={todayISO()} onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
          </label>
          <label className="text-xs">
            <span className="block mb-1 opacity-70">To</span>
            <input type="date" value={to} min={from || todayISO()} onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
          </label>
          <label className="text-xs">
            <span className="block mb-1 opacity-70">Your resale /night (optional)</span>
            <input type="number" min={0} value={resale} onChange={(e) => setResale(e.target.value)}
              placeholder="auto" className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={getQuote}
            className="rounded-lg px-3 py-1.5 text-sm font-medium border sb-card-lift"
            style={{ borderColor: "var(--border-strong)" }}>
            {busy ? "…" : "Get quote"}
          </button>
          <button disabled={busy} onClick={saveDraft}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}>
            Save as draft
          </button>
        </div>

        {quote && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label={`Buy (${quote.nights} nights)`} value={inr(quote.buyTotal)} sub={`${inr(quote.avgBuyPerNight)}/night wholesale`} />
            <Stat label="Suggested resale" value={inr(quote.suggestedResaleTotal)} sub={`${inr(quote.avgResalePerNight)}/night`} />
            <Stat label={`Platform fee ${quote.feePct}%`} value={inr(quote.estFeeOnSuggested)} sub="on resale" />
            <Stat label="Est. your margin" value={inr(quote.estInvestorNetOnSuggested)} sub="resale − fee − buy" accent />
          </div>
        )}
        {atResale && (
          <div className="mt-2 text-xs rounded-lg px-3 py-2" style={{ background: "var(--accent-soft)", color: "var(--text-soft)" }}>
            At <b>{inr(Number(resale))}/night</b>: resale {inr(atResale.resaleTotal)} − fee {inr(atResale.feeTotal)} − buy {inr(atResale.buyTotal)} = <b>{inr(atResale.investorNet)} net</b>
          </div>
        )}
      </div>

      {/* Existing blocks */}
      <div className="mt-5">
        <div className="text-xs font-medium mb-2 opacity-70">Your inventory blocks</div>
        {blocks.length === 0 ? (
          <div className="text-sm opacity-60">No blocks yet.</div>
        ) : (
          <div className="space-y-2">
            {blocks.map((b) => (
              <div key={b.id} className="rounded-xl border p-3 flex items-center gap-3 flex-wrap"
                style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[b.status] || "bg-slate-100 text-slate-600"}`}>
                  {b.status.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text-base)" }}>
                  #{b.unit_number || b.unit_id}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {b.date_from} → {b.date_to} · {b.nights}n
                </span>
                <span className="text-xs" style={{ color: "var(--text-soft)" }}>
                  buy {inr(b.buy_total)}{b.resale_price_per_night ? ` · resale ${inr(b.resale_price_per_night)}/n` : ""}
                </span>
                {/* v330 — C4: auto-markdown badge (only shows once the cron has discounted a listed block). */}
                {b.status === "listed" && Number(b.metadata?.markdownPct) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-600"
                    title={`Auto-marked down as check-in nears · was ${inr(b.metadata?.listResalePerNight)}/n`}>
                    −{Number(b.metadata?.markdownPct)}% auto
                    {b.metadata?.listResalePerNight ? (
                      <span className="ml-1 line-through opacity-60">{inr(b.metadata?.listResalePerNight)}</span>
                    ) : null}
                  </span>
                )}
                {/* v330 — C4: platform-buyback toggle (owned or listed blocks). */}
                {["owned", "listed"].includes(b.status) && (
                  <label className="text-[10px] flex items-center gap-1 cursor-pointer select-none"
                    title="If on, StayBid may buy this block back near check-in if it stays unsold — you recover your wholesale cost."
                    style={{ color: "var(--text-muted)" }}>
                    <input type="checkbox" disabled={busy} checked={!!b.buyback_enabled}
                      onChange={(e) => toggleBuyback(b, e.target.checked)} />
                    buyback
                  </label>
                )}
                <div className="ml-auto flex gap-2">
                  {["draft", "quoted"].includes(b.status) && (
                    <>
                      <button disabled={busy} onClick={() => buyNights(b)}
                        className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                        style={{ background: "var(--accent)" }}>
                        Buy nights · {inr(b.buy_total)}
                      </button>
                      <button disabled={busy} onClick={() => del(b.id)}
                        className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: "var(--border-soft)" }}>
                        Delete
                      </button>
                    </>
                  )}
                  {b.status === "pending_payment" && (
                    <button disabled={busy} onClick={() => buyNights(b)}
                      className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                      style={{ background: "var(--accent)" }}>
                      Complete payment
                    </button>
                  )}
                  {b.status === "owned" && (
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] opacity-60">₹</span>
                        <input type="number" min={0} placeholder="resale/night"
                          value={listDraft[b.id] ?? (b.resale_price_per_night ? String(b.resale_price_per_night) : "")}
                          onChange={(e) => setListDraft((s) => ({ ...s, [b.id]: e.target.value }))}
                          className="w-24 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border-soft)" }} />
                        <button disabled={busy} onClick={() => listResale(b)}
                          className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white" style={{ background: "var(--accent)" }}>
                          List for resale
                        </button>
                      </div>
                      {/* v331 — D1: OR trade to another investor on the B2B exchange. */}
                      {activeB2bByBlock[b.id] ? (
                        <span className="text-[11px] px-2 py-1 rounded-lg font-medium bg-indigo-50 text-indigo-600"
                          title={`On the B2B exchange at ${inr(activeB2bByBlock[b.id].ask_per_night)}/night`}>
                          ⇄ On exchange · {inr(activeB2bByBlock[b.id].ask_total)}
                        </span>
                      ) : (
                        <button disabled={busy} onClick={() => listB2b(b)}
                          title="List this owned block on the B2B exchange at the StayBid-regulated price (Spine cost + markup; StayBid takes the commission)."
                          className="text-xs px-2.5 py-1 rounded-lg font-semibold border"
                          style={{ borderColor: "var(--border-strong)", color: "var(--text-base)" }}>
                          ⇄ List on exchange
                        </button>
                      )}
                    </div>
                  )}
                  {b.status === "listed" && (
                    <button disabled={busy} onClick={() => unlist(b)}
                      className="text-xs px-2.5 py-1 rounded-lg border font-medium" style={{ borderColor: "var(--border-soft)" }}>
                      Unlist
                    </button>
                  )}
                  {b.status === "sold" && (
                    <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Sold ✓</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* v331 — D1: Model 4 B2B exchange listings (this investor's offers). */}
      <div className="mt-7">
        <div className="mb-2">
          <div className="text-sm font-semibold" style={{ color: "var(--text-base)" }}>
            ⇄ B2B Exchange <span className="text-xs font-normal opacity-60">· Model 2</span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Sell an <b>owned</b> block to another investor at your own B2B price — a faster exit than waiting
            for a guest. Or <b>list room-nights straight from your own inventory</b> (no pre-buy needed).
            StayBid takes a small platform fee; you keep the rest.
          </p>
        </div>

        {/* v343 — M4: list room-nights from OWN inventory (supply side). No
            pre-bought block — the buyer is auto-assigned a free unit at checkout. */}
        {roomOptions.length > 0 && (
          <div className="rounded-2xl border p-4 mb-3" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
            <div className="text-xs font-medium mb-2" style={{ color: "var(--text-base)" }}>
              ➕ List your own inventory <span className="opacity-60 font-normal">· no pre-buy needed</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-xs">
                <span className="block mb-1 opacity-70">Room</span>
                <select value={ownRoomId} onChange={(e) => setOwnRoomId(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }}>
                  {roomOptions.map((r) => (
                    <option key={r.roomId} value={r.roomId}>{r.title}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="block mb-1 opacity-70">From</span>
                <input type="date" value={ownFrom} min={todayISO()} onChange={(e) => setOwnFrom(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
              </label>
              <label className="text-xs">
                <span className="block mb-1 opacity-70">To</span>
                <input type="date" value={ownTo} min={ownFrom || todayISO()} onChange={(e) => setOwnTo(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
              </label>
              <div className="text-xs">
                <span className="block mb-1 opacity-70">StayBid-regulated price · 2× your own price</span>
                <div className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)", background: "var(--accent-soft)" }}>
                  {ownQuote ? <><b>{inr(ownQuote.askPerNight)}</b>/night · {inr(ownQuote.askTotal)} total</> : <span className="opacity-50">pick dates…</span>}
                </div>
              </div>
            </div>
            {ownQuote?.split && (
              <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                You receive <b style={{ color: "var(--text-base)" }}>{inr(ownQuote.split.sellerNet)}</b> after the {ownQuote.split.sellerFeePct ?? 0}% seller fee · buyer pays {inr(ownQuote.split.buyerPays ?? ownQuote.split.askTotal)}.
              </div>
            )}
            <div className="mt-3">
              <button disabled={busy || !ownQuote} onClick={listOwnInventory}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: "var(--accent)" }}>
                {busy ? "…" : "List at regulated price"}
              </button>
            </div>
          </div>
        )}

        {b2bListings.length === 0 ? (
          <div className="text-sm opacity-60">
            No exchange listings yet. Use <b>List on exchange</b> on an owned block above.
          </div>
        ) : (
          <div className="space-y-2">
            {b2bListings.map((l) => (
              <div key={l.id} className="rounded-xl border p-3 flex items-center gap-3 flex-wrap"
                style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[l.status] || "bg-slate-100 text-slate-600"}`}>
                  {l.status.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text-base)" }}>
                  {unitLabel(l)}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {l.date_from} → {l.date_to} · {l.nights}n
                </span>
                <span className="text-xs" style={{ color: "var(--text-soft)" }}>
                  {(() => {
                    const md = Number(l.metadata?.markdownPct) || 0;
                    const orig = Number(l.metadata?.listAskPerNight) || 0;
                    if (l.status === "listed" && md > 0 && orig > l.ask_per_night) {
                      return (
                        <>
                          ask <s style={{ color: "var(--text-muted)" }}>{inr(orig)}/n</s>{" "}
                          <b style={{ color: "var(--text-base)" }}>{inr(l.ask_per_night)}/n</b>{" "}
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold bg-rose-50 text-rose-600">
                            −{md}% auto
                          </span>
                        </>
                      );
                    }
                    return <>ask {inr(l.ask_total)} ({inr(l.ask_per_night)}/n)</>;
                  })()}
                </span>
                {l.split && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600"
                    title={`Buyer pays ${inr(l.split.buyerPays ?? l.split.askTotal)} (ask ${inr(l.split.askTotal)} + ${l.split.buyerFeePct ?? 0}% buyer fee) · seller fee ${l.split.sellerFeePct ?? 0}% · you receive ${inr(l.split.sellerNet)}`}>
                    you get {inr(l.split.sellerNet)}
                    {l.split.buyTotal > 0 ? ` · margin ${inr(l.split.sellerMargin)}` : ""}
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  {["draft", "listed"].includes(l.status) && (
                    <button disabled={busy} onClick={() => withdrawB2b(l.id)}
                      className="text-xs px-2.5 py-1 rounded-lg border font-medium" style={{ borderColor: "var(--border-soft)" }}>
                      Withdraw
                    </button>
                  )}
                  {l.status === "sold" && (
                    <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Sold ✓</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* v333 — D3: Model 4 B2B marketplace (buy OTHER investors' listings). */}
      {market.length > 0 && (
        <div className="mt-7">
          <div className="mb-2">
            <div className="text-sm font-semibold" style={{ color: "var(--text-base)" }}>
              🛒 Buy from the exchange <span className="text-xs font-normal opacity-60">· Model 2</span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Owned blocks other investors on this hotel have put up for sale — cheapest first. Buy one and it
              becomes yours to resell on the guest feed or manage. Payment is secure; StayBid pays the seller.
            </p>
          </div>
          <div className="space-y-2">
            {market.map((l) => (
              <div key={l.id} className="rounded-xl border p-3 flex items-center gap-3 flex-wrap"
                style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--text-base)" }}>
                  {unitLabel(l)}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {l.date_from} → {l.date_to} · {l.nights}n
                </span>
                <span className="text-xs" style={{ color: "var(--text-soft)" }}>
                  {inr(l.ask_per_night)}/night
                </span>
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-base)" }}
                    title={l.split ? `ask ${inr(l.split.askTotal)} + ${l.split.buyerFeePct ?? 0}% buyer fee` : undefined}>
                    {inr(l.split?.buyerPays ?? l.ask_total)}
                    {l.split?.buyerFee ? <span className="text-[10px] font-normal opacity-60"> incl. fee</span> : null}
                  </span>
                  <button disabled={busy} onClick={() => buyExchange(l)}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                    style={{ background: "var(--accent)" }}>
                    Buy block
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* v332 — D2: Model 4 B2B trade history (as buyer / as seller). */}
      {(b2bTrades.asBuyer.length > 0 || b2bTrades.asSeller.length > 0) && (
        <div className="mt-7">
          <div className="mb-2">
            <div className="text-sm font-semibold" style={{ color: "var(--text-base)" }}>
              ⇄ Exchange trades <span className="text-xs font-normal opacity-60">· Model 2</span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Blocks you bought from or sold to other investors on the exchange. Sold blocks pay out to the seller
              (StayBid fee deducted); bought blocks become yours to resell or manage.
            </p>
          </div>
          <div className="space-y-2">
            {b2bTrades.asSeller.map((t) => (
              <TradeRow key={`s-${t.id}`} t={t} role="seller" />
            ))}
            {b2bTrades.asBuyer.map((t) => (
              <TradeRow key={`b-${t.id}`} t={t} role="buyer" />
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm text-white"
          style={{ background: "var(--text-base)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function TradeRow({ t, role }: { t: B2bTrade; role: "buyer" | "seller" }) {
  const done = String(t.status) === "completed";
  return (
    <div className="rounded-xl border p-3 flex items-center gap-3 flex-wrap"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${role === "seller" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-600"}`}>
        {role === "seller" ? "Sold" : "Bought"}
      </span>
      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
        {String(t.status).replace(/_/g, " ")}
      </span>
      <span className="text-sm font-medium" style={{ color: "var(--text-base)" }}>
        #{t.unit_number || t.unit_id}
      </span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t.date_from} → {t.date_to} · {t.nights}n
      </span>
      <span className="ml-auto text-xs" style={{ color: "var(--text-soft)" }}>
        {role === "seller"
          ? <>ask {inr(t.ask_total)} · <b>you get {inr(t.seller_net)}</b></>
          : <>paid {inr(t.ask_total)}</>}
      </span>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--border-soft)" }}>
      <div className="text-[11px] opacity-60">{label}</div>
      <div className="text-base font-semibold" style={{ color: accent ? "var(--accent)" : "var(--text-base)" }}>{value}</div>
      {sub && <div className="text-[10px] opacity-50">{sub}</div>}
    </div>
  );
}
