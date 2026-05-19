"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type Metrics = {
  range: { days: number; since: string };
  summary: {
    total: number;
    aiOnlyResolved: number;
    humanTouched: number;
    resolved: number;
    aiDeflectionRate: number;
    resolutionRate: number;
    avgResolutionMs: number;
    messagesUserTotal: number;
    messagesAITotal: number;
    messagesAgentTotal: number;
  };
  queueDepth: { ai: number; queue: number; agent: number };
  dailyCounts: Array<{ date: string; total: number; resolved: number; escalated: number }>;
  topReasons: Array<{ reason: string; count: number }>;
  agents: Array<{ id: string; name: string; taken: number; resolved: number; messages: number }>;
};

function adminHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("sb_admin_token") || "";
  const user = JSON.parse(localStorage.getItem("sb_admin_user") || "{}");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (user?.id) h["x-admin-id"] = user.id;
  if (user?.phone) h["x-admin-phone"] = user.phone;
  if (user?.name) h["x-admin-name"] = user.name;
  return h;
}

export default function SupportMetricsPage() {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/support/metrics?days=${days}`, { headers: adminHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setData(j))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>
            <Link href="/admin/support" style={styles.backLink}>← Support Inbox</Link>
          </div>
          <h1 style={styles.title}>Support Metrics</h1>
          <div style={styles.subtitle}>AI deflection · response times · agent activity</div>
        </div>
        <div style={styles.rangeTabs}>
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              style={{
                ...styles.rangeTab,
                ...(days === d ? styles.rangeTabActive : {}),
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {loading || !data ? (
        <div style={styles.loading}>Loading metrics…</div>
      ) : (
        <div style={styles.body}>
          <section style={styles.kpiGrid}>
            <Kpi
              label="Conversations"
              value={data.summary.total}
              sub={`last ${days} days`}
            />
            <Kpi
              label="AI deflected"
              value={`${Math.round(data.summary.aiDeflectionRate * 100)}%`}
              sub={`${data.summary.aiOnlyResolved} of ${data.summary.total}`}
              accent="#D4AF37"
            />
            <Kpi
              label="Human-touched"
              value={data.summary.humanTouched}
              sub={`${
                data.summary.total > 0
                  ? Math.round((data.summary.humanTouched / data.summary.total) * 100)
                  : 0
              }% of total`}
              accent="#FF4757"
            />
            <Kpi
              label="Resolution rate"
              value={`${Math.round(data.summary.resolutionRate * 100)}%`}
              sub={`${data.summary.resolved} resolved`}
              accent="#2ECC71"
            />
            <Kpi
              label="Avg resolution"
              value={formatDuration(data.summary.avgResolutionMs)}
              sub="from first message"
            />
            <Kpi
              label="Live queue"
              value={data.queueDepth.queue}
              sub={`${data.queueDepth.ai} AI · ${data.queueDepth.agent} agent active`}
              accent="#F0B429"
            />
          </section>

          <section style={styles.chartCard}>
            <h2 style={styles.chartTitle}>Conversations per day</h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.dailyCounts} margin={{ top: 10, right: 14, bottom: 10, left: -10 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#8A8FA8"
                  tickFormatter={(d) => d.slice(5)}
                  fontSize={11}
                />
                <YAxis stroke="#8A8FA8" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  labelStyle={{ color: "#E8EAF0" }}
                />
                <Line type="monotone" dataKey="total" name="Total" stroke="#D4AF37" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#2ECC71" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="escalated" name="Escalated" stroke="#FF4757" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <section style={styles.twoCol}>
            <div style={styles.chartCard}>
              <h2 style={styles.chartTitle}>AI vs Human messages</h2>
              <div style={styles.ratioBars}>
                <RatioBar
                  label="Customer"
                  value={data.summary.messagesUserTotal}
                  total={
                    data.summary.messagesUserTotal +
                    data.summary.messagesAITotal +
                    data.summary.messagesAgentTotal
                  }
                  color="#82B2DD"
                />
                <RatioBar
                  label="AI"
                  value={data.summary.messagesAITotal}
                  total={
                    data.summary.messagesUserTotal +
                    data.summary.messagesAITotal +
                    data.summary.messagesAgentTotal
                  }
                  color="#D4AF37"
                />
                <RatioBar
                  label="Agent"
                  value={data.summary.messagesAgentTotal}
                  total={
                    data.summary.messagesUserTotal +
                    data.summary.messagesAITotal +
                    data.summary.messagesAgentTotal
                  }
                  color="#7F9269"
                />
              </div>
            </div>

            <div style={styles.chartCard}>
              <h2 style={styles.chartTitle}>Top escalation reasons</h2>
              {data.topReasons.length === 0 ? (
                <div style={styles.empty}>No escalations in this window</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.topReasons} layout="vertical" margin={{ top: 0, right: 14, bottom: 0, left: 70 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="#8A8FA8" fontSize={11} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="reason"
                      stroke="#8A8FA8"
                      fontSize={11}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    />
                    <Bar dataKey="count" fill="#D4AF37" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section style={styles.chartCard}>
            <h2 style={styles.chartTitle}>Agent activity</h2>
            {data.agents.length === 0 ? (
              <div style={styles.empty}>No agent activity in this window</div>
            ) : (
              <table style={styles.agentTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Agent</th>
                    <th style={styles.thRight}>Taken</th>
                    <th style={styles.thRight}>Resolved</th>
                    <th style={styles.thRight}>Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.id}>
                      <td style={styles.td}>{a.name}</td>
                      <td style={styles.tdRight}>{a.taken}</td>
                      <td style={styles.tdRight}>{a.resolved}</td>
                      <td style={styles.tdRight}>{a.messages}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub: string;
  accent?: string;
}) {
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: accent || "#E8EAF0" }}>{value}</div>
      <div style={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function RatioBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#E8EAF0", marginBottom: 5 }}>
        <span>{label}</span>
        <span style={{ color: "#8A8FA8" }}>
          {value} ({Math.round(pct)}%)
        </span>
      </div>
      <div style={{ height: 10, background: "#0F1117", borderRadius: 6, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const hrs = Math.round((min / 60) * 10) / 10;
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "calc(100vh - 60px)",
    background: "#07080C",
    color: "#E8EAF0",
    fontFamily: "'DM Sans', system-ui, sans-serif",
    padding: 20,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  eyebrow: { marginBottom: 4 },
  backLink: {
    color: "#8A8FA8",
    fontSize: 12,
    textDecoration: "none",
  },
  title: {
    fontFamily: "'Syne', serif",
    fontSize: 24,
    fontWeight: 700,
    margin: 0,
    color: "#E8EAF0",
  },
  subtitle: { fontSize: 13, color: "#8A8FA8", marginTop: 3 },
  rangeTabs: { display: "flex", gap: 6 },
  rangeTab: {
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#8A8FA8",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  rangeTabActive: {
    background: "rgba(212, 175, 55, 0.15)",
    color: "#D4AF37",
    borderColor: "rgba(212, 175, 55, 0.4)",
  },
  loading: {
    textAlign: "center",
    padding: 60,
    color: "#8A8FA8",
  },
  body: { display: "flex", flexDirection: "column", gap: 16 },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  kpi: {
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 14,
  },
  kpiLabel: {
    fontSize: 11,
    color: "#8A8FA8",
    textTransform: "uppercase",
    letterSpacing: 0.05,
    fontWeight: 600,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: 700,
    margin: "6px 0",
    fontFamily: "'Syne', serif",
  },
  kpiSub: { fontSize: 11, color: "#8A8FA8" },
  chartCard: {
    background: "#0F1117",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 14,
    padding: 16,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: 600,
    margin: "0 0 14px 0",
    color: "#E8EAF0",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    gap: 12,
  },
  ratioBars: { padding: "4px 0" },
  empty: { padding: "24px 0", textAlign: "center", color: "#8A8FA8", fontSize: 12 },
  agentTable: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "#8A8FA8",
    textTransform: "uppercase",
    letterSpacing: 0.05,
    padding: "8px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  thRight: {
    textAlign: "right",
    fontSize: 11,
    fontWeight: 700,
    color: "#8A8FA8",
    textTransform: "uppercase",
    letterSpacing: 0.05,
    padding: "8px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  td: { padding: "10px 8px", fontSize: 13, color: "#E8EAF0", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  tdRight: { padding: "10px 8px", fontSize: 13, color: "#E8EAF0", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.04)" },
};
