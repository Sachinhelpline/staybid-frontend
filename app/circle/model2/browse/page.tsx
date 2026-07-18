"use client";

// v355 — Circle Model 2: browse released inventory + room/property TOUR +
// multi-select basket + multi-city bundle. Premium, high-tech surface:
//   • ALL cities shown by default (an "All Cities" chip) + per-city filter.
//   • Every listing opens a full room + property TOUR (image gallery, amenities,
//     capacity, description) BEFORE buying — an investor goes through the room
//     just like a guest would.
//   • Price rule (v355): sell = the owner's OWN price/night × 2 (double). Each
//     card + the tour show "own ₹X → you buy at ₹2X (2×)" transparently.
// NO pre-activation gate — the FULL inventory is browsable from the start; the
// per-city ₹access fee is added AT CHECKOUT only for the cities the basket
// touches that the buyer hasn't unlocked yet (one-time, lifetime).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { fmtINR } from "@/lib/circle/engine";
import { CIRCLE_B2B_RESALE_NOTE } from "@/lib/circle/disclosure";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type ListingMeta = {
  title?: string; city?: string; room?: string; capacity?: number; star?: number;
  description?: string; monthly_rate?: number; ownPerNight?: number; multiplier?: number;
  room_images?: string[]; prop_images?: string[]; amenities?: string[];
};
type Listing = {
  id: string; hotel_id: string; hotel_name: string | null; hotel_city: string;
  unit_number: string | null; unit_id: string | null; room_id: string; source?: string | null;
  date_from: string; date_to: string; nights: number; ask_per_night: number; ask_total: number;
  own_per_night?: number | null; price_multiplier?: number | null; metadata?: ListingMeta | null;
  split?: { buyerPays?: number; askTotal: number; buyerFeePct?: number; buyerFee?: number };
};

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const norm = (c: any) => String(c || "").trim().toLowerCase();
const cap = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
const ALL = "__all__";

// Resolve the display facets of a listing from its columns + metadata.
function facets(l: Listing) {
  const md = l.metadata || {};
  const own = Number(l.own_per_night ?? md.ownPerNight ?? 0) || 0;
  const mult = Number(l.price_multiplier ?? md.multiplier ?? 2) || 2;
  const askN = Number(l.ask_per_night) || own * mult;
  const youPay = Number(l.split?.buyerPays ?? l.ask_total ?? 0) || 0;
  const imgs = [...(md.room_images || []), ...(md.prop_images || [])].filter(Boolean);
  return {
    own, mult, askN, youPay, imgs,
    title: l.hotel_name || md.title || "Property",
    city: l.hotel_city || md.city || "",
    room: md.room || "Room",
    capacity: Number(md.capacity) || 0,
    star: Number(md.star) || 0,
    amenities: (md.amenities || []).filter(Boolean),
    description: md.description || "",
    monthly: Number(md.monthly_rate) || own * 30,
  };
}

