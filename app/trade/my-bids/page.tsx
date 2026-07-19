"use client";

// v361 — Model 3: an agent's AWARDS (won → pay balance → voucher) + BIDS
// (active / lost). Sealed-bid, so other agents' bids are never shown.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import { useTradeAuth, getTradeToken } from "@/lib/trade/use-trade-auth";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const monthLabel = (mk: string) => {
  try { const [y, m] = String(mk).split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};
const ST: Record<string, { bg: string; c: string; label: string }> = {
  active:   { bg: "#eff6ff", c: "#1d4ed8", label: "Live" },
  won:      { bg: "#ecfdf5", c: "#047857", label: "Won" },
  partial:  { bg: "#f0fdf4", c: "#15803d", label: "Won (partial)" },
  lost:     { bg: "#f3f4f6", c: "#6b7280", label: "Lost" },
  refunded: { bg: "#fef2f2", c: "#b91c1c", label: "Refunded" },
};

export default function TradeMyBidsPage() {
  const router = useRouter();
  const auth = useTradeAuth();
  const [awards, setAwards] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const tok = getTradeToken();
      const [ar, br] = await Promise.all([
        fetch("/api/trade/awards/mine", { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }),
        fetch("/api/trade/bids/mine", { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }),
      ]);
      const ad = await ar.json(); const bd = await br.json();
      if (ar.ok) setAwards(ad.awards || []);
      if (br.ok) setBids(bd.bids || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    if (auth.status === "signed_out") { setLoading(false); return; }
    load();
  }, [auth.loading, auth.status, load]);

  const payAward = useCallback(async (award: any) => {
    setPayingId(award.id); setMsg(null);
    try {
      const tok = getTradeToken();
      const co = await fetch("/api/trade/awards/pay", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ awardId: award.id }) });
      const cd = await co.json();
      if (!co.ok) { setMsg({ ok: false, text: cd.error || "Pay failed." }); setPayingId(""); return; }
      let pr: any;
      try {
        pr = await openRazorpayForOrder({ keyId: cd.keyId, orderId: cd.orderId, amountPaise: cd.amountPaise, description: `Auction balance · ${award.rooms_awarded} rooms`, userName: cd.prefill?.name, userEmail: cd.prefill?.email });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof RazorpayError && e.message === "__CANCELLED__" ? "Payment cancel." : "Payment failed." });
        setPayingId(""); return;
      }
      const vr = await fetch("/api/trade/awards/verify", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ awardId: award.id, razorpay_order_id: pr.razorpay_order_id, razorpay_payment_id: pr.razorpay_payment_id, razorpay_signature: pr.razorpay_signature }) });
      const vd = await vr.json();
      if (vr.ok && vd.ok) { setMsg({ ok: true, text: `Voucher issued: ${vd.voucher || "done"}` }); load(); }
      else { setMsg({ ok: false, text: vd.error || "Verify failed." }); }
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setPayingId(""); }
  }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#faf7f2,#f3ece1)" }}>
      <div className="sticky top-0 z-30" style={{ background: "linear-gradient(135deg,#1f1710,#33251a)", color: "#ffe9c7" }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/trade")} className="text-lg">‹</button>
          <div className="font-extrabold" style={{ color: "#ffd98a" }}>My Bids & Vouchers</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {auth.status === "signed_out" ? (
          <div className="text-center text-luxury-400 py-12">Sign-in karo. <button onClick={() => router.push("/trade")} className="underline text-gold-600">Browse</button></div>
        ) : loading ? (
          <div className="text-center text-luxury-400 py-12">Loading…</div>
        ) : (
          <>
            {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}

            {/* Awards */}
            {awards.length > 0 && (
              <div>
                <div className="font-bold text-luxury-900 mb-2">🏆 Won allotments</div>
                <div className="space-y-2">
                  {awards.map((a) => (
                    <div key={a.id} className="rounded-2xl bg-white border border-green-200 p-3">
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-luxury-900 truncate">{a.metadata?.hotel_name || a.hotel_id} · {a.city}</div>
                          <div className="text-[0.75rem] text-luxury-500">{a.segment_label} · {monthLabel(a.month_key)} · {a.rooms_awarded} rooms</div>
                          <div className="text-[0.75rem] mt-0.5">Bid {inr(a.base_total)} + premium {inr(a.buyer_fee)} − EMD {inr(a.deposit_applied)}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {a.status === "voucher_issued" ? (
                            <div className="text-[0.72rem]"><div className="text-green-700 font-bold">Voucher</div><div className="font-mono text-luxury-900">{a.voucher_code}</div></div>
                          ) : a.status === "awarded" ? (
                            <button onClick={() => payAward(a)} disabled={payingId === a.id}
                              className="px-3 py-2 rounded-lg font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                              {payingId === a.id ? "…" : `Pay ${inr(a.amount_due)}`}
                            </button>
                          ) : <span className="text-[0.72rem] text-luxury-400">{a.status}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bids */}
            <div>
              <div className="font-bold text-luxury-900 mb-2">My bids</div>
              {bids.length === 0 ? (
                <div className="text-center text-luxury-400 py-8">Abhi koi bid nahi. <button onClick={() => router.push("/trade")} className="underline text-gold-600">Browse</button></div>
              ) : (
                <div className="space-y-2">
                  {bids.map((b) => {
                    const st = ST[b.status] || ST.active;
                    return (
                      <div key={b.id} className="rounded-2xl bg-white border border-luxury-200 p-3 flex gap-3">
                        <div className="w-14 h-14 rounded-xl bg-cover bg-center shrink-0" style={{ backgroundImage: `url(${b.lot?.metadata?.room_img || ""})`, background: b.lot?.metadata?.room_img ? undefined : "#e7d9c2" }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-luxury-900 truncate">{b.lot?.category || b.metadata?.room_id || b.lot_id}</div>
                          <div className="text-[0.72rem] text-luxury-400">{b.lot?.metadata?.hotel_name || ""} · {b.lot?.city || b.metadata?.city} · {monthLabel(b.lot?.month_key || b.metadata?.month_key || "")}</div>
                          <div className="text-[0.75rem] text-luxury-600 mt-0.5">{b.segment_label} · {inr(b.per_room_per_night)}/night × {b.rooms_wanted} rooms</div>
                          <div className="text-[0.72rem] text-amber-700 mt-0.5">EMD {inr(b.deposit_amount)}{b.status === "lost" ? " · refund owed" : ""}</div>
                        </div>
                        <span className="text-[0.7rem] font-bold px-2 py-1 rounded-full self-start" style={{ background: st.bg, color: st.c }}>{st.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
