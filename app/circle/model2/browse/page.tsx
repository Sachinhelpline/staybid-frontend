"use client";

// v356 — Circle Model 2 B2B: the full Model-1-style journey.
//   Step 1 BROWSE  → released inventory grouped BY PROPERTY (not flat rooms).
//   Step 2 TOUR    → full property + room tour; each room shows a LIVE
//                    availability calendar (pick your own nights) and a
//                    "trading" panel — your buy price (own × 2) vs the room's
//                    real guest ADR / lowest / highest market price, so a buyer
//                    sees resale-profit potential like checking a stock.
//   Step 3 BUILD   → picked room-nights across cities go into a bundle.
//   Step 4 REVIEW  → full package review (line items + city fees + totals) then
//                    ONE payment. Buyer-picked dates priced own/night × 2.
// No pre-activation gate; per-new-city ₹fee added at checkout (lifetime).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { fmtINR } from "@/lib/circle/engine";
import { CIRCLE_B2B_RESALE_NOTE } from "@/lib/circle/disclosure";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type Meta = {
  title?: string; city?: string; room?: string; capacity?: number; star?: number;
  description?: string; monthly_rate?: number; ownPerNight?: number; multiplier?: number;
  room_images?: string[]; prop_images?: string[]; amenities?: string[];
  releasedFrom?: string; releasedTo?: string;
};
type Listing = {
  id: string; hotel_id: string; hotel_name: string | null; hotel_city: string;
  room_id: string; date_from: string; date_to: string; nights: number;
  ask_per_night: number; own_per_night?: number | null; price_multiplier?: number | null;
  metadata?: Meta | null; split?: { buyerPays?: number };
};
type Property = {
  key: string; title: string; city: string; star: number; images: string[];
  description: string; rooms: Listing[];
};
type BItem = {
  key: string; listingId: string; hotelId: string; roomId: string;
  title: string; city: string; room: string; image: string;
  from: string; to: string; nights: number; buyPerNight: number; buyerPays: number; marketAdr: number;
};
type Quote = {
  window: { from: string; to: string; effectiveFrom: string };
  blocked: string[]; ownPerNight: number; multiplier: number; buyPerNight: number;
  market: { adr: number; low: number; high: number } | null;
  selection?: { from: string; to: string; nights: number; buyPerNight: number; subtotal: number; buyerFee: number; buyerPays: number; marketValue: number; marketUpside: number; marketValuePerNight: number };
};

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const norm = (c: any) => String(c || "").trim().toLowerCase();
const cap = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
const ALL = "__all__";
const inr = (n: number) => fmtINR(Math.round(n || 0));
const perN = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

function facets(l: Listing) {
  const md = l.metadata || {};
  const own = Number(l.own_per_night ?? md.ownPerNight ?? 0) || 0;
  const mult = Number(l.price_multiplier ?? md.multiplier ?? 2) || 2;
  const buyN = Number(l.ask_per_night) || own * mult;
  const roomImgs = (md.room_images || []).filter(Boolean);
  const propImgs = (md.prop_images || []).filter(Boolean);
  return {
    own, mult, buyN,
    title: l.hotel_name || md.title || "Property",
    city: l.hotel_city || md.city || "",
    room: md.room || "Room",
    capacity: Number(md.capacity) || 0,
    star: Number(md.star) || 0,
    amenities: (md.amenities || []).filter(Boolean),
    description: md.description || "",
    roomImg: roomImgs[0] || propImgs[0] || "",
    roomImgs: roomImgs.length ? roomImgs : propImgs,
  };
}

