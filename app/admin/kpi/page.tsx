"use client";
// v584 — DECK KPI SCORECARD. The owner's "Execution Roadmap, KPIs & Scale
// Blueprint" sheet as a live target-vs-actual board: every number derived
// from the real tables by /api/admin/kpi (admin-gated). Un-instrumented
// KPIs show an honest "—" with the reason, never an invented figure.

import { useEffect, useState } from "react";

type Kpi = {
  key: string; label: string; actual: number | null; unit: string;
  target: string; status: "ok" | "low" | "na"; note?: string;
};
type Payload = {
  days: number;
  totals: { leads: number; bookings: number; paidBookings: number; bids: number };
  kpis: Kpi[];
};

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  ok:  { label: "ON TRACK",   color: "#7fe0a7", bg: "rgba(37,211,102,0.10)" },
  low: { label: "BELOW GOAL", color: "#ffb36b", bg: "rgba(255,140,60,0.10)" },
  na:  { label: "TRACKING",   color: "#899eb3", bg: "rgba(176, 192, 209,0.08)" },
};

function fmt(k: Kpi): string {
  if (k.actual == null) return "—";
  if (k.unit === "₹") return `₹${Number(k.actual).toLocaleString("en-IN")}`;
  return `${Number(k.actual).toLocaleString("en-IN")}${k.unit ? ` ${k.unit}` : ""}`.trim();
}

export default function AdminKpiPage() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setErr(null);
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
    fetch(`/api/admin/kpi?days=${days}`, { headers: { "x-admin-token": tok } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (!dead) setData(j); })
      .catch((e) => { if (!dead) setErr(String(e?.message || e)); });
    return () => { dead = true; };
  }, [days]);

  return (
    <div style={{ padding: "26px 22px 60px", maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontStyle: "italic", fontSize: "1.9rem", color: "#e5eaef", margin: 0 }}>
            📊 KPI Scorecard
          </h1>
          <p style={{ fontSize: "0.78rem", color: "rgba(176, 192, 209,0.6)", margin: "4px 0 0" }}>
            The growth-plan targets vs live actuals — computed from real bid requests, bookings and bids.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 90, 180].map((d) => (
            <button
              key={d} type="button" onClick={() => setDays(d)}
              style={{
                cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, padding: "7px 13px",
                borderRadius: 999, border: "1px solid rgba(176, 192, 209,0.35)",
                background: days === d ? "linear-gradient(140deg,#e5eaef,#bdc9d5 44%,#8ca1b5)" : "rgba(176, 192, 209,0.08)",
                color: days === d ? "#3a2606" : "#eaedf1",
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <p style={{ marginTop: 26, color: "#ffb36b", fontSize: "0.85rem" }}>
          Could not load KPIs ({err}). Sign in on /admin first.
        </p>
      ) : !data ? (
        <p style={{ marginTop: 26, color: "rgba(176, 192, 209,0.6)", fontSize: "0.85rem" }}>Loading…</p>
      ) : (
        <>
          <p style={{ margin: "18px 0 14px", fontSize: "0.72rem", color: "rgba(176, 192, 209,0.55)" }}>
            Window: last {data.days} days · {data.totals.leads.toLocaleString("en-IN")} bid requests ·{" "}
            {data.totals.paidBookings.toLocaleString("en-IN")} paid bookings · {data.totals.bids.toLocaleString("en-IN")} bids
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
            {data.kpis.map((k) => {
              const st = STATUS[k.status] || STATUS.na;
              return (
                <div
                  key={k.key}
                  style={{
                    borderRadius: 16, padding: "14px 15px",
                    background: "linear-gradient(150deg,#26190e,#382a1c 60%,#26190e)",
                    border: "1px solid rgba(176, 192, 209,0.3)",
                    boxShadow: "inset 0 1px 0 rgba(176, 192, 209,0.14), 0 10px 22px -14px rgba(0,0,0,0.8)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.05em", color: "rgba(176, 192, 209,0.65)", textTransform: "uppercase" }}>
                      {k.label}
                    </span>
                    <span style={{ fontSize: "0.54rem", fontWeight: 800, letterSpacing: "0.06em", color: st.color, background: st.bg, border: `1px solid ${st.color}44`, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>
                      {st.label}
                    </span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: "1.65rem", fontWeight: 800, color: "#f1f4f6", fontVariantNumeric: "tabular-nums" }}>
                    {fmt(k)}
                  </div>
                  <div style={{ marginTop: 5, fontSize: "0.66rem", color: "rgba(176, 192, 209,0.75)" }}>
                    Target: {k.target}
                  </div>
                  {k.note ? (
                    <div style={{ marginTop: 6, fontSize: "0.6rem", color: "rgba(176, 192, 209,0.5)" }}>{k.note}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p style={{ marginTop: 18, fontSize: "0.62rem", color: "rgba(176, 192, 209,0.45)" }}>
            Targets from the growth plan. "Below goal" is expected pre-launch — the board exists so the trend is visible from day one.
          </p>
        </>
      )}
    </div>
  );
}
