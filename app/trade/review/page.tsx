"use client";

// v361 — Model 3: agent BUNDLE review + EMD payment. Lists the bid bundle,
// shows each deposit + the total, and pays ONE refundable EMD deposit via
// Razorpay (tamper-safe: server re-prices in /api/trade/bids/checkout).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import { useTradeAuth, getTradeToken } from "@/lib/trade/use-trade-auth";
import { bidBasketList, removeBid, clearBidBasket, onBidBasketChange, type BidItem } from "@/lib/trade/bid-basket";
import { bidCostPreview } from "@/lib/trade/auction-engine";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const monthLabel = (mk: string) => {
  try { const [y, m] = mk.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};

export default function TradeReviewPage() {
  const router = useRouter();
  const auth = useTradeAuth();
  const [items, setItems] = useState<BidItem[]>([]);
  const [depositPct, setDepositPct] = useState(10);
  const [paying, setPaying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const sync = () => setItems(bidBasketList());
    sync();
    return onBidBasketChange(sync);
  }, []);

  // depositPct is a global config value — read it from any lot detail once.
  useEffect(() => {
    const first = bidBasketList()[0];
    if (!first) return;
    (async () => {
      try { const r = await fetch(`/api/trade/lots/${first.lotId}`, { cache: "no-store" }); const d = await r.json(); if (r.ok && d.depositPct != null) setDepositPct(d.depositPct); } catch {}
    })();
  }, []);

  const lines = useMemo(() => items.map((it) => ({ it, ...bidCostPreview({ perRoomPerNight: it.perRoomPerNight, nights: it.nights, rooms: it.roomsWanted, depositPct }) })), [items, depositPct]);
  const depositTotal = lines.reduce((s, l) => s + l.deposit, 0);

  const pay = useCallback(async () => {
    if (!items.length) return;
    if (auth.status !== "approved") { setMsg({ ok: false, text: "Only approved agents can bid." }); return; }
    setPaying(true); setMsg(null);
    try {
      const token = getTradeToken();
      const co = await fetch("/api/trade/bids/checkout", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map((it) => ({ lotId: it.lotId, segmentType: it.segmentType, weekIndex: it.weekIndex, perRoomPerNight: it.perRoomPerNight, roomsWanted: it.roomsWanted })) }),
      });
      const cd = await co.json();
      if (!co.ok) { setMsg({ ok: false, text: cd.error || "Checkout failed." }); setPaying(false); return; }

      let pr: any;
      try {
        pr = await openRazorpayForOrder({
          keyId: cd.keyId, orderId: cd.orderId, amountPaise: cd.amountPaise,
          description: `Auction EMD · ${cd.count} bids`,
          userName: cd.prefill?.name, userEmail: cd.prefill?.email,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setMsg({ ok: false, text: "Payment cancelled." }); }
        else { setMsg({ ok: false, text: e instanceof RazorpayError ? e.message : "Payment failed." }); }
        setPaying(false); return;
      }

      const vr = await fetch("/api/trade/bids/verify", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ razorpay_order_id: pr.razorpay_order_id, razorpay_payment_id: pr.razorpay_payment_id, razorpay_signature: pr.razorpay_signature }),
      });
      const vd = await vr.json();
      if (vr.ok && vd.ok) {
        clearBidBasket();
        setMsg({ ok: true, text: `Bids submitted (${vd.activated}). Results at window close — check My Bids.` });
      } else { setMsg({ ok: false, text: vd.error || "Verification failed." }); }
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setPaying(false); }
  }, [items, auth.status]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,var(--trd-page-a),var(--trd-page-b))" }}>
      <div className="sticky top-0 z-30" style={{ background: "linear-gradient(135deg,#1f1710,#33251a)", color: "#ffe9c7" }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/trade")} className="text-lg">‹</button>
          <div className="font-extrabold" style={{ color: "#ffd98a" }}>Your bid bundle</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-center text-luxury-400 py-12">
            Your bundle is empty. <button onClick={() => router.push("/trade")} className="text-gold-600 font-semibold underline">Browse lots</button>
          </div>
        ) : (
          <>
            {lines.map(({ it, baseTotal, deposit }) => (
              <div key={it.key} className="rounded-2xl bg-white border border-luxury-200 p-3 flex gap-3">
                <div className="w-16 h-16 rounded-xl bg-cover bg-center shrink-0" style={{ backgroundImage: `url(${it.image})`, background: it.image ? undefined : "var(--trd-soft)" }} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-luxury-900 truncate">{it.roomName}</div>
                  <div className="text-[0.72rem] text-luxury-400">{it.hotelName} · {it.city} · {monthLabel(it.monthKey)}</div>
                  <div className="text-[0.75rem] text-luxury-600 mt-0.5">{it.segmentLabel} · {inr(it.perRoomPerNight)}/night × {it.roomsWanted} rooms</div>
                  <div className="text-[0.75rem] mt-1 flex gap-3">
                    <span>Bid <b>{inr(baseTotal)}</b></span>
                    <span className="text-amber-700">EMD <b>{inr(deposit)}</b></span>
                  </div>
                </div>
                <button onClick={() => removeBid(it.key)} className="text-red-400 text-sm self-start">Remove</button>
              </div>
            ))}

            <div className="rounded-2xl bg-white border border-luxury-200 p-4">
              <div className="flex justify-between text-sm text-luxury-600"><span>Total refundable EMD ({depositPct}%)</span><b className="text-luxury-900 text-lg">{inr(depositTotal)}</b></div>
              <div className="text-[0.72rem] text-luxury-400 mt-1">This deposit is charged now. If you win, pay the balance + buyer premium; if you don't, it's refunded.</div>
            </div>

            {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}

            {msg?.ok ? (
              <button onClick={() => router.push("/trade/my-bids")} className="w-full py-3 rounded-xl font-bold text-white" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>View My Bids →</button>
            ) : (
              <button onClick={pay} disabled={paying || auth.status !== "approved"}
                className="w-full py-3 rounded-xl font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                {paying ? "Processing…" : `Pay EMD ${inr(depositTotal)}`}
              </button>
            )}
            {auth.status !== "approved" && <div className="text-[0.75rem] text-amber-700 text-center">You must be an approved agent to bid — <button onClick={() => router.push("/trade")} className="underline">sign in / register here</button>.</div>}
          </>
        )}
      </div>
    </div>
  );
}
