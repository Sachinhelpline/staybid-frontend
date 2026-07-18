"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /circle/model3 — Pre-Buy Marketplace (v340 · Phase M1).
//
// Model 3 = an investor pre-buys room-nights WHOLESALE on StayBid-operated
// host-circle properties, then resells them for a margin. M1 turns the M0
// honest-supply shell into the real 3-step marketplace:
//   1 Choose  — browse operated pre-buy properties → pick a hotel + room
//   2 Select  — pick a date range, priced LIVE at StayBid's wholesale rate
//   3 Build & Pay — review the wholesale buy + Razorpay
//
// The whole checkout+verify chain is server-authoritative:
//   /api/circle/marketplace         (browse feed, public)
//   /api/circle/marketplace/quote   (Spine wholesale quote, public read-only)
//   /api/circle/marketplace/checkout (auth · auto-assigns a free unit · charge)
//   /api/circle/marketplace/verify   (HMAC · flips owned · stamps unit owner)
// Client NEVER sets ₹ — the checkout re-quotes the Spine and freezes the buy.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CircleStepShell from "@/components/circle/CircleStepShell";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type MktRoom = {
  id: string;
  name: string;
  type: string;
  image: string | null;
  capacity: number;
  fromWholesale: number | null;
};
type MktHotel = {
  id: string;
  name: string;
  city: string;
  state: string | null;
  starRating: number;
  image: string | null;
  fromWholesale: number | null;
  rooms: MktRoom[];
};
type Quote = {
  nights: number;
  buyTotal: number;
  avgBuyPerNight: number;
  suggestedResaleTotal: number;
  avgResalePerNight: number;
  feePct: number;
  perNight: number;
};

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDaysISO = (base: string, d: number) => {
  const dt = new Date(base + "T00:00:00");
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

export default function Model3Page() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — browse
  const [hotels, setHotels] = useState<MktHotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<string>("all");
  const [selHotel, setSelHotel] = useState<MktHotel | null>(null);
  const [selRoom, setSelRoom] = useState<MktRoom | null>(null);

  // Step 2 — dates + quote
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [available, setAvailable] = useState(true);
  const [unitsFree, setUnitsFree] = useState<number | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const quoteSeq = useRef(0);

  // Step 3 — pay
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState("");
  const [done, setDone] = useState<{ from: string; to: string; buyTotal: number } | null>(null);

  const mounted = useRef(true);
  const flash = (m: string) => { setToast(m); setTimeout(() => { if (mounted.current) setToast(""); }, 2800); };

  // ── browse feed ───────────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const r = await fetch("/api/circle/marketplace", { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (mounted.current) setHotels(Array.isArray(d.hotels) ? d.hotels : []);
      } catch { /* ignore */ }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; };
  }, []);

  const cities = useMemo(() => {
    const s = new Set<string>();
    hotels.forEach((h) => { if (h.city) s.add(h.city); });
    return Array.from(s).sort();
  }, [hotels]);

  const shown = useMemo(
    () => (city === "all" ? hotels : hotels.filter((h) => h.city === city)),
    [hotels, city],
  );

  // ── live Spine quote when hotel+room+dates set ─────────────────────────────
  const fetchQuote = useCallback(async (hid: string, rid: string, f: string, t: string) => {
    const seq = ++quoteSeq.current;
    setQuoting(true); setQuoteErr(""); setQuote(null);
    try {
      const r = await fetch("/api/circle/marketplace/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotelId: hid, roomId: rid, from: f, to: t }),
      });
      const d = await r.json().catch(() => ({}));
      if (seq !== quoteSeq.current) return; // stale
      if (!r.ok || !d?.ok) { setQuoteErr(d?.error || "Couldn't price these dates."); return; }
      setQuote(d.quote as Quote);
      setAvailable(d.available !== false);
      setUnitsFree(typeof d.unitsFree === "number" ? d.unitsFree : null);
    } catch {
      if (seq === quoteSeq.current) setQuoteErr("Couldn't reach pricing — try again.");
    } finally {
      if (seq === quoteSeq.current) setQuoting(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 2 || !selHotel || !selRoom) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
      setQuote(null); setQuoteErr(""); setQuoting(false); return;
    }
    const id = setTimeout(() => fetchQuote(selHotel.id, selRoom.id, from, to), 250);
    return () => clearTimeout(id);
  }, [step, selHotel, selRoom, from, to, fetchQuote]);

  // ── step transitions ───────────────────────────────────────────────────────
  const pickRoom = (h: MktHotel, room: MktRoom) => {
    setSelHotel(h); setSelRoom(room);
    // seed a sensible default date range (tomorrow → +3 nights)
    const f = plusDaysISO(todayISO(), 1);
    setFrom(f); setTo(plusDaysISO(f, 3));
    setStep(2);
  };

  const canReview = !!quote && quote.buyTotal > 0 && available && !quoting && !quoteErr;

  async function pay() {
    if (!selHotel || !selRoom || !quote) return;
    if (!token()) {
      flash("Please sign in to pre-buy.");
      setTimeout(() => router.push("/auth"), 900);
      return;
    }
    setPaying(true);
    try {
      const cr = await fetch("/api/circle/marketplace/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ hotelId: selHotel.id, roomId: selRoom.id, from, to }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id || !cd?.blockId) {
        flash(cd?.error || "Couldn't start the pre-buy.");
        return;
      }

      let rp: any;
      try {
        rp = await openRazorpayForOrder({
          keyId: cd.keyId,
          orderId: cd.order.id,
          amountPaise: cd.order.amount,
          description: `${selHotel.name} · ${from}→${to} (${quote.nights}n) pre-buy`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { flash("Payment cancelled"); return; }
        flash(e instanceof Error ? e.message : "Payment failed");
        return;
      }

      const vr = await fetch("/api/circle/marketplace/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          blockId: cd.blockId,
          razorpay_order_id: cd.order.id,
          razorpay_payment_id: rp?.razorpay_payment_id,
          razorpay_signature: rp?.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { flash(vd?.error || "Verify failed — contact support"); return; }
      setDone({ from, to, buyTotal: Number(cd.buyTotal) || quote.buyTotal });
    } catch {
      flash("Pre-buy failed — try again.");
    } finally {
      if (mounted.current) setPaying(false);
    }
  }

  // ── step titles ─────────────────────────────────────────────────────────────
  const titles: Record<1 | 2 | 3, { t: string; s: string }> = {
    1: { t: "Pick a property to pre-buy", s: "StayBid-operated stays open for wholesale pre-buy. You lock room-nights below retail, then resell them for a margin. Unsold-inventory risk is yours." },
    2: { t: "Pick your dates", s: "Priced live at StayBid's wholesale rate. This is what you pay to hold these room-nights." },
    3: { t: "Review & pay", s: "Server re-prices the Spine at pay time and assigns you a free room automatically." },
  };

  return (
    <CircleStepShell
      model="Model 2"
      tag="Inventory Bundle · Pre-Buy"
      title={titles[step].t}
      subtitle={titles[step].s}
      activeStep={step}
    >
      {/* ── STEP 1 · BROWSE ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <>
          {loading ? (
            <div className="sbc-mkt-grid">
              {[0, 1, 2, 3].map((i) => <div key={i} className="sbc-mkt-skel" />)}
            </div>
          ) : shown.length === 0 ? (
            <div className="sbc-ms-empty">
              <div className="sbc-ms-empty-ic">🔑</div>
              <div className="sbc-ms-empty-h">Pre-buy supply is being onboarded</div>
              <p className="sbc-ms-empty-p">
                StayBid is provisioning operated properties for the pre-buy marketplace. Check back soon.
              </p>
              <a href="/circle" className="sbc-ms-cta">Back to StayCircle</a>
            </div>
          ) : (
            <>
              {cities.length > 1 && (
                <div className="sbc-mkt-cityrow">
                  <button className={`sbc-mkt-cityChip ${city === "all" ? "on" : ""}`} onClick={() => setCity("all")}>
                    All cities
                  </button>
                  {cities.map((c) => (
                    <button key={c} className={`sbc-mkt-cityChip ${city === c ? "on" : ""}`} onClick={() => setCity(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              )}

              <div className="sbc-mkt-grid">
                {shown.map((h) => (
                  <div key={h.id} className="sbc-mkt-card">
                    <div className="sbc-mkt-card-img">
                      {h.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={h.image} alt={h.name} loading="lazy" />
                      ) : (
                        <div className="sbc-mkt-card-noimg">🏨</div>
                      )}
                      {h.starRating > 0 && <span className="sbc-mkt-star">★ {h.starRating}</span>}
                    </div>
                    <div className="sbc-mkt-card-body">
                      <div className="sbc-mkt-card-name">{h.name}</div>
                      <div className="sbc-mkt-card-meta">📍 {h.city}{h.state ? `, ${h.state}` : ""}</div>
                      {h.fromWholesale ? (
                        <div className="sbc-mkt-card-from">
                          from <b>{inr(h.fromWholesale)}</b><span>/night wholesale</span>
                        </div>
                      ) : null}

                      <div className="sbc-mkt-roomrow">
                        {h.rooms.map((room) => (
                          <button key={room.id} className="sbc-mkt-roomChip" onClick={() => pickRoom(h, room)}>
                            <span className="sbc-mkt-roomChip-name">{room.name}</span>
                            {room.fromWholesale ? (
                              <span className="sbc-mkt-roomChip-price">{inr(room.fromWholesale)}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="sbc-ms-note">
                Investors only · pre-buying to resell carries unsold-inventory risk. Income depends on actual
                resale — never guaranteed.
              </p>
            </>
          )}
        </>
      )}

      {/* ── STEP 2 · DATES ──────────────────────────────────────────────────── */}
      {step === 2 && selHotel && selRoom && (
        <>
          <div className="sbc-mkt-panel">
            <div className="sbc-mkt-selhead">
              <div>
                <div className="sbc-mkt-card-name">{selHotel.name}</div>
                <div className="sbc-mkt-card-meta">📍 {selHotel.city} · {selRoom.name}</div>
              </div>
              <button className="sbc-mkt-btn-ghost" onClick={() => { setStep(1); setQuote(null); }}>
                ← Change
              </button>
            </div>

            <div className="sbc-mkt-dategrid">
              <label className="sbc-mkt-field">
                <span className="sbc-mkt-label">Check-in</span>
                <input
                  className="sbc-mkt-input" type="date" value={from} min={todayISO()}
                  onChange={(e) => {
                    const f = e.target.value;
                    setFrom(f);
                    if (to && to <= f) setTo(plusDaysISO(f, 1));
                  }}
                />
              </label>
              <label className="sbc-mkt-field">
                <span className="sbc-mkt-label">Check-out</span>
                <input
                  className="sbc-mkt-input" type="date" value={to} min={from ? plusDaysISO(from, 1) : plusDaysISO(todayISO(), 1)}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="sbc-mkt-panel">
            {quoting ? (
              <div className="sbc-mkt-quoteloading">Pricing at StayBid's wholesale rate…</div>
            ) : quoteErr ? (
              <div className="sbc-mkt-avail warn">{quoteErr}</div>
            ) : quote ? (
              <>
                <div className="sbc-mkt-quote">
                  <div className="sbc-mkt-qrow">
                    <span>{quote.nights} night{quote.nights === 1 ? "" : "s"} · wholesale</span>
                    <span>{inr(quote.avgBuyPerNight)}/night</span>
                  </div>
                  <div className="sbc-mkt-qrow sbc-mkt-qtotal">
                    <span>You pay</span>
                    <span>{inr(quote.buyTotal)}</span>
                  </div>
                  <div className="sbc-mkt-qrow sbc-mkt-qmuted">
                    <span>Suggested resale</span>
                    <span>{inr(quote.suggestedResaleTotal)} · {quote.feePct}% platform fee</span>
                  </div>
                </div>
                <div className={`sbc-mkt-avail ${available ? "" : "warn"}`}>
                  {available
                    ? (unitsFree != null ? `✓ ${unitsFree} room${unitsFree === 1 ? "" : "s"} free for these nights` : "✓ Available for these nights")
                    : "Sold out for these nights — try different dates."}
                </div>
              </>
            ) : (
              <div className="sbc-mkt-quoteloading">Pick a valid date range to see the wholesale price.</div>
            )}
          </div>

          <div className="sbc-mkt-actions">
            <button className="sbc-mkt-btn-ghost" onClick={() => { setStep(1); setQuote(null); }}>← Back</button>
            <button className="sbc-mkt-btn" disabled={!canReview} onClick={() => setStep(3)}>
              Review →
            </button>
          </div>
          <p className="sbc-ms-note">
            Pre-buying to resell carries unsold-inventory risk. Income depends on actual resale — never guaranteed.
          </p>
        </>
      )}

      {/* ── STEP 3 · REVIEW & PAY ───────────────────────────────────────────── */}
      {step === 3 && selHotel && selRoom && quote && (
        <>
          <div className="sbc-mkt-panel">
            <div className="sbc-mkt-card-name">{selHotel.name}</div>
            <div className="sbc-mkt-card-meta">📍 {selHotel.city} · {selRoom.name}</div>
            <div className="sbc-mkt-rev">
              <div className="sbc-mkt-qrow"><span>Dates</span><span>{from} → {to}</span></div>
              <div className="sbc-mkt-qrow"><span>Nights</span><span>{quote.nights}</span></div>
              <div className="sbc-mkt-qrow"><span>Wholesale / night</span><span>{inr(quote.avgBuyPerNight)}</span></div>
              <div className="sbc-mkt-qrow sbc-mkt-qtotal"><span>You pay now</span><span>{inr(quote.buyTotal)}</span></div>
              <div className="sbc-mkt-qrow sbc-mkt-qmuted"><span>Suggested resale</span><span>{inr(quote.suggestedResaleTotal)}</span></div>
              <div className="sbc-mkt-qrow sbc-mkt-qmuted"><span>Platform fee on resale</span><span>{quote.feePct}%</span></div>
            </div>
          </div>

          <div className="sbc-mkt-actions">
            <button className="sbc-mkt-btn-ghost" disabled={paying} onClick={() => setStep(2)}>← Change dates</button>
            <button className="sbc-mkt-btn" disabled={paying} onClick={pay}>
              {paying ? "Processing…" : `Pay ${inr(quote.buyTotal)} & pre-buy`}
            </button>
          </div>
          <p className="sbc-ms-note">
            Server re-prices the Spine at pay time — the amount above is indicative. A free room is auto-assigned
            to you on payment. Unsold-inventory risk is yours; income depends on actual resale — never guaranteed.
          </p>
        </>
      )}

      {/* ── SUCCESS ─────────────────────────────────────────────────────────── */}
      {done && (
        <div className="sbc-mkt-success" onClick={() => { setDone(null); router.push("/partner/dashboard"); }}>
          <div className="sbc-mkt-success-card" onClick={(e) => e.stopPropagation()}>
            <div className="sbc-mkt-success-ic">🎉</div>
            <div className="sbc-mkt-success-h">Room-nights pre-bought!</div>
            <p className="sbc-mkt-success-p">
              {done.from} → {done.to} · {inr(done.buyTotal)} paid. Your room is now in your Circle inventory —
              list it for resale from your dashboard whenever you like.
            </p>
            <button className="sbc-ms-cta" onClick={() => router.push("/partner/dashboard")}>
              Go to my inventory →
            </button>
            <button
              className="sbc-mkt-btn-ghost" style={{ marginTop: 8 }}
              onClick={() => { setDone(null); setStep(1); setSelHotel(null); setSelRoom(null); setQuote(null); }}
            >
              Pre-buy another
            </button>
          </div>
        </div>
      )}

      {toast && <div className="sbc-mkt-toast">{toast}</div>}
    </CircleStepShell>
  );
}
