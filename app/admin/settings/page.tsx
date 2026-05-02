"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";
import { adminColors as C, btnGold, btnGhost, h1Style, inputStyle, pageStyle, pill } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

type Tab = "config" | "team" | "logs";

export default function AdminSettings() {
  const [tab, setTab] = useState<Tab>("config");
  const [config, setConfig] = useState<any>({});
  const [team, setTeam] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/settings").then((r) => r.json()),
      fetch("/api/admin/logs").then((r) => r.json()),
    ]).then(([s, l]) => {
      setConfig(s.config || {});
      setTeam(s.team || []);
      setLogs(l.logs || []);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function saveConfig() {
    const r = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (r.ok) {
      setSavedAt(new Date().toLocaleTimeString("en-IN"));
      setTimeout(() => setSavedAt(null), 3000);
    } else {
      alert("Save failed");
    }
  }

  async function setRole(userId: string, role: string) {
    if (!confirm(`Set this user's role to "${role}"?`)) return;
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    load();
  }

  const teamCols: any[] = [
    { key: "id", label: "ID", render: (u: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{u.id?.slice(0, 8)}</span> },
    { key: "name", label: "Name", render: (u: any) => u.name || <span style={{ color: C.textDim }}>—</span> },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", render: (u: any) => u.email || <span style={{ color: C.textDim }}>—</span> },
    {
      key: "role",
      label: "Role",
      render: (u: any) => (
        <span style={pill(u.role === "super_admin" ? C.purple : u.role === "admin" ? C.gold : C.blue, "")}>{u.role}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (u: any) => (
        <div style={{ display: "flex", gap: 6 }}>
          {u.role !== "super_admin" && (
            <button onClick={() => setRole(u.id, "admin")} style={smallBtn}>→ admin</button>
          )}
          {u.role !== "agent" && (
            <button onClick={() => setRole(u.id, "agent")} style={smallBtn}>→ agent</button>
          )}
          {u.role !== "customer" && (
            <button onClick={() => setRole(u.id, "customer")} style={{ ...smallBtn, color: C.red, background: "rgba(255,71,87,0.1)", border: `1px solid ${C.red}55` }}>Demote</button>
          )}
        </div>
      ),
    },
  ];

  const logCols: any[] = [
    { key: "id", label: "ID", render: (l: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{l.id?.slice(0, 8)}</span> },
    { key: "adminId", label: "Admin", render: (l: any) => l.adminPhone || l.adminId?.slice(0, 8) || "—" },
    { key: "action", label: "Action", render: (l: any) => <span style={pill(C.blue, "")}>{l.action}</span> },
    { key: "target", label: "Target", render: (l: any) => l.targetType ? `${l.targetType}: ${l.targetId?.slice(0, 8)}` : "—" },
    { key: "details", label: "Details", render: (l: any) => <span style={{ color: C.text, fontSize: 12 }}>{typeof l.details === "string" ? l.details : JSON.stringify(l.details)}</span> },
    { key: "timestamp", label: "Time", render: (l: any) => l.timestamp ? new Date(l.timestamp).toLocaleString("en-IN") : "—" },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ ...h1Style, margin: 0 }}>Settings & Config</h1>
        {tab === "logs" && (
          <button onClick={() => exportRows("admin-logs", logs, logCols)} style={{ ...btnGhost, marginLeft: "auto" }}>Export CSV</button>
        )}
        {tab === "team" && (
          <button onClick={() => exportRows("team", team, teamCols.filter((c: any) => c.key !== "actions"))} style={{ ...btnGhost, marginLeft: "auto" }}>Export CSV</button>
        )}
      </div>

      <div className="admin-tabs" style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        {(["config", "team", "logs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              color: tab === t ? C.gold : C.textDim,
              padding: "12px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === t ? `2px solid ${C.gold}` : "2px solid transparent",
              fontFamily: "DM Sans, sans-serif",
              textTransform: "capitalize",
            }}
          >
            {t === "config" ? "Platform Config" : t === "team" ? "Team Management" : "Action Logs"}
          </button>
        ))}
      </div>

      {tab === "config" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, maxWidth: 720 }}>
          <Section label="Commission">
            <Lbl>Default Commission %</Lbl>
            <input
              type="number"
              value={config.commissionPct ?? 5}
              onChange={(e) => setConfig({ ...config, commissionPct: Number(e.target.value) })}
              style={{ ...inputStyle, width: "100%" }}
            />
          </Section>

          <Section label="OTP">
            <Lbl>OTP Length</Lbl>
            <input
              type="number"
              value={config.otpLength ?? 6}
              onChange={(e) => setConfig({ ...config, otpLength: Number(e.target.value) })}
              style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
            />
            <Lbl>OTP TTL (seconds)</Lbl>
            <input
              type="number"
              value={config.otpTtl ?? 300}
              onChange={(e) => setConfig({ ...config, otpTtl: Number(e.target.value) })}
              style={{ ...inputStyle, width: "100%" }}
            />
          </Section>

          <Section label="Verification">
            <Lbl>Verification Window (hours after checkout)</Lbl>
            <input
              type="number"
              value={config.verificationHours ?? 48}
              onChange={(e) => setConfig({ ...config, verificationHours: Number(e.target.value) })}
              style={{ ...inputStyle, width: "100%" }}
            />
          </Section>

          <Section label="AI Pricing">
            <Lbl>Recalc Interval (seconds)</Lbl>
            <input
              type="number"
              value={config.aiRecalcSec ?? 60}
              onChange={(e) => setConfig({ ...config, aiRecalcSec: Number(e.target.value) })}
              style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
            />
            <Lbl>Demand Multiplier Cap</Lbl>
            <input
              type="number"
              step="0.1"
              value={config.demandCap ?? 1.5}
              onChange={(e) => setConfig({ ...config, demandCap: Number(e.target.value) })}
              style={{ ...inputStyle, width: "100%" }}
            />
          </Section>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <button onClick={saveConfig} style={btnGold}>Save Config</button>
            {savedAt && <span style={{ color: C.green, fontSize: 13 }}>✓ Saved at {savedAt}</span>}
          </div>
        </div>
      )}

      {tab === "team" && <DataTable columns={teamCols} data={team} loading={loading} pageSize={15} />}
      {tab === "logs" && <DataTable columns={logCols} data={logs} loading={loading} pageSize={20} />}
    </div>
  );
}

function Section({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 22, paddingBottom: 22, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontFamily: "Syne, sans-serif", color: C.text, fontSize: 16, marginBottom: 12 }}>{label}</div>
      {children}
    </div>
  );
}

function Lbl({ children }: { children: any }) {
  return <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6, fontWeight: 600, letterSpacing: 0.5 }}>{children}</div>;
}

const smallBtn = {
  background: "rgba(212,175,55,0.1)",
  color: C.gold,
  border: `1px solid rgba(212,175,55,0.3)`,
  padding: "5px 10px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
} as const;
