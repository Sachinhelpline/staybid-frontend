"use client";
// Admin → Bidding Analytics. Single-page dashboard summarising the
// bid lifecycle metrics introduced in phases 1-7: acceptance rates,
// auto-accept hit rate, hold conversion, revenue by flow, daily trend.

import { useEffect, useState } from "react";
import AdminLineChart from "@/components/admin/charts/line-chart";
import AdminBarChart from "@/components/admin/charts/bar-chart";
import AdminPieChart from "@/components/admin/charts/pie-chart";
import KpiCardShared from "@/components/admin/kpi-card";
import { LivePill, useAutoPoll } from "@/components/admin/live-ticker";

type Kpis = {
  totalBids: number;
  accepted: number; countered: number; rejected: number; pending: number;
  acceptRate: number; counterRate: number; autoAcceptHit: number;
  scheduledBids: number; autoAccepted: number;
  holds: { total: number; completed: number; expired: number; active: number; conversion: number; lockedNow: number; payAtHotelCount: number };
  windows: { total: number; paid: number; expired: number; active: number; payRate: number };
  revenueTotal: number;
  revenueByFlow: Record<string, number>;
  avgTimeToAcceptMs: number;
  // v94 — source attribution
  bookingsBySource?: Record<string, number>;
  revenueBySource?: Record<string, number>;
  totalCommission?: number;
  attributedCount?: number;
};

// v94 — source style for the admin breakdown panel
const SOURCE_STYLE_ADMIN: Record<string, { icon: string; label: string; color: string }> = {
  direct:        { icon: "🔗", label: "Direct",      color: "#3D9CF5" },
  creator:       { icon: "✨", label: "Creator",     color: "#A855F7" },
  "hotel-feed":  { icon: "🏨", label: "Hotel reel",  color: "#9fb1c2" },
  flash:         { icon: "⚡", label: "Flash deal",  color: "#FF4757" },
  unknown:       { icon: "•",  label: "Unknown",     color: "#8A8FA8" },
};

const TIER_COLORS: Record<string, string> = {
  PREMIUM: "#10b981",
  STRONG: "#22c55e",
  NORMAL: "#a4b5c5",
  CAUTIOUS: "#f59e0b",
  LOWBALL: "#ef4444",
  NEW: "#3b82f6",
  UNKNOWN: "#6b7280",
};

