"use client";

// v329 — Circle Phase C3: member-resale offers on the consumer feed.
//
// Renders LISTED inventory blocks (owner-set resale price) as bookable cards on
// the SAME flash-deals surface. A signed-in customer taps Reserve → the block's
// resale total is charged via Razorpay (server-authoritative) → settlement is
// recorded (StayBid fee + investor net) and the room stays held for the guest.
// Self-contained: mounted with a single <ResaleOffers city={city}/> line so the
// large flash-deals page stays untouched. Renders NOTHING when there are no
// offers, so it's invisible until an investor lists inventory.

import { useCallback, useEffect, useRef, useState } from "react";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type Offer = {
  id: string; hotelId: string; roomId: string;
  dateFrom: string; dateTo: string; nights: number;
  perNight: number; total: number; suggestedTotal: number | null; discount: number;
  hotel: { name: string; city: string; image: string | null };
  room: { name: string; type: string; image: string | null } | null;
};

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");

export default function ResaleOffers({ city = "" }: { city?: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [done, setDone] = useState<{ dateFrom: string; dateTo: string; total: number } | null>(null);
  const mounted = useRef(true);

  const flash = (m: string) => { setToast(m); setTimeout(() => { if (mounted.current) setToast(""); }, 2800); };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/circle/resale${city ? `?city=${encodeURIComponent(city)}` : ""}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (mounted.current) setOffers(Array.isArray(d.offers) ? d.offers : []);
    } catch { /* ignore */ }
    finally { if (mounted.current) setLoaded(true); }
  }, [city]);

  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);

  async function reserve(o: Offer) {
    if (!token()) {
      flash("Please sign in to reserve.");
      setTimeout(() => { window.location.href = "/auth"; }, 900);
      return;
    }
    setBusy(true);
    try {
      const cr = await fetch(`/api/circle/resale/${encodeURIComponent(o.id)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({}),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { flash(cd?.error || "Couldn't start reservation"); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({
          keyId: cd.keyId,
          orderId: cd.order.id,
          amountPaise: cd.order.amount,
          description: `${o.hotel.name} · ${o.dateFrom}→${o.dateTo} (${o.nights}n)`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { flash("Payment cancelled"); return; }
        flash(e instanceof Error ? e.message : "Payment failed");
        return;
      }

      const vr = await fetch(`/api/circle/resale/${encodeURIComponent(o.id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          razorpay_order_id: cd.order.id,
          razorpay_payment_id: pay?.razorpay_payment_id,
          razorpay_signature: pay?.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { flash(vd?.error || "Verify failed — contact support"); return; }
      setActive(null);
      setDone({ dateFrom: o.dateFrom, dateTo: o.dateTo, total: o.total });
      setOffers((list) => list.filter((x) => x.id !== o.id));
    } catch { flash("Reservation failed"); }
    finally { if (mounted.current) setBusy(false); }
  }

  if (!loaded || offers.length === 0) return null;

  return (
    <div className="mt-6 mb-2">
      <div className="flex items-baseline gap-2 mb-2 px-1">
        <h2 className="text-base font-semibold" style={{ color: "var(--text-base)" }}>
          🔑 Member Resale
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          exclusive nights from Circle investors
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 px-1 -mx-1" style={{ scrollbarWidth: "none" }}>
        {offers.map((o) => (
          <button
            key={o.id}
            onClick={() => setActive(o)}
            className="shrink-0 w-[220px] text-left rounded-2xl overflow-hidden border sb-card-lift"
            style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
          >
            <div className="relative h-[118px] bg-black/5">
              {(o.room?.image || o.hotel.image) ? (
                <img src={o.room?.image || o.hotel.image || ""} alt={o.hotel.name}
                  className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl">🏨</div>
              )}
              {o.discount > 0 && (
                <span className="absolute top-2 right-2 text-[11px] font-bold px-2 py-0.5 rounded-full text-white"
                  style={{ background: "var(--accent)" }}>
                  {o.discount}% off
                </span>
              )}
            </div>
            <div className="p-2.5">
              <div className="text-sm font-semibold truncate" style={{ color: "var(--text-base)" }}>{o.hotel.name}</div>
              <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                📍 {o.hotel.city}{o.room ? ` · ${o.room.name}` : ""}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--text-soft)" }}>
                {o.dateFrom} → {o.dateTo} · {o.nights}n
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-base font-bold" style={{ color: "var(--accent)" }}>{inr(o.total)}</span>
                {o.suggestedTotal && o.suggestedTotal > o.total && (
                  <span className="text-[11px] line-through opacity-50">{inr(o.suggestedTotal)}</span>
                )}
                <span className="text-[10px] opacity-60">total</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Reserve modal */}
      {active && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !busy && setActive(null)}>
          <div className="bg-white w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl p-5"
            style={{ background: "var(--bg-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold" style={{ color: "var(--text-base)" }}>Reserve this stay</div>
            <div className="mt-2 text-sm" style={{ color: "var(--text-soft)" }}>
              <b>{active.hotel.name}</b> · {active.hotel.city}
              {active.room ? <> · {active.room.name}</> : null}
            </div>
            <div className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {active.dateFrom} → {active.dateTo} · {active.nights} night{active.nights === 1 ? "" : "s"}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ background: "var(--accent-soft)" }}>
              <span className="text-sm" style={{ color: "var(--text-soft)" }}>You pay</span>
              <span className="text-xl font-bold" style={{ color: "var(--accent)" }}>{inr(active.total)}</span>
            </div>
            <button disabled={busy} onClick={() => reserve(active)}
              className="mt-4 w-full rounded-xl py-3 text-white font-semibold"
              style={{ background: "var(--accent)" }}>
              {busy ? "Processing…" : `Pay ${inr(active.total)} & reserve`}
            </button>
            <button disabled={busy} onClick={() => setActive(null)}
              className="mt-2 w-full rounded-xl py-2 text-sm border" style={{ borderColor: "var(--border-soft)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success */}
      {done && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setDone(null)}>
          <div className="bg-white sm:max-w-sm w-[90%] rounded-3xl p-6 text-center"
            style={{ background: "var(--bg-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-2">🎉</div>
            <div className="text-lg font-semibold" style={{ color: "var(--text-base)" }}>Stay reserved!</div>
            <div className="mt-1 text-sm" style={{ color: "var(--text-soft)" }}>
              {done.dateFrom} → {done.dateTo} · {inr(done.total)} paid
            </div>
            <button onClick={() => setDone(null)}
              className="mt-4 w-full rounded-xl py-2.5 text-white font-semibold" style={{ background: "var(--accent)" }}>
              Done
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-xl text-sm text-white"
          style={{ background: "var(--text-base)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
