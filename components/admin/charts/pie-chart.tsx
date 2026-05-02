"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface PieChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}

const COLORS = ["#2ECC71", "#FF4757", "#D4AF37", "#3D9CF5", "#A855F7"];

export default function AdminPieChart({ data, height = 200 }: PieChartProps) {
  const chartData = data.map((d) => ({ name: d.label, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={chartData} cx="50%" cy="45%" outerRadius={65} dataKey="value" strokeWidth={0}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={data[i]?.color || COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "#151820",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#E8EAF0",
            fontFamily: "DM Sans, sans-serif",
            fontSize: 13,
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
