"use client";
// v100 — Premium line chart with gradient area + smoother stroke + glow.
//
// API unchanged from v95-era so every existing call-site continues to
// work. The only new visuals are an Area gradient under the line and
// the active-dot glow on hover.

import {
  Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface LineChartProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  /** Optional Y-axis prefix like "₹". Default: none. */
  prefix?: string;
}

function CustomTooltip({ active, payload, label, prefix }: any) {
  if (active && payload && payload.length) {
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
        <div style={{ color: "#8A8FA8", marginBottom: 4, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
          {label}
        </div>
        <div style={{ fontWeight: 700, fontFamily: "Syne, sans-serif", fontSize: 15 }}>
          {prefix || ""}{typeof v === "number" ? v.toLocaleString("en-IN") : v}
        </div>
      </div>
    );
  }
  return null;
}

export default function AdminLineChart({ data, color = "#D4AF37", height = 200, prefix }: LineChartProps) {
  const chartData = data.map((d) => ({ name: d.label, value: d.value }));
  const safeColor = (color || "#D4AF37").replace(/[^a-z0-9]/gi, "");
  const gradId = `lc-area-${safeColor}`;
  // v103 — key derived from a small fingerprint of the data forces a remount
  // when values change, so recharts replays the entry animation rather than
  // teleporting points to their new positions.
  const dataKeyHash = chartData.reduce((h, p, i) => h + ((Number(p.value) || 0) * (i + 1)), 0);

  return (
    <ResponsiveContainer width="100%" height={height} key={dataKeyHash}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 5 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={color} stopOpacity={0.36} />
            <stop offset="60%" stopColor={color} stopOpacity={0.10} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "#8A8FA8", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#8A8FA8", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip prefix={prefix} />} cursor={{ stroke: color + "44", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="none"
          fill={`url(#${gradId})`}
          fillOpacity={1}
          isAnimationActive
          animationDuration={650}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.2}
          dot={{ fill: color, r: 3, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: color, stroke: "#fff", strokeWidth: 2, filter: `drop-shadow(0 0 6px ${color})` }}
          isAnimationActive
          animationDuration={700}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
