"use client";
//
// v178 — Subscription billing history (partner panel, Phase 5).
//
// Lists this hotel's service_payments rows. Each paid row has a
// "Receipt" button that opens a clean, printable receipt in a new
// window (StayBid as biller, the hotel as customer).
//
import { useEffect, useState } from "react";
import { ReceiptText, X, Printer } from "lucide-react";
import { modalPortal } from "@/lib/partner/modal-portal";
import { SERVICE_LABEL } from "@/lib/partner/services";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: any) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); }
function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const PLAN_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

function payTitle(p: any): string {
  if (p.bundle_id) return "Bundle plan";
  return SERVICE_LABEL[p.service_key] || p.service_key || "Service";
}
function payServices(p: any): string {
  const keys: string[] = Array.isArray(p.service_keys) ? p.service_keys : [];
  return keys.map((k) => SERVICE_LABEL[k] || k).join(", ");
}

function openReceipt(p: any) {
  const w = window.open("", "_blank", "width=520,height=720");
  if (!w) { alert("The receipt pop-up was blocked — please allow pop-ups."); return; }
  const esc = (s: any) => String(s ?? "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
<title>StayBid Receipt — ${esc(p.id)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Roboto,sans-serif;color:#2b2415;padding:32px;background:#fff}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #c1ccd7;padding-bottom:14px}
  .brand{font-size:22px;font-weight:800;color:#8198ae;letter-spacing:.5px}
  .tag{font-size:11px;color:#8a805f;margin-top:2px}
  .rno{font-size:11px;color:#8a805f;text-align:right}
  h2{font-size:13px;margin:20px 0 8px;color:#6e5430;text-transform:uppercase;letter-spacing:.6px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:7px 0;vertical-align:top}
  td.l{color:#8a805f;width:42%}
  td.r{font-weight:600;text-align:right}
  .total{margin-top:16px;border-top:2px solid #c1ccd7;padding-top:12px;display:flex;justify-content:space-between;align-items:center}
  .total .amt{font-size:24px;font-weight:800;color:#8198ae}
  .paid{display:inline-block;margin-top:6px;background:#e7f6ec;color:#1c7a3e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px}
  .ft{margin-top:28px;font-size:10.5px;color:#889db3;text-align:center;line-height:1.6}
  @media print{body{padding:18px}}
</style></head><body>
  <div class="hd">
    <div><div class="brand">StayBid</div><div class="tag">Hotel subscription services</div></div>
    <div class="rno">Receipt<br/><b>${esc(p.id)}</b><br/>${esc(fmtDate(p.paid_at || p.created_at))}</div>
  </div>
  <h2>Billed to</h2>
  <table><tr><td class="l">Hotel</td><td class="r">${esc(p.hotel_name || p.hotel_id)}</td></tr></table>
  <h2>Subscription</h2>
  <table>
    <tr><td class="l">${p.bundle_id ? "Bundle" : "Service"}</td><td class="r">${esc(payTitle(p))}</td></tr>
    <tr><td class="l">Includes</td><td class="r">${esc(payServices(p))}</td></tr>
    <tr><td class="l">Plan</td><td class="r">${esc(PLAN_LABEL[p.plan] || p.plan)}</td></tr>
    <tr><td class="l">Valid till</td><td class="r">${esc(fmtDate(p.expires_at))}</td></tr>
  </table>
  <h2>Payment</h2>
  <table>
    <tr><td class="l">Razorpay payment ID</td><td class="r">${esc(p.razorpay_payment_id)}</td></tr>
    <tr><td class="l">Razorpay order ID</td><td class="r">${esc(p.razorpay_order_id)}</td></tr>
    <tr><td class="l">Paid on</td><td class="r">${esc(fmtDate(p.paid_at || p.created_at))}</td></tr>
  </table>
  <div class="total">
    <div><div style="font-size:12px;color:#8a805f">Amount paid</div><span class="paid">PAID</span></div>
    <div class="amt">${esc(fmtCur(p.amount))}</div>
  </div>
  <div class="ft">
    This is a system-generated receipt — no signature required.<br/>
    StayBid · support@staybids.in · staybids.in
  </div>
  <script>setTimeout(function(){window.print();},250);<\/script>
</body></html>`);
  w.document.close();
}

export default function SubscriptionBillingModal({ onClose }: { onClose: () => void }) {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/partner/service-checkout", {
          headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Load failed");
        setPayments(Array.isArray(d.payments) ? d.payments : []);
      } catch (e: any) { setErr(e?.message || "Load failed"); }
      finally { setLoading(false); }
    })();
  }, []);

  const totalPaid = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <div>
            <p className="font-display text-lg text-luxury-900 inline-flex items-center gap-1.5" style={{ fontWeight: 500 }}><ReceiptText size={17} strokeWidth={2.2} aria-hidden />Subscription Billing</p>
            <p className="text-[0.66rem] text-luxury-500">Your service payments and receipts</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 flex items-center justify-center"><X size={16} strokeWidth={2.4} aria-hidden /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="text-center text-[0.78rem] text-luxury-500 py-6">Loading…</p>
          ) : err ? (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
          ) : payments.length === 0 ? (
            <div className="text-center py-6">
              <ReceiptText className="mx-auto mb-2 text-luxury-300" size={30} strokeWidth={1.8} aria-hidden />
              <p className="text-[0.8rem] font-bold text-luxury-900">No payments yet</p>
              <p className="text-[0.68rem] text-luxury-500 mt-1">
                When you activate a subscription service, its payment will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-xl px-3 py-2.5 mb-3 flex items-center justify-between bg-luxury-50 border border-luxury-200">
                <span className="text-[0.7rem] text-luxury-600">Total paid</span>
                <span className="text-[0.95rem] font-bold text-gold-700">{fmtCur(totalPaid)}</span>
              </div>
              <div className="space-y-2">
                {payments.map((p) => {
                  const paid = p.status === "paid";
                  return (
                    <div key={p.id} className="rounded-xl p-3 bg-luxury-50 border border-luxury-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[0.8rem] font-bold text-luxury-900 truncate">
                            {payTitle(p)} <span className="text-luxury-500 font-medium">· {PLAN_LABEL[p.plan] || p.plan}</span>
                          </p>
                          <p className="text-[0.63rem] text-luxury-500 truncate">{payServices(p)}</p>
                          <p className="text-[0.63rem] text-luxury-400 mt-0.5">{fmtDate(p.paid_at || p.created_at)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[0.86rem] font-bold text-gold-700">{fmtCur(p.amount)}</p>
                          <span className={`text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full ${
                            paid ? "bg-emerald-50 text-emerald-700" : p.status === "failed" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                            {paid ? "PAID" : String(p.status || "").toUpperCase()}
                          </span>
                        </div>
                      </div>
                      {paid && (
                        <button onClick={() => openReceipt(p)}
                          className="mt-2 w-full rounded-lg py-1.5 text-[0.68rem] font-bold text-white transition-all inline-flex items-center justify-center gap-1.5"
                          style={{ background: "#8198ae" }}>
                          <Printer size={13} strokeWidth={2.3} aria-hidden />View / print receipt
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost w-full">Close</button>
        </div>
      </div>
    </div>
  );
}
