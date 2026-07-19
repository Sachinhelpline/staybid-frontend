"use client";

// v369 — Model 3: full property TOUR page (mirrors Model 1/2's /circle/[id]).
// Hero gallery + thumbnails + metric grid + description + room gallery/amenities,
// then the sealed-bid form (segment → per-room-per-night bid → rooms → EMD).
// Picked bids add to the localStorage bundle read by /trade/review. English copy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTradeAuth, getTradeToken } from "@/lib/trade/use-trade-auth";
import { addBid, bidItemKey, onBidBasketChange, bidBasketList } from "@/lib/trade/bid-basket";
import { bidCostPreview } from "@/lib/trade/auction-engine";

const inr = (n: any) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const cap = (s: string) => String(s || "").replace(/\b\w/g, (m) => m.toUpperCase());
const monthLabel = (mk: string) => {
  try { const [y, m] = String(mk).split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};

type Seg = { type: "full_month" | "week" | "weekend"; weekIndex?: number; label: string; nights: number };
const segId = (s: Seg) => `${s.type}:${s.weekIndex ?? ""}`;

export default function TradeTourPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lotId = decodeURIComponent(String(params?.id || ""));
  const auth = useTradeAuth();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [gi, setGi] = useState(0);
  const [basketN, setBasketN] = useState(0);

  useEffect(() => {
    (async () => {
      try { const r = await fetch(`/api/trade/lots/${encodeURIComponent(lotId)}`, { cache: "no-store" }); const d = await r.json(); if (r.ok) setData(d); }
      catch {} finally { setLoading(false); }
    })();
  }, [lotId]);
  useEffect(() => { setBasketN(bidBasketList().length); return onBidBasketChange(() => setBasketN(bidBasketList().length)); }, []);

  if (loading) return <div className="sbt-wrap"><div className="sbt-load">Loading property…</div><TourStyles /></div>;
  if (!data?.lot) return <div className="sbt-wrap"><Link href="/trade" className="sbt-back">← Back</Link><div className="sbt-load">This lot is no longer available.</div><TourStyles /></div>;

  const { lot, hotel, room, segments, depositPct } = data;
  const isLive = lot.sale_mode === "live";
  const heroImgs: string[] = (hotel.images?.length ? hotel.images : room.images) || [];

  return (
    <div className="sbt-wrap">
      <Link href="/trade" className="sbt-back">← Back to auction</Link>

      {/* Hero gallery */}
      <div className="sbt-hero">
        {heroImgs.length ? <img src={heroImgs[Math.min(gi, heroImgs.length - 1)]} alt={hotel.name} /> : <div className="sbt-noimg">🏔️</div>}
        {heroImgs.length > 1 && (<>
          <button className="sbt-nav left" onClick={() => setGi((i) => (i - 1 + heroImgs.length) % heroImgs.length)}>‹</button>
          <button className="sbt-nav right" onClick={() => setGi((i) => (i + 1) % heroImgs.length)}>›</button>
        </>)}
        <div className="sbt-hero-cap">
          <div className="sbt-hero-title">{hotel.name}</div>
          <div className="sbt-hero-loc">📍 {cap(hotel.city)}{hotel.star > 0 && <span className="sbt-hero-star"> · {"★".repeat(hotel.star)}</span>}</div>
        </div>
      </div>
      {heroImgs.length > 1 && <div className="sbt-thumbs">{heroImgs.map((im, i) => <button key={i} className={`sbt-thumb${i === gi ? " on" : ""}`} onClick={() => setGi(i)}><img src={im} alt="" /></button>)}</div>}

      {/* Two-column on desktop: property/room content left, sticky bid panel right */}
      <div className="sbt-cols">
        <div className="sbt-left">
          <div className="sbt-metrics">
            <div className="sbt-metric"><b>{inr(lot.min_bid_per_room_night)}</b><span>MIN BID / ROOM / NIGHT</span></div>
            <div className="sbt-metric"><b>{lot.num_rooms}</b><span>ROOMS AVAILABLE</span></div>
            <div className="sbt-metric"><b>{monthLabel(lot.month_key)}</b><span>AUCTION MONTH</span></div>
            <div className="sbt-metric"><b>{cap(lot.city)}</b><span>LOCATION</span></div>
          </div>
          {hotel.description && <p className="sbt-desc">{hotel.description}</p>}

          <div className="sbt-h2">{room.name || lot.category}</div>
          <RoomGallery images={room.images} />
          {(room.capacity > 0 || room.amenities?.length > 0) && (
            <div className="sbt-amen">
              {room.capacity > 0 && <span className="sbt-amen-chip">up to {room.capacity} guests</span>}
              {(room.amenities || []).slice(0, 12).map((a: string, i: number) => <span key={i} className="sbt-amen-chip">{a}</span>)}
            </div>
          )}
          {room.description && <p className="sbt-desc sm">{room.description}</p>}
        </div>

        <div className="sbt-right">
          <div className="sbt-h2">Place your bid</div>
          <p className="sbt-h2sub">
            {isLive
              ? "Pick a segment, set your buy price per room per night, and bid — no deposit. Buy wholesale, resell to your guests up to the room's booking price, and pocket the difference. Pay from your dashboard once it's accepted."
              : "Pick a segment (the whole month, a single week, or just weekends), set your price per room per night, then add it to your bundle. Highest bids win at the month-end close."}
          </p>
          {auth.status === "approved"
            ? (isLive
                ? <LiveBidBox lot={lot} segments={segments} live={data.live} buyerPremiumPct={data.buyerPremiumPct} market={data.market} roomsAvailable={data.roomsAvailable} />
                : <BidBox lot={lot} hotel={hotel} room={room} segments={segments} depositPct={depositPct} />)
            : <BidGate auth={auth} city={lot.city} />}
        </div>
      </div>

      {basketN > 0 && (
        <div className="sbt-basket">
          <div className="sbt-basket-in">
            <span>{basketN} bid{basketN === 1 ? "" : "s"} in bundle</span>
            <button onClick={() => router.push("/trade/review")} className="sbt-btn-gold">Review & pay EMD →</button>
          </div>
        </div>
      )}
      <TourStyles />
    </div>
  );
}

