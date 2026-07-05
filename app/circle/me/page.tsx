"use client";

// StayCircle™ — My Portfolio (Community Partner dashboard)
// Live KPIs (CountUp) + active bundles + monthly payout ledger (live ROI feed)
// + locked properties. Data: /api/circle/me (locks + bundles + payouts).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import { CIRCLE_PLANS, fmtINR, type PaymentPlanKey } from "@/lib/circle/engine";

export default function CircleMePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
  }, [user, authLoading, router]);

  const kpis = data?.kpis || {};
  const bundles: any[] = Array.isArray(data?.bundles) ? data.bundles : [];
  const payouts: any[] = Array.isArray(data?.payouts) ? data.payouts : [];
  const locks: any[] = Array.isArray(data?.locks) ? data.locks : [];

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
            <div className="sbc-hero-stat"><b><CountUp value={Number(kpis.totalPaidOut || 0)} prefix="₹" /></b><span>Returns Paid Out</span></div>
          </div>
        </div>
      </section>

      <section className="sbc-section" style={{ maxWidth: 900, paddingTop: "clamp(24px, 4vw, 40px)" }}>
        {loading ? (
          <div className="sbc-panel" style={{ padding: 40, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading your portfolio…</div>
        ) : (
          <div style={{ display: "grid", gap: 26 }}>

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
                            <b style={{ fontSize: "1.2rem", color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(b.monthly_total)}</b>
                            <div style={{ fontSize: ".68rem", color: "rgba(74,56,32,.55)" }}>/ month</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                          <span className="sbc-badge-roi">📈 {b.expected_roi_min}–{b.expected_roi_max}% ROI</span>
                          <span className="sbc-badge-occ">₹ {fmtINR(b.expected_monthly_income)} / mo expected</span>
                          <span className="sbc-badge-occ">⏳ Payback {b.payback_label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* -------- payouts (live ROI ledger) -------- */}
            <div>
              <h2 className="sbc-h2" style={{ fontSize: "1.5rem" }}>Monthly Returns</h2>
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
          </div>
        )}
      </section>
    </div>
  );
}
