"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LineChartProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div
        style={{
          background: "#151820",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 12px",
          color: "#E8EAF0",
          fontFamily: "DM Sans, sans-serif",
          fontSize: 13,
        }}
      >
        <div style={{ color: "#8A8FA8", marginBottom: 4 }}>{label}</div>
        <div style={{ fontWeight: 600 }}>{payload[0].value.toLocaleString()}</div>
      </div>
    );
  }
  return null;
};

export default function AdminLineChart({ data, color = "#D4AF37", height = 200 }: LineChartProps) {
  const chartData = data.map((d) => ({ name: d.label, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: "#8A8FA8", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#8A8FA8", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ fill: color, r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