function RoomGallery({ images }: { images: string[] }) {
  const imgs = (images || []).filter(Boolean);
  const [ri, setRi] = useState(0);
  if (!imgs.length) return null;
  return (
    <div className="sbt-roomgal">
      <img src={imgs[Math.min(ri, imgs.length - 1)]} alt="" />
      {imgs.length > 1 && (<>
        <button className="sbt-nav left sm" onClick={() => setRi((i) => (i - 1 + imgs.length) % imgs.length)}>‹</button>
        <button className="sbt-nav right sm" onClick={() => setRi((i) => (i + 1) % imgs.length)}>›</button>
      </>)}
    </div>
  );
}

function BidBox({ lot, hotel, room, segments, depositPct }: { lot: any; hotel: any; room: any; segments: Seg[]; depositPct: number }) {
  const router = useRouter();
  const [segKey, setSegKey] = useState(segments[0] ? segId(segments[0]) : "");
  const [perNight, setPerNight] = useState<number>(lot.min_bid_per_room_night);
  const [rooms, setRooms] = useState(1);
  const [added, setAdded] = useState(false);

  const seg = useMemo(() => segments.find((s) => segId(s) === segKey) || null, [segments, segKey]);
  const belowFloor = perNight < lot.min_bid_per_room_night;
  const preview = seg && !belowFloor ? bidCostPreview({ perRoomPerNight: perNight, nights: seg.nights, rooms, depositPct }) : null;

  const add = () => {
    if (!seg || belowFloor) return;
    addBid({
      key: bidItemKey(lot.id, seg.type, seg.weekIndex), lotId: lot.id,
      hotelName: hotel.name, roomName: room.name || lot.category, city: lot.city,
      image: (room.images || [])[0] || (hotel.images || [])[0] || "", monthKey: lot.month_key,
      segmentType: seg.type, weekIndex: seg.weekIndex, segmentLabel: seg.label, nights: seg.nights,
      minBid: lot.min_bid_per_room_night, perRoomPerNight: perNight, roomsWanted: rooms,
    });
    setAdded(true); setTimeout(() => setAdded(false), 1800);
  };

  return (
    <div className="sbt-bidbox">
      <label className="sbt-field">
        <span>Segment</span>
        <select value={segKey} onChange={(e) => setSegKey(e.target.value)}>
          {segments.map((s) => <option key={segId(s)} value={segId(s)}>{s.label} · {s.nights} nights</option>)}
        </select>
      </label>
      <div className="sbt-field-row">
        <label className="sbt-field">
          <span>Bid / room / night</span>
          <input type="number" min={lot.min_bid_per_room_night} value={perNight} onChange={(e) => setPerNight(Number(e.target.value) || 0)} />
          <small>Minimum {inr(lot.min_bid_per_room_night)}</small>
        </label>
        <label className="sbt-field">
          <span>Rooms (max {lot.num_rooms})</span>
          <input type="number" min={1} max={lot.num_rooms} value={rooms} onChange={(e) => setRooms(Math.max(1, Math.min(lot.num_rooms, Number(e.target.value) || 1)))} />
        </label>
      </div>
      {belowFloor && <div className="sbt-err">Your bid can't be below the floor.</div>}
      {preview && (
        <div className="sbt-preview">
          <div className="sbt-preview-row"><span>Bid ({seg?.nights} nights × {rooms} rooms)</span><b>{inr(preview.baseTotal)}</b></div>
          <div className="sbt-preview-row"><span>Refundable EMD deposit ({depositPct}%) now</span><b>{inr(preview.deposit)}</b></div>
          <div className="sbt-preview-note">If you win, pay the balance + buyer premium. If you don't, your deposit is refunded.</div>
        </div>
      )}
      <button className="sbt-btn-gold full" onClick={add} disabled={!seg || belowFloor}>{added ? "✓ Added to bundle" : "Add to bundle"}</button>
      <button className="sbt-btn-ghost full" onClick={() => router.push("/trade/review")}>Go to bundle & pay →</button>
    </div>
  );
}

function LiveBidBox({ lot, segments, live, buyerPremiumPct, market, roomsAvailable }: { lot: any; segments: Seg[]; live?: { hybridAcceptRatio: number; payWindowHours: number; belowFloorMinRatio?: number }; buyerPremiumPct: number; market?: { adr: number; low: number; high: number; rack?: number } | null; roomsAvailable?: number }) {
  const router = useRouter();
  const [segKey, setSegKey] = useState(segments[0] ? segId(segments[0]) : "");
  const [perNight, setPerNight] = useState<number>(lot.min_bid_per_room_night);
  const didInitBid = useRef(false);
  const [rooms, setRooms] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const seg = useMemo(() => segments.find((s) => segId(s) === segKey) || null, [segments, segKey]);
  const floor = Number(lot.min_bid_per_room_night) || 0;
  const round100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);

  // ── AI bid coach — BOOKING-PRICE (MRP) framed. Profit is measured against the
  // room's booking price (rack/MRP), the picks are a profit ladder off it, and the
  // agent isn't shown the accept mechanics (they bid freely, high interest). ─────
  const mktLow = Math.round(Number(market?.low) || 0);
  const mktHigh = Math.round(Number(market?.high) || 0);
  // Booking price = the room's list/rack rate (MRP) — the resale reference.
  const bookingPrice = Math.round(Number(market?.rack) || 0) || (mktHigh > 0 ? round100(mktHigh * 1.4) : round100(floor * 2));
  const prem = (Number(buyerPremiumPct) || 0) / 100;
  // What a guest can pay for this room: from the market low up to the booking price.
  const guestMin = mktLow > 0 ? mktLow : round100(bookingPrice * 0.6);
  const guestMax = Math.max(bookingPrice, mktHigh);
  // Profit ladder OFF the booking price: the bid that yields a target profit% (after
  // the buyer premium). Higher target profit ⇒ lower bid.
  const bidForProfit = (p: number) => round100(bookingPrice / ((1 + prem) * (1 + p / 100)));
  const saveBidVal = bidForProfit(40);   // deepest margin
  const smartBidVal = bidForProfit(30);  // recommended
  const maxBidVal = bidForProfit(20);    // strongest bid (least margin) — NOT a hard cap
  // Slider: from the 40%-profit price up to the ~0-profit price. The agent may bid
  // above the 20% pick for certainty (owner loves a higher bid) — never hard-capped.
  const sliderMin = saveBidVal;
  const sliderMax = round100(bookingPrice / (1 + prem));
  const tooLow = perNight < Math.round(floor * (live?.belowFloorMinRatio || 0.85)); // server hard floor only
  // Profit at the current bid, vs the booking price: per-room (whole segment) + total.
  const nightsSel = seg?.nights || 0;
  const profitPerNight = Math.max(0, bookingPrice - Math.round(perNight * (1 + prem)));
  const profitPerRoom = profitPerNight * nightsSel;
  const totalProfit = profitPerRoom * rooms;
  const profitPct = perNight > 0 ? Math.round((profitPerNight / Math.max(1, Math.round(perNight * (1 + prem)))) * 100) : 0;
  const base = seg && !tooLow ? perNight * seg.nights * rooms : 0;
  const premium = Math.round((base * (Number(buyerPremiumPct) || 0)) / 100);
  const picks = [
    { key: "save", label: "💰 Save Big", pct: 40, value: saveBidVal },
    { key: "smart", label: "⭐ Smart", pct: 30, value: smartBidVal },
    { key: "max", label: "⚡ Max", pct: 20, value: maxBidVal },
  ];
  const scarce = typeof roomsAvailable === "number" && roomsAvailable > 0 && roomsAvailable <= 3;

  // Default to the recommended (Smart, ~30% profit) price.
  const defaultBid = smartBidVal;
  useEffect(() => {
    if (!didInitBid.current && Number.isFinite(defaultBid) && defaultBid > 0) {
      setPerNight(defaultBid); didInitBid.current = true;
    }
  }, [defaultBid]);

  const place = async () => {
    if (!seg || tooLow) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/trade/bids/place-live", {
        method: "POST", headers: { Authorization: `Bearer ${getTradeToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ lotId: lot.id, segmentType: seg.type, weekIndex: seg.weekIndex, perRoomPerNight: perNight, roomsWanted: rooms }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: d.error || "Could not place the bid." }); return; }
      setMsg({ ok: true, text: d.accepted ? "Accepted! Taking you to pay & lock your rooms…" : "Bid placed — the owner will review it. Track it in My Bids." });
      setTimeout(() => router.push("/trade/my-bids"), 1100);
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setBusy(false); }
  };

  return (
    <div className="sbt-bidbox">
      <div className="sbt-live-pill">⚡ Live · no deposit</div>
      <label className="sbt-field">
        <span>Segment</span>
        <select value={segKey} onChange={(e) => setSegKey(e.target.value)}>
          {segments.map((s) => <option key={segId(s)} value={segId(s)}>{s.label} · {s.nights} nights</option>)}
        </select>
      </label>
      <div className="sbt-field-row">
        <label className="sbt-field">
          <span>Bid / room / night</span>
          <input type="number" min={sliderMin} value={perNight} onChange={(e) => setPerNight(Number(e.target.value) || 0)} />
        </label>
        <label className="sbt-field">
          <span>Rooms (max {lot.num_rooms})</span>
          <input type="number" min={1} max={lot.num_rooms} value={rooms} onChange={(e) => setRooms(Math.max(1, Math.min(lot.num_rooms, Number(e.target.value) || 1)))} />
        </label>
      </div>
      {tooLow && <div className="sbt-err">Enter a higher bid to continue.</div>}

      {/* AI Bid Coach — booking-price (MRP) framed profit intelligence */}
      <div className="sbt-coach">
        <div className="sbt-coach-head">
          <span className="sbt-coach-ai">✦ AI Bid Coach</span>
          {profitPct > 0 && <span className="sbt-coach-outcome on">↑ {profitPct}% profit</span>}
        </div>
        {scarce && (
          <div className="sbt-scarce">🔥 Only {roomsAvailable} room{roomsAvailable === 1 ? "" : "s"} left — bid strong to secure yours.</div>
        )}

        {/* Slidable price — drag to set your buy price; profit updates live */}
        <div className="sbt-slider-val">
          {inr(perNight)}<span>/room/night</span>
          {totalProfit > 0 && <em className="sbt-slider-margin" style={{ color: "#059669" }}>≈ {inr(totalProfit)} profit</em>}
        </div>
        <input
          type="range" className="sbt-range"
          min={sliderMin} max={sliderMax} step={100} value={Math.min(Math.max(perNight, sliderMin), sliderMax)}
          onChange={(e) => setPerNight(Number(e.target.value))}
          style={{ ["--pct" as any]: `${Math.round(((Math.min(Math.max(perNight, sliderMin), sliderMax) - sliderMin) / Math.max(1, sliderMax - sliderMin)) * 100)}%`, marginBottom: "12px" }}
        />

        {/* Quick-pick profit tiers (no accept mechanics shown — you bid freely) */}
        <div className="sbt-picks">
          {picks.map((p) => (
            <button key={p.key} type="button" onClick={() => setPerNight(p.value)}
              className={`sbt-pick${perNight === p.value ? " on" : ""}`}>
              <span className="sbt-pick-label">{p.label}</span>
              <b>{inr(p.value)}</b>
              <span className="sbt-pick-sub">~{p.pct}% profit</span>
            </button>
          ))}
        </div>

        {/* Booking-price + profit intelligence */}
        {bookingPrice > 0 ? (
          <div className="sbt-mkt">
            <div className="sbt-mkt-cell"><span>ROOM BOOKING PRICE</span><b>{inr(bookingPrice)}</b></div>
            <div className="sbt-mkt-cell"><span>GUESTS PAY</span><b>{inr(guestMin)}–{inr(guestMax)}</b></div>
            <div className="sbt-mkt-cell sbt-mkt-profit"><span>EST. PROFIT / ROOM{nightsSel ? ` · ${nightsSel}N` : ""}</span><b>{inr(profitPerRoom)}</b></div>
            <div className="sbt-mkt-cell sbt-mkt-profit"><span>TOTAL PROFIT ({rooms} room{rooms === 1 ? "" : "s"})</span><b>{inr(totalProfit)}</b></div>
          </div>
        ) : (
          <div className="sbt-mkt"><div className="sbt-mkt-cell"><span>YOUR BID</span><b>{inr(perNight)}</b></div></div>
        )}
      </div>

      {seg && !tooLow && (
        <div className="sbt-preview">
          <div className="sbt-preview-row"><span>Bid ({seg.nights} nights × {rooms} rooms)</span><b>{inr(base)}</b></div>
          <div className="sbt-preview-row"><span>Buyer premium ({buyerPremiumPct}%) on accept</span><b>{inr(premium)}</b></div>
          <div className="sbt-preview-row"><span>You pay on accept</span><b>{inr(base + premium)}</b></div>
          <div className="sbt-preview-note">No deposit — you only pay if it's accepted. Then resell to your guests up to the {inr(bookingPrice)} booking price.</div>
        </div>
      )}
      {msg && (
        <div className={msg.ok ? "sbt-live-ok" : "sbt-err"}>
          {msg.text}
          {!msg.ok && /already have a live bid/i.test(msg.text) && (
            <button type="button" onClick={() => router.push("/trade/my-bids")} className="sbt-mybids-link">Manage / withdraw it in My Bids →</button>
          )}
        </div>
      )}
      <button className="sbt-btn-gold full" onClick={place} disabled={!seg || tooLow || busy}>
        {busy ? "Placing…" : "Place bid"}
      </button>
    </div>
  );
}

function BidGate({ auth, city }: { auth: ReturnType<typeof useTradeAuth>; city: string }) {
  const [agencyName, setAgencyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const signIn = async () => { setBusy(true); setErr(""); try { await auth.signIn(); } catch (e: any) { setErr(e?.message || "Sign-in failed."); } finally { setBusy(false); } };
  const register = async () => {
    if (!agencyName.trim()) { setErr("Enter your agency name."); return; }
    setBusy(true); setErr("");
    try { const res = await auth.register({ agencyName, city }); if (!res.ok) setErr(res.data?.error || "Registration failed."); }
    catch { setErr("Registration failed."); } finally { setBusy(false); }
  };
  return (
    <div className="sbt-gate">
      {auth.status === "signed_out" && (<>
        <p>Browsing is open to everyone. To place a bid, sign in with Google — only admin-approved travel agents can bid.</p>
        <button className="sbt-btn-gold full" onClick={signIn} disabled={busy}>{busy ? "…" : "Sign in with Google"}</button>
      </>)}
      {auth.status === "unregistered" && (<>
        <p>You're signed in. Register your travel agency — an admin will approve it, then you can bid.</p>
        <input className="sbt-gate-input" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Agency name" />
        <button className="sbt-btn-gold full" onClick={register} disabled={busy}>{busy ? "…" : "Register as a travel agent"}</button>
      </>)}
      {auth.status === "pending" && <p>Your agent application is under review. You'll be able to bid once it's approved.</p>}
      {(auth.status === "rejected" || auth.status === "suspended") && <p>Your agent account is {auth.status}. Please contact support.</p>}
      {err && <p className="sbt-err">{err}</p>}
    </div>
  );
}

function TourStyles() {
  return (
    <style jsx global>{`
      .sbt-wrap { max-width: 720px; margin: 0 auto; padding: 14px 14px 110px; min-height: 100vh; background: linear-gradient(180deg,#faf7f2,#f3ece1); }
      .sbt-back { display: inline-block; margin-bottom: 12px; font-weight: 700; color: #a9791f; font-size: .9rem; }
      .sbt-load { padding: 40px; text-align: center; color: rgba(74,56,32,.6); }
      .sbt-hero { position: relative; height: 250px; border-radius: 20px; overflow: hidden; background: #221812; box-shadow: 0 12px 34px rgba(40,26,12,.22); }
      .sbt-hero img { width: 100%; height: 100%; object-fit: cover; }
      .sbt-noimg { display: grid; place-items: center; font-size: 3rem; width: 100%; height: 100%; color: #ffe9b8; }
      .sbt-hero-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 34px 17px 15px; background: linear-gradient(0deg, rgba(18,12,6,.9), transparent); color: #fff; }
      .sbt-hero-title { font-size: 1.55rem; font-weight: 800; line-height: 1.08; text-shadow: 0 2px 12px rgba(0,0,0,.4); }
      .sbt-hero-loc { font-size: .84rem; opacity: .92; margin-top: 3px; }
      .sbt-hero-star { color: #ffcf6e; }
      .sbt-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(20,14,7,.55); color: #ffe9b8; font-size: 1.3rem; cursor: pointer; z-index: 2; }
      .sbt-nav.left { left: 9px; } .sbt-nav.right { right: 9px; }
      .sbt-nav.sm { width: 28px; height: 28px; font-size: 1.05rem; color: #fff; }
      .sbt-thumbs { display: flex; gap: 7px; overflow-x: auto; margin: 10px 0 0; padding-bottom: 4px; }
      .sbt-thumb { flex: none; width: 64px; height: 46px; border-radius: 9px; overflow: hidden; border: 2px solid transparent; padding: 0; background: none; cursor: pointer; }
      .sbt-thumb.on { border-color: #c9911a; }
      .sbt-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .sbt-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 16px 0 14px; }
      @media (min-width: 560px) { .sbt-metrics { grid-template-columns: repeat(4, 1fr); } }
      .sbt-metric { background: linear-gradient(150deg, #241a11, #35271a); border: 1px solid rgba(212,162,74,.25); border-radius: 13px; padding: 12px 13px; }
      .sbt-metric b { display: block; color: #ffd98a; font-size: 1.02rem; font-weight: 800; }
      .sbt-metric span { font-size: .54rem; letter-spacing: .06em; color: rgba(243,231,208,.55); font-weight: 700; }
      .sbt-desc { font-size: .84rem; line-height: 1.55; color: rgba(74,56,32,.75); margin: 0 0 16px; }
      .sbt-desc.sm { font-size: .78rem; margin: 8px 0 14px; }
      .sbt-h2 { font-size: 1.35rem; font-weight: 800; color: #3a2c17; margin-top: 6px; }
      .sbt-h2sub { font-size: .82rem; color: rgba(74,56,32,.65); margin: 4px 0 14px; line-height: 1.5; }
      .sbt-roomgal { position: relative; height: 190px; border-radius: 14px; overflow: hidden; margin: 6px 0 10px; background: #e2d4bb; }
      .sbt-roomgal img { width: 100%; height: 100%; object-fit: cover; }
      .sbt-amen { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 4px; }
      .sbt-amen-chip { font-size: .68rem; font-weight: 600; color: rgba(74,56,32,.8); background: rgba(139,105,20,.09); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 4px 10px; text-transform: capitalize; }
      .sbt-bidbox { background: #fff; border: 1px solid rgba(139,105,20,.2); border-radius: 16px; padding: 15px; box-shadow: 0 4px 16px rgba(74,56,32,.05); }
      .sbt-live-pill { display: inline-block; font-size: .72rem; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 999px; padding: 3px 11px; margin-bottom: 11px; }
      .sbt-live-ok { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 8px 11px; font-size: .8rem; font-weight: 600; margin: 6px 0; }
      .sbt-mybids-link { display: block; margin-top: 6px; font-size: .78rem; font-weight: 800; color: #a9791f; text-decoration: underline; background: none; border: 0; padding: 0; cursor: pointer; }
      /* ── AI Bid Coach ── */
      .sbt-coach { margin: 10px 0; border: 1px solid rgba(139,105,20,.22); border-radius: 14px; padding: 12px; background: linear-gradient(160deg,#fffdf7,#fbf4e6); }
      .sbt-coach-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .sbt-coach-ai { font-size: .78rem; font-weight: 800; color: #a9791f; letter-spacing: .02em; }
      .sbt-coach-outcome { font-size: .68rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: #fff7ed; color: #b45309; border: 1px solid #fed7aa; }
      .sbt-coach-outcome.on { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
      .sbt-scarce { font-size: .72rem; font-weight: 800; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 5px 9px; margin-bottom: 8px; }
      .sbt-slider-val { font-size: 1.5rem; font-weight: 800; color: #3a2c17; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
      .sbt-slider-val span { font-size: .7rem; font-weight: 600; color: rgba(74,56,32,.5); }
      .sbt-slider-margin { font-style: normal; font-size: .72rem; font-weight: 800; margin-left: auto; }
      /* Slidable range — gradient track red(floor)→green(market), gold thumb */
      .sbt-range { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 999px; margin: 12px 0 6px; outline: none; cursor: pointer;
        background: linear-gradient(90deg, #ef4444 0%, #f0b429 var(--pct,50%), #10b981 100%); }
      .sbt-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 26px; height: 26px; border-radius: 50%; background: #fff; border: 4px solid #c9911a; box-shadow: 0 2px 8px rgba(74,56,32,.35); cursor: grab; }
      .sbt-range::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.08); }
      .sbt-range::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; background: #fff; border: 4px solid #c9911a; box-shadow: 0 2px 8px rgba(74,56,32,.35); cursor: grab; }
      .sbt-range-ends { display: flex; justify-content: space-between; font-size: .68rem; color: rgba(74,56,32,.6); font-weight: 800; margin-bottom: 12px; }
      .sbt-picks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
      .sbt-pick { text-align: center; border: 2px solid #e5e0d5; border-radius: 12px; padding: 8px 4px; background: #fff; cursor: pointer; transition: border-color .12s, background .12s; }
      .sbt-pick.on { border-color: #c9911a; background: #fffbef; }
      .sbt-pick-label { display: block; font-size: .68rem; font-weight: 800; color: #a9791f; }
      .sbt-pick b { display: block; font-size: .95rem; color: #3a2c17; margin: 1px 0; }
      .sbt-pick-sub { display: block; font-size: .56rem; color: rgba(74,56,32,.5); font-weight: 700; line-height: 1.15; }
      .sbt-mkt { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .sbt-mkt-cell { background: #fff; border: 1px solid rgba(139,105,20,.14); border-radius: 10px; padding: 7px 9px; }
      .sbt-mkt-cell span { display: block; font-size: .54rem; letter-spacing: .05em; color: rgba(74,56,32,.5); font-weight: 800; }
      .sbt-mkt-cell b { font-size: .92rem; color: #3a2c17; font-weight: 800; }
      .sbt-mkt-profit { background: #ecfdf5; border-color: #a7f3d0; }
      .sbt-mkt-profit b { color: #047857; }
      .sbt-mkt-profit em { display: block; font-style: normal; font-size: .58rem; font-weight: 700; color: #059669; }
      .sbt-coach-tip { font-size: .74rem; color: rgba(74,56,32,.78); line-height: 1.45; margin-top: 9px; }
      .sbt-field { display: block; margin-bottom: 11px; }
      .sbt-field > span { font-size: .78rem; font-weight: 700; color: rgba(74,56,32,.7); display: block; margin-bottom: 4px; }
      .sbt-field select, .sbt-field input { width: 100%; border: 1px solid rgba(139,105,20,.28); border-radius: 10px; padding: 9px 11px; font-size: .9rem; background: #fffdfa; color: #3a2c17; }
      .sbt-field small { font-size: .68rem; color: rgba(74,56,32,.5); }
      .sbt-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .sbt-err { color: #c0392b; font-size: .78rem; margin: 4px 0; }
      .sbt-preview { background: linear-gradient(135deg,#1c140c,#2c2116); color: #f3e7d0; border-radius: 12px; padding: 12px 14px; margin: 10px 0; border: 1px solid rgba(212,162,74,.2); }
      .sbt-preview-row { display: flex; justify-content: space-between; align-items: baseline; font-size: .82rem; padding: 2px 0; }
      .sbt-preview-row b { color: #ffd98a; }
      .sbt-preview-note { font-size: .68rem; color: rgba(243,231,208,.6); margin-top: 6px; }
      .sbt-btn-gold { background: linear-gradient(135deg,#c9911a,#f0b429); color: #1f1710; border: 0; border-radius: 12px; padding: 11px 16px; font-weight: 800; font-size: .9rem; cursor: pointer; }
      .sbt-btn-gold.full { width: 100%; margin-top: 8px; }
      .sbt-btn-gold:disabled { opacity: .5; cursor: default; }
      .sbt-btn-ghost { background: none; border: 1px solid rgba(139,105,20,.3); color: #a9791f; border-radius: 12px; padding: 10px 16px; font-weight: 700; font-size: .85rem; cursor: pointer; }
      .sbt-btn-ghost.full { width: 100%; margin-top: 8px; }
      .sbt-gate { background: #fff8ec; border: 1px solid #f0dcb0; border-radius: 16px; padding: 15px; font-size: .85rem; color: #7a5a2e; }
      .sbt-gate p { margin: 0 0 10px; line-height: 1.5; }
      .sbt-gate-input { width: 100%; border: 1px solid #e2c98a; border-radius: 10px; padding: 9px 11px; font-size: .9rem; margin-bottom: 8px; }
      .sbt-basket { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; padding: 10px 12px; background: linear-gradient(0deg, rgba(255,255,255,.96) 70%, rgba(255,255,255,0)); }
      .sbt-basket-in { max-width: 1080px; margin: 0 auto; background: #3a2c17; color: #fbf3e2; border-radius: 16px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25); font-size: .82rem; font-weight: 600; }
      /* ── Tablet: wider hero + 3-col metrics ── */
      @media (min-width: 640px) {
        .sbt-wrap { max-width: 760px; padding-left: 22px; padding-right: 22px; }
        .sbt-hero { height: auto; aspect-ratio: 16 / 9; max-height: 360px; }
        .sbt-roomgal { height: 240px; }
      }
      /* ── Laptop / desktop: two columns, sticky bid panel, capped for cozy reading ── */
      @media (min-width: 900px) {
        .sbt-wrap { max-width: 1080px; padding-left: 28px; padding-right: 28px; }
        .sbt-hero { aspect-ratio: 16 / 9; max-height: 400px; }
        .sbt-cols { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 28px; align-items: start; margin-top: 6px; }
        .sbt-left { min-width: 0; }
        .sbt-right { position: sticky; top: 16px; }
        .sbt-h2 { margin-top: 0; }
        .sbt-roomgal { height: 300px; }
      }
      @media (min-width: 1280px) {
        .sbt-hero { aspect-ratio: 21 / 9; max-height: 460px; }
        .sbt-cols { grid-template-columns: minmax(0, 1fr) 420px; gap: 34px; }
      }
    `}</style>
  );
}