export default function Model2BrowsePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [accessPrice, setAccessPrice] = useState<number>(999);
  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [city, setCity] = useState<string>(ALL);
  const [basket, setBasket] = useState<Record<string, Listing>>({});
  const [tour, setTour] = useState<Listing | null>(null);   // open room/property tour
  const [tourIdx, setTourIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadListings = useCallback(() => {
    setLoading(true);
    fetch(`/api/b2b/marketplace`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAllListings(Array.isArray(d?.listings) ? d.listings : []))
      .catch(() => setAllListings([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/browse" }); return; }
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); if (d?.price) setAccessPrice(Number(d.price) || 999); })
      .catch(() => {});
    loadListings();
  }, [user, authLoading, router, loadListings]);

  const listings = useMemo(
    () => (city === ALL ? allListings : allListings.filter((l) => norm(facets(l).city) === norm(city))),
    [allListings, city],
  );

  const isUnlocked = (c: string) => unlocked.includes(norm(c));
  const inBasket = (id: string) => !!basket[id];
  const toggle = (l: Listing) => setBasket((b) => { const n = { ...b }; if (n[l.id]) delete n[l.id]; else n[l.id] = l; return n; });

  const basketList = useMemo(() => Object.values(basket), [basket]);
  const invTotal = useMemo(() => basketList.reduce((s, l) => s + Number(l.split?.buyerPays ?? l.ask_total ?? 0), 0), [basketList]);
  const basketCities = useMemo(() => Array.from(new Set(basketList.map((l) => norm(facets(l).city)).filter(Boolean))), [basketList]);
  const newCities = useMemo(() => basketCities.filter((c) => !isUnlocked(c)), [basketCities, unlocked]);
  const accessFees = newCities.length * accessPrice;
  const grandTotal = invTotal + accessFees;

  async function buyBasket() {
    if (!basketList.length) { setMsg("Add some listings first."); return; }
    setBusy(true); setMsg("");
    try {
      const cr = await fetch("/api/b2b/basket/checkout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ listingIds: basketList.map((l) => l.id) }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { setMsg(cd?.error || "Couldn't start payment"); loadListings(); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({ keyId: cd.keyId, orderId: cd.order.id, amountPaise: cd.order.amount, description: `Model 2 basket · ${basketList.length} listing${basketList.length === 1 ? "" : "s"}` });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setMsg("Payment cancelled"); return; }
        setMsg(e instanceof Error ? e.message : "Payment failed"); return;
      }

      const vr = await fetch("/api/b2b/basket/verify", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ razorpay_order_id: cd.order.id, razorpay_payment_id: pay?.razorpay_payment_id, razorpay_signature: pay?.razorpay_signature }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { setMsg(vd?.error || "Verify failed — contact support"); return; }
      setMsg(`Basket bought ✓ — ${vd.settled} block${vd.settled === 1 ? "" : "s"} now in your selling inventory.`);
      setBasket({}); setTour(null);
      fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()).then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); }).catch(() => {});
      loadListings();
    } catch { setMsg("Something went wrong"); }
    finally { setBusy(false); }
  }

  const supplyCities = useMemo(
    () => Array.from(new Set(allListings.map((l) => norm(facets(l).city)).filter(Boolean))).sort(),
    [allListings],
  );

  const openTour = (l: Listing) => { setTour(l); setTourIdx(0); };

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap sbc2b">
        <Link href="/circle" className="sbc-ms-back" style={{ color: "var(--sbc-gold-deep)" }}>← StayCircle</Link>

        {/* hero */}
        <div className="sbc-ms-eyebrow">
          <span className="sbc-ms-model">Model 2</span>
          <span className="sbc-ms-tag" style={{ color: "var(--sbc-coffee)" }}>Multi-City Inventory Bundle</span>
        </div>
        <h1 className="sbc-ms-title" style={{ color: "var(--sbc-coffee)" }}>Buy released inventory</h1>
        <p className="sbc-ms-sub" style={{ color: "rgba(74,56,32,.75)" }}>
          Tour any room, add owner-released nights across cities to your basket, and buy them together.
          Every room is StayBid-priced at <b>2× the owner’s own price</b> — a clear margin for the seller,
          a clear price for you. A one-time ₹{accessPrice} city fee is added at checkout only for the cities
          your basket touches (lifetime — you keep them).
        </p>

        {/* how-it-works mini strip */}
        <div className="sbc2b-steps">
          {[
            { n: "1", t: "Browse", d: "All cities, full inventory" },
            { n: "2", t: "Tour", d: "Go through the room" },
            { n: "3", t: "Build", d: "Add across cities" },
            { n: "4", t: "One payment", d: "Rooms + city fee together" },
          ].map((s) => (
            <div key={s.n} className="sbc2b-step">
              <span className="sbc2b-step-n">{s.n}</span>
              <div><div className="sbc2b-step-t">{s.t}</div><div className="sbc2b-step-d">{s.d}</div></div>
            </div>
          ))}
        </div>

        {/* KPI chips */}
        <div className="sbc2b-kpis">
          <span className="sbc2b-kpi">🔓 No pre-unlock — full inventory</span>
          <span className="sbc2b-kpi">🗝️ ₹{accessPrice}/city · one-time</span>
          <span className="sbc2b-kpi">⇄ 5% + 5% fee</span>
          <span className="sbc2b-kpi sbc2b-kpi-gold">✦ Listed at 2× owner’s own price</span>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "8px 0 2px" }}>
          <Link href="/circle/model2" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)" }}>Pre-buy StayBid-operated rooms →</Link>
          <Link href="/circle/me" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)" }}>My Circle · City Access →</Link>
        </div>

        {/* city filter — "All Cities" first + per-city chips */}
        <div className="sbc2b-chips">
          <button onClick={() => setCity(ALL)} className={`sbc2b-chip${city === ALL ? " on" : ""}`}>
            All Cities <span className="sbc2b-chip-ct">{allListings.length}</span>
          </button>
          {supplyCities.map((c) => {
            const ct = allListings.filter((l) => norm(facets(l).city) === c).length;
            return (
              <button key={c} onClick={() => setCity(c)} className={`sbc2b-chip${norm(city) === c ? " on" : ""}`}>
                {cap(c)}{isUnlocked(c) ? " 🔓" : ""} <span className="sbc2b-chip-ct">{ct}</span>
              </button>
            );
          })}
        </div>

        {/* listing grid */}
        {loading ? (
          <div className="sbc-panel" style={{ padding: 28, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading inventory…</div>
        ) : listings.length === 0 ? (
          <div className="sbc-panel" style={{ padding: 24, color: "rgba(74,56,32,.6)", fontSize: ".9rem" }}>No live listings here yet — released inventory will appear as owners release nights.</div>
        ) : (
          <div className="sbc2b-grid">
            {listings.map((l) => {
              const f = facets(l);
              const picked = inBasket(l.id);
              return (
                <div key={l.id} className={`sbc2b-card${picked ? " picked" : ""}`}>
                  <button className="sbc2b-card-img" onClick={() => openTour(l)} aria-label="View room">
                    {f.imgs[0]
                      ? <img src={f.imgs[0]} alt={f.room} loading="lazy" />
                      : <div className="sbc2b-noimg">🏔️</div>}
                    <span className="sbc2b-badge sbc2b-badge-city">📍 {cap(f.city)}</span>
                    <span className="sbc2b-badge sbc2b-badge-nights">{l.nights}n · {l.date_from.slice(5)}→{l.date_to.slice(5)}</span>
                    <span className="sbc2b-view">View room →</span>
                  </button>
                  <div className="sbc2b-card-body">
                    <div className="sbc2b-card-title">{f.title}</div>
                    <div className="sbc2b-card-room">{f.room}{f.capacity ? ` · up to ${f.capacity} guests` : ""}</div>
                    <div className="sbc2b-price">
                      <div className="sbc2b-price-own">Owner’s own ₹{fmtINR(f.own).replace("₹", "")}/night</div>
                      <div className="sbc2b-price-ask">You buy at <b>₹{fmtINR(f.askN).replace("₹", "")}</b>/night <span className="sbc2b-x">2×</span></div>
                    </div>
                    <div className="sbc2b-card-foot">
                      <div className="sbc2b-youpay"><b>{fmtINR(f.youPay)}</b><span>you pay · {l.nights}n</span></div>
                      <button onClick={() => toggle(l)} className={picked ? "sbc-btn-ghost" : "sbc-btn-gold"} style={{ whiteSpace: "nowrap" }}>
                        {picked ? "Remove" : "Add"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {msg && <div style={{ fontSize: ".82rem", marginTop: 12, color: "var(--sbc-gold-deep)", fontWeight: 600 }}>{msg}</div>}
        <p className="sbc-ms-note" style={{ marginTop: 16, color: "rgba(74,56,32,.55)" }}>{CIRCLE_B2B_RESALE_NOTE}</p>
      </div>

      {/* sticky basket bar */}
      {basketList.length > 0 && (
        <div className="sbc2b-basket">
          <div className="sbc2b-basket-in">
            <div className="sbc2b-basket-lines">
              <span>{basketList.length} room{basketList.length === 1 ? "" : "s"}{basketCities.length > 1 ? ` · ${basketCities.length} cities` : ""} · Inventory {fmtINR(invTotal)}</span>
              {newCities.length > 0 && <span className="sbc2b-basket-city">+ City access ({newCities.map(cap).join(", ")}) {fmtINR(accessFees)}</span>}
            </div>
            <div className="sbc2b-basket-cta">
              <b>{fmtINR(grandTotal)}</b>
              <button disabled={busy} onClick={buyBasket} className="sbc-btn-gold">{busy ? "Processing…" : "Buy basket"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ROOM / PROPERTY TOUR modal */}
      {tour && (() => {
        const f = facets(tour);
        const picked = inBasket(tour.id);
        const buyerFee = Number(tour.split?.buyerFee ?? Math.max(0, f.youPay - f.askN * tour.nights)) || 0;
        return (
          <div className="sbc2b-tour" onClick={() => setTour(null)}>
            <div className="sbc2b-tour-card" onClick={(e) => e.stopPropagation()}>
              <button className="sbc2b-tour-x" onClick={() => setTour(null)} aria-label="Close">✕</button>

              <div className="sbc2b-gallery">
                {f.imgs.length ? (
                  <>
                    <img src={f.imgs[Math.min(tourIdx, f.imgs.length - 1)]} alt={f.room} />
                    {f.imgs.length > 1 && (
                      <>
                        <button className="sbc2b-nav left" onClick={() => setTourIdx((i) => (i - 1 + f.imgs.length) % f.imgs.length)}>‹</button>
                        <button className="sbc2b-nav right" onClick={() => setTourIdx((i) => (i + 1) % f.imgs.length)}>›</button>
                        <div className="sbc2b-dots">{f.imgs.map((_, i) => <span key={i} className={i === tourIdx ? "on" : ""} />)}</div>
                      </>
                    )}
                  </>
                ) : <div className="sbc2b-noimg big">🏔️</div>}
                <span className="sbc2b-badge sbc2b-badge-city">📍 {cap(f.city)}</span>
              </div>

              <div className="sbc2b-tour-body">
                <div className="sbc2b-tour-head">
                  <div>
                    <div className="sbc2b-tour-title">{f.title}{f.star ? <span className="sbc2b-stars"> {"★".repeat(f.star)}</span> : null}</div>
                    <div className="sbc2b-tour-room">{f.room}{f.capacity ? ` · up to ${f.capacity} guests` : ""}</div>
                  </div>
                </div>

                <div className="sbc2b-tour-dates">🗓️ {tour.date_from} → {tour.date_to} · {tour.nights} night{tour.nights === 1 ? "" : "s"}</div>

                {f.amenities.length > 0 && (
                  <div className="sbc2b-amen">
                    {f.amenities.slice(0, 12).map((a, i) => <span key={i} className="sbc2b-amen-chip">{a}</span>)}
                  </div>
                )}

                {f.description && <p className="sbc2b-desc">{f.description}</p>}

                {/* price breakdown */}
                <div className="sbc2b-break">
                  <div className="sbc2b-break-row"><span>Owner’s own price / night</span><b>{fmtINR(f.own)}</b></div>
                  <div className="sbc2b-break-row"><span>StayBid resale multiplier</span><b>{f.mult}× <span className="sbc2b-x">double</span></b></div>
                  <div className="sbc2b-break-row hi"><span>Sell price / night</span><b>{fmtINR(f.askN)}</b></div>
                  <div className="sbc2b-break-row"><span>× {tour.nights} night{tour.nights === 1 ? "" : "s"}</span><b>{fmtINR(f.askN * tour.nights)}</b></div>
                  {buyerFee > 0 && <div className="sbc2b-break-row"><span>Buyer fee (5%)</span><b>{fmtINR(buyerFee)}</b></div>}
                  <div className="sbc2b-break-row total"><span>You pay</span><b>{fmtINR(f.youPay)}</b></div>
                  {!isUnlocked(f.city) && <div className="sbc2b-break-note">+ one-time ₹{accessPrice} {cap(f.city)} city access at checkout (lifetime).</div>}
                </div>

                <button onClick={() => { toggle(tour); }} className={picked ? "sbc-btn-ghost" : "sbc-btn-gold"} style={{ width: "100%", padding: "12px", fontSize: ".95rem" }}>
                  {picked ? "✓ In basket — remove" : "Add to basket"}
                </button>
                <p className="sbc2b-tour-foot">{CIRCLE_B2B_RESALE_NOTE}</p>
              </div>
            </div>
          </div>
        );
      })()}

      <style jsx global>{`
        .sbc2b { padding-bottom: 96px; }
        .sbc2b-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 12px; }
        .sbc2b-step { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 12px; padding: 9px 10px; }
        .sbc2b-step-n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--sbc-gold-deep); color: #fff; font-size: .72rem; font-weight: 800; display: grid; place-items: center; }
        .sbc2b-step-t { font-size: .78rem; font-weight: 800; color: var(--sbc-coffee); line-height: 1.1; }
        .sbc2b-step-d { font-size: .64rem; color: rgba(74,56,32,.6); }
        .sbc2b-kpis { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 8px; }
        .sbc2b-kpi { font-size: .7rem; font-weight: 700; color: rgba(74,56,32,.8); background: rgba(139,105,20,.08); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 5px 11px; }
        .sbc2b-kpi-gold { color: #fff; background: var(--sbc-gold-deep); border-color: var(--sbc-gold-deep); }
        .sbc2b-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
        .sbc2b-chip { text-transform: capitalize; font-size: .82rem; font-weight: 700; padding: 7px 13px; border-radius: 999px; cursor: pointer; border: 1px solid rgba(139,105,20,.25); background: #fff; color: var(--sbc-ink); display: inline-flex; align-items: center; gap: 6px; }
        .sbc2b-chip.on { border-color: var(--sbc-gold-deep); background: var(--sbc-gold-deep); color: #fff; }
        .sbc2b-chip-ct { font-size: .64rem; opacity: .7; background: rgba(0,0,0,.08); border-radius: 999px; padding: 1px 6px; }
        .sbc2b-chip.on .sbc2b-chip-ct { background: rgba(255,255,255,.22); opacity: .9; }
        .sbc2b-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
        .sbc2b-card { background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 16px; overflow: hidden; box-shadow: 0 4px 18px rgba(74,56,32,.06); transition: transform .15s, box-shadow .15s; display: flex; flex-direction: column; }
        .sbc2b-card:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(74,56,32,.13); }
        .sbc2b-card.picked { outline: 2px solid var(--sbc-gold-deep); outline-offset: -2px; }
        .sbc2b-card-img { position: relative; display: block; width: 100%; height: 152px; padding: 0; border: 0; cursor: pointer; background: linear-gradient(135deg, #efe6d4, #e2d4bb); overflow: hidden; }
        .sbc2b-card-img img { width: 100%; height: 100%; object-fit: cover; }
        .sbc2b-noimg { width: 100%; height: 100%; display: grid; place-items: center; font-size: 2.4rem; }
        .sbc2b-noimg.big { height: 240px; font-size: 3.4rem; }
        .sbc2b-badge { position: absolute; font-size: .64rem; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: rgba(30,22,12,.72); color: #fff; backdrop-filter: blur(3px); }
        .sbc2b-badge-city { top: 8px; left: 8px; }
        .sbc2b-badge-nights { top: 8px; right: 8px; background: rgba(139,105,20,.9); }
        .sbc2b-view { position: absolute; bottom: 8px; right: 8px; font-size: .66rem; font-weight: 800; color: #fff; background: rgba(30,22,12,.6); padding: 4px 9px; border-radius: 999px; opacity: 0; transition: opacity .15s; }
        .sbc2b-card-img:hover .sbc2b-view { opacity: 1; }
        .sbc2b-card-body { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .sbc2b-card-title { font-weight: 800; color: var(--sbc-coffee); font-size: .92rem; line-height: 1.15; }
        .sbc2b-card-room { font-size: .72rem; color: rgba(74,56,32,.62); }
        .sbc2b-price { margin: 4px 0 2px; }
        .sbc2b-price-own { font-size: .68rem; color: rgba(74,56,32,.5); text-decoration: line-through; }
        .sbc2b-price-ask { font-size: .8rem; color: var(--sbc-ink); }
        .sbc2b-x { font-size: .6rem; font-weight: 800; color: #fff; background: var(--sbc-gold-deep); border-radius: 999px; padding: 1px 6px; margin-left: 3px; vertical-align: middle; }
        .sbc2b-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 8px; }
        .sbc2b-youpay { display: flex; flex-direction: column; line-height: 1.05; }
        .sbc2b-youpay b { color: var(--sbc-coffee); font-size: .98rem; font-variant-numeric: tabular-nums; }
        .sbc2b-youpay span { font-size: .6rem; color: rgba(74,56,32,.5); }
        .sbc2b-basket { position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: linear-gradient(0deg, #fff 70%, rgba(255,255,255,0)); }
        .sbc2b-basket-in { max-width: 720px; margin: 0 auto; background: var(--sbc-coffee, #3a2c17); color: #fbf3e2; border-radius: 16px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
        .sbc2b-basket-lines { display: flex; flex-direction: column; gap: 2px; font-size: .76rem; opacity: .92; }
        .sbc2b-basket-city { font-size: .68rem; opacity: .78; }
        .sbc2b-basket-cta { display: flex; align-items: center; gap: 12px; }
        .sbc2b-basket-cta b { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
        .sbc2b-tour { position: fixed; inset: 0; z-index: 90; background: rgba(28,20,10,.62); backdrop-filter: blur(4px); display: flex; align-items: flex-end; justify-content: center; animation: sbc2bFade .18s ease; }
        @media (min-width: 640px) { .sbc2b-tour { align-items: center; } }
        .sbc2b-tour-card { width: 100%; max-width: 500px; max-height: 94vh; overflow-y: auto; background: #fffaf0; border-radius: 22px 22px 0 0; position: relative; animation: sbc2bSlide .22s cubic-bezier(.2,.8,.2,1); -webkit-overflow-scrolling: touch; }
        @media (min-width: 640px) { .sbc2b-tour-card { border-radius: 22px; } }
        .sbc2b-tour-x { position: absolute; top: 10px; right: 10px; z-index: 3; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(30,22,12,.6); color: #fff; font-size: .9rem; cursor: pointer; }
        .sbc2b-gallery { position: relative; height: 240px; background: #e2d4bb; overflow: hidden; }
        .sbc2b-gallery img { width: 100%; height: 100%; object-fit: cover; }
        .sbc2b-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(30,22,12,.5); color: #fff; font-size: 1.3rem; cursor: pointer; display: grid; place-items: center; }
        .sbc2b-nav.left { left: 8px; } .sbc2b-nav.right { right: 8px; }
        .sbc2b-dots { position: absolute; bottom: 9px; left: 0; right: 0; display: flex; justify-content: center; gap: 5px; }
        .sbc2b-dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.5); }
        .sbc2b-dots span.on { background: #fff; width: 16px; border-radius: 999px; }
        .sbc2b-tour-body { padding: 15px 17px 20px; }
        .sbc2b-tour-title { font-size: 1.12rem; font-weight: 800; color: var(--sbc-coffee); }
        .sbc2b-stars { color: #d4a24a; font-size: .8rem; }
        .sbc2b-tour-room { font-size: .82rem; color: rgba(74,56,32,.66); margin-top: 1px; }
        .sbc2b-tour-dates { font-size: .78rem; color: rgba(74,56,32,.7); margin: 10px 0; font-weight: 600; }
        .sbc2b-amen { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
        .sbc2b-amen-chip { font-size: .68rem; font-weight: 600; color: rgba(74,56,32,.8); background: rgba(139,105,20,.09); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 4px 10px; text-transform: capitalize; }
        .sbc2b-desc { font-size: .8rem; line-height: 1.5; color: rgba(74,56,32,.72); margin: 10px 0; }
        .sbc2b-break { background: #fff; border: 1px solid rgba(139,105,20,.18); border-radius: 14px; padding: 12px 14px; margin: 12px 0 14px; }
        .sbc2b-break-row { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; color: rgba(74,56,32,.72); padding: 4px 0; }
        .sbc2b-break-row b { color: var(--sbc-coffee); font-variant-numeric: tabular-nums; }
        .sbc2b-break-row.hi { color: var(--sbc-ink); }
        .sbc2b-break-row.hi b { color: var(--sbc-gold-deep); }
        .sbc2b-break-row.total { border-top: 1px dashed rgba(139,105,20,.3); margin-top: 4px; padding-top: 9px; font-size: .92rem; }
        .sbc2b-break-row.total b { color: var(--sbc-coffee); font-size: 1.06rem; }
        .sbc2b-break-note { font-size: .68rem; color: rgba(74,56,32,.6); margin-top: 7px; }
        .sbc2b-tour-foot { font-size: .64rem; color: rgba(74,56,32,.5); margin-top: 10px; }
        @keyframes sbc2bFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sbc2bSlide { from { transform: translateY(24px); opacity: .6; } to { transform: translateY(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .sbc2b-tour, .sbc2b-tour-card { animation: none; } .sbc2b-card { transition: none; } }
      `}</style>
    </div>
  );
}
