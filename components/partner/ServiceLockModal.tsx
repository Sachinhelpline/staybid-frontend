"use client";
//
// v178 — Locked-service modal (partner panel, Phase 1-3).
//
// Shown when a hotel taps a subscription service it hasn't unlocked.
// Three options: Activate · Show charges · Request free trial.
//
//   • Activate  — if the service has a price set, opens the plan picker
//                 (monthly / quarterly / yearly + bundles) → Razorpay
//                 payment → instant unlock. If no price is set, raises an
//                 admin request instead (admin then grants free / paid).
//   • Free trial — always raises an admin request.
//
import { useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";
import { SERVICE_LABEL } from "@/lib/partner/services";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

function fmtCur(n: any) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); }

const PLAN_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
const PLAN_TERM: Record<string, string> = { monthly: "1 month", quarterly: "3 months", yearly: "12 months" };

export default function ServiceLockModal({
  serviceKey, hotelId, pendingRequest, pricing, bundles, onClose, onRequested, onUnlocked,
}: {
  serviceKey: string;
  hotelId: string;
  pendingRequest?: { kind?: string } | null;
  pricing?: { monthly?: number | null; quarterly?: number | null; yearly?: number | null } | null;
  bundles?: any[];
  onClose: () => void;
  onRequested: () => void;
  onUnlocked?: () => void;
}) {
  const [showCharges, setShowCharges] = useState(false);
  const [mode, setMode] = useState<"choose" | "plans">("choose");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const label = SERVICE_LABEL[serviceKey] || serviceKey;

  const hasPrice = !!pricing && (pricing.monthly != null || pricing.quarterly != null || pricing.yearly != null);
  const myBundles = (bundles || []).filter((b: any) =>
    Array.isArray(b.service_keys) && b.service_keys.includes(serviceKey));
  const canBuy = hasPrice || myBundles.length > 0;

  async function raise(kind: "activate" | "free_trial") {
    setBusy(kind); setErr("");
    try {
      const r = await fetch("/api/partner/services", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hotelId, serviceKey, kind }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Request failed");
      onRequested();
    } catch (e: any) { setErr(e?.message || "Request failed"); setBusy(""); }
  }

  // Activate tapped — pay if priced, otherwise raise an admin request.
  function onActivate() {
    setErr("");
    if (canBuy) setMode("plans");
    else raise("activate");
  }

  async function pay(plan: "monthly" | "quarterly" | "yearly", bundleId?: string) {
    const tag = (bundleId || serviceKey) + ":" + plan;
    setBusy(tag); setErr("");
    try {
      const token = getToken();
      const cr = await fetch("/api/partner/service-checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", hotelId, plan, serviceKey: bundleId ? undefined : serviceKey, bundleId }),
      });
      const order = await cr.json().catch(() => ({}));
      if (!cr.ok || !order.ok) throw new Error(order.error || "Order create fail");

      let pr;
      try {
        pr = await openRazorpayForOrder({
          orderId: order.orderId,
          amountPaise: order.amountPaise,
          keyId: order.keyId,
          description: `${order.label} — ${PLAN_LABEL[plan]}`,
        });
      } catch (e: any) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setBusy(""); return; }
        throw e;
      }

      const vr = await fetch("/api/partner/service-checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          paymentId: order.paymentId,
          razorpay_order_id: pr.razorpay_order_id,
          razorpay_payment_id: pr.razorpay_payment_id,
          razorpay_signature: pr.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd.ok) throw new Error(vd.error || "Payment verify fail");
      (onUnlocked || onRequested)(); // service is now unlocked — refresh entitlements
    } catch (e: any) {
      setErr(e?.message || "Payment failed");
      setBusy("");
    }
  }

  return modalPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>🔒 {label}</p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {pendingRequest ? (
            <div className="text-center py-4">
              <p className="text-3xl mb-2">⏳</p>
              <p className="text-[0.82rem] font-bold text-luxury-900">Request bhej di gayi hai</p>
              <p className="text-[0.7rem] text-luxury-500 mt-1">
                Admin aapki <b>{label}</b> request review kar raha hai. Approve hote hi ye service apne aap unlock ho jayegi.
              </p>
            </div>
          ) : mode === "plans" ? (
            <>
              <button onClick={() => { setMode("choose"); setErr(""); }}
                className="text-[0.7rem] text-luxury-500 mb-2">‹ Wapas</button>
              <p className="text-[0.78rem] text-luxury-600 mb-3">
                <b>{label}</b> ke liye apna plan choose karo. Payment ke turant baad service unlock ho jayegi.
              </p>

              {hasPrice && (
                <div className="space-y-2 mb-3">
                  <p className="text-[0.66rem] font-bold text-luxury-700">{label} — plans</p>
                  {(["monthly", "quarterly", "yearly"] as const).map((pl) => {
                    const price = pricing?.[pl];
                    if (price == null) return null;
                    const tag = serviceKey + ":" + pl;
                    return (
                      <button key={pl} onClick={() => pay(pl)} disabled={!!busy}
                        className="w-full flex items-center justify-between rounded-xl p-3 transition-all disabled:opacity-50"
                        style={{ background: "#fff8e6", border: "1.5px solid #e3c98f" }}>
                        <span className="text-left">
                          <span className="block text-[0.8rem] font-bold text-luxury-900">{PLAN_LABEL[pl]}</span>
                          <span className="block text-[0.6rem] text-luxury-500">{PLAN_TERM[pl]} access</span>
                        </span>
                        <span className="text-[0.92rem] font-bold text-gold-700">
                          {busy === tag ? "…" : fmtCur(price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {myBundles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[0.66rem] font-bold text-luxury-700">Bundle plans (extra services included)</p>
                  {myBundles.map((b: any) => (
                    <div key={b.id} className="rounded-xl p-2.5" style={{ background: "#f6f1e6" }}>
                      <p className="text-[0.74rem] font-bold text-luxury-900">{b.name}</p>
                      <p className="text-[0.58rem] text-luxury-500 mb-1.5">
                        {(b.service_keys || []).map((k: string) => SERVICE_LABEL[k] || k).join(" · ")}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(["monthly", "quarterly", "yearly"] as const).map((pl) => {
                          const price = b[pl];
                          if (price == null) return <div key={pl} />;
                          const tag = b.id + ":" + pl;
                          return (
                            <button key={pl} onClick={() => pay(pl, b.id)} disabled={!!busy}
                              className="bg-white rounded-lg px-1.5 py-1.5 text-center transition-all disabled:opacity-50"
                              style={{ border: "1px solid #e3c98f" }}>
                              <span className="block text-[0.5rem] text-luxury-400 uppercase tracking-wide">{PLAN_LABEL[pl]}</span>
                              <span className="block text-[0.72rem] font-bold text-gold-700">
                                {busy === tag ? "…" : fmtCur(price)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{err}</p>}
            </>
          ) : (
            <>
              <p className="text-[0.78rem] text-luxury-600 mb-3">
                <b>{label}</b> ek subscription service hai. Iska access lene ke liye neeche se choose karo —
                admin aapko free access dega ya plan ka price batayega.
              </p>
              <div className="space-y-2">
                <button onClick={onActivate} disabled={!!busy}
                  className="w-full text-left rounded-xl p-3 transition-all disabled:opacity-50"
                  style={{ background: "#fff8e6", border: "1.5px solid #e3c98f" }}>
                  <p className="text-[0.82rem] font-bold text-luxury-900">⚡ Activate</p>
                  <p className="text-[0.64rem] text-luxury-500">
                    {canBuy ? "Plan choose karke abhi unlock karo" : "Subscribe karne ke liye admin ko request bhejo"}
                  </p>
                </button>
                <button onClick={() => setShowCharges((s) => !s)}
                  className="w-full text-left rounded-xl p-3 transition-all bg-white"
                  style={{ border: "1.5px solid #e6ddc8" }}>
                  <p className="text-[0.82rem] font-bold text-luxury-900">💰 Show charges</p>
                  <p className="text-[0.64rem] text-luxury-500">Is service ka plan price dekho</p>
                </button>
                {showCharges && (() => {
                  if (!hasPrice && !myBundles.length) {
                    return (
                      <div className="rounded-xl p-2.5 text-[0.68rem] text-luxury-600" style={{ background: "#f6f1e6" }}>
                        Iss service ki pricing admin abhi set kar raha hai. Activate ya free-trial request bhejo —
                        admin aapko exact price ya free access bata dega.
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-xl p-2.5" style={{ background: "#f6f1e6" }}>
                      {hasPrice && (
                        <>
                          <p className="text-[0.66rem] font-bold text-luxury-700 mb-1">{label} — plan price</p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {([["Monthly", pricing!.monthly], ["Quarterly", pricing!.quarterly], ["Yearly", pricing!.yearly]] as const).map(([k, v]) => (
                              <div key={k} className="bg-white rounded-lg px-1.5 py-1 text-center">
                                <p className="text-[0.52rem] text-luxury-400 uppercase tracking-wide">{k}</p>
                                <p className="text-[0.74rem] font-bold text-gold-700">{v != null ? fmtCur(v) : "—"}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {myBundles.length > 0 && (
                        <div className={hasPrice ? "mt-2" : ""}>
                          <p className="text-[0.66rem] font-bold text-luxury-700 mb-1">Bundle plans</p>
                          {myBundles.map((b: any) => (
                            <p key={b.id} className="text-[0.62rem] text-luxury-600">
                              <b>{b.name}</b> — {b.monthly != null ? `${fmtCur(b.monthly)}/mo` : ""}
                              {b.yearly != null ? ` · ${fmtCur(b.yearly)}/yr` : ""}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="text-[0.58rem] text-luxury-400 mt-1.5">Activate dabao — plan choose karke pay karo.</p>
                    </div>
                  );
                })()}
                <button onClick={() => raise("free_trial")} disabled={!!busy}
                  className="w-full text-left rounded-xl p-3 transition-all bg-white disabled:opacity-50"
                  style={{ border: "1.5px solid #e6ddc8" }}>
                  <p className="text-[0.82rem] font-bold text-luxury-900">🎁 Request free trial</p>
                  <p className="text-[0.64rem] text-luxury-500">Admin se kuch din ka free access maango</p>
                </button>
              </div>
              {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{err}</p>}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost w-full">
            {pendingRequest ? "Theek hai" : "Abhi nahi"}
          </button>
        </div>
      </div>
    </div>
  );
}
