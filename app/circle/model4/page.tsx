"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /circle/model4 — Investor Exchange marketplace (v342 · Phase M3).
//
// Model 4 = a members-only B2B exchange: an investor lists pre-bought
// room-nights at their own ask; ANOTHER investor buys them and resells (or
// keeps) them. M3 turns the M0 honest-supply shell into the real 3-step
// marketplace, mirroring the M1 Model-3 journey so all three investor flows
// render the SAME CircleStepShell and look identical:
//   1 Choose      — browse every live listing on the exchange → pick one
//   2 Select      — review the fixed date-range + frozen ask (no re-pricing)
//   3 Build & Pay — Razorpay → the block transfers to you
//
// Browse feed is public/auth-optional (`/api/circle/model4/listings`, own
// listings excluded when signed in). The BUY chain is the D2 engine verbatim:
//   /api/b2b/listings/[id]/checkout  (auth · re-quotes the frozen ask · order)
//   /api/b2b/listings/[id]/verify    (HMAC · transfers the block · settlement)
// The ask + fee are FROZEN at list time — the buyer never sets ₹, and preview
// == charge == settlement.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CircleStepShell from "@/components/circle/CircleStepShell";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type Split = {
  nights: number;
  askTotal: number;
  platformFeePct: number;
  platformFee: number;
  sellerNet: number;
  sellerMargin: number;
};
type Listing = {
  id: string;
  block_id: string;
  hotel_id: string;
  hotel_name: string | null;
  hotel_city: string;
  unit_id: string;
  unit_number: string | null;
  room_id: string;
  date_from: string;
  date_to: string;
  nights: number;
  ask_per_night: number;
  ask_total: number;
  buy_total: number;
  platform_fee_pct: number;
  split: Split;
};

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const fmtDate = (iso: string) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return iso; }
};

