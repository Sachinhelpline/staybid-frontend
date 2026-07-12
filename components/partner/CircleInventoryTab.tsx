"use client";

// v327 — Circle Phase C1: Model 3 "Pre-buy Inventory" (foundation UI).
//
// A Circle investor who owns physical rooms can take commercial control of a
// DATE RANGE of an owned room: get a live Pricing-Spine quote (wholesale buy +
// suggested retail + their margin) and save it as a DRAFT block. Purchase +
// resale-listing land in C2/C3 — shown here as clearly-labelled "coming next"
// so the surface is honest and inert.
//
// Reads/writes /api/circle/inventory (owner-scoped server-side). Mounted under
// the "My Rooms" operator tab, below CircleUnitsTab.

import { useCallback, useEffect, useMemo, useState } from "react";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

type Unit = { id: string; hotelId: string; roomId: string; roomNumber?: string | null; title?: string | null };
type Block = {
  id: string; unit_id: string; room_id: string; date_from: string; date_to: string;
  nights: number; buy_price_per_night?: number | null; buy_total?: number | null;
  resale_price_per_night?: number | null; platform_fee_pct?: number | null; status: string;
  unit_number?: string | null; hotel_name?: string | null;
};
type Quote = {
  nights: number; buyTotal: number; avgBuyPerNight: number; suggestedResaleTotal: number;
  avgResalePerNight: number; feePct: number; estFeeOnSuggested: number; estInvestorNetOnSuggested: number;
};
type AtResale = { resaleTotal: number; feeTotal: number; buyTotal: number; investorNet: number };

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  quoted: "bg-slate-100 text-slate-600",
  pending_payment: "bg-amber-100 text-amber-700",
  owned: "bg-blue-100 text-blue-700",
  listed: "bg-emerald-100 text-emerald-700",
  sold: "bg-emerald-100 text-emerald-700",
  expired: "bg-slate-100 text-slate-400",
  cancelled: "bg-rose-100 text-rose-600",
  refunded: "bg-rose-100 text-rose-600",
};

