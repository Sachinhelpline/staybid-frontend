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
  active:    { bg: "#eff6ff", c: "#1d4ed8", label: "Live" },
  accepted:  { bg: "#fffbeb", c: "#b45309", label: "Accepted · pay above" },
  countered: { bg: "#f5f3ff", c: "#6d28d9", label: "Counter offer" },
  won:       { bg: "#ecfdf5", c: "#047857", label: "Won" },
  partial:   { bg: "#f0fdf4", c: "#15803d", label: "Won (partial)" },
  lost:      { bg: "#f3f4f6", c: "#6b7280", label: "Lost" },
  rejected:  { bg: "#f3f4f6", c: "#6b7280", label: "Declined" },
  expired:   { bg: "#f3f4f6", c: "#6b7280", label: "Expired" },
  refunded:  { bg: "#fef2f2", c: "#b91c1c", label: "Refunded" },
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

  const [sellBusy, setSellBusy] = useState("");
  const [copied, setCopied] = useState("");
  const [counterBusy, setCounterBusy] = useState("");

  const [cancelBusy, setCancelBusy] = useState("");
  const cancelBid = useCallback(async (b: any) => {
    setCancelBusy(b.id); setMsg(null);
    try {
      const tok = getTradeToken();
      const r = await fetch("/api/trade/bids/cancel", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ bidId: b.id }) });
      const d = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: d.error || "Could not cancel." }); }
      else { setMsg({ ok: true, text: "Bid withdrawn — you can bid again on this lot." }); load(); }
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setCancelBusy(""); }
  }, [load]);

  const acceptCounter = useCallback(async (b: any) => {
    setCounterBusy(b.id); setMsg(null);
    try {
      const tok = getTradeToken();
      const r = await fetch("/api/trade/bids/accept-counter", { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ bidId: b.id }) });
      const d = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: d.error || "Could not accept the counter." }); }
      else { setMsg({ ok: true, text: "Counter accepted — pay above in Won allotments to lock your rooms." }); load(); }
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setCounterBusy(""); }
  }, [load]);

  const directLink = (a: any) => {
    const nights: string[] = Array.isArray(a.night_dates) ? [...a.night_dates].sort() : [];
    if (!nights.length) return "";
    const checkIn = nights[0];
    const checkOut = new Date(new Date(nights[nights.length - 1] + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/hotels/${a.hotel_id}?checkIn=${checkIn}&checkOut=${checkOut}`;
  };
  const copyLink = async (a: any) => {
    const link = directLink(a);
    try { await navigator.clipboard.writeText(link); setCopied(a.id); setTimeout(() => setCopied(""), 2000); } catch {}
  };
  const enableSelling = useCallback(async (award: any) => {
    setSellBusy(award.id); setMsg(null);
    try {
      const tok = getTradeToken();
      const r = await fetch(`/api/trade/awards/${award.id}/enable-selling`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: d.error || "Enable failed." }); setSellBusy(""); return; }
      if (d.granted > 0) {
        // Reuse the agent's Google token as the partner session so the dashboard
        // resolves their newly-granted operator scope (My Rooms + OTA feeds).
        try {
          localStorage.setItem("sb_partner_token", tok);
          localStorage.setItem("sb_partner_user", JSON.stringify({ id: auth.user?.id, name: auth.agent?.agency_name || "Agent" }));
        } catch {}
        window.location.href = "/partner/dashboard";
      } else {
        setMsg({ ok: false, text: d.message || "Self-listing not available for this property — use your own channel." });
      }
    } catch { setMsg({ ok: false, text: "Network error." }); } finally { setSellBusy(""); }
  }, [auth.user, auth.agent]);

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
          <div className="text-center text-luxury-400 py-12">Sign in to see your bids. <button onClick={() => router.push("/trade")} className="underline text-gold-600">Browse</button></div>
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
                          <div className="text-[0.75rem] mt-0.5">Bid {inr(a.base_total)} + premium {inr(a.buyer_fee)}{Number(a.deposit_applied) > 0 ? ` − EMD ${inr(a.deposit_applied)}` : ""}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {a.status === "voucher_issued" ? (
                            <div className="text-[0.72rem]"><div className="text-green-700 font-bold">Voucher</div><div className="font-mono text-luxury-900">{a.voucher_code}</div></div>
                          ) : a.status === "awarded" ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <button onClick={() => payAward(a)} disabled={payingId === a.id}
                                className="px-3 py-2 rounded-lg font-bold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                                {payingId === a.id ? "…" : `Pay ${inr(a.amount_due)}`}
                              </button>
                              {(a.metadata?.sale_mode === "live") && a.bid_id && (
                                <button onClick={() => cancelBid({ id: a.bid_id })} disabled={cancelBusy === a.bid_id}
                                  className="text-[0.68rem] font-bold text-red-500 disabled:opacity-50">
                                  {cancelBusy === a.bid_id ? "…" : "Withdraw"}
                                </button>
                              )}
                            </div>
                          ) : <span className="text-[0.72rem] text-luxury-400">{a.status}</span>}
                        </div>
                      </div>
                      {a.status === "voucher_issued" && (
                        <div className="mt-3 pt-3 border-t border-green-100">
                          <div className="text-[0.72rem] font-bold text-luxury-700 mb-1.5">Sell your allotment:</div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => enableSelling(a)} disabled={sellBusy === a.id}
                              className="px-3 py-1.5 rounded-lg text-[0.75rem] font-bold text-white disabled:opacity-50" style={{ background: "#33251a" }}>
                              {sellBusy === a.id ? "…" : "🏠 Sell on StayBid + OTA"}
                            </button>
                            <button onClick={() => copyLink(a)}
                              className="px-3 py-1.5 rounded-lg text-[0.75rem] font-bold" style={{ background: "#fef3c7", color: "#92400e" }}>
                              {copied === a.id ? "✓ Link copied" : "🔗 Your channel link"}
                            </button>
                          </div>
                          <div className="text-[0.68rem] text-luxury-400 mt-1.5">StayBid + OTA: list your rooms + set OTA feeds in the partner dashboard. Own channel: share the direct booking link with your guests.</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bids */}
            <div>
              <div className="font-bold text-luxury-900 mb-2">My bids</div>
              {bids.length === 0 ? (
                <div className="text-center text-luxury-400 py-8">No bids yet. <button onClick={() => router.push("/trade")} className="underline text-gold-600">Browse lots</button></div>
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
                          <div className="text-[0.72rem] text-amber-700 mt-0.5">
                            {b.metadata?.sale_mode === "live" || Number(b.deposit_amount) === 0
                              ? "⚡ Live · no deposit"
                              : `EMD ${inr(b.deposit_amount)}${b.status === "lost" ? " · refund owed" : ""}`}
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {b.status === "countered" && Number(b.counter_per_room_per_night) > 0 && (
                              <button onClick={() => acceptCounter(b)} disabled={counterBusy === b.id}
                                className="px-3 py-1.5 rounded-lg text-[0.72rem] font-bold text-white disabled:opacity-50" style={{ background: "#6d28d9" }}>
                                {counterBusy === b.id ? "…" : `Accept counter ${inr(b.counter_per_room_per_night)}/night`}
                              </button>
                            )}
                            {["active", "countered"].includes(b.status) && (
                              <button onClick={() => cancelBid(b)} disabled={cancelBusy === b.id}
                                className="px-3 py-1.5 rounded-lg text-[0.72rem] font-bold text-red-600 border border-red-200 disabled:opacity-50">
                                {cancelBusy === b.id ? "…" : "Withdraw bid"}
                              </button>
                            )}
                          </div>
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
