"use client";
// v100 — Premium bar chart with vertical gradient + hover glow.

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface BarChartProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  /** Optional prefix in tooltip — defaults to "₹". */
  prefix?: string;
}

function CustomTooltip({ active, payload, label, prefix }: any) {
  if (active && payload?.length) {
    const v = payload[0].value;
    return (
      <div
        style={{
          background: "#0F1117",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          padding: "10px 14px",
          color: "#E8EAF0",
          fontFamily: "DM Sans, sans-serif",
          fontSize: 13,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ color: "#8A8FA8", marginBottom: 4, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontWeight: 700, fontFamily: "Syne, sans-serif", fontSize: 15 }}>
          {prefix ?? "₹"}{typeof v === "number" ? v.toLocaleString("en-IN") : v}
        </div>
      </div>
    );
  }
  return null;
}

export default function AdminBarChart({ data, color = "#3D9CF5", height = 200, prefix }: BarChartProps) {
  const chartData = data.map((d) => ({ name: d.label, value: d.value }));
  const safeColor = (color || "#3D9CF5").replace(/[^a-z0-9]/gi, "");
  const gradId = `bc-grad-${safeColor}`;
  // v103 — fingerprint to force remount + re-animate on data change
  const dataKeyHash = chartData.reduce((h, p, i) => h + ((Number(p.value) || 0) * (i + 1)), 0);

  return (
    <ResponsiveContainer width="100%" height={height} key={dataKeyHash}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 5 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.95} />
            <stop offset="100%" stopColor={color} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "#8A8FA8", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#8A8FA8", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip prefix={prefix} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar
          dataKey="value"
          fill={`url(#${gradId})`}
          radius={[6, 6, 0, 0]}
          isAnimationActive
          animationDuration={650}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