export default function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true); setErr("");
    fetch(`/api/admin/analytics/bidding?days=${days}`)
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(String(d.error)); else setData(d); })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);
  // v126.2 — auto-poll every 15s while tab is visible
  const { lastAt, refresh } = useAutoPoll(load, 15_000);

  const k: Kpis | null = data?.kpis || null;
  const tierCounts: Record<string, number> = data?.tierCounts || {};
  const dailyTrend: { date: string; placed: number; accepted: number; countered: number }[] = data?.dailyTrend || [];
  const topHotels: { hotelId: string; name: string; city?: string; placed: number; accepted: number; rate: number }[] = data?.topHotels || [];
  // v94 — top creators by attributed GMV
  const topCreators: { handle: string; bookings: number; gmv: number; commission: number }[] = data?.topCreators || [];

  const fmtMs = (ms: number) => {
    if (!ms) return "—";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    return `${h} h`;
  };

  return (
    <div style={{ padding: "24px 28px", fontFamily: "DM Sans, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, color: "#E8EAF0", margin: 0 }}>
              📊 Bidding Analytics
            </h1>
            <LivePill lastRefreshAt={lastAt} refreshNow={refresh} />
          </div>
          <p style={{ color: "#8A8FA8", fontSize: 12, margin: "6px 0 0" }}>
            Lifecycle metrics · acceptance rate · auto-accept hit · hold conversion · revenue
          </p>
        </div>
        {/* Range picker — v126.2 added Today (1d) tab */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { d: 1,  label: "Today" },
            { d: 7,  label: "7d" },
            { d: 30, label: "30d" },
            { d: 90, label: "90d" },
          ].map((opt) => (
            <button key={opt.d} onClick={() => setDays(opt.d)}
              style={{
                padding: "6px 14px", borderRadius: 999,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "1px solid",
                ...(days === opt.d
                  ? { background: "linear-gradient(135deg,#9fb1c2,#c6d0da)", color: "#0F1117", borderColor: "transparent" }
                  : { background: "rgba(255,255,255,0.04)", color: "#8A8FA8", borderColor: "rgba(255,255,255,0.1)" }),
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
          {err}
        </div>
      )}

      {loading && !data ? (
        <div style={{ color: "#8A8FA8", padding: 40 }}>Loading analytics…</div>
      ) : k ? (
        <>
          {/* Hero KPIs — v102: now shared <KpiCard> with CountUp + live pulse +
              sparklines from the daily trend series. Mobile auto-shrinks to 2-col. */}
          <div className="admin-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            <KpiCardShared
              title="Bids placed"
              value={k.totalBids || 0}
              sub={`${days}d`} icon="🎯" color="#9fb1c2" live
              sparkline={dailyTrend.map((d: any) => d.placed)}
            />
            <KpiCardShared
              title="Accept rate"
              value={k.acceptRate || 0}
              format={(n) => `${Math.round(n)}%`}
              sub={`${k.accepted} accepted`} icon="✅" color="#2ECC71" live
            />
            <KpiCardShared
              title="Auto-accept hit"
              value={k.autoAcceptHit || 0}
              format={(n) => `${Math.round(n)}%`}
              sub={`${k.autoAccepted} of ${k.scheduledBids} scheduled`} icon="⚡" color="#3D9CF5" live
            />
            <KpiCardShared
              title="Hold conversion"
              value={k.holds?.conversion || 0}
              format={(n) => `${Math.round(n)}%`}
              sub={`${k.holds?.completed || 0}/${k.holds?.total || 0} paid balance`} icon="🔒" color="#A855F7" live
            />
            <KpiCardShared
              title="Revenue"
              value={k.revenueTotal || 0}
              format={(n) => "₹" + Math.round(n).toLocaleString("en-IN")}
              sub="paid amounts" icon="💰" color="#c6d0da" live
            />
            <KpiCardShared
              title="Avg time-to-accept"
              value={fmtMs(k.avgTimeToAcceptMs)}
              sub="placed → auto-accepted" icon="⏱" color="#F59E0B" live
            />
          </div>

          {/* Daily trend chart */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 20 }} className="analytics-grid">
            <Panel title="Daily bid trend" subtitle="placed · accepted · countered">
              <div style={{ height: 280 }}>
                <AdminLineChart
                  data={dailyTrend.map((d) => ({ label: d.date.slice(5), value: d.placed }))}
                  color="#9fb1c2"
                  height={280}
                />
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#8A8FA8", marginTop: 8 }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: "#9fb1c2", marginRight: 5 }} />Placed</span>
                <span>·  Accepted: <strong style={{ color: "#2ECC71" }}>{k.accepted}</strong></span>
                <span>·  Countered: <strong style={{ color: "#f59e0b" }}>{k.countered}</strong></span>
                <span>·  Rejected: <strong style={{ color: "#ef4444" }}>{k.rejected}</strong></span>
              </div>
            </Panel>

            {/* Bidder tier distribution */}
            <Panel title="Bidder tier distribution" subtitle="cached at bid time">
              <div style={{ display: "grid", gap: 8 }}>
                {Object.entries(tierCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([tier, count]) => {
                    const max = Math.max(...Object.values(tierCounts), 1);
                    const pct = (count / max) * 100;
                    const color = TIER_COLORS[tier] || "#6b7280";
                    return (
                      <div key={tier}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{tier}</span>
                          <span style={{ color: "#8A8FA8" }}>{count}</span>
                        </div>
                        <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s ease" }} />
                        </div>
                      </div>
                    );
                  })}
                {Object.keys(tierCounts).length === 0 && (
                  <p style={{ color: "#8A8FA8", fontSize: 12, textAlign: "center", padding: 18 }}>No tier data yet.</p>
                )}
              </div>
            </Panel>
          </div>

          {/* Hold + window stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }} className="analytics-grid">
            <Panel title="Hold lifecycle" subtitle={`₹${k.holds.lockedNow.toLocaleString("en-IN")} locked right now`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                <MiniStat label="Total holds"   value={k.holds.total}     color="#9fb1c2" />
                <MiniStat label="Active"         value={k.holds.active}    color="#2ECC71" />
                <MiniStat label="Completed"      value={k.holds.completed} color="#A855F7" />
                <MiniStat label="Expired"        value={k.holds.expired}   color="#EF4444" />
                <MiniStat label="Pay-at-hotel"   value={k.holds.payAtHotelCount} color="#3D9CF5" />
                <MiniStat label="Conversion %"   value={`${k.holds.conversion}%`} color="#c6d0da" />
              </div>
            </Panel>

            <Panel title="Acceptance windows" subtitle="15-min-to-pay timer">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                <MiniStat label="Total windows" value={k.windows.total}    color="#9fb1c2" />
                <MiniStat label="Active"         value={k.windows.active}  color="#2ECC71" />
                <MiniStat label="Paid"           value={k.windows.paid}    color="#A855F7" />
                <MiniStat label="Expired"        value={k.windows.expired} color="#EF4444" />
                <MiniStat label="Pay rate"       value={`${k.windows.payRate}%`} color="#c6d0da" />
              </div>
            </Panel>
          </div>

          {/* Revenue by flow */}
          <Panel title="Revenue by booking flow" subtitle="sum of paid amounts">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {Object.entries(k.revenueByFlow)
                .sort(([, a], [, b]) => b - a)
                .map(([flow, amt]) => (
                  <div key={flow} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 12 }}>
                    <p style={{ color: "#8A8FA8", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>{flow}</p>
                    <p style={{ color: "#9fb1c2", fontSize: 18, fontWeight: 700, margin: "4px 0 0", fontFamily: "Syne, sans-serif" }}>
                      ₹{amt.toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              {Object.keys(k.revenueByFlow).length === 0 && (
                <p style={{ color: "#8A8FA8", fontSize: 12, padding: 18 }}>No revenue data yet.</p>
              )}
            </div>
          </Panel>

          {/* v94 — Source attribution breakdown */}
          <Panel title="Bookings by source" subtitle={`${k.attributedCount || 0} of ${k.totalBids} bids attributed · commission ₹${(k.totalCommission || 0).toLocaleString("en-IN")}`}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="analytics-grid">
              <div>
                <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 600, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>By count</p>
                <div style={{ display: "grid", gap: 8 }}>
                  {Object.entries(k.bookingsBySource || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([src, count]) => {
                      const meta = SOURCE_STYLE_ADMIN[src] || SOURCE_STYLE_ADMIN.unknown;
                      const max  = Math.max(...Object.values(k.bookingsBySource || { x: 1 }), 1);
                      const pct  = (count / max) * 100;
                      return (
                        <div key={src}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                            <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{meta.icon} {meta.label}</span>
                            <span style={{ color: "#8A8FA8" }}>{count}</span>
                          </div>
                          <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: meta.color, transition: "width 0.5s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  {Object.keys(k.bookingsBySource || {}).length === 0 && (
                    <p style={{ color: "#8A8FA8", fontSize: 12, padding: 18, textAlign: "center" }}>No attribution data yet.</p>
                  )}
                </div>
              </div>
              <div>
                <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 600, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>By revenue</p>
                <div style={{ display: "grid", gap: 8 }}>
                  {Object.entries(k.revenueBySource || {})
                    .sort(([, a], [, b]) => b - a)
                    .map(([src, amt]) => {
                      const meta = SOURCE_STYLE_ADMIN[src] || SOURCE_STYLE_ADMIN.unknown;
                      return (
                        <div key={src} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${meta.color}33`, borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#E8EAF0", fontSize: 12, fontWeight: 600 }}>{meta.icon} {meta.label}</span>
                          <span style={{ color: meta.color, fontSize: 13, fontWeight: 700 }}>₹{(amt || 0).toLocaleString("en-IN")}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </Panel>

          {/* v94 — Top creators by attributed GMV */}
          {topCreators.length > 0 && (
            <Panel title="Top creators by attributed GMV" subtitle="Bookings driven by creator reels">
              <div style={{ display: "grid", gap: 6 }}>
                {topCreators.map((c, i) => (
                  <div key={c.handle} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12 }}>
                    <span style={{ color: "#8A8FA8", fontWeight: 700, minWidth: 22 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: "#E8EAF0", margin: 0, fontWeight: 600 }}>✨ @{c.handle}</p>
                      <p style={{ color: "#8A8FA8", margin: 0, fontSize: 11 }}>{c.bookings} booking{c.bookings === 1 ? "" : "s"}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ color: "#A855F7", margin: 0, fontWeight: 700 }}>₹{Math.round(c.gmv).toLocaleString("en-IN")}</p>
                      <p style={{ color: "#8A8FA8", margin: 0, fontSize: 11 }}>Comm ₹{Math.round(c.commission).toLocaleString("en-IN")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Top hotels */}
          <Panel title="Top hotels by acceptance rate" subtitle="minimum 3 bids placed">
            {topHotels.length === 0 ? (
              <p style={{ color: "#8A8FA8", fontSize: 12, padding: 18 }}>No hotel data yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {topHotels.map((h, i) => (
                  <div key={h.hotelId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12 }}>
                    <span style={{ color: "#8A8FA8", fontWeight: 700, minWidth: 22 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: "#E8EAF0", margin: 0, fontWeight: 600 }}>{h.name}</p>
                      {h.city && <p style={{ color: "#8A8FA8", margin: 0, fontSize: 11 }}>{h.city}</p>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ color: "#9fb1c2", margin: 0, fontWeight: 700 }}>{h.rate}%</p>
                      <p style={{ color: "#8A8FA8", margin: 0, fontSize: 11 }}>{h.accepted}/{h.placed} bids</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      ) : null}

      <style jsx>{`
        @media (max-width: 760px) {
          :global(.analytics-grid) { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{
      background: "#151820",
      border: `1px solid ${color}33`,
      borderRadius: 12, padding: 14,
    }}>
      <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>{label}</p>
      <p style={{ color, fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "Syne, sans-serif" }}>{value}</p>
      {sub && <p style={{ color: "#666876", fontSize: 11, margin: "2px 0 0" }}>{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 10 }}>
      <p style={{ color: "#8A8FA8", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>{label}</p>
      <p style={{ color, fontSize: 18, fontWeight: 700, margin: "4px 0 0", fontFamily: "Syne, sans-serif" }}>{value}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <p style={{ color: "#E8EAF0", fontSize: 14, fontWeight: 700, margin: 0 }}>{title}</p>
        {subtitle && <p style={{ color: "#8A8FA8", fontSize: 11, margin: "2px 0 0" }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
