"use client";
// v102 — Premium pie/donut with radial gradient slices + hover scale +
// smooth entry animation. Backward compatible signature.
import { useState } from "react";
import { PieChart, Pie as PieRaw, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from "recharts";
// recharts type version in this worktree doesn't expose activeIndex on PieProps.
// Cast to any so the runtime prop still passes through (works at runtime).
const Pie: any = PieRaw;

interface PieChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  /** Render as donut (default) or solid pie. */
  donut?: boolean;
}

const COLORS = ["#2ECC71", "#FF4757", "#9fb1c2", "#3D9CF5", "#A855F7"];

function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        style={{ filter: `drop-shadow(0 0 10px ${fill})` }}
      />
      {/* Center label */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#E8EAF0" style={{ fontFamily: "Syne, sans-serif", fontSize: 18, fontWeight: 700 }}>
        {(percent * 100).toFixed(0)}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#8A8FA8" style={{ fontFamily: "DM Sans, sans-serif", fontSize: 11, letterSpacing: 0.5 }}>
        {payload.name?.toUpperCase()}
      </text>
    </g>
  );
}

export default function AdminPieChart({ data, height = 220, donut = true }: PieChartProps) {
  const chartData = data.map((d, i) => ({
    name: d.label,
    value: d.value,
    color: d.color || COLORS[i % COLORS.length],
  }));
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  // v103 — fingerprint to force remount + re-animate on data change
  const dataKeyHash = chartData.reduce((h, p, i) => h + ((Number(p.value) || 0) * (i + 1)), 0);

  return (
    <ResponsiveContainer width="100%" height={height} key={dataKeyHash}>
      <PieChart>
        <defs>
          {chartData.map((d, i) => (
            <radialGradient key={i} id={`pie-grad-${i}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={d.color} stopOpacity={1} />
              <stop offset="100%" stopColor={d.color} stopOpacity={0.65} />
            </radialGradient>
          ))}
        </defs>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={donut ? 52 : 0}
          outerRadius={80}
          dataKey="value"
          strokeWidth={2}
          stroke="#0F1117"
          paddingAngle={1.5}
          activeIndex={activeIndex}
          activeShape={renderActiveShape}
          onMouseEnter={(_: any, i: number) => setActiveIndex(i)}
          onMouseLeave={() => setActiveIndex(undefined)}
          isAnimationActive
          animationDuration={650}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={`url(#pie-grad-${i})`} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "#0F1117",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            color: "#E8EAF0",
            fontFamily: "DM Sans, sans-serif",
            fontSize: 13,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontFamily: "DM Sans, sans-serif", fontSize: 12, color: "#8A8FA8" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
