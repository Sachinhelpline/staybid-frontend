"use client";

// StayCircle™ — My Portfolio (Community Partner dashboard)
// Live KPIs (CountUp) + active bundles + monthly payout ledger (live ROI feed)
// + locked properties. Data: /api/circle/me (locks + bundles + payouts).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import {
  CIRCLE_PLANS, computeBundle, fmtINR,
  DEFAULT_CIRCLE_REVENUE, type CircleRevenueConfig, type PaymentPlanKey,
} from "@/lib/circle/engine";
import {
  CIRCLE_INCOME_DISCLOSURE, CIRCLE_PAYOUTS_LABEL,
  CIRCLE_RESALE_RISK_NOTE, CIRCLE_B2B_RESALE_NOTE,
} from "@/lib/circle/disclosure";

// v345 — M6: block/listing/trade status → tone pill (matches the partner tab).
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  owned:           { bg: "rgba(90,120,180,.16)", fg: "#3a5a94" },
  listed:          { bg: "rgba(127,146,105,.16)", fg: "#3F5233" },
  sold:            { bg: "rgba(127,146,105,.16)", fg: "#3F5233" },
  completed:       { bg: "rgba(127,146,105,.16)", fg: "#3F5233" },
  pending_payment: { bg: "rgba(201,166,107,.16)", fg: "var(--sbc-gold-deep)" },
  draft:           { bg: "rgba(74,56,32,.10)", fg: "var(--sbc-coffee)" },
  quoted:          { bg: "rgba(74,56,32,.10)", fg: "var(--sbc-coffee)" },
  withdrawn:       { bg: "rgba(74,56,32,.10)", fg: "rgba(74,56,32,.6)" },
  expired:         { bg: "rgba(74,56,32,.10)", fg: "rgba(74,56,32,.6)" },
  cancelled:       { bg: "rgba(212,149,131,.16)", fg: "#a85b4e" },
  refunded:        { bg: "rgba(212,149,131,.16)", fg: "#a85b4e" },
};
const tonePill = (status: string) => STATUS_TONE[status] || { bg: "rgba(74,56,32,.10)", fg: "var(--sbc-coffee)" };

