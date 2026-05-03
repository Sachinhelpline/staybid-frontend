"use client";
import { useEffect, useState } from "react";
import KpiCard from "@/components/admin/kpi-card";
import AdminLineChart from "@/components/admin/charts/line-chart";

const inr = (n: number) => "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function AdminRevenuePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/revenue")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const k = data?.kpi || {};

  return (
    <div style={{ padding: 24, color: "#E8EAF0", fontFamily: "DM Sans, sans-serif" }}>
      <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 700, color: "#E8EAF0", margin: 0 }}>Revenue</h1>
      <p style={{ color: "#8A8FA8", fontSize: 14, marginTop: 4, marginBottom: 22 }}>
        Top-line gross from accepted bids · commissions · loyalty liability
      </p>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#8A8FA8" }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
            <KpiCard title="Gross All-time"   value={inr(k.grossAllTime)} icon="💰" />
            <KpiCard title="Gross This Month" value={inr(k.grossMTD)}     icon="📈" />
            <KpiCard title="Gross Last 30d"   value={inr(k.gross30)}      icon="🗓️" />
            <KpiCard title="Accepted Bids"    value={String(k.acceptedBids || 0)} icon="🎯" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
            <KpiCard title="Commission Paid"     value={inr(k.commissionPaid)}    icon="✅" />
            <KpiCard title="Commission Pending"  value={inr(k.commissionPending)} icon="⏳" />
            <KpiCard title="Points Outstanding"  value={(k.pointsOutstanding || 0).toLocaleString("en-IN")} icon="⭐" />
          </div>

          <div style={{ background: "#151820", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", padding: 18 }}>
            <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 16, fontWeight: 700, color: "#D4AF37", margin: 0, marginBottom: 12 }}>
              Gross — Last 30 Days
            </h2>
            <AdminLineChart
              data={(data?.series || []).map((s: any) => ({ label: s.date.slice(5), value: s.gross }))}
              color="#D4AF37"
            />
          </div>
        </>
      )}
    </div>
  );
}