export default function Model4Page() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — browse
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<string>("all");
  const [sel, setSel] = useState<Listing | null>(null);

  // Step 3 — pay
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState("");
  const [done, setDone] = useState<{ from: string; to: string; askTotal: number } | null>(null);

  const mounted = useRef(true);
  const flash = (m: string) => { setToast(m); setTimeout(() => { if (mounted.current) setToast(""); }, 2800); };

  // ── browse feed (auth-optional; excludes your own listings when signed in) ──
  const loadFeed = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      const t = token();
      if (t) headers.Authorization = `Bearer ${t}`;
      const r = await fetch("/api/circle/model4/listings", { cache: "no-store", headers });
      const d = await r.json().catch(() => ({}));
      if (mounted.current) setListings(Array.isArray(d.listings) ? d.listings : []);
    } catch { /* ignore */ }
    finally { if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadFeed();
    return () => { mounted.current = false; };
  }, [loadFeed]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    listings.forEach((l) => { if (l.hotel_city) s.add(l.hotel_city); });
    return Array.from(s).sort();
  }, [listings]);

  const shown = useMemo(
    () => (city === "all" ? listings : listings.filter((l) => l.hotel_city === city)),
    [listings, city],
  );

  // ── step transitions ────────────────────────────────────────────────────────
  const pickListing = (l: Listing) => { setSel(l); setStep(2); };

  async function pay() {
    if (!sel) return;
    if (!token()) {
      flash("Please sign in to buy on the exchange.");
      setTimeout(() => router.push("/auth"), 900);
      return;
    }
    setPaying(true);
    try {
      const cr = await fetch(`/api/b2b/listings/${encodeURIComponent(sel.id)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id || !cd?.tradeId) {
        flash(cd?.error || "Couldn't start the trade.");
        return;
      }

      let rp: any;
      try {
        rp = await openRazorpayForOrder({
          keyId: cd.keyId,
          orderId: cd.order.id,
          amountPaise: cd.order.amount,
          description: `${sel.hotel_name || "Exchange block"} · ${sel.date_from}→${sel.date_to} (${sel.nights}n)`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { flash("Payment cancelled"); return; }
        flash(e instanceof Error ? e.message : "Payment failed");
        return;
      }

      const vr = await fetch(`/api/b2b/listings/${encodeURIComponent(sel.id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          razorpay_order_id: cd.order.id,
          razorpay_payment_id: rp?.razorpay_payment_id,
          razorpay_signature: rp?.razorpay_signature,
        }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { flash(vd?.error || "Verify failed — contact support"); return; }
      setDone({ from: sel.date_from, to: sel.date_to, askTotal: Number(cd.askTotal) || sel.split.askTotal });
    } catch {
      flash("Trade failed — try again.");
    } finally {
      if (mounted.current) setPaying(false);
    }
  }

  // ── step titles ─────────────────────────────────────────────────────────────
  const titles: Record<1 | 2 | 3, { t: string; s: string }> = {
    1: { t: "Pick a block from the exchange", s: "Live listings from other investors — pre-bought room-nights at their ask price. Buy the block and it transfers to you to resell (or keep). Investors only · B2B wholesale." },
    2: { t: "Review this block", s: "The date range and ask are fixed by the seller's listing. This is what you pay to take over the block." },
    3: { t: "Confirm & pay", s: "Server re-checks the seller's frozen ask at pay time and transfers the block to you automatically." },
  };

  return (
    <CircleStepShell
      model="Model 2"
      tag="Inventory Bundle · Exchange"
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
              <div className="sbc-ms-empty-ic">⇄</div>
              <div className="sbc-ms-empty-h">The exchange is opening soon</div>
              <p className="sbc-ms-empty-p">
                No live listings yet. Once investors start pre-buying inventory, they can list
                it here for other members to buy.
              </p>
              <a href="/circle/model2" className="sbc-ms-cta">Explore Model 2 pre-buy →</a>
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
                {shown.map((l) => (
                  <div key={l.id} className="sbc-mkt-card">
                    <div className="sbc-mkt-card-body">
                      <div className="sbc-mkt-card-name">{l.hotel_name || "Exchange block"}</div>
                      <div className="sbc-mkt-card-meta">
                        📍 {l.hotel_city || "—"}{l.unit_number ? ` · Unit ${l.unit_number}` : ""}
                      </div>
                      <div className="sbc-mkt-card-from">
                        {fmtDate(l.date_from)} → {fmtDate(l.date_to)}<span> · {l.nights} night{l.nights === 1 ? "" : "s"}</span>
                      </div>

                      <div className="sbc-mkt-quote" style={{ marginTop: 10 }}>
                        <div className="sbc-mkt-qrow">
                          <span>Ask / night</span>
                          <span>{inr(l.ask_per_night)}</span>
                        </div>
                        <div className="sbc-mkt-qrow sbc-mkt-qtotal">
                          <span>You pay</span>
                          <span>{inr(l.split.askTotal)}</span>
                        </div>
                      </div>

                      <button className="sbc-mkt-btn" style={{ marginTop: 10, width: "100%" }} onClick={() => pickListing(l)}>
                        Review →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="sbc-ms-note">
                Investors only · B2B wholesale exchange. Once you own a block you may resell it — resale income
                depends on actual bookings and is never guaranteed.
              </p>
            </>
          )}
        </>
      )}

      {/* ── STEP 2 · REVIEW LISTING ─────────────────────────────────────────── */}
      {step === 2 && sel && (
        <>
          <div className="sbc-mkt-panel">
            <div className="sbc-mkt-selhead">
              <div>
                <div className="sbc-mkt-card-name">{sel.hotel_name || "Exchange block"}</div>
                <div className="sbc-mkt-card-meta">
                  📍 {sel.hotel_city || "—"}{sel.unit_number ? ` · Unit ${sel.unit_number}` : ""}
                </div>
              </div>
              <button className="sbc-mkt-btn-ghost" onClick={() => { setStep(1); setSel(null); }}>
                ← Change
              </button>
            </div>

            <div className="sbc-mkt-quote">
              <div className="sbc-mkt-qrow"><span>Dates</span><span>{sel.date_from} → {sel.date_to}</span></div>
              <div className="sbc-mkt-qrow"><span>Nights</span><span>{sel.nights}</span></div>
              <div className="sbc-mkt-qrow"><span>Ask / night</span><span>{inr(sel.ask_per_night)}</span></div>
              <div className="sbc-mkt-qrow sbc-mkt-qtotal"><span>You pay</span><span>{inr(sel.split.askTotal)}</span></div>
              <div className="sbc-mkt-qrow sbc-mkt-qmuted">
                <span>Platform fee</span>
                <span>{sel.split.platformFeePct}% (from the seller&apos;s side)</span>
              </div>
            </div>
          </div>

          <div className="sbc-mkt-actions">
            <button className="sbc-mkt-btn-ghost" onClick={() => { setStep(1); setSel(null); }}>← Back</button>
            <button className="sbc-mkt-btn" onClick={() => setStep(3)}>Confirm →</button>
          </div>
          <p className="sbc-ms-note">
            The block transfers to you on payment — you become its owner and may list it for resale. Resale
            income depends on actual bookings — never guaranteed.
          </p>
        </>
      )}

      {/* ── STEP 3 · CONFIRM & PAY ──────────────────────────────────────────── */}
      {step === 3 && sel && (
        <>
          <div className="sbc-mkt-panel">
            <div className="sbc-mkt-card-name">{sel.hotel_name || "Exchange block"}</div>
            <div className="sbc-mkt-card-meta">
              📍 {sel.hotel_city || "—"}{sel.unit_number ? ` · Unit ${sel.unit_number}` : ""}
            </div>
            <div className="sbc-mkt-rev">
              <div className="sbc-mkt-qrow"><span>Dates</span><span>{sel.date_from} → {sel.date_to}</span></div>
              <div className="sbc-mkt-qrow"><span>Nights</span><span>{sel.nights}</span></div>
              <div className="sbc-mkt-qrow"><span>Ask / night</span><span>{inr(sel.ask_per_night)}</span></div>
              <div className="sbc-mkt-qrow sbc-mkt-qtotal"><span>You pay now</span><span>{inr(sel.split.askTotal)}</span></div>
            </div>
          </div>

          <div className="sbc-mkt-actions">
            <button className="sbc-mkt-btn-ghost" disabled={paying} onClick={() => setStep(2)}>← Back</button>
            <button className="sbc-mkt-btn" disabled={paying} onClick={pay}>
              {paying ? "Processing…" : `Pay ${inr(sel.split.askTotal)} & take over`}
            </button>
          </div>
          <p className="sbc-ms-note">
            Server re-checks the seller&apos;s frozen ask at pay time — the amount above is indicative. The block
            transfers to you automatically on payment. Resale income depends on actual bookings — never guaranteed.
          </p>
        </>
      )}

      {/* ── SUCCESS ─────────────────────────────────────────────────────────── */}
      {done && (
        <div className="sbc-mkt-success" onClick={() => { setDone(null); router.push("/partner/dashboard"); }}>
          <div className="sbc-mkt-success-card" onClick={(e) => e.stopPropagation()}>
            <div className="sbc-mkt-success-ic">🎉</div>
            <div className="sbc-mkt-success-h">Block acquired!</div>
            <p className="sbc-mkt-success-p">
              {done.from} → {done.to} · {inr(done.askTotal)} paid. The block is now in your Circle inventory —
              list it for resale from your dashboard whenever you like.
            </p>
            <button className="sbc-ms-cta" onClick={() => router.push("/partner/dashboard")}>
              Go to my inventory →
            </button>
            <button
              className="sbc-mkt-btn-ghost" style={{ marginTop: 8 }}
              onClick={() => { setDone(null); setStep(1); setSel(null); loadFeed(); }}
            >
              Buy another
            </button>
          </div>
        </div>
      )}

      {toast && <div className="sbc-mkt-toast">{toast}</div>}
    </CircleStepShell>
  );
}