export default function CircleMePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<any>(null);
  // v345 — M6: cross-model holdings (blocks + B2B + operated hotels + resale KPIs).
  const [portfolio, setPortfolio] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // v297.5 — recompute every bundle's ROI/income/payback LIVE from the same
  // unified engine + revConfig used by /circle home + /circle/build, so stored
  // (possibly old-formula) snapshot columns never diverge from what the wizard
  // shows. Fetch the admin-editable revenue levers exactly like the other pages.
  const [revConfig, setRevConfig] = useState<CircleRevenueConfig>(DEFAULT_CIRCLE_REVENUE);
  // v348 — Model 2 city access (₹999 one-time lifetime per city).
  const [cityAccess, setCityAccess] = useState<{ cities: string[]; price: number }>({ cities: [], price: 999 });
  const [newCity, setNewCity] = useState("");
  const [cityBusy, setCityBusy] = useState(false);
  const [cityMsg, setCityMsg] = useState("");
  // v351 — My Selling Inventory: copy a direct booking link per block.
  const [copiedId, setCopiedId] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      redirectToSignIn(router, { route: "/circle/me" });
      return;
    }
    const token = localStorage.getItem("sb_token") || "";
    fetch("/api/circle/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
    // v345 — M6: cross-model holdings (best-effort; never blocks the Model-1 view).
    fetch("/api/circle/portfolio", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setPortfolio)
      .catch(() => {});
    fetch("/api/circle/revenue-config")
      .then((r) => r.json())
      .then((d) => { if (d?.config) setRevConfig(d.config as CircleRevenueConfig); })
      .catch(() => {});
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d && Array.isArray(d.cities)) setCityAccess({ cities: d.cities, price: Number(d.price) || 999 }); })
      .catch(() => {});
  }, [user, authLoading, router]);

  // v348 — unlock a city (₹999 one-time). Server sets the amount; we open
  // Razorpay, then verify flips the access active (lifetime).
  async function unlockCity() {
    const city = newCity.trim();
    if (!city) { setCityMsg("Type a city to unlock."); return; }
    setCityBusy(true); setCityMsg("");
    try {
      const token = localStorage.getItem("sb_token") || "";
      const cr = await fetch("/api/circle/city-access", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ city }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (cr.ok && cd?.free) { setCityMsg(`${city} unlocked ✓`); setNewCity(""); refreshCities(token); return; }
      if (!cr.ok || !cd?.order?.id) { setCityMsg(cd?.error || "Couldn't start payment"); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({
          keyId: cd.keyId, orderId: cd.order.id, amountPaise: cd.order.amount,
          description: `Unlock ${city} · StayCircle Model 2`,
        });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setCityMsg("Payment cancelled"); return; }
        setCityMsg(e instanceof Error ? e.message : "Payment failed"); return;
      }

      const vr = await fetch("/api/circle/city-access/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ city, razorpay_order_id: cd.order.id, razorpay_payment_id: pay?.razorpay_payment_id, razorpay_signature: pay?.razorpay_signature }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { setCityMsg(vd?.error || "Verify failed — contact support"); return; }
      setCityMsg(`${city} unlocked ✓`); setNewCity(""); refreshCities(token);
    } catch { setCityMsg("Something went wrong"); }
    finally { setCityBusy(false); }
  }
  function refreshCities(token: string) {
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d && Array.isArray(d.cities)) setCityAccess({ cities: d.cities, price: Number(d.price) || 999 }); })
      .catch(() => {});
  }

  // v351 — Direct channel: copy a shareable booking link for a block's nights.
  function copyDirect(b: any) {
    try {
      const from = String(b.date_from).slice(0, 10);
      const to = String(b.date_to).slice(0, 10);
      const url = `${window.location.origin}/hotels/${b.hotel_id}?checkIn=${from}&checkOut=${to}`;
      navigator.clipboard?.writeText(url).then(() => { setCopiedId(b.id); setTimeout(() => setCopiedId(""), 1800); }).catch(() => {});
    } catch { /* clipboard unavailable */ }
  }

  const serverKpis = data?.kpis || {};
  const bundlesRaw: any[] = Array.isArray(data?.bundles) ? data.bundles : [];
  const payouts: any[] = Array.isArray(data?.payouts) ? data.payouts : [];
  const locks: any[] = Array.isArray(data?.locks) ? data.locks : [];

  // v345 — M6: cross-model holdings.
  const pfKpis = portfolio?.kpis || {};
  const blocks: any[] = Array.isArray(portfolio?.blocks) ? portfolio.blocks : [];
  const b2bListings: any[] = Array.isArray(portfolio?.listings) ? portfolio.listings : [];
  const asBuyer: any[] = Array.isArray(portfolio?.trades?.asBuyer) ? portfolio.trades.asBuyer : [];
  const asSeller: any[] = Array.isArray(portfolio?.trades?.asSeller) ? portfolio.trades.asSeller : [];
  const operatedHotels: any[] = Array.isArray(portfolio?.operatedHotels) ? portfolio.operatedHotels : [];
  const hasMarketplace =
    blocks.length > 0 || b2bListings.length > 0 || asBuyer.length > 0 || asSeller.length > 0 || operatedHotels.length > 0;

  // Live recompute per bundle — the SINGLE source of truth (computeBundle).
  const bundles = useMemo(
    () =>
      bundlesRaw.map((b) => {
        const items = Array.isArray(b.items) ? b.items : [];
        const plan = (b.payment_plan as PaymentPlanKey) || "monthly";
        const bd = computeBundle(items, plan, revConfig);
        return {
          ...b,
          _monthlyTotal: bd.ok ? bd.monthlyTotal : Number(b.monthly_total) || 0,
          _roiMin: bd.ok ? bd.expectedRoiMin : b.expected_roi_min,
          _roiMax: bd.ok ? bd.expectedRoiMax : b.expected_roi_max,
          _income: bd.ok ? bd.expectedMonthlyIncome : Number(b.expected_monthly_income) || 0,
          _payback: bd.ok ? bd.paybackLabel : b.payback_label,
        };
      }),
    [bundlesRaw, revConfig],
  );

  // KPI tiles recomputed from the SAME engine (active bundles only) so the hero
  // strip and each card agree. activeBundles count + totalPaidOut are engine-
  // independent, keep them from the server payload.
  const kpis = useMemo(() => {
    const active = bundles.filter((b) => b.status === "active");
    return {
      activeBundles: active.length,
      investedMonthly: active.reduce((s, b) => s + b._monthlyTotal, 0),
      expectedMonthlyIncome: active.reduce((s, b) => s + b._income, 0),
      totalPaidOut: Number(serverKpis.totalPaidOut || 0),
    };
  }, [bundles, serverKpis]);

  return (
    <div>
      <section className="sbc-hero" style={{ paddingBottom: 0 }}>
        <div className="sbc-hero-inner" style={{ maxWidth: 980, padding: "26px 20px 30px" }}>
          <span className="sbc-hero-eyebrow"><span className="dot" /> Community Partner Dashboard</span>
          <h1 className="sbc-hero-title" style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.4rem)", margin: "12px 0 6px" }}>
            My <span className="gold">Portfolio</span>
          </h1>
          <div className="sbc-hero-stats" style={{ marginTop: 18 }}>
            <div className="sbc-hero-stat"><b><CountUp value={Number(kpis.activeBundles || 0)} /></b><span>Active Bundles</span></div>
            <div className="sbc-hero-stat"><b><CountUp value={Number(kpis.investedMonthly || 0)} prefix="₹" /></b><span>Monthly Investment</span></div>
            <div className="sbc-hero-stat"><b><CountUp value={Number(kpis.expectedMonthlyIncome || 0)} prefix="₹" /></b><span>Expected Monthly Income</span></div>
            <div className="sbc-hero-stat"><b><CountUp value={Number(kpis.totalPaidOut || 0)} prefix="₹" /></b><span>Payouts Received</span></div>
          </div>
        </div>
      </section>

      <section className="sbc-section" style={{ maxWidth: 900, paddingTop: "clamp(24px, 4vw, 40px)" }}>
        {loading ? (
          <div className="sbc-panel" style={{ padding: 40, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading your portfolio…</div>
        ) : (
          <div style={{ display: "grid", gap: 26 }}>

            {/* -------- v348: Model 2 city access (₹999 one-time / city) -------- */}
            <div>
              <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>City Access <span style={{ fontSize: ".8rem", fontWeight: 500, opacity: .6 }}>· Model 2</span></h2>
              <p style={{ fontSize: ".72rem", lineHeight: 1.5, color: "rgba(74,56,32,.6)", margin: "4px 0 0" }}>
                Unlock a city once (₹{cityAccess.price} · lifetime) to buy &amp; resell inventory there on the Model 2 marketplace.
              </p>
              <div className="sbc-panel" style={{ padding: 16, marginTop: 12 }}>
                {cityAccess.cities.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                    {cityAccess.cities.map((c) => (
                      <span key={c} style={{ textTransform: "capitalize", fontSize: ".8rem", fontWeight: 700, padding: "5px 12px", borderRadius: 999, background: "rgba(127,146,105,.16)", color: "#3F5233" }}>
                        ✓ {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: ".85rem", color: "rgba(74,56,32,.6)", marginBottom: 12 }}>No cities unlocked yet.</div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <input value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="City to unlock (e.g. Manali)"
                    style={{ flex: "1 1 200px", minWidth: 0, borderRadius: 10, border: "1px solid rgba(139,105,20,.25)", padding: "9px 12px", fontSize: ".9rem", background: "#fff", color: "var(--sbc-ink)" }} />
                  <button disabled={cityBusy} onClick={unlockCity} className="sbc-btn-gold" style={{ whiteSpace: "nowrap" }}>
                    {cityBusy ? "…" : `Unlock · ₹${cityAccess.price}`}
                  </button>
                </div>
                {cityMsg && <div style={{ fontSize: ".78rem", marginTop: 8, color: "var(--sbc-gold-deep)" }}>{cityMsg}</div>}
              </div>
            </div>

            {/* -------- bundles -------- */}
            <div>
              <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>Investment Bundles</h2>
              {bundles.length === 0 ? (
                <div className="sbc-panel" style={{ padding: 30, textAlign: "center" }}>
                  <div style={{ fontSize: 30 }}>🧺</div>
                  <p style={{ marginTop: 6, color: "rgba(74,56,32,.7)" }}>Abhi koi bundle nahi — pehla bundle banao aur earning start karo.</p>
                  <Link href="/circle/build" className="sbc-btn-gold" style={{ marginTop: 14 }}>Build Your First Bundle →</Link>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                  {bundles.map((b) => {
                    const planName = CIRCLE_PLANS[b.payment_plan as PaymentPlanKey]?.name || b.payment_plan;
                    const items: any[] = Array.isArray(b.items) ? b.items : [];
                    const tone =
                      b.status === "active" ? { bg: "rgba(127,146,105,.14)", fg: "#3F5233", label: "● ACTIVE" } :
                      b.status === "pending_payment" ? { bg: "rgba(201,166,107,.16)", fg: "var(--sbc-gold-deep)", label: "◌ PAYMENT PENDING" } :
                      b.status === "completed" ? { bg: "rgba(74,56,32,.1)", fg: "var(--sbc-coffee)", label: "✓ COMPLETED" } :
                      { bg: "rgba(212,149,131,.16)", fg: "#a85b4e", label: "✕ CANCELLED" };
                    return (
                      <div key={b.id} className="sbc-panel" style={{ padding: 18 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                          <div>
                            <span style={{ fontSize: ".66rem", fontWeight: 800, letterSpacing: ".08em", padding: "4px 10px", borderRadius: 999, background: tone.bg, color: tone.fg }}>{tone.label}</span>
                            <div style={{ marginTop: 8, fontWeight: 700, color: "var(--sbc-coffee)" }}>
                              {items.map((it) => `${it.propertyTitle} · ${it.roomTypeName} ×${it.rooms}`).join("  +  ") || "Bundle"}
                            </div>
                            <div style={{ fontSize: ".74rem", color: "rgba(74,56,32,.6)", marginTop: 2 }}>
                              {planName} · started {new Date(b.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <b style={{ fontSize: "1.2rem", color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(b._monthlyTotal)}</b>
                            <div style={{ fontSize: ".68rem", color: "rgba(74,56,32,.55)" }}>/ month</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                          <span className="sbc-badge-roi">📈 {b._roiMin}–{b._roiMax}% ROI</span>
                          <span className="sbc-badge-occ">₹ {fmtINR(b._income)} / mo expected</span>
                          <span className="sbc-badge-occ">⏳ Payback {b._payback}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* -------- payouts (live revenue-share ledger) -------- */}
            <div>
              <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>{CIRCLE_PAYOUTS_LABEL}</h2>
              <p style={{ fontSize: ".68rem", lineHeight: 1.5, color: "rgba(74,56,32,.5)", margin: "4px 0 0" }}>
                {CIRCLE_INCOME_DISCLOSURE}
              </p>
              {payouts.length === 0 ? (
                <div className="sbc-panel" style={{ padding: 24, color: "rgba(74,56,32,.65)", fontSize: ".88rem" }}>
                  Pehla payout aapke bundle ke pehle complete month ke baad yahan dikhega. 💰
                </div>
              ) : (
                <div className="sbc-panel" style={{ padding: 8, marginTop: 12 }}>
                  {payouts.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid rgba(139,105,20,.1)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: ".9rem", color: "var(--sbc-coffee)" }}>{p.month_label}</div>
                        {p.note && <div style={{ fontSize: ".72rem", color: "rgba(74,56,32,.55)" }}>{p.note}</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <b style={{ color: p.status === "paid" ? "#3F5233" : "var(--sbc-gold-deep)", fontVariantNumeric: "tabular-nums" }}>+{fmtINR(p.amount)}</b>
                        <div style={{ fontSize: ".66rem", color: "rgba(74,56,32,.5)" }}>{p.status === "paid" ? "credited" : "pending"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* -------- locked properties -------- */}
            <div>
              <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>Locked Properties</h2>
              {locks.length === 0 ? (
                <div className="sbc-panel" style={{ padding: 24, color: "rgba(74,56,32,.65)", fontSize: ".88rem" }}>
                  Koi property locked nahi — <Link href="/circle" style={{ color: "var(--sbc-gold-deep)", fontWeight: 700 }}>Discover</Link> par explore karo.
                </div>
              ) : (
                <div className="sbc-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", marginTop: 12 }}>
                  {locks.map((l) => (
                    <div key={l.id} className="sbc-panel" style={{ padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", flexShrink: 0, background: "#241B10" }}>
                        {Array.isArray(l.property?.images) && l.property.images[0] && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.property.images[0]} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: ".88rem", color: "var(--sbc-coffee)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {l.property?.title || "Property"}
                        </div>
                        <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>📍 {l.property?.city} · {fmtINR(l.property?.monthly_rate || 0)}/mo</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <Link href="/circle/build" className="sbc-btn-gold">Build / Extend Bundle →</Link>
              </div>
            </div>

            {/* ═══ v345 — M6: Model 3/4 pre-buy + B2B exchange holdings ═══ */}
            {hasMarketplace && (
              <>
                {/* KPI strip — actuals only (never projected). */}
                <div>
                  <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>Pre-buy &amp; Exchange</h2>
                  <div className="sbc-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", marginTop: 12 }}>
                    <div className="sbc-panel" style={{ padding: 14 }}>
                      <b style={{ fontSize: "1.2rem", color: "var(--sbc-ink)" }}><CountUp value={Number(pfKpis.ownedBlocks || 0)} /></b>
                      <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>Owned blocks</div>
                    </div>
                    <div className="sbc-panel" style={{ padding: 14 }}>
                      <b style={{ fontSize: "1.2rem", color: "var(--sbc-ink)" }}><CountUp value={Number(pfKpis.activeListings || 0)} /></b>
                      <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>On the exchange</div>
                    </div>
                    <div className="sbc-panel" style={{ padding: 14 }}>
                      <b style={{ fontSize: "1.2rem", color: "var(--sbc-ink)" }}><CountUp value={Number(pfKpis.inventoryValue || 0)} prefix="₹" /></b>
                      <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>Inventory at cost</div>
                    </div>
                    <div className="sbc-panel" style={{ padding: 14 }}>
                      <b style={{ fontSize: "1.2rem", color: "#3F5233" }}><CountUp value={Number(pfKpis.b2bNetEarned || 0)} prefix="₹" /></b>
                      <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>Earned on exchange</div>
                    </div>
                  </div>
                </div>

                {/* v351 — My Selling Inventory (owned blocks) + sell-through channels. */}
                {blocks.length > 0 && (
                  <div>
                    <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>My Selling Inventory <span style={{ fontSize: ".8rem", fontWeight: 500, opacity: .6 }}>· Model 2</span></h2>
                    <p style={{ fontSize: ".72rem", lineHeight: 1.5, color: "rgba(74,56,32,.6)", margin: "4px 0 0" }}>
                      The room-nights you own — sell them <b>your way</b>: 🏠 on the StayBid guest feed, ⇄ on the B2B exchange, 🌐 through your own OTA listings (Channel Manager), or 🔗 a direct booking link you share.
                    </p>
                    <p style={{ fontSize: ".66rem", lineHeight: 1.5, color: "rgba(74,56,32,.5)", margin: "2px 0 0" }}>{CIRCLE_RESALE_RISK_NOTE}</p>
                    <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                      {blocks.map((b) => {
                        const t = tonePill(String(b.status));
                        const sellable = ["owned", "listed"].includes(String(b.status));
                        return (
                          <div key={b.id} className="sbc-panel" style={{ padding: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontSize: ".62rem", fontWeight: 800, letterSpacing: ".06em", padding: "3px 9px", borderRadius: 999, background: t.bg, color: t.fg, textTransform: "uppercase" }}>{String(b.status).replace(/_/g, " ")}</span>
                                <div style={{ marginTop: 6, fontWeight: 700, color: "var(--sbc-coffee)", fontSize: ".9rem" }}>
                                  {b.hotel_name || "Property"} {b.unit_number ? `· #${b.unit_number}` : ""}
                                </div>
                                <div style={{ fontSize: ".72rem", color: "rgba(74,56,32,.6)" }}>{b.date_from} → {b.date_to} · {b.nights}n</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <b style={{ color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(b.buy_total)}</b>
                                <div style={{ fontSize: ".66rem", color: "rgba(74,56,32,.55)" }}>at cost{b.resale_price_per_night ? ` · resale ${fmtINR(b.resale_price_per_night)}/n` : ""}</div>
                              </div>
                            </div>
                            {sellable && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                                <button onClick={() => copyDirect(b)}
                                  style={{ fontSize: ".72rem", fontWeight: 700, padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(139,105,20,.3)", background: "#fff", color: "var(--sbc-ink)", cursor: "pointer" }}>
                                  {copiedId === b.id ? "🔗 Copied!" : "🔗 Direct link"}
                                </button>
                                <Link href="/partner/dashboard"
                                  style={{ fontSize: ".72rem", fontWeight: 700, padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(139,105,20,.3)", background: "#fff", color: "var(--sbc-ink)" }}>
                                  🏠 Sell on StayBid / ⇄ exchange
                                </Link>
                                <Link href="/partner/dashboard?tab=channels"
                                  style={{ fontSize: ".72rem", fontWeight: 700, padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(139,105,20,.3)", background: "#fff", color: "var(--sbc-ink)" }}>
                                  🌐 Your OTA (Channel Manager)
                                </Link>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* B2B exchange — my listings + trades. */}
                {(b2bListings.length > 0 || asSeller.length > 0 || asBuyer.length > 0) && (
                  <div>
                    <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>B2B Exchange <span style={{ fontSize: ".8rem", fontWeight: 500, opacity: .6 }}>· Model 2</span></h2>
                    <p style={{ fontSize: ".68rem", lineHeight: 1.5, color: "rgba(74,56,32,.5)", margin: "4px 0 0" }}>{CIRCLE_B2B_RESALE_NOTE}</p>
                    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                      {b2bListings.map((l) => {
                        const t = tonePill(String(l.status));
                        const unit = l.unit_number ? `#${l.unit_number}` : (String(l.source) === "hotel_owner" ? "Own inventory" : "");
                        return (
                          <div key={`l-${l.id}`} className="sbc-panel" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: ".6rem", fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: "rgba(201,166,107,.16)", color: "var(--sbc-gold-deep)" }}>LISTING</span>
                              <span style={{ fontSize: ".6rem", fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: t.bg, color: t.fg, textTransform: "uppercase" }}>{String(l.status).replace(/_/g, " ")}</span>
                              <span style={{ fontSize: ".82rem", color: "var(--sbc-coffee)", fontWeight: 600 }}>{l.hotel_name || "Property"} {unit ? `· ${unit}` : ""}</span>
                              <span style={{ fontSize: ".72rem", color: "rgba(74,56,32,.6)" }}>{l.date_from}→{l.date_to} · {l.nights}n</span>
                            </div>
                            <b style={{ color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(l.ask_total)}</b>
                          </div>
                        );
                      })}
                      {asSeller.map((tr) => (
                        <div key={`s-${tr.id}`} className="sbc-panel" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: ".6rem", fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: "rgba(127,146,105,.16)", color: "#3F5233" }}>SOLD</span>
                            <span style={{ fontSize: ".82rem", color: "var(--sbc-coffee)", fontWeight: 600 }}>{tr.hotel_name || "Property"} {tr.unit_number ? `· #${tr.unit_number}` : ""}</span>
                            <span style={{ fontSize: ".72rem", color: "rgba(74,56,32,.6)" }}>{tr.date_from}→{tr.date_to} · {tr.nights}n</span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <b style={{ color: "#3F5233", fontVariantNumeric: "tabular-nums" }}>+{fmtINR(tr.seller_net)}</b>
                            <div style={{ fontSize: ".64rem", color: "rgba(74,56,32,.5)" }}>{tr.status === "completed" ? "you received" : "pending"}</div>
                          </div>
                        </div>
                      ))}
                      {asBuyer.map((tr) => (
                        <div key={`b-${tr.id}`} className="sbc-panel" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: ".6rem", fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: "rgba(90,120,180,.16)", color: "#3a5a94" }}>BOUGHT</span>
                            <span style={{ fontSize: ".82rem", color: "var(--sbc-coffee)", fontWeight: 600 }}>{tr.hotel_name || "Property"} {tr.unit_number ? `· #${tr.unit_number}` : ""}</span>
                            <span style={{ fontSize: ".72rem", color: "rgba(74,56,32,.6)" }}>{tr.date_from}→{tr.date_to} · {tr.nights}n</span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <b style={{ color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(tr.ask_total)}</b>
                            <div style={{ fontSize: ".64rem", color: "rgba(74,56,32,.5)" }}>{tr.status === "completed" ? "paid" : "pending"}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dashboard access — operated hotels the investor can manage. */}
                {operatedHotels.length > 0 && (
                  <div>
                    <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>Dashboard Access</h2>
                    <p style={{ fontSize: ".68rem", lineHeight: 1.5, color: "rgba(74,56,32,.5)", margin: "4px 0 0" }}>
                      Hotels where you hold rooms — manage inventory, pricing &amp; bookings from the partner panel.
                    </p>
                    <div className="sbc-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", marginTop: 12 }}>
                      {operatedHotels.map((h) => (
                        <Link key={h.id} href="/partner/dashboard" className="sbc-panel" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textDecoration: "none" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: ".9rem", color: "var(--sbc-coffee)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</div>
                            <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>{h.unitCount} room{h.unitCount === 1 ? "" : "s"}</div>
                          </div>
                          <span style={{ color: "var(--sbc-gold-deep)", fontWeight: 800, fontSize: ".82rem", flexShrink: 0 }}>Manage →</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        )}
      </section>
    </div>
  );
}
