"use client";

// v358 — Circle Model 2 · Step 2 TOUR (premium). Full property page mirroring
// Model 1's /circle/[id], upgraded to the deck's dark-walnut + gold look. Each
// room opens a MULTI-SELECT availability calendar — the buyer taps ANY nights
// (non-contiguous, across months) exactly like the deck's "owner-released dates"
// grid — plus a market panel (buy price vs the room's real guest ADR/low/high).
// The internal own-price × N rule is NEVER shown; only what the buyer pays + the
// market. Picked nights add to the localStorage bundle read by the review page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fmtINR } from "@/lib/circle/engine";
import { addItem, removeItem, readBasket, onBasketChange, priceNights, type M2Item } from "@/lib/circle/model2-basket";

type Meta = { title?: string; city?: string; room?: string; capacity?: number; star?: number; description?: string; room_images?: string[]; prop_images?: string[]; amenities?: string[] };
type Listing = { id: string; hotel_id: string; hotel_name: string | null; hotel_city: string; room_id: string; ask_per_night: number; date_from: string; date_to: string; metadata?: Meta | null };
type Quote = { window: { from: string; to: string; effectiveFrom: string }; blocked: string[]; buyPerNight: number; buyerFeePct: number; market: { adr: number; low: number; high: number } | null };

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const cap = (s: string) => String(s || "").replace(/\b\w/g, (m) => m.toUpperCase());
const perN = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const inr = (n: number) => fmtINR(Math.round(n || 0));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthGrid(y: number, m: number) {
  const startDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const days: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= dim; d++) days.push(iso(new Date(Date.UTC(y, m, d))));
  while (days.length % 7) days.push(null);
  return days;
}
function fc(l: Listing) {
  const md = l.metadata || {};
  const roomImgs = (md.room_images || []).filter(Boolean);
  const propImgs = (md.prop_images || []).filter(Boolean);
  return {
    title: l.hotel_name || md.title || "Property", city: l.hotel_city || md.city || "",
    star: Number(md.star) || 0, room: md.room || "Room", capacity: Number(md.capacity) || 0,
    amenities: (md.amenities || []).filter(Boolean), description: md.description || "",
    buyN: Number(l.ask_per_night) || 0, roomImgs: roomImgs.length ? roomImgs : propImgs, propImgs: propImgs.length ? propImgs : roomImgs,
  };
}

