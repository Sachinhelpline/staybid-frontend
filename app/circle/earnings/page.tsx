"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — Earnings & payouts  (v294.19, Phase 5)
//
// Circle's OWN income screen — COMPLETELY SEPARATE from the hotel-partner
// panel and creator commission earnings. Reads /api/circle/me, which returns
// KPIs + the circle_payouts ledger for THIS investor only. The dashboard row
// "Earnings & payouts" used to jump into /circle/me (the portfolio view); it
// now lands here on a clean payouts-first screen.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fmtINR } from "@/lib/circle/engine";

type Payout = {
  id: string;
  month_label?: string | null;
  amount?: number | null;
  note?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type Kpis = {
  activeBundles?: number;
  investedMonthly?: number;
  expectedMonthlyIncome?: number;
  totalPaidOut?: number;
  lockedProperties?: number;
};

export default function CircleEarningsPage() {
  const { user } = useAuth();

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [projected, setProjected] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const token = localStorage.getItem("sb_token");
    if (!token) { setLoading(false); return; }
    fetch("/api/circle/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setKpis(d?.kpis || null);
        setPayouts(Array.isArray(d?.payouts) ? d.payouts : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Read-only projection from real confirmed bookings (S1 — never a money write).
    fetch("/api/circle/projected-earnings", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d && !d.error) setProjected(d); })
      .catch(() => {});
  }, [user]);

  const totalPaid = Number(kpis?.totalPaidOut || 0);
  const pendingTotal = payouts
    .filter((p) => (p.status || "").toLowerCase() !== "paid")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div className="sbc-dash">
      <header className="sbc-dash-head">
        <Link href="/circle/dashboard" className="sbc-dash-back" aria-label="Back">←</Link>
        <span className="sbc-dash-title">Earnings &amp; payouts</span>
        <span style={{ width: 34 }} />
      </header>

      {!user ? (
        <section className="sbc-dash-profile" style={{ justifyContent: "space-between" }}>
          <div className="sbc-dash-who"><b>Sign in to see earnings</b><span>Track your monthly StayCircle income.</span></div>
          <Link href="/auth" className="sbc-dash-edit gold">Sign in</Link>
        </section>
      ) : (
        <>
          {/* total paid out — the headline */}
          <section className="sbc-earn-hero">
            <span className="sbc-earn-hero-k">Total paid out</span>
            <b className="sbc-earn-hero-v">{loading ? "…" : fmtINR(totalPaid)}</b>
            <span className="sbc-earn-hero-sub">Your lifetime StayCircle payouts, credited to your account.</span>
          </section>

          {/* KPI strip */}
          <div className="sbc-earn-kpis">
            <div className="sbc-earn-kpi">
              <span className="sbc-earn-kpi-k">Est. / month</span>
              <b className="sbc-earn-kpi-v">{loading ? "…" : fmtINR(Number(kpis?.expectedMonthlyIncome || 0))}</b>
            </div>
            <div className="sbc-earn-kpi">
              <span className="sbc-earn-kpi-k">Invested / mo</span>
              <b className="sbc-earn-kpi-v">{loading ? "…" : fmtINR(Number(kpis?.investedMonthly || 0))}</b>
            </div>
            <div className="sbc-earn-kpi">
              <span className="sbc-earn-kpi-k">Properties</span>
              <b className="sbc-earn-kpi-v">{loading ? "…" : Number(kpis?.lockedProperties || 0)}</b>
            </div>
          </div>

          {pendingTotal > 0 && (
            <div className="sbc-earn-note">
              <span style={{ fontSize: "1rem" }}>⏳</span>
              <span><b>{fmtINR(pendingTotal)}</b> pending — will be credited on the next payout cycle.</span>
            </div>
          )}

          {/* Projected from live bookings — READ-ONLY preview (S1). No money recorded. */}
          {projected && Number(projected.bookingCount) > 0 && (
            <section style={{ marginTop: 14, border: "1px solid rgba(139,105,20,.22)", borderRadius: 16, overflow: "hidden", background: "linear-gradient(160deg,#fffdf7,#fbf4e6)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "13px 15px 0" }}>
                <div style={{ fontWeight: 800, color: "var(--sbc-coffee)", fontSize: ".95rem" }}>📈 Projected from your live bookings</div>
                <span style={{ fontSize: ".62rem", fontWeight: 800, color: "#a9791f", background: "rgba(201,166,107,.16)", padding: "3px 9px", borderRadius: 999 }}>PREVIEW</span>
              </div>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "8px 15px 4px" }}>
                <div><div style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".05em", color: "rgba(74,56,32,.55)" }}>PROJECTED NET</div><b style={{ fontSize: "1.35rem", color: "#047857" }}>{fmtINR(Number(projected.projectedNetOwed) || 0)}</b></div>
                <div><div style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".05em", color: "rgba(74,56,32,.55)" }}>GROSS</div><b style={{ fontSize: "1.35rem", color: "var(--sbc-coffee)" }}>{fmtINR(Number(projected.projectedGross) || 0)}</b></div>
                <div><div style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".05em", color: "rgba(74,56,32,.55)" }}>BOOKINGS · NIGHTS</div><b style={{ fontSize: "1.35rem", color: "var(--sbc-coffee)" }}>{Number(projected.bookingCount) || 0} · {Number(projected.nightsCount) || 0}</b></div>
              </div>
              <div style={{ display: "grid", gap: 6, padding: "6px 15px 4px" }}>
                {(projected.items || []).slice(0, 6).map((it: any) => (
                  <div key={it.bookingId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: ".78rem", color: "rgba(74,56,32,.85)" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.hotelName} · {it.checkIn} → {it.checkOut} · {it.nights}n</span>
                    <b style={{ color: "#047857", whiteSpace: "nowrap" }}>{fmtINR(Number(it.net) || 0)}</b>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: ".64rem", lineHeight: 1.5, color: "rgba(74,56,32,.6)", margin: 0, padding: "8px 15px 13px" }}>
                Illustrative at a {Number(projected.feePct) || 12}% platform fee — the committed fee and actual payout are set in the settlement phase. <b>Nothing has been recorded or paid yet.</b>
              </p>
            </section>
          )}

          <p className="sbc-earn-note" style={{ marginTop: 12 }}>
            <span style={{ fontSize: "1rem" }}>🔒</span>
            <span>This is your <b>StayCircle investment income</b>. It is completely separate from any hotel-partner or creator earnings.</span>
          </p>

          {/* payout ledger */}
          <section className="sbc-dash-sec">
            <div className="sbc-dash-sec-h">Payout history</div>
            {loading ? (
              <div className="sbc-earn-empty"><span className="sbc-earn-empty-ic">⌛</span><b>Loading…</b></div>
            ) : payouts.length === 0 ? (
              <div className="sbc-earn-empty">
                <span className="sbc-earn-empty-ic">🌱</span>
                <b>No payouts yet</b>
                <span>Once your locked properties start earning, monthly payouts appear here.</span>
              </div>
            ) : (
              <div className="sbc-earn-list">
                {payouts.map((p) => {
                  const isPaid = (p.status || "").toLowerCase() === "paid";
                  return (
                    <div key={p.id} className="sbc-earn-row">
                      <span className="sbc-earn-row-ic">{isPaid ? "💰" : "⏳"}</span>
                      <div className="sbc-earn-row-main">
                        <b>{p.month_label || "Payout"}</b>
                        {p.note ? <span>{p.note}</span> : null}
                      </div>
                      <div className="sbc-earn-row-amt">
                        <b>{fmtINR(Number(p.amount) || 0)}</b>
                        <span className={`sbc-earn-status ${isPaid ? "paid" : "pending"}`}>{isPaid ? "Paid" : "Pending"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