// ── date helpers ──────────────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400000));
const nightsOf = (from: string, to: string) => Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 86400000));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthGrid(y: number, m: number) {
  const first = new Date(Date.UTC(y, m, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Mon=0
  const days: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= dim; d++) days.push(iso(new Date(Date.UTC(y, m, d))));
  while (days.length % 7) days.push(null);
  return days;
}

export default function Model2BrowsePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [accessPrice, setAccessPrice] = useState(999);
  const [all, setAll] = useState<Listing[]>([]);
  const [city, setCity] = useState<string>(ALL);
  const [basket, setBasket] = useState<Record<string, BItem>>({});
  const [tour, setTour] = useState<Property | null>(null);
  const [review, setReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/b2b/marketplace`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAll(Array.isArray(d?.listings) ? d.listings : []))
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/browse" }); return; }
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); if (d?.price) setAccessPrice(Number(d.price) || 999); })
      .catch(() => {});
    load();
  }, [user, authLoading, router, load]);

  // group listings → properties (by hotel), filtered by city.
  const properties = useMemo<Property[]>(() => {
    const rows = city === ALL ? all : all.filter((l) => norm(facets(l).city) === norm(city));
    const by: Record<string, Property> = {};
    rows.forEach((l) => {
      const f = facets(l);
      const key = l.hotel_id || f.title;
      if (!by[key]) by[key] = { key, title: f.title, city: f.city, star: f.star, images: (l.metadata?.prop_images || []).filter(Boolean), description: f.description, rooms: [] };
      by[key].rooms.push(l);
    });
    return Object.values(by).sort((a, b) => a.title.localeCompare(b.title));
  }, [all, city]);

  const supplyCities = useMemo(
    () => Array.from(new Set(all.map((l) => norm(facets(l).city)).filter(Boolean))).sort(),
    [all],
  );

  const basketList = useMemo(() => Object.values(basket), [basket]);
  const invTotal = useMemo(() => basketList.reduce((s, b) => s + b.buyerPays, 0), [basketList]);
  const basketCities = useMemo(() => Array.from(new Set(basketList.map((b) => norm(b.city)).filter(Boolean))), [basketList]);
  const isUnlocked = (c: string) => unlocked.includes(norm(c));
  const newCities = useMemo(() => basketCities.filter((c) => !isUnlocked(c)), [basketCities, unlocked]);
  const cityFees = newCities.length * accessPrice;
  const grandTotal = invTotal + cityFees;

  const addToBasket = (b: BItem) => setBasket((s) => ({ ...s, [b.key]: b }));
  const removeFromBasket = (key: string) => setBasket((s) => { const n = { ...s }; delete n[key]; return n; });

  async function pay() {
    if (!basketList.length) { setMsg("Add some nights first."); return; }
    setBusy(true); setMsg("");
    try {
      const cr = await fetch("/api/b2b/basket/checkout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ items: basketList.map((b) => ({ listingId: b.listingId, from: b.from, to: b.to })) }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { setMsg(cd?.error || "Couldn't start payment"); load(); return; }
      let p: any;
      try {
        p = await openRazorpayForOrder({ keyId: cd.keyId, orderId: cd.order.id, amountPaise: cd.order.amount, description: `Model 2 bundle · ${basketList.length} room-night set${basketList.length === 1 ? "" : "s"}` });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setMsg("Payment cancelled"); return; }
        setMsg(e instanceof Error ? e.message : "Payment failed"); return;
      }
      const vr = await fetch("/api/b2b/basket/verify", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ razorpay_order_id: cd.order.id, razorpay_payment_id: p?.razorpay_payment_id, razorpay_signature: p?.razorpay_signature }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { setMsg(vd?.error || "Verify failed — contact support"); return; }
      setMsg(`Bundle bought ✓ — ${vd.settled} room-night set${vd.settled === 1 ? "" : "s"} now in your selling inventory.`);
      setBasket({}); setReview(false); setTour(null);
      fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()).then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); }).catch(() => {});
      load();
    } catch { setMsg("Something went wrong"); }
    finally { setBusy(false); }
  }

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap sbc2b">
        <Link href="/circle" className="sbc-ms-back" style={{ color: "var(--sbc-gold-deep)" }}>← StayCircle</Link>
        <div className="sbc-ms-eyebrow"><span className="sbc-ms-model">Model 2</span><span className="sbc-ms-tag" style={{ color: "var(--sbc-coffee)" }}>Multi-City Inventory Bundle</span></div>
        <h1 className="sbc-ms-title" style={{ color: "var(--sbc-coffee)" }}>Browse released inventory</h1>
        <p className="sbc-ms-sub" style={{ color: "rgba(74,56,32,.75)" }}>
          Tour any property, open a room’s <b>live availability calendar</b>, and pick the nights you want.
          Every night is priced at <b>2× the owner’s own price</b> — check it against the room’s real market
          rate (like a stock) and see your resale upside before you buy.
        </p>

        <div className="sbc2b-steps">
          {[
            { n: "1", t: "Browse", d: "Properties, all cities" },
            { n: "2", t: "Tour", d: "Calendar + market price" },
            { n: "3", t: "Build", d: "Pick nights, add" },
            { n: "4", t: "One payment", d: "Review + pay" },
          ].map((s) => (
            <div key={s.n} className="sbc2b-step"><span className="sbc2b-step-n">{s.n}</span><div><div className="sbc2b-step-t">{s.t}</div><div className="sbc2b-step-d">{s.d}</div></div></div>
          ))}
        </div>
        <div className="sbc2b-kpis">
          <span className="sbc2b-kpi">🔓 Full inventory — no pre-unlock</span>
          <span className="sbc2b-kpi">🗝️ ₹{accessPrice}/city · one-time</span>
          <span className="sbc2b-kpi">⇄ 5% + 5% fee</span>
          <span className="sbc2b-kpi sbc2b-kpi-gold">✦ Buy at 2× owner’s own price</span>
        </div>

        {/* city filter */}
        <div className="sbc2b-chips">
          <button onClick={() => setCity(ALL)} className={`sbc2b-chip${city === ALL ? " on" : ""}`}>All Cities <span className="sbc2b-chip-ct">{properties.length && city === ALL ? properties.length : new Set(all.map((l) => norm(facets(l).city))).size}</span></button>
          {supplyCities.map((c) => {
            const ct = new Set(all.filter((l) => norm(facets(l).city) === c).map((l) => l.hotel_id)).size;
            return <button key={c} onClick={() => setCity(c)} className={`sbc2b-chip${norm(city) === c ? " on" : ""}`}>{cap(c)}{isUnlocked(c) ? " 🔓" : ""} <span className="sbc2b-chip-ct">{ct}</span></button>;
          })}
        </div>

        {/* Step 1 — property browse */}
        {loading ? (
          <div className="sbc-panel" style={{ padding: 28, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading inventory…</div>
        ) : properties.length === 0 ? (
          <div className="sbc-panel" style={{ padding: 24, color: "rgba(74,56,32,.6)", fontSize: ".9rem" }}>No released inventory here yet.</div>
        ) : (
          <div className="sbc2b-grid">
            {properties.map((p) => {
              const fromPrice = Math.min(...p.rooms.map((r) => facets(r).buyN));
              const img = p.images[0] || facets(p.rooms[0]).roomImg;
              return (
                <button key={p.key} className="sbc2b-card" onClick={() => setTour(p)}>
                  <div className="sbc2b-card-img">
                    {img ? <img src={img} alt={p.title} loading="lazy" /> : <div className="sbc2b-noimg">🏔️</div>}
                    <span className="sbc2b-badge sbc2b-badge-city">📍 {cap(p.city)}</span>
                    {p.star > 0 && <span className="sbc2b-badge sbc2b-badge-nights">{"★".repeat(p.star)}</span>}
                    <span className="sbc2b-view">Tour property →</span>
                  </div>
                  <div className="sbc2b-card-body">
                    <div className="sbc2b-card-title">{p.title}</div>
                    <div className="sbc2b-card-room">{p.rooms.length} room{p.rooms.length === 1 ? "" : "s"} released · owner-vacant nights</div>
                    <div className="sbc2b-card-foot">
                      <div className="sbc2b-youpay"><b>from {perN(fromPrice)}</b><span>/night · buy at 2×</span></div>
                      <span className="sbc-btn-gold" style={{ pointerEvents: "none" }}>Open</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {msg && <div style={{ fontSize: ".82rem", marginTop: 12, color: "var(--sbc-gold-deep)", fontWeight: 600 }}>{msg}</div>}
        <p className="sbc-ms-note" style={{ marginTop: 16, color: "rgba(74,56,32,.55)" }}>{CIRCLE_B2B_RESALE_NOTE}</p>
      </div>

      {/* basket bar */}
      {basketList.length > 0 && !review && (
        <div className="sbc2b-basket">
          <div className="sbc2b-basket-in">
            <div className="sbc2b-basket-lines">
              <span>{basketList.length} room-night set{basketList.length === 1 ? "" : "s"}{basketCities.length > 1 ? ` · ${basketCities.length} cities` : ""} · {inr(invTotal)}</span>
              {newCities.length > 0 && <span className="sbc2b-basket-city">+ City access ({newCities.map(cap).join(", ")}) {inr(cityFees)}</span>}
            </div>
            <div className="sbc2b-basket-cta"><b>{inr(grandTotal)}</b><button onClick={() => setReview(true)} className="sbc-btn-gold">Review & pay</button></div>
          </div>
        </div>
      )}

      {/* Step 2 — property + room TOUR */}
      {tour && (
        <TourOverlay
          property={tour} accessPrice={accessPrice} unlocked={unlocked}
          inBasket={(k) => !!basket[k]}
          onAdd={addToBasket} onRemove={removeFromBasket}
          onClose={() => setTour(null)}
        />
      )}

      {/* Step 4 — review + pay */}
      {review && (
        <ReviewOverlay
          items={basketList} invTotal={invTotal} newCities={newCities} accessPrice={accessPrice} cityFees={cityFees} grandTotal={grandTotal}
          busy={busy} onRemove={removeFromBasket} onClose={() => setReview(false)} onPay={pay}
        />
      )}

      <BrowseStyles />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// TOUR — full property + room tour with calendar + trading panel
// ════════════════════════════════════════════════════════════════════════
function TourOverlay({ property, accessPrice, unlocked, inBasket, onAdd, onRemove, onClose }: {
  property: Property; accessPrice: number; unlocked: string[];
  inBasket: (k: string) => boolean; onAdd: (b: BItem) => void; onRemove: (k: string) => void; onClose: () => void;
}) {
  const [gi, setGi] = useState(0);
  const imgs = property.images.length ? property.images : facets(property.rooms[0]).roomImgs;
  const cityLocked = !unlocked.includes(norm(property.city));
  return (
    <div className="sbc2b-tour" onClick={onClose}>
      <div className="sbc2b-tour-card" onClick={(e) => e.stopPropagation()}>
        <button className="sbc2b-tour-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="sbc2b-gallery">
          {imgs.length ? <img src={imgs[Math.min(gi, imgs.length - 1)]} alt={property.title} /> : <div className="sbc2b-noimg big">🏔️</div>}
          {imgs.length > 1 && (<>
            <button className="sbc2b-nav left" onClick={() => setGi((i) => (i - 1 + imgs.length) % imgs.length)}>‹</button>
            <button className="sbc2b-nav right" onClick={() => setGi((i) => (i + 1) % imgs.length)}>›</button>
            <div className="sbc2b-dots">{imgs.map((_, i) => <span key={i} className={i === gi ? "on" : ""} />)}</div>
          </>)}
          <span className="sbc2b-badge sbc2b-badge-city">📍 {cap(property.city)}</span>
        </div>
        <div className="sbc2b-tour-body">
          <div className="sbc2b-tour-title">{property.title}{property.star > 0 && <span className="sbc2b-stars"> {"★".repeat(property.star)}</span>}</div>
          {property.description && <p className="sbc2b-desc">{property.description}</p>}
          {cityLocked && <div className="sbc2b-lockedcity">🗝️ First room you buy here adds a one-time ₹{accessPrice} {cap(property.city)} city access (lifetime).</div>}

          <div className="sbc2b-roomshead">Rooms released · pick your nights</div>
          {property.rooms.map((l) => (
            <RoomTradingCard key={l.id} listing={l} inBasket={inBasket} onAdd={onAdd} onRemove={onRemove} />
          ))}
        </div>
      </div>
      <RoomStyles />
    </div>
  );
}

function RoomTradingCard({ listing, inBasket, onAdd, onRemove }: {
  listing: Listing; inBasket: (k: string) => boolean; onAdd: (b: BItem) => void; onRemove: (k: string) => void;
}) {
  const f = facets(listing);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<Quote | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sel, setSel] = useState<Quote["selection"] | null>(null);
  const [ri, setRi] = useState(0);

  // load window + blocked + market headline when opened
  useEffect(() => {
    if (!open || q) return;
    fetch(`/api/b2b/market-quote?listingId=${encodeURIComponent(listing.id)}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (d?.ok) setQ(d); }).catch(() => {});
  }, [open, q, listing.id]);

  // price the selection when both dates chosen
  useEffect(() => {
    if (!from || !to || nightsOf(from, to) < 1) { setSel(null); return; }
    let live = true;
    fetch(`/api/b2b/market-quote?listingId=${encodeURIComponent(listing.id)}&from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (live && d?.ok && d.selection) setSel(d.selection); }).catch(() => {});
    return () => { live = false; };
  }, [from, to, listing.id]);

  const blocked = useMemo(() => new Set(q?.blocked || []), [q]);
  const win = q?.window;
  const key = from && to ? `${listing.id}|${from}|${to}` : "";
  const picked = key && inBasket(key);

  const onDay = (d: string) => {
    if (!from || (from && to)) { setFrom(d); setTo(""); return; }
    if (d <= from) { setFrom(d); setTo(""); return; }
    // no blocked date inside [from, d)
    for (let x = from; x < d; x = addDays(x, 1)) if (blocked.has(x)) { setFrom(d); setTo(""); return; }
    setTo(d);
  };

  const add = () => {
    if (!sel || !from || !to) return;
    onAdd({
      key, listingId: listing.id, hotelId: listing.hotel_id, roomId: listing.room_id,
      title: f.title, city: f.city, room: f.room, image: f.roomImg,
      from, to, nights: sel.nights, buyPerNight: sel.buyPerNight, buyerPays: sel.buyerPays, marketAdr: sel.marketValuePerNight,
    });
  };

  const imgs = f.roomImgs;
  return (
    <div className="sbc2b-room">
      <div className="sbc2b-room-top" onClick={() => setOpen((o) => !o)}>
        {imgs[0] ? <img src={imgs[0]} alt={f.room} className="sbc2b-room-img" /> : <div className="sbc2b-room-img sbc2b-noimg">🛏</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sbc2b-room-name">{f.room}</div>
          <div className="sbc2b-room-sub">{f.capacity ? `up to ${f.capacity} guests · ` : ""}buy at {perN(f.buyN)}/night</div>
          {q?.market && <div className="sbc2b-room-mkt">Market {perN(q.market.adr)} ADR · {perN(q.market.low)}–{perN(q.market.high)}</div>}
        </div>
        <span className="sbc2b-room-caret">{open ? "▾" : "›"}</span>
      </div>

      {open && (
        <div className="sbc2b-room-body">
          {/* room gallery */}
          {imgs.length > 1 && (
            <div className="sbc2b-roomgal">
              <img src={imgs[Math.min(ri, imgs.length - 1)]} alt={f.room} />
              <button className="sbc2b-nav left sm" onClick={() => setRi((i) => (i - 1 + imgs.length) % imgs.length)}>‹</button>
              <button className="sbc2b-nav right sm" onClick={() => setRi((i) => (i + 1) % imgs.length)}>›</button>
            </div>
          )}
          {f.amenities.length > 0 && <div className="sbc2b-amen">{f.amenities.slice(0, 12).map((a, i) => <span key={i} className="sbc2b-amen-chip">{a}</span>)}</div>}

          {/* trading panel */}
          <div className="sbc2b-trade">
            <div className="sbc2b-trade-row"><span>Your buy price</span><b>{perN(f.buyN)}<small>/night</small></b></div>
            {q?.market ? (<>
              <div className="sbc2b-trade-row"><span>Market rate (ADR)</span><b>{perN(q.market.adr)}<small>/night</small></b></div>
              <div className="sbc2b-trade-bar">
                <span className="sbc2b-trade-low">low {perN(q.market.low)}</span>
                <div className="sbc2b-trade-track"><span className="sbc2b-trade-buy" style={{ left: `${Math.max(2, Math.min(96, ((f.buyN - q.market.low) / Math.max(1, q.market.high - q.market.low)) * 100))}%` }} title="your buy price" /></div>
                <span className="sbc2b-trade-high">high {perN(q.market.high)}</span>
              </div>
              <div className="sbc2b-trade-note">{f.buyN < q.market.adr ? `📈 You buy ${perN(q.market.adr - f.buyN)}/night below market — resale upside.` : "Priced around the market rate."}</div>
            </>) : <div className="sbc2b-trade-note dim">Loading market price…</div>}
          </div>

          {/* live availability calendar */}
          {win ? (
            <MiniCalendar windowFrom={win.effectiveFrom} windowTo={win.to} blocked={blocked} from={from} to={to} onDay={onDay} />
          ) : <div className="sbc2b-trade-note dim">Loading calendar…</div>}

          {/* selection summary */}
          {from && to && sel && (
            <div className="sbc2b-selbox">
              <div className="sbc2b-sel-row"><span>{from} → {to} · {sel.nights} night{sel.nights === 1 ? "" : "s"}</span><b>{inr(sel.buyerPays)}</b></div>
              <div className="sbc2b-sel-sub">
                {perN(sel.buyPerNight)}/n × {sel.nights} = {inr(sel.subtotal)} + {inr(sel.buyerFee)} fee
                {sel.marketUpside > 0 && <span className="sbc2b-upside"> · market value {inr(sel.marketValue)} → upside {inr(sel.marketUpside)}</span>}
              </div>
              <button className={picked ? "sbc-btn-ghost" : "sbc-btn-gold"} style={{ width: "100%", marginTop: 8 }} onClick={() => (picked ? onRemove(key) : add())}>
                {picked ? "✓ In bundle — remove" : `Add ${sel.nights} night${sel.nights === 1 ? "" : "s"} to bundle`}
              </button>
            </div>
          )}
          {from && !to && <div className="sbc2b-trade-note">Now pick your check-out date.</div>}
        </div>
      )}
    </div>
  );
}

function MiniCalendar({ windowFrom, windowTo, blocked, from, to, onDay }: {
  windowFrom: string; windowTo: string; blocked: Set<string>; from: string; to: string; onDay: (d: string) => void;
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
  const inRange = (d: string) => from && to && d >= from && d < to;
  return (
    <div className="sbc2b-cal">
      <div className="sbc2b-cal-head">
        <button disabled={atMin} onClick={() => step(-1)}>‹</button>
        <span>{MONTHS[ym.m]} {ym.y}</span>
        <button disabled={atMax} onClick={() => step(1)}>›</button>
      </div>
      <div className="sbc2b-cal-dow">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="sbc2b-cal-grid">
        {grid.map((d, i) => {
          if (!d) return <span key={i} className="sbc2b-cal-empty" />;
          const past = d < windowFrom || d >= windowTo;
          const isBlocked = blocked.has(d);
          const disabled = past || isBlocked;
          const isFrom = d === from, isTo = d === to;
          const cls = ["sbc2b-cal-day"];
          if (disabled) cls.push("off");
          if (isFrom || isTo) cls.push("end");
          else if (inRange(d)) cls.push("mid");
          return <button key={i} disabled={disabled} className={cls.join(" ")} onClick={() => onDay(d)}>{Number(d.slice(8))}</button>;
        })}
      </div>
      <div className="sbc2b-cal-legend"><span className="lg free" /> released <span className="lg off" /> booked</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// REVIEW — full package review before payment
// ════════════════════════════════════════════════════════════════════════
function ReviewOverlay({ items, invTotal, newCities, accessPrice, cityFees, grandTotal, busy, onRemove, onClose, onPay }: {
  items: BItem[]; invTotal: number; newCities: string[]; accessPrice: number; cityFees: number; grandTotal: number;
  busy: boolean; onRemove: (k: string) => void; onClose: () => void; onPay: () => void;
}) {
  const byCity = useMemo(() => {
    const m: Record<string, BItem[]> = {};
    items.forEach((it) => { const c = norm(it.city); (m[c] ||= []).push(it); });
    return m;
  }, [items]);
  return (
    <div className="sbc2b-tour" onClick={onClose}>
      <div className="sbc2b-tour-card" onClick={(e) => e.stopPropagation()}>
        <button className="sbc2b-tour-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="sbc2b-tour-body">
          <div className="sbc2b-tour-title">Review your bundle</div>
          <p className="sbc2b-desc">{items.length} room-night set{items.length === 1 ? "" : "s"} across {Object.keys(byCity).length} cit{Object.keys(byCity).length === 1 ? "y" : "ies"} — one payment.</p>

          {Object.entries(byCity).map(([c, its]) => (
            <div key={c} className="sbc2b-rev-city">
              <div className="sbc2b-rev-cityhead">📍 {cap(c)}{newCities.includes(c) ? <span className="sbc2b-rev-newcity">+ ₹{accessPrice} access</span> : <span className="sbc2b-rev-unlocked">unlocked</span>}</div>
              {its.map((it) => (
                <div key={it.key} className="sbc2b-rev-item">
                  {it.image ? <img src={it.image} alt={it.room} /> : <div className="sbc2b-noimg" style={{ width: 46, height: 46, borderRadius: 8 }}>🛏</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sbc2b-rev-title">{it.title}</div>
                    <div className="sbc2b-rev-sub">{it.room} · {it.from}→{it.to} · {it.nights}n · {perN(it.buyPerNight)}/n</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <b style={{ color: "var(--sbc-coffee)" }}>{inr(it.buyerPays)}</b>
                    <button className="sbc2b-rev-rm" onClick={() => onRemove(it.key)}>remove</button>
                  </div>
                </div>
              ))}
            </div>
          ))}

          <div className="sbc2b-break">
            <div className="sbc2b-break-row"><span>Inventory ({items.length} set{items.length === 1 ? "" : "s"})</span><b>{inr(invTotal)}</b></div>
            {cityFees > 0 && <div className="sbc2b-break-row"><span>City access ({newCities.map(cap).join(", ")})</span><b>{inr(cityFees)}</b></div>}
            <div className="sbc2b-break-row total"><span>You pay</span><b>{inr(grandTotal)}</b></div>
          </div>

          <button disabled={busy || !items.length} className="sbc-btn-gold" style={{ width: "100%", padding: 13, fontSize: ".98rem" }} onClick={onPay}>
            {busy ? "Processing…" : `Pay ${inr(grandTotal)}`}
          </button>
          <p className="sbc2b-tour-foot">{CIRCLE_B2B_RESALE_NOTE}</p>
        </div>
      </div>
      <RoomStyles />
    </div>
  );
}

// ── styles (split so each block stays small) ──────────────────────────────
function BrowseStyles() {
  return (
    <style jsx global>{`
      .sbc2b { padding-bottom: 96px; }
      .sbc2b-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 12px; }
      .sbc2b-step { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 12px; padding: 9px 10px; }
      .sbc2b-step-n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--sbc-gold-deep); color: #fff; font-size: .72rem; font-weight: 800; display: grid; place-items: center; }
      .sbc2b-step-t { font-size: .78rem; font-weight: 800; color: var(--sbc-coffee); line-height: 1.1; }
      .sbc2b-step-d { font-size: .62rem; color: rgba(74,56,32,.6); }
      .sbc2b-kpis { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 8px; }
      .sbc2b-kpi { font-size: .7rem; font-weight: 700; color: rgba(74,56,32,.8); background: rgba(139,105,20,.08); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 5px 11px; }
      .sbc2b-kpi-gold { color: #fff; background: var(--sbc-gold-deep); border-color: var(--sbc-gold-deep); }
      .sbc2b-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
      .sbc2b-chip { text-transform: capitalize; font-size: .82rem; font-weight: 700; padding: 7px 13px; border-radius: 999px; cursor: pointer; border: 1px solid rgba(139,105,20,.25); background: #fff; color: var(--sbc-ink); display: inline-flex; align-items: center; gap: 6px; }
      .sbc2b-chip.on { border-color: var(--sbc-gold-deep); background: var(--sbc-gold-deep); color: #fff; }
      .sbc2b-chip-ct { font-size: .64rem; opacity: .7; background: rgba(0,0,0,.08); border-radius: 999px; padding: 1px 6px; }
      .sbc2b-chip.on .sbc2b-chip-ct { background: rgba(255,255,255,.22); }
      .sbc2b-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
      .sbc2b-card { background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 16px; overflow: hidden; box-shadow: 0 4px 18px rgba(74,56,32,.06); transition: transform .15s, box-shadow .15s; display: flex; flex-direction: column; text-align: left; padding: 0; cursor: pointer; }
      .sbc2b-card:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(74,56,32,.13); }
      .sbc2b-card-img { position: relative; width: 100%; height: 150px; background: linear-gradient(135deg, #efe6d4, #e2d4bb); overflow: hidden; }
      .sbc2b-card-img img { width: 100%; height: 100%; object-fit: cover; }
      .sbc2b-noimg { display: grid; place-items: center; font-size: 2.4rem; width: 100%; height: 100%; }
      .sbc2b-noimg.big { height: 240px; font-size: 3.4rem; }
      .sbc2b-badge { position: absolute; font-size: .64rem; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: rgba(30,22,12,.72); color: #fff; }
      .sbc2b-badge-city { top: 8px; left: 8px; }
      .sbc2b-badge-nights { top: 8px; right: 8px; background: rgba(139,105,20,.9); color: #ffe9b8; }
      .sbc2b-view { position: absolute; bottom: 8px; right: 8px; font-size: .66rem; font-weight: 800; color: #fff; background: rgba(30,22,12,.6); padding: 4px 9px; border-radius: 999px; opacity: 0; transition: opacity .15s; }
      .sbc2b-card:hover .sbc2b-view { opacity: 1; }
      .sbc2b-card-body { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
      .sbc2b-card-title { font-weight: 800; color: var(--sbc-coffee); font-size: .92rem; line-height: 1.15; }
      .sbc2b-card-room { font-size: .72rem; color: rgba(74,56,32,.62); }
      .sbc2b-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 8px; }
      .sbc2b-youpay { display: flex; flex-direction: column; line-height: 1.05; }
      .sbc2b-youpay b { color: var(--sbc-coffee); font-size: .92rem; }
      .sbc2b-youpay span { font-size: .58rem; color: rgba(74,56,32,.5); }
      .sbc2b-basket { position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: linear-gradient(0deg, #fff 70%, rgba(255,255,255,0)); }
      .sbc2b-basket-in { max-width: 720px; margin: 0 auto; background: var(--sbc-coffee, #3a2c17); color: #fbf3e2; border-radius: 16px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
      .sbc2b-basket-lines { display: flex; flex-direction: column; gap: 2px; font-size: .76rem; opacity: .92; }
      .sbc2b-basket-city { font-size: .68rem; opacity: .78; }
      .sbc2b-basket-cta { display: flex; align-items: center; gap: 12px; }
      .sbc2b-basket-cta b { font-size: 1.05rem; }
    `}</style>
  );
}

function RoomStyles() {
  return (
    <style jsx global>{`
      .sbc2b-tour { position: fixed; inset: 0; z-index: 90; background: rgba(28,20,10,.62); backdrop-filter: blur(4px); display: flex; align-items: flex-end; justify-content: center; animation: sbc2bFade .18s ease; }
      @media (min-width: 640px) { .sbc2b-tour { align-items: center; } }
      .sbc2b-tour-card { width: 100%; max-width: 520px; max-height: 94vh; overflow-y: auto; background: #fffaf0; border-radius: 22px 22px 0 0; position: relative; animation: sbc2bSlide .22s cubic-bezier(.2,.8,.2,1); -webkit-overflow-scrolling: touch; }
      @media (min-width: 640px) { .sbc2b-tour-card { border-radius: 22px; } }
      .sbc2b-tour-x { position: absolute; top: 10px; right: 10px; z-index: 3; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(30,22,12,.6); color: #fff; font-size: .9rem; cursor: pointer; }
      .sbc2b-gallery { position: relative; height: 230px; background: #e2d4bb; overflow: hidden; }
      .sbc2b-gallery img { width: 100%; height: 100%; object-fit: cover; }
      .sbc2b-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(30,22,12,.5); color: #fff; font-size: 1.3rem; cursor: pointer; }
      .sbc2b-nav.left { left: 8px; } .sbc2b-nav.right { right: 8px; }
      .sbc2b-nav.sm { width: 28px; height: 28px; font-size: 1.05rem; }
      .sbc2b-dots { position: absolute; bottom: 9px; left: 0; right: 0; display: flex; justify-content: center; gap: 5px; }
      .sbc2b-dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.5); }
      .sbc2b-dots span.on { background: #fff; width: 16px; border-radius: 999px; }
      .sbc2b-tour-body { padding: 15px 17px 22px; }
      .sbc2b-tour-title { font-size: 1.12rem; font-weight: 800; color: var(--sbc-coffee); }
      .sbc2b-stars { color: #d4a24a; font-size: .8rem; }
      .sbc2b-desc { font-size: .8rem; line-height: 1.5; color: rgba(74,56,32,.72); margin: 8px 0; }
      .sbc2b-lockedcity { font-size: .72rem; color: #8a6914; background: rgba(139,105,20,.08); border: 1px solid rgba(139,105,20,.2); border-radius: 10px; padding: 8px 11px; margin: 8px 0; }
      .sbc2b-roomshead { font-size: .82rem; font-weight: 800; color: var(--sbc-coffee); margin: 14px 0 8px; }
      .sbc2b-room { border: 1px solid rgba(139,105,20,.18); border-radius: 14px; margin-bottom: 10px; overflow: hidden; background: #fff; }
      .sbc2b-room-top { display: flex; align-items: center; gap: 10px; padding: 9px 11px; cursor: pointer; }
      .sbc2b-room-img { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; flex: none; font-size: 1.3rem; }
      .sbc2b-room-name { font-weight: 800; color: var(--sbc-coffee); font-size: .88rem; }
      .sbc2b-room-sub { font-size: .7rem; color: rgba(74,56,32,.62); }
      .sbc2b-room-mkt { font-size: .66rem; color: #6b8f4e; font-weight: 700; margin-top: 1px; }
      .sbc2b-room-caret { color: var(--sbc-gold-deep); font-weight: 800; font-size: 1rem; }
      .sbc2b-room-body { padding: 4px 11px 13px; border-top: 1px solid rgba(139,105,20,.12); }
      .sbc2b-roomgal { position: relative; height: 150px; border-radius: 12px; overflow: hidden; margin: 10px 0; background: #e2d4bb; }
      .sbc2b-roomgal img { width: 100%; height: 100%; object-fit: cover; }
      .sbc2b-amen { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
      .sbc2b-amen-chip { font-size: .66rem; font-weight: 600; color: rgba(74,56,32,.8); background: rgba(139,105,20,.09); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 3px 9px; text-transform: capitalize; }
      .sbc2b-trade { background: linear-gradient(135deg, #1f1710, #2c2116); color: #f3e7d0; border-radius: 12px; padding: 11px 13px; margin: 10px 0; }
      .sbc2b-trade-row { display: flex; justify-content: space-between; align-items: baseline; font-size: .78rem; padding: 2px 0; opacity: .95; }
      .sbc2b-trade-row b { color: #ffd98a; font-size: .92rem; } .sbc2b-trade-row small { opacity: .6; font-size: .62rem; font-weight: 500; }
      .sbc2b-trade-bar { display: flex; align-items: center; gap: 7px; margin: 9px 0 3px; font-size: .58rem; opacity: .8; }
      .sbc2b-trade-track { position: relative; flex: 1; height: 5px; border-radius: 999px; background: linear-gradient(90deg, #6b8f4e, #d4a24a, #c96f4a); }
      .sbc2b-trade-buy { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #1f1710; transform: translate(-50%, -50%); box-shadow: 0 0 0 2px #ffd98a; }
      .sbc2b-trade-note { font-size: .68rem; color: #cde7b0; margin-top: 6px; }
      .sbc2b-trade-note.dim { color: rgba(243,231,208,.55); }
      .sbc2b-cal { border: 1px solid rgba(139,105,20,.18); border-radius: 12px; padding: 10px; margin: 10px 0; }
      .sbc2b-cal-head { display: flex; align-items: center; justify-content: space-between; font-weight: 800; color: var(--sbc-coffee); font-size: .85rem; margin-bottom: 8px; }
      .sbc2b-cal-head button { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(139,105,20,.25); background: #fff; color: var(--sbc-gold-deep); font-size: 1rem; cursor: pointer; }
      .sbc2b-cal-head button:disabled { opacity: .3; cursor: default; }
      .sbc2b-cal-dow { display: grid; grid-template-columns: repeat(7,1fr); gap: 3px; font-size: .6rem; color: rgba(74,56,32,.5); text-align: center; margin-bottom: 3px; font-weight: 700; }
      .sbc2b-cal-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 3px; }
      .sbc2b-cal-empty { aspect-ratio: 1; }
      .sbc2b-cal-day { aspect-ratio: 1; border: 0; border-radius: 8px; background: rgba(107,143,78,.14); color: var(--sbc-coffee); font-size: .72rem; font-weight: 600; cursor: pointer; font-family: inherit; }
      .sbc2b-cal-day.off { background: repeating-linear-gradient(45deg, #f0eadf, #f0eadf 3px, #e6ddcd 3px, #e6ddcd 6px); color: rgba(74,56,32,.32); cursor: default; text-decoration: line-through; }
      .sbc2b-cal-day.mid { background: rgba(212,162,74,.32); border-radius: 0; }
      .sbc2b-cal-day.end { background: var(--sbc-gold-deep); color: #fff; }
      .sbc2b-cal-legend { display: flex; align-items: center; gap: 6px; font-size: .6rem; color: rgba(74,56,32,.55); margin-top: 8px; }
      .sbc2b-cal-legend .lg { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
      .sbc2b-cal-legend .lg.free { background: rgba(107,143,78,.35); } .sbc2b-cal-legend .lg.off { background: #e6ddcd; margin-left: 8px; }
      .sbc2b-selbox { background: #fff; border: 1px solid rgba(139,105,20,.2); border-radius: 12px; padding: 11px 13px; margin-top: 8px; }
      .sbc2b-sel-row { display: flex; justify-content: space-between; font-size: .82rem; font-weight: 700; color: var(--sbc-coffee); }
      .sbc2b-sel-sub { font-size: .66rem; color: rgba(74,56,32,.6); margin-top: 2px; }
      .sbc2b-upside { color: #6b8f4e; font-weight: 700; }
      .sbc2b-break { background: #fff; border: 1px solid rgba(139,105,20,.18); border-radius: 14px; padding: 12px 14px; margin: 12px 0 14px; }
      .sbc2b-break-row { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; color: rgba(74,56,32,.72); padding: 4px 0; }
      .sbc2b-break-row b { color: var(--sbc-coffee); }
      .sbc2b-break-row.total { border-top: 1px dashed rgba(139,105,20,.3); margin-top: 4px; padding-top: 9px; font-size: .95rem; }
      .sbc2b-break-row.total b { color: var(--sbc-coffee); font-size: 1.08rem; }
      .sbc2b-rev-city { margin: 10px 0; }
      .sbc2b-rev-cityhead { font-size: .8rem; font-weight: 800; color: var(--sbc-coffee); display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .sbc2b-rev-newcity { font-size: .62rem; font-weight: 700; color: #8a6914; background: rgba(139,105,20,.1); border-radius: 999px; padding: 2px 8px; }
      .sbc2b-rev-unlocked { font-size: .62rem; font-weight: 700; color: #6b8f4e; }
      .sbc2b-rev-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid rgba(139,105,20,.1); }
      .sbc2b-rev-item img { width: 46px; height: 46px; border-radius: 8px; object-fit: cover; flex: none; }
      .sbc2b-rev-title { font-weight: 700; color: var(--sbc-coffee); font-size: .8rem; }
      .sbc2b-rev-sub { font-size: .66rem; color: rgba(74,56,32,.6); }
      .sbc2b-rev-rm { display: block; font-size: .6rem; color: #c96f4a; background: none; border: 0; cursor: pointer; margin-top: 2px; }
      .sbc2b-tour-foot { font-size: .64rem; color: rgba(74,56,32,.5); margin-top: 10px; }
      @keyframes sbc2bFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes sbc2bSlide { from { transform: translateY(24px); opacity: .6; } to { transform: translateY(0); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .sbc2b-tour, .sbc2b-tour-card { animation: none; } .sbc2b-card { transition: none; } }
    `}</style>
  );
}