export default function Model2PropertyPage() {
  const params = useParams<{ id: string }>();
  const hotelId = decodeURIComponent(String(params?.id || ""));
  const { user, loading: authLoading } = useAuth();
  const [rooms, setRooms] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [gi, setGi] = useState(0);
  const [count, setCount] = useState(0);
  const [bTotal, setBTotal] = useState(0);
  const [headMarket, setHeadMarket] = useState<{ adr: number } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/b2b/marketplace?hotelId=${encodeURIComponent(hotelId)}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => setRooms(Array.isArray(d?.listings) ? d.listings : []))
      .catch(() => setRooms([])).finally(() => setLoading(false));
  }, [hotelId]);
  useEffect(() => { if (!authLoading && user) load(); }, [authLoading, user, load]);
  useEffect(() => {
    const refresh = () => { const l = Object.values(readBasket()); setCount(l.length); setBTotal(l.reduce((s, x) => s + (x.buyerPays || 0), 0)); };
    refresh(); return onBasketChange(refresh);
  }, []);

  const prop = rooms.length ? fc(rooms[0]) : null;
  const imgs = prop?.propImgs || [];
  const fromPrice = rooms.length ? Math.min(...rooms.map((r) => fc(r).buyN)) : 0;

  useEffect(() => {
    if (!rooms.length) return;
    const cheapest = rooms.slice().sort((a, b) => fc(a).buyN - fc(b).buyN)[0];
    fetch(`/api/b2b/market-quote?listingId=${encodeURIComponent(cheapest.id)}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (d?.market?.adr) setHeadMarket({ adr: d.market.adr }); }).catch(() => {});
  }, [rooms]);

  if (authLoading || loading) return <div className="sbc-home"><div className="sbc-ms-wrap"><div className="sbc-panel" style={{ padding: 30, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading property…</div></div></div>;
  if (!prop) return <div className="sbc-home"><div className="sbc-ms-wrap"><Link href="/circle/model2/browse" className="sbc-ms-back" style={{ color: "var(--sbc-gold-deep)" }}>← Back</Link><div className="sbc-panel" style={{ padding: 24, marginTop: 12, color: "rgba(74,56,32,.6)" }}>This property has no released rooms right now.</div></div></div>;

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap sbc2p">
        <Link href="/circle/model2/browse" className="sbc2p-back">← Back to browse</Link>
        <div className="sbc2p-hero">
          {imgs.length ? <img src={imgs[Math.min(gi, imgs.length - 1)]} alt={prop.title} /> : <div className="sbc2p-noimg">🏔️</div>}
          {imgs.length > 1 && (<>
            <button className="sbc2p-nav left" onClick={() => setGi((i) => (i - 1 + imgs.length) % imgs.length)}>‹</button>
            <button className="sbc2p-nav right" onClick={() => setGi((i) => (i + 1) % imgs.length)}>›</button>
          </>)}
          <div className="sbc2p-hero-cap"><div className="sbc2p-hero-title">{prop.title}</div><div className="sbc2p-hero-loc">📍 {cap(prop.city)}{prop.star > 0 && <span className="sbc2p-hero-star"> · {"★".repeat(prop.star)}</span>}</div></div>
        </div>
        {imgs.length > 1 && <div className="sbc2p-thumbs">{imgs.map((im, i) => <button key={i} className={`sbc2p-thumb${i === gi ? " on" : ""}`} onClick={() => setGi(i)}><img src={im} alt="" /></button>)}</div>}

        <div className="sbc2p-metrics">
          <div className="sbc2p-metric"><b>from {perN(fromPrice)}</b><span>PER NIGHT</span></div>
          <div className="sbc2p-metric"><b>{rooms.length}</b><span>ROOMS RELEASED</span></div>
          <div className="sbc2p-metric"><b>{headMarket ? perN(headMarket.adr) : "—"}</b><span>MARKET ADR</span></div>
          <div className="sbc2p-metric"><b>{cap(prop.city)}</b><span>LOCATION</span></div>
        </div>
        {prop.description && <p className="sbc2p-desc">{prop.description}</p>}

        <div className="sbc2p-h2">Choose your rooms &amp; nights</div>
        <p className="sbc2p-h2sub">Open any room's calendar and tap the nights you want (any month, any dates) — check the market rate and add them to your bundle.</p>

        {rooms.map((l) => <RoomCard key={l.id} listing={l} />)}
      </div>

      {count > 0 && (
        <div className="sbc2b-basket">
          <div className="sbc2b-basket-in">
            <span style={{ fontSize: ".78rem", opacity: .92 }}>{count} room{count === 1 ? "" : "s"} · {inr(bTotal)}</span>
            <Link href="/circle/model2/review" className="sbc-btn-gold">Continue to review →</Link>
          </div>
        </div>
      )}
      <PropStyles />
    </div>
  );
}

function RoomCard({ listing }: { listing: Listing }) {
  const f = fc(listing);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<Quote | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ri, setRi] = useState(0);
  const [inBasket, setInBasket] = useState(false);

  // load window + market + fee when opened; seed selection from an existing bundle line.
  useEffect(() => {
    if (!open) return;
    const existing = readBasket()[listing.id] as M2Item | undefined;
    if (existing?.dates?.length) setSel(new Set(existing.dates));
    if (q) return;
    fetch(`/api/b2b/market-quote?listingId=${encodeURIComponent(listing.id)}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (d?.ok) setQ(d); }).catch(() => {});
  }, [open, q, listing.id]);

  useEffect(() => {
    const check = () => setInBasket(!!readBasket()[listing.id]);
    check(); return onBasketChange(check);
  }, [listing.id]);

  const blocked = useMemo(() => new Set(q?.blocked || []), [q]);
  const win = q?.window;
  const buyN = q?.buyPerNight || f.buyN;
  const feePct = q?.buyerFeePct ?? 5;
  const dates = useMemo(() => Array.from(sel).sort(), [sel]);
  const price = useMemo(() => priceNights(buyN, feePct, dates), [buyN, feePct, dates]);
  const marketAdr = q?.market?.adr || 0;
  const marketValue = marketAdr * dates.length;
  const upside = Math.max(0, marketValue - price.subtotal);

  const toggle = (d: string) => setSel((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const clear = () => setSel(new Set());
  const add = () => {
    if (!dates.length) return;
    addItem({ key: listing.id, listingId: listing.id, hotelId: listing.hotel_id, roomId: listing.room_id, title: f.title, city: f.city, room: f.room, image: f.roomImgs[0] || "", dates, nights: dates.length, buyPerNight: buyN, buyerPays: price.buyerPays, marketAdr });
  };

  const imgs = f.roomImgs;
  return (
    <div className="sbc2p-room">
      <button className="sbc2p-room-top" onClick={() => setOpen((o) => !o)}>
        {imgs[0] ? <img src={imgs[0]} alt={f.room} className="sbc2p-room-img" /> : <div className="sbc2p-room-img sbc2p-noimg">🛏</div>}
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div className="sbc2p-room-name">{f.room}</div>
          <div className="sbc2p-room-sub">{f.capacity ? `up to ${f.capacity} guests · ` : ""}from {perN(f.buyN)}/night</div>
          {q?.market && <div className="sbc2p-room-mkt">📈 Market {perN(q.market.adr)} ADR</div>}
          {inBasket && <div className="sbc2p-room-in">✓ in bundle</div>}
        </div>
        <span className="sbc2p-room-caret">{open ? "▾" : "View ›"}</span>
      </button>

      {open && (
        <div className="sbc2p-room-body">
          {imgs.length > 1 && (
            <div className="sbc2p-roomgal">
              <img src={imgs[Math.min(ri, imgs.length - 1)]} alt={f.room} />
              <button className="sbc2p-nav left sm" onClick={() => setRi((i) => (i - 1 + imgs.length) % imgs.length)}>‹</button>
              <button className="sbc2p-nav right sm" onClick={() => setRi((i) => (i + 1) % imgs.length)}>›</button>
            </div>
          )}
          {f.amenities.length > 0 && <div className="sbc2p-amen">{f.amenities.slice(0, 12).map((a, i) => <span key={i} className="sbc2p-amen-chip">{a}</span>)}</div>}

          {/* market panel — only the buy price vs the market (no internal rule) */}
          <div className="sbc2p-mkt">
            <div className="sbc2p-mkt-row"><span>Your buy price</span><b>{perN(buyN)}<small>/night</small></b></div>
            {q?.market ? (<>
              <div className="sbc2p-mkt-row"><span>Market rate (ADR)</span><b>{perN(q.market.adr)}<small>/night</small></b></div>
              <div className="sbc2p-mkt-bar">
                <span>low {perN(q.market.low)}</span>
                <div className="sbc2p-mkt-track"><span className="sbc2p-mkt-dot" style={{ left: `${Math.max(3, Math.min(95, ((buyN - q.market.low) / Math.max(1, q.market.high - q.market.low)) * 100))}%` }} /></div>
                <span>high {perN(q.market.high)}</span>
              </div>
              {buyN < q.market.adr && <div className="sbc2p-mkt-note">📈 You buy {perN(q.market.adr - buyN)}/night below market — resale upside.</div>}
            </>) : <div className="sbc2p-mkt-note dim">Loading market price…</div>}
          </div>

          {/* multi-select availability calendar (tap ANY nights, across months) */}
          {win ? <MultiCalendar windowFrom={win.effectiveFrom} windowTo={win.to} blocked={blocked} selected={sel} onToggle={toggle} onClear={clear} count={dates.length} /> : <div className="sbc2p-mkt-note dim">Loading calendar…</div>}

          {dates.length > 0 && (
            <div className="sbc2p-selbox">
              <div className="sbc2p-sel-row"><span>{dates.length} night{dates.length === 1 ? "" : "s"} selected</span><b>{inr(price.buyerPays)}</b></div>
              <div className="sbc2p-sel-sub">{inr(price.subtotal)} + {inr(price.fee)} fee{upside > 0 ? <span className="sbc2p-upside"> · market value {inr(marketValue)} → upside {inr(upside)}</span> : null}</div>
              <button className={inBasket ? "sbc-btn-gold" : "sbc-btn-gold"} style={{ width: "100%", marginTop: 8 }} onClick={add}>{inBasket ? `Update bundle · ${dates.length} night${dates.length === 1 ? "" : "s"}` : `Add ${dates.length} night${dates.length === 1 ? "" : "s"} to bundle`}</button>
            </div>
          )}
          {inBasket && dates.length === 0 && <button className="sbc-btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => removeItem(listing.id)}>Remove from bundle</button>}
        </div>
      )}
    </div>
  );
}

function MultiCalendar({ windowFrom, windowTo, blocked, selected, onToggle, onClear, count }: {
  windowFrom: string; windowTo: string; blocked: Set<string>; selected: Set<string>; onToggle: (d: string) => void; onClear: () => void; count: number;
}) {
  const start = new Date(windowFrom + "T00:00:00Z");
  const [ym, setYm] = useState({ y: start.getUTCFullYear(), m: start.getUTCMonth() });
  const grid = monthGrid(ym.y, ym.m);
  const minYm = { y: start.getUTCFullYear(), m: start.getUTCMonth() };
  const end = new Date(windowTo + "T00:00:00Z");
  const maxYm = { y: end.getUTCFullYear(), m: end.getUTCMonth() };
  const atMin = ym.y === minYm.y && ym.m === minYm.m;
  const atMax = ym.y === maxYm.y && ym.m === maxYm.m;
  const step = (d: number) => { const nm = new Date(Date.UTC(ym.y, ym.m + d, 1)); setYm({ y: nm.getUTCFullYear(), m: nm.getUTCMonth() }); };
  const monthSel = grid.filter((d) => d && selected.has(d)).length;
  return (
    <div className="sbc2p-cal">
      <div className="sbc2p-cal-top">
        <span className="sbc2p-cal-tip">Tap any nights — one month or across months</span>
        {count > 0 && <button className="sbc2p-cal-clear" onClick={onClear}>Clear ({count})</button>}
      </div>
      <div className="sbc2p-cal-head">
        <button disabled={atMin} onClick={() => step(-1)}>‹</button>
        <span>{MONTHS[ym.m]} {ym.y}{monthSel > 0 ? <em> · {monthSel} picked</em> : null}</span>
        <button disabled={atMax} onClick={() => step(1)}>›</button>
      </div>
      <div className="sbc2p-cal-dow">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="sbc2p-cal-grid">
        {grid.map((d, i) => {
          if (!d) return <span key={i} className="sbc2p-cal-empty" />;
          const off = d < windowFrom || d >= windowTo || blocked.has(d);
          const on = selected.has(d);
          return <button key={i} disabled={off} className={`sbc2p-cal-day${off ? " off" : ""}${on ? " on" : ""}`} onClick={() => onToggle(d)}>{Number(d.slice(8))}</button>;
        })}
      </div>
      <div className="sbc2p-cal-legend"><span className="lg on" /> selected <span className="lg free" /> released <span className="lg off" /> unavailable</div>
    </div>
  );
}

function PropStyles() {
  return (
    <style jsx global>{`
      .sbc2p { padding-bottom: 100px; }
      .sbc2p-back { display: inline-block; margin-bottom: 12px; font-weight: 700; color: var(--sbc-gold-deep); font-size: .9rem; }
      .sbc2p-hero { position: relative; height: 250px; border-radius: 20px; overflow: hidden; background: #221812; box-shadow: 0 12px 34px rgba(40,26,12,.22); }
      .sbc2p-hero img { width: 100%; height: 100%; object-fit: cover; }
      .sbc2p-noimg { display: grid; place-items: center; font-size: 3rem; width: 100%; height: 100%; }
      .sbc2p-hero-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 34px 17px 15px; background: linear-gradient(0deg, rgba(18,12,6,.9), transparent); color: #fff; }
      .sbc2p-hero-title { font-size: 1.55rem; font-weight: 800; line-height: 1.08; text-shadow: 0 2px 12px rgba(0,0,0,.4); }
      .sbc2p-hero-loc { font-size: .84rem; opacity: .92; margin-top: 3px; }
      .sbc2p-hero-star { color: #ffcf6e; }
      .sbc2p-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(20,14,7,.55); color: #ffe9b8; font-size: 1.3rem; cursor: pointer; z-index: 2; }
      .sbc2p-nav.left { left: 9px; } .sbc2p-nav.right { right: 9px; }
      .sbc2p-nav.sm { width: 28px; height: 28px; font-size: 1.05rem; color: #fff; }
      .sbc2p-thumbs { display: flex; gap: 7px; overflow-x: auto; margin: 10px 0 0; padding-bottom: 4px; }
      .sbc2p-thumb { flex: none; width: 64px; height: 46px; border-radius: 9px; overflow: hidden; border: 2px solid transparent; padding: 0; background: none; cursor: pointer; }
      .sbc2p-thumb.on { border-color: var(--sbc-gold-deep); }
      .sbc2p-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .sbc2p-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 16px 0 14px; }
      @media (min-width: 560px) { .sbc2p-metrics { grid-template-columns: repeat(4, 1fr); } }
      .sbc2p-metric { background: linear-gradient(150deg, #241a11, #35271a); border: 1px solid rgba(212,162,74,.25); border-radius: 13px; padding: 12px 13px; }
      .sbc2p-metric b { display: block; color: #ffd98a; font-size: 1.05rem; font-weight: 800; }
      .sbc2p-metric span { font-size: .56rem; letter-spacing: .06em; color: rgba(243,231,208,.55); font-weight: 700; }
      .sbc2p-desc { font-size: .84rem; line-height: 1.55; color: rgba(74,56,32,.75); margin: 0 0 16px; }
      .sbc2p-h2 { font-size: 1.4rem; font-weight: 800; color: var(--sbc-coffee); font-family: var(--font-syne, inherit); }
      .sbc2p-h2sub { font-size: .82rem; color: rgba(74,56,32,.65); margin: 4px 0 14px; line-height: 1.5; }
      .sbc2p-room { border: 1px solid rgba(139,105,20,.18); border-radius: 16px; margin-bottom: 12px; overflow: hidden; background: #fff; box-shadow: 0 4px 16px rgba(74,56,32,.05); }
      .sbc2p-room-top { display: flex; align-items: center; gap: 11px; padding: 11px 13px; cursor: pointer; width: 100%; border: 0; background: none; }
      .sbc2p-room-img { width: 58px; height: 58px; border-radius: 11px; object-fit: cover; flex: none; font-size: 1.4rem; }
      .sbc2p-room-name { font-weight: 800; color: var(--sbc-coffee); font-size: .95rem; }
      .sbc2p-room-sub { font-size: .74rem; color: rgba(74,56,32,.62); }
      .sbc2p-room-mkt { font-size: .68rem; color: #6b8f4e; font-weight: 700; margin-top: 1px; }
      .sbc2p-room-in { font-size: .66rem; color: var(--sbc-gold-deep); font-weight: 800; margin-top: 1px; }
      .sbc2p-room-caret { color: var(--sbc-gold-deep); font-weight: 800; font-size: .8rem; white-space: nowrap; }
      .sbc2p-room-body { padding: 4px 13px 14px; border-top: 1px solid rgba(139,105,20,.12); }
      .sbc2p-roomgal { position: relative; height: 165px; border-radius: 12px; overflow: hidden; margin: 11px 0; background: #e2d4bb; }
      .sbc2p-roomgal img { width: 100%; height: 100%; object-fit: cover; }
      .sbc2p-amen { display: flex; flex-wrap: wrap; gap: 6px; margin: 9px 0; }
      .sbc2p-amen-chip { font-size: .68rem; font-weight: 600; color: rgba(74,56,32,.8); background: rgba(139,105,20,.09); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 4px 10px; text-transform: capitalize; }
      .sbc2p-mkt { background: linear-gradient(135deg, #1c140c, #2c2116); color: #f3e7d0; border-radius: 14px; padding: 13px 15px; margin: 12px 0; border: 1px solid rgba(212,162,74,.2); }
      .sbc2p-mkt-row { display: flex; justify-content: space-between; align-items: baseline; font-size: .8rem; padding: 2px 0; opacity: .95; }
      .sbc2p-mkt-row b { color: #ffd98a; font-size: .98rem; } .sbc2p-mkt-row small { opacity: .6; font-size: .62rem; font-weight: 500; }
      .sbc2p-mkt-bar { display: flex; align-items: center; gap: 8px; margin: 10px 0 3px; font-size: .58rem; opacity: .8; }
      .sbc2p-mkt-track { position: relative; flex: 1; height: 6px; border-radius: 999px; background: linear-gradient(90deg, #6b8f4e, #d4a24a, #c96f4a); }
      .sbc2p-mkt-dot { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%; background: #fff; border: 2px solid #1f1710; transform: translate(-50%, -50%); box-shadow: 0 0 0 2px #ffd98a; }
      .sbc2p-mkt-note { font-size: .7rem; color: #cde7b0; margin-top: 7px; }
      .sbc2p-mkt-note.dim { color: rgba(243,231,208,.55); }
      /* premium dark-walnut calendar (deck look) */
      .sbc2p-cal { background: linear-gradient(150deg, #1f1710, #2e2115); border: 1px solid rgba(212,162,74,.22); border-radius: 15px; padding: 13px; margin: 12px 0; color: #f3e7d0; }
      .sbc2p-cal-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
      .sbc2p-cal-tip { font-size: .66rem; color: rgba(243,231,208,.6); }
      .sbc2p-cal-clear { border: 1px solid rgba(212,162,74,.4); background: none; color: #ffcf6e; font-size: .66rem; font-weight: 700; cursor: pointer; border-radius: 999px; padding: 3px 10px; }
      .sbc2p-cal-head { display: flex; align-items: center; justify-content: space-between; font-weight: 800; color: #ffe9b8; font-size: .9rem; margin-bottom: 9px; }
      .sbc2p-cal-head em { font-style: normal; font-size: .68rem; color: #9fc47a; font-weight: 700; }
      .sbc2p-cal-head button { width: 30px; height: 30px; border-radius: 9px; border: 1px solid rgba(212,162,74,.3); background: rgba(255,255,255,.04); color: #ffcf6e; font-size: 1.05rem; cursor: pointer; }
      .sbc2p-cal-head button:disabled { opacity: .25; cursor: default; }
      .sbc2p-cal-dow { display: grid; grid-template-columns: repeat(7,1fr); gap: 4px; font-size: .58rem; color: rgba(243,231,208,.45); text-align: center; margin-bottom: 4px; font-weight: 700; }
      .sbc2p-cal-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 4px; }
      .sbc2p-cal-empty { aspect-ratio: 1; }
      .sbc2p-cal-day { aspect-ratio: 1; border: 1px solid rgba(212,162,74,.16); border-radius: 9px; background: rgba(255,255,255,.03); color: #f3e7d0; font-size: .74rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: transform .08s; }
      .sbc2p-cal-day:hover:not(.off):not(.on) { border-color: rgba(212,162,74,.55); }
      .sbc2p-cal-day.off { background: repeating-linear-gradient(45deg, rgba(255,255,255,.02), rgba(255,255,255,.02) 3px, rgba(255,255,255,.05) 3px, rgba(255,255,255,.05) 6px); color: rgba(243,231,208,.22); cursor: default; border-color: transparent; }
      .sbc2p-cal-day.on { background: linear-gradient(145deg, #e6b34d, #c98f2e); color: #241a0d; border-color: #ffcf6e; font-weight: 800; box-shadow: 0 3px 10px rgba(201,143,46,.4); }
      .sbc2p-cal-legend { display: flex; align-items: center; gap: 6px; font-size: .58rem; color: rgba(243,231,208,.5); margin-top: 10px; flex-wrap: wrap; }
      .sbc2p-cal-legend .lg { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
      .sbc2p-cal-legend .lg.on { background: #e6b34d; } .sbc2p-cal-legend .lg.free { background: rgba(255,255,255,.08); margin-left: 8px; } .sbc2p-cal-legend .lg.off { background: rgba(255,255,255,.03); margin-left: 8px; }
      .sbc2p-selbox { background: #fff; border: 1px solid rgba(139,105,20,.2); border-radius: 13px; padding: 12px 14px; margin-top: 9px; }
      .sbc2p-sel-row { display: flex; justify-content: space-between; font-size: .84rem; font-weight: 800; color: var(--sbc-coffee); }
      .sbc2p-sel-sub { font-size: .68rem; color: rgba(74,56,32,.6); margin-top: 2px; }
      .sbc2p-upside { color: #6b8f4e; font-weight: 700; }
      .sbc2b-basket { position: fixed; left: 0; right: 0; bottom: 62px; z-index: 40; padding: 10px 12px; background: linear-gradient(0deg, rgba(255,255,255,.94) 70%, rgba(255,255,255,0)); }
      .sbc2b-basket-in { max-width: 720px; margin: 0 auto; background: var(--sbc-coffee, #3a2c17); color: #fbf3e2; border-radius: 16px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
    `}</style>
  );
}
