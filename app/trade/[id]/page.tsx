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
  // Booking-price framing (live lots): the top strip shows the room's booking price
  // (rack/MRP), consistent with the coach — not the internal min-bid floor.
  const round100m = (n: number) => Math.max(100, Math.round(n / 100) * 100);
  const bookingPriceTop = Math.round(Number(data.market?.rack) || 0)
    || (data.market?.high ? round100m(Number(data.market.high) * 1.4) : round100m((Number(lot.min_bid_per_room_night) || 0) * 2));

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
            {isLive
              ? <div className="sbt-metric"><b>{inr(bookingPriceTop)}</b><span>ROOM BOOKING PRICE</span></div>
              : <div className="sbt-metric"><b>{inr(lot.min_bid_per_room_night)}</b><span>MIN BID / ROOM / NIGHT</span></div>}
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

// Robust rooms picker — +/− stepper so every value 1..max is reachable (a bare
// number input let the browser spinner jump straight to the max on some devices).
function RoomStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(1, Math.min(max, Math.round(n) || 1));
  return (
    <div className="sbt-stepper" role="group" aria-label="Rooms">
      <button type="button" className="sbt-step-btn" onClick={() => onChange(clamp(value - 1))} disabled={value <= 1} aria-label="Fewer rooms">−</button>
      <input
        type="number" className="sbt-step-in" min={1} max={max} value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <button type="button" className="sbt-step-btn" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label="More rooms">+</button>
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
          <RoomStepper value={rooms} max={Number(lot.num_rooms) || 1} onChange={setRooms} />
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
  // The advertised MINIMUM is the lot's real floor (what the browse card shows) —
  // NOT an MRP-profit price. The ladder spans floor → the ~0-profit MRP ceiling, so
  // an agent can always bid the floor they were promised (biggest margin), while the
  // default still nudges them to a stronger "Smart" bid. This keeps the tour page's
  // minimum consistent with the browse card's "Min bid" for every lot, including
  // Circle-operated rooms where the floor sits far below the room's booking price.
  const mrpCeil = round100(bookingPrice / (1 + prem));
  const floorBid = Math.max(100, Math.min(floor || mrpCeil, mrpCeil));
  const span = Math.max(0, mrpCeil - floorBid);
  const saveBidVal = floorBid;                          // best margin = the advertised floor
  const smartBidVal = round100(floorBid + span * 0.34); // recommended default (nudge up)
  const maxBidVal = round100(floorBid + span * 0.67);   // strong bid (still very profitable)
  const sliderMin = floorBid;
  const sliderMax = mrpCeil;
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
    { key: "save", label: "💰 Save Big", value: saveBidVal },
    { key: "smart", label: "⭐ Smart", value: smartBidVal },
    { key: "max", label: "⚡ Max", value: maxBidVal },
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
          <RoomStepper value={rooms} max={Number(lot.num_rooms) || 1} onChange={setRooms} />
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
            </button>
          ))}
        </div>

        {/* Booking-price + profit intelligence */}
        {bookingPrice > 0 ? (
          <div className="sbt-mkt">
            <div className="sbt-mkt-cell"><span>ROOM BOOKING PRICE</span><b>{inr(bookingPrice)}</b></div>
            <div className="sbt-mkt-cell"><span>GUESTS PAY</span><b>{inr(guestMin)}–{inr(guestMax)}</b></div>
            <div className="sbt-mkt-cell sbt-mkt-profit"><span>PROFIT / ROOM / NIGHT</span><b>{inr(profitPerNight)}</b></div>
            <div className="sbt-mkt-cell sbt-mkt-profit"><span>TOTAL PROFIT</span><b>{inr(totalProfit)}</b><em>{rooms} room{rooms === 1 ? "" : "s"} × {nightsSel || 0}N × {inr(profitPerNight)}</em></div>
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
      .sbt-wrap { max-width: 720px; margin: 0 auto; padding: 14px 14px 110px; min-height: 100vh; background: linear-gradient(180deg,var(--trd-page-a),var(--trd-page-b)); }
      .sbt-back { display: inline-block; margin-bottom: 12px; font-weight: 700; color: #65819c; font-size: .9rem; }
      .sbt-load { padding: 40px; text-align: center; color: rgba(74,56,32,.6); }
      .sbt-hero { position: relative; height: 250px; border-radius: 20px; overflow: hidden; background: var(--trd-hero); box-shadow: 0 12px 34px rgba(40,26,12,.22); }
      .sbt-hero img { width: 100%; height: 100%; object-fit: cover; }
      .sbt-noimg { display: grid; place-items: center; font-size: 3rem; width: 100%; height: 100%; color: #e6ebef; }
      .sbt-hero-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 34px 17px 15px; background: linear-gradient(0deg, rgba(18,12,6,.9), transparent); color: #fff; }
      .sbt-hero-title { font-family: var(--font-display, "Cormorant Garamond", Georgia, serif); font-size: 1.85rem; font-weight: 600; letter-spacing: .005em; line-height: 1.06; text-shadow: 0 2px 12px rgba(0,0,0,.4); }
      .sbt-hero-loc { font-size: .84rem; opacity: .92; margin-top: 3px; }
      .sbt-hero-star { color: #cad4dd; }
      .sbt-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(20,14,7,.55); color: #e6ebef; font-size: 1.3rem; cursor: pointer; z-index: 2; }
      .sbt-nav.left { left: 9px; } .sbt-nav.right { right: 9px; }
      .sbt-nav.sm { width: 28px; height: 28px; font-size: 1.05rem; color: #fff; }
      .sbt-thumbs { display: flex; gap: 7px; overflow-x: auto; margin: 10px 0 0; padding-bottom: 4px; }
      .sbt-thumb { flex: none; width: 64px; height: 46px; border-radius: 9px; overflow: hidden; border: 2px solid transparent; padding: 0; background: none; cursor: pointer; }
      .sbt-thumb.on { border-color: #8198ae; }
      .sbt-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .sbt-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 16px 0 14px; }
      @media (min-width: 560px) { .sbt-metrics { grid-template-columns: repeat(4, 1fr); } }
      /* v711 (owner) — metric strip was a hardcoded dark-walnut card on the
         light trade page (and never flipped for dark). Re-themed to the trd
         tokens: a light card that matches the page AND flips in dark. */
      .sbt-metric { background: var(--trd-card); border: 1px solid var(--trd-line); border-radius: 13px; padding: 12px 13px; }
      .sbt-metric b { display: block; color: var(--trd-ink); font-size: 1.02rem; font-weight: 800; font-variant-numeric: tabular-nums; }
      .sbt-metric span { font-size: .63rem; letter-spacing: .06em; color: var(--trd-ink-3); font-weight: 700; }
      .sbt-desc { font-size: .84rem; line-height: 1.55; color: var(--trd-ink-2); margin: 0 0 16px; }
      .sbt-desc.sm { font-size: .78rem; margin: 8px 0 14px; }
      .sbt-h2 { font-family: var(--font-display, "Cormorant Garamond", Georgia, serif); font-size: 1.5rem; font-weight: 600; letter-spacing: .005em; color: var(--trd-ink); margin-top: 6px; }
      .sbt-h2sub { font-size: .82rem; color: var(--trd-ink-2); margin: 4px 0 14px; line-height: 1.5; }
      .sbt-roomgal { position: relative; height: 190px; border-radius: 14px; overflow: hidden; margin: 6px 0 10px; background: var(--trd-soft); }
      .sbt-roomgal img { width: 100%; height: 100%; object-fit: cover; }
      .sbt-amen { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 4px; }
      .sbt-amen-chip { font-size: .68rem; font-weight: 600; color: var(--trd-ink-2); background: var(--trd-soft); border: 1px solid var(--trd-line); border-radius: 999px; padding: 4px 10px; text-transform: capitalize; }
      .sbt-bidbox { background: var(--trd-card); border: 1px solid var(--trd-line); border-radius: 16px; padding: 15px; box-shadow: 0 4px 16px rgba(31,26,15,.06); }
      .sbt-live-pill { display: inline-block; font-size: .72rem; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 999px; padding: 3px 11px; margin-bottom: 11px; }
      .sbt-live-ok { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 8px 11px; font-size: .8rem; font-weight: 600; margin: 6px 0; }
      .sbt-mybids-link { display: block; margin-top: 6px; font-size: .78rem; font-weight: 800; color: #65819c; text-decoration: underline; background: none; border: 0; padding: 0; cursor: pointer; }
      /* ── AI Bid Coach ── */
      .sbt-coach { margin: 10px 0; border: 1px solid rgba(139,105,20,.22); border-radius: 14px; padding: 12px; background: linear-gradient(160deg,var(--trd-card-2),var(--trd-soft)); }
      .sbt-coach-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .sbt-coach-ai { font-size: .78rem; font-weight: 800; color: #65819c; letter-spacing: .02em; }
      .sbt-coach-outcome { font-size: .68rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: #fff7ed; color: #b45309; border: 1px solid #fed7aa; }
      .sbt-coach-outcome.on { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
      .sbt-scarce { font-size: .72rem; font-weight: 800; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 5px 9px; margin-bottom: 8px; }
      .sbt-slider-val { font-size: 1.5rem; font-weight: 800; color: var(--trd-ink); display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
      .sbt-slider-val span { font-size: .7rem; font-weight: 600; color: rgba(74,56,32,.5); }
      .sbt-slider-margin { font-style: normal; font-size: .72rem; font-weight: 800; margin-left: auto; }
      /* Slidable range — gradient track red(floor)→green(market), gold thumb */
      .sbt-range { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; border-radius: 999px; margin: 12px 0 6px; outline: none; cursor: pointer;
        background: linear-gradient(90deg, #ef4444 0%, #a9b9c8 var(--pct,50%), #10b981 100%); }
      .sbt-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 26px; height: 26px; border-radius: 50%; background: var(--trd-card); border: 4px solid #8198ae; box-shadow: 0 2px 8px rgba(74,56,32,.35); cursor: grab; }
      .sbt-range::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.08); }
      .sbt-range::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; background: var(--trd-card); border: 4px solid #8198ae; box-shadow: 0 2px 8px rgba(74,56,32,.35); cursor: grab; }
      .sbt-range-ends { display: flex; justify-content: space-between; font-size: .68rem; color: rgba(74,56,32,.6); font-weight: 800; margin-bottom: 12px; }
      .sbt-picks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
      .sbt-pick { text-align: center; border: 2px solid var(--trd-line); border-radius: 12px; padding: 8px 4px; background: var(--trd-card); cursor: pointer; transition: border-color .12s, background .12s; }
      .sbt-pick.on { border-color: #8198ae; background: var(--trd-card-2); }
      .sbt-pick-label { display: block; font-size: .68rem; font-weight: 800; color: #65819c; }
      .sbt-pick b { display: block; font-size: .95rem; color: var(--trd-ink); margin: 1px 0; }
      .sbt-pick-sub { display: block; font-size: .56rem; color: rgba(74,56,32,.5); font-weight: 700; line-height: 1.15; }
      .sbt-mkt { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .sbt-mkt-cell { background: var(--trd-card); border: 1px solid rgba(139,105,20,.14); border-radius: 10px; padding: 7px 9px; }
      .sbt-mkt-cell span { display: block; font-size: .63rem; letter-spacing: .05em; color: rgba(74,56,32,.72); font-weight: 800; }
      .sbt-mkt-cell b { font-size: .92rem; color: var(--trd-ink); font-weight: 800; }
      .sbt-mkt-profit { background: #ecfdf5; border-color: #a7f3d0; }
      .sbt-mkt-profit b { color: #047857; }
      .sbt-mkt-profit em { display: block; font-style: normal; font-size: .58rem; font-weight: 700; color: #059669; }
      .sbt-coach-tip { font-size: .74rem; color: rgba(74,56,32,.78); line-height: 1.45; margin-top: 9px; }
      .sbt-field { display: block; margin-bottom: 11px; }
      .sbt-field > span { font-size: .78rem; font-weight: 700; color: rgba(74,56,32,.7); display: block; margin-bottom: 4px; }
      .sbt-field select, .sbt-field input { width: 100%; border: 1px solid rgba(139,105,20,.28); border-radius: 10px; padding: 9px 11px; font-size: .9rem; background: var(--trd-card-2); color: var(--trd-ink); }
      .sbt-field small { font-size: .68rem; color: rgba(74,56,32,.5); }
      .sbt-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      /* Rooms +/− stepper — reliable single-step selection 1..max */
      .sbt-stepper { display: flex; align-items: stretch; border: 1px solid rgba(139,105,20,.28); border-radius: 10px; overflow: hidden; background: var(--trd-card-2); }
      .sbt-step-btn { flex: none; width: 40px; border: 0; background: rgba(139,105,20,.09); color: #65819c; font-size: 1.25rem; font-weight: 800; line-height: 1; cursor: pointer; }
      .sbt-step-btn:active { background: rgba(139,105,20,.18); }
      .sbt-step-btn:disabled { opacity: .4; cursor: default; }
      .sbt-step-in { flex: 1; min-width: 0; border: 0; text-align: center; font-size: 1rem; font-weight: 800; color: var(--trd-ink); background: transparent; -moz-appearance: textfield; }
      .sbt-step-in::-webkit-outer-spin-button, .sbt-step-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .sbt-err { color: color-mix(in srgb, #d64545 60%, var(--trd-ink)); font-size: .78rem; margin: 4px 0; }
      /* v711 (owner) — cost-preview box was hardcoded dark on the light page; now
         a subtle themed highlight card that flips in dark. */
      .sbt-preview { background: var(--trd-soft); color: var(--trd-ink); border-radius: 12px; padding: 12px 14px; margin: 10px 0; border: 1px solid var(--trd-line); }
      .sbt-preview-row { display: flex; justify-content: space-between; align-items: baseline; font-size: .82rem; padding: 2px 0; color: var(--trd-ink-2); }
      .sbt-preview-row b { color: var(--trd-ink); }
      .sbt-preview-note { font-size: .68rem; color: var(--trd-ink-3); margin-top: 6px; }
      .sbt-btn-gold { background: radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%); color: #ffffff; border: 0; border-radius: 12px; padding: 11px 16px; font-weight: 800; font-size: .9rem; cursor: pointer; }
      .sbt-btn-gold.full { width: 100%; margin-top: 8px; }
      .sbt-btn-gold:disabled { opacity: .5; cursor: default; }
      .sbt-btn-ghost { background: none; border: 1px solid var(--trd-line-2); color: var(--accent); border-radius: 12px; padding: 10px 16px; font-weight: 700; font-size: .85rem; cursor: pointer; }
      .sbt-btn-ghost.full { width: 100%; margin-top: 8px; }
      .sbt-gate { background: var(--trd-card-2); border: 1px solid var(--trd-line-2); border-radius: 16px; padding: 15px; font-size: .85rem; color: var(--trd-ink-2); }
      .sbt-gate p { margin: 0 0 10px; line-height: 1.5; }
      .sbt-gate-input { width: 100%; border: 1px solid var(--trd-line-2); border-radius: 10px; padding: 9px 11px; font-size: .9rem; margin-bottom: 8px; background: var(--trd-card); color: var(--trd-ink); }
      /* v711 (owner) — the sealed-bundle sticky bar: theme-token fade + card so
         it matches the page and flips in dark (the globals dark-patch for the
         fade stays harmless). Compact bottom-right on desktop so it never floats
         over the content column. */
      .sbt-basket { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; padding: 10px 12px; background: linear-gradient(0deg, var(--trd-page-a) 62%, transparent); }
      .sbt-basket-in { max-width: 1080px; margin: 0 auto; background: var(--trd-card); color: var(--trd-ink); border-radius: 16px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--trd-line-2); box-shadow: 0 12px 34px -12px rgba(0,0,0,.4); font-size: .82rem; font-weight: 600; }
      @media (min-width: 1024px) { .sbt-basket { left: auto; right: 22px; bottom: 22px; padding: 0; background: none; } .sbt-basket-in { max-width: 340px; box-shadow: 0 18px 44px -16px rgba(0,0,0,.5); } }
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
