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