export default function CircleInventoryTab({
  hotelId,
  initialUnits,
}: {
  hotelId: string;
  initialUnits?: Unit[];
}) {
  const units = useMemo(
    () => (initialUnits || []).filter((u) => String(u.hotelId) === String(hotelId)),
    [initialUnits, hotelId],
  );
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [unitId, setUnitId] = useState<string>(units[0]?.id || "");
  const [from, setFrom] = useState<string>(todayISO());
  const [to, setTo] = useState<string>("");
  const [resale, setResale] = useState<string>("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [atResale, setAtResale] = useState<AtResale | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => { if (!unitId && units[0]) setUnitId(units[0].id); }, [units, unitId]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const loadBlocks = useCallback(async () => {
    const token = getToken();
    if (!token || !hotelId) return;
    try {
      const r = await fetch(`/api/circle/inventory?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d.blocks)) setBlocks(d.blocks);
    } catch { /* ignore */ }
  }, [hotelId]);

  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  async function getQuote() {
    if (!unitId || !from || !to || to <= from) { flash("Pick a room and a valid date range."); return; }
    setBusy(true); setQuote(null); setAtResale(null);
    try {
      const r = await fetch(`/api/circle/inventory/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ unitId, from, to, resalePricePerNight: Number(resale) || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Quote failed"); return; }
      setQuote(d.quote || null);
      setAtResale(d.atResale || null);
    } catch { flash("Quote failed"); }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!unitId || !from || !to || to <= from) { flash("Pick a room and a valid date range."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/circle/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ unitId, from, to, resalePricePerNight: Number(resale) || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Save failed"); return; }
      flash("Draft block saved");
      setQuote(null); setAtResale(null); setResale("");
      loadBlocks();
    } catch { flash("Save failed"); }
    finally { setBusy(false); }
  }

  // v328 — C2: buy the room-nights. Server re-quotes + freezes the buy, creates
  // a Razorpay order (client never sets the amount), we open checkout, then
  // verify flips the block to `owned` + writes the inventory hold.
  async function buyNights(b: Block) {
    setBusy(true);
    try {
      const token = getToken();
      const cr = await fetch(`/api/circle/inventory/${encodeURIComponent(b.id)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { flash(cd?.error || "Couldn't start payment"); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({
          keyId: cd.keyId,
          orderId: cd.order.id,
          amountPaise: cd.order.amount,
          description: `Pre-buy ${b.nights} night${b.nights === 1 ? "" : "s"} · ${b.date_from}→${b.date_to}`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { flash("Payment cancelled"); return; }
        flash(e instanceof Error ? e.message : "Payment failed");
        return;
      }

      const vr = await fetch(`/api/circle/inventory/${encodeURIComponent(b.id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          razorpay_order_id: cd.order.id,
          razorpay_payment_id: pay?.razorpay_payment_id,
          razorpay_signature: pay?.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { flash(vd?.error || "Payment verify failed — contact support"); return; }
      flash(vd.held === false ? "Bought — hold syncing…" : "Room-nights secured ✓");
      loadBlocks();
    } catch { flash("Purchase failed"); }
    finally { setBusy(false); }
  }

  async function del(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/circle/inventory?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash(d?.error || "Delete failed"); return; }
      setBlocks((b) => b.filter((x) => x.id !== id));
    } catch { flash("Delete failed"); }
    finally { setBusy(false); }
  }

  if (!units.length) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed p-6 text-sm text-slate-500"
           style={{ borderColor: "var(--border-soft)" }}>
        Pre-buy Inventory (Model 3) becomes available once you own rooms on this hotel.
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="mb-3">
        <h3 className="text-base font-semibold" style={{ color: "var(--text-base)" }}>
          🧾 Pre-buy Inventory <span className="text-xs font-normal opacity-60">· Model 3</span>
        </h3>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          Buy specific room-nights wholesale, set your own resale price, keep the margin. Quote &amp; buy
          now — <b>resale-listing on the guest feed arrives next</b>.
        </p>
      </div>

      {/* Quote builder */}
      <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-xs">
            <span className="block mb-1 opacity-70">Room</span>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>#{u.roomNumber || u.id}{u.title ? ` · ${u.title}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block mb-1 opacity-70">From</span>
            <input type="date" value={from} min={todayISO()} onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
          </label>
          <label className="text-xs">
            <span className="block mb-1 opacity-70">To</span>
            <input type="date" value={to} min={from || todayISO()} onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
          </label>
          <label className="text-xs">
            <span className="block mb-1 opacity-70">Your resale /night (optional)</span>
            <input type="number" min={0} value={resale} onChange={(e) => setResale(e.target.value)}
              placeholder="auto" className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--border-soft)" }} />
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={getQuote}
            className="rounded-lg px-3 py-1.5 text-sm font-medium border sb-card-lift"
            style={{ borderColor: "var(--border-strong)" }}>
            {busy ? "…" : "Get quote"}
          </button>
          <button disabled={busy} onClick={saveDraft}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}>
            Save as draft
          </button>
        </div>

        {quote && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label={`Buy (${quote.nights} nights)`} value={inr(quote.buyTotal)} sub={`${inr(quote.avgBuyPerNight)}/night wholesale`} />
            <Stat label="Suggested resale" value={inr(quote.suggestedResaleTotal)} sub={`${inr(quote.avgResalePerNight)}/night`} />
            <Stat label={`Platform fee ${quote.feePct}%`} value={inr(quote.estFeeOnSuggested)} sub="on resale" />
            <Stat label="Est. your margin" value={inr(quote.estInvestorNetOnSuggested)} sub="resale − fee − buy" accent />
          </div>
        )}
        {atResale && (
          <div className="mt-2 text-xs rounded-lg px-3 py-2" style={{ background: "var(--accent-soft)", color: "var(--text-soft)" }}>
            At <b>{inr(Number(resale))}/night</b>: resale {inr(atResale.resaleTotal)} − fee {inr(atResale.feeTotal)} − buy {inr(atResale.buyTotal)} = <b>{inr(atResale.investorNet)} net</b>
          </div>
        )}
      </div>

      {/* Existing blocks */}
      <div className="mt-5">
        <div className="text-xs font-medium mb-2 opacity-70">Your inventory blocks</div>
        {blocks.length === 0 ? (
          <div className="text-sm opacity-60">No blocks yet.</div>
        ) : (
          <div className="space-y-2">
            {blocks.map((b) => (
              <div key={b.id} className="rounded-xl border p-3 flex items-center gap-3 flex-wrap"
                style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[b.status] || "bg-slate-100 text-slate-600"}`}>
                  {b.status.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text-base)" }}>
                  #{b.unit_number || b.unit_id}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {b.date_from} → {b.date_to} · {b.nights}n
                </span>
                <span className="text-xs" style={{ color: "var(--text-soft)" }}>
                  buy {inr(b.buy_total)}{b.resale_price_per_night ? ` · resale ${inr(b.resale_price_per_night)}/n` : ""}
                </span>
                <div className="ml-auto flex gap-2">
                  {["draft", "quoted"].includes(b.status) && (
                    <>
                      <button disabled={busy} onClick={() => buyNights(b)}
                        className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                        style={{ background: "var(--accent)" }}>
                        Buy nights · {inr(b.buy_total)}
                      </button>
                      <button disabled={busy} onClick={() => del(b.id)}
                        className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: "var(--border-soft)" }}>
                        Delete
                      </button>
                    </>
                  )}
                  {b.status === "pending_payment" && (
                    <button disabled={busy} onClick={() => buyNights(b)}
                      className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white"
                      style={{ background: "var(--accent)" }}>
                      Complete payment
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm text-white"
          style={{ background: "var(--text-base)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--border-soft)" }}>
      <div className="text-[11px] opacity-60">{label}</div>
      <div className="text-base font-semibold" style={{ color: accent ? "var(--accent)" : "var(--text-base)" }}>{value}</div>
      {sub && <div className="text-[10px] opacity-50">{sub}</div>}
    </div>
  );
}
