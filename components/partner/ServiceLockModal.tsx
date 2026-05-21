"use client";
//
// v176 — Locked-service modal (partner panel, Phase 1).
//
// Shown when a hotel taps a subscription service it hasn't unlocked.
// Three options: Activate · Show charges · Request free trial.
// Activate + free-trial both raise an admin request; the admin then
// grants free access (with a duration) or sets a price.
//
import { useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";
import { SERVICE_LABEL } from "@/lib/partner/services";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

export default function ServiceLockModal({
  serviceKey, hotelId, pendingRequest, onClose, onRequested,
}: {
  serviceKey: string;
  hotelId: string;
  pendingRequest?: { kind?: string } | null;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [showCharges, setShowCharges] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const label = SERVICE_LABEL[serviceKey] || serviceKey;

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
          ) : (
            <>
              <p className="text-[0.78rem] text-luxury-600 mb-3">
                <b>{label}</b> ek subscription service hai. Iska access lene ke liye neeche se choose karo —
                admin aapko free access dega ya plan ka price batayega.
              </p>
              <div className="space-y-2">
                <button onClick={() => raise("activate")} disabled={!!busy}
                  className="w-full text-left rounded-xl p-3 transition-all"
                  style={{ background: "#fff8e6", border: "1.5px solid #e3c98f" }}>
                  <p className="text-[0.82rem] font-bold text-luxury-900">⚡ Activate</p>
                  <p className="text-[0.64rem] text-luxury-500">Subscribe karne ke liye admin ko request bhejo</p>
                </button>
                <button onClick={() => setShowCharges((s) => !s)}
                  className="w-full text-left rounded-xl p-3 transition-all bg-white"
                  style={{ border: "1.5px solid #e6ddc8" }}>
                  <p className="text-[0.82rem] font-bold text-luxury-900">💰 Show charges</p>
                  <p className="text-[0.64rem] text-luxury-500">Is service ka plan price dekho</p>
                </button>
                {showCharges && (
                  <div className="rounded-xl p-2.5 text-[0.68rem] text-luxury-600" style={{ background: "#f6f1e6" }}>
                    Plan pricing admin set karta hai (monthly / quarterly / yearly · single ya bundle).
                    Activate ya free-trial request bhejo — admin aapko exact price ya free access bata dega.
                  </div>
                )}
                <button onClick={() => raise("free_trial")} disabled={!!busy}
                  className="w-full text-left rounded-xl p-3 transition-all bg-white"
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
