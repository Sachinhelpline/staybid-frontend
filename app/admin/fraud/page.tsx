"use client";
import { useEffect, useState } from "react";
import KPICard from "@/components/admin/kpi-card";
import DataTable from "@/components/admin/data-table";
import Modal, { Field } from "@/components/admin/modal";
import { adminColors as C, btnGold, btnGhost, h1Style, pageStyle, pill } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

export default function AdminFraud() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDup, setSelectedDup] = useState<any | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/fraud/flags")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }

  useEffect(() => { load(); }, []);

  async function banUser(userId: string) {
    if (!confirm("Ban this user?")) return;
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "status", value: "banned" }),
    });
    load();
  }

  async function unbanUser(userId: string) {
    if (!confirm("Unban this user?")) return;
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "status", value: "active" }),
    });
    load();
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <h1 style={h1Style}>Fraud & Security</h1>
        <div style={{ color: C.textDim }}>Loading…</div>
      </div>
    );
  }

  const flags = data?.flags || {};
  const duplicates = data?.duplicates || [];
  const banned = data?.bannedUsers || [];

  // Risk matrix: severity × type
  const matrix = [
    { type: "Duplicate Accounts", low: 0, medium: 0, high: duplicates.length, color: C.amber },
    { type: "Banned Users", low: 0, medium: 0, high: banned.length, color: C.red },
    { type: "High-Priority Complaints", low: 0, medium: 0, high: flags.highPriorityComplaints || 0, color: C.purple },
  ];

  const dupCols: any[] = [
    { key: "phone", label: "Phone", render: (d: any) => <span style={{ fontFamily: "monospace", color: C.text }}>{d.phone}</span> },
    { key: "ids", label: "Account Count", render: (d: any) => <span style={pill(C.amber, "")}>{d.ids.length} accounts</span> },
    { key: "ids2", label: "User IDs", render: (d: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 11 }}>{d.ids.map((i: string) => i.slice(0, 8)).join(", ")}</span> },
    { key: "actions", label: "", render: (d: any) => <button onClick={() => setSelectedDup(d)} style={smallBtn}>Review</button> },
  ];

  const banCols: any[] = [
    { key: "id", label: "ID", render: (u: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{u.id?.slice(0, 8)}</span> },
    { key: "phone", label: "Phone" },
    { key: "status", label: "Status", render: (u: any) => <span style={pill(C.red, "")}>banned</span> },
    { key: "actions", label: "", render: (u: any) => <button onClick={() => unbanUser(u.id)} style={{ ...smallBtn, color: C.green, background: "rgba(46,204,113,0.1)", border: `1px solid ${C.green}55` }}>Unban</button> },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ ...h1Style, margin: 0 }}>Fraud & Security</h1>
        <button
          onClick={() =>
            exportRows("fraud-duplicates", duplicates.map((d: any) => ({ phone: d.phone, ids: d.ids.join(";"), count: d.ids.length })), [
              { key: "phone", label: "Phone" },
              { key: "ids", label: "User IDs" },
              { key: "count", label: "Count" },
            ])
          }
          style={{ ...btnGhost, marginLeft: "auto" }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 28 }}>
        <KPICard title="Duplicate Accounts" value={flags.duplicateAccounts || 0} color={C.amber} />
        <KPICard title="Banned Users" value={flags.bannedUsers || 0} color={C.red} />
        <KPICard title="High-Priority Complaints" value={flags.highPriorityComplaints || 0} color={C.purple} />
      </div>

      {/* Risk Matrix */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 28 }}>
        <div style={{ fontFamily: "Syne, sans-serif", color: C.text, fontSize: 18, marginBottom: 14 }}>Risk Matrix</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "DM Sans, sans-serif" }}>
          <thead>
            <tr>
              <th style={cellH}>Risk Type</th>
              <th style={{ ...cellH, textAlign: "center" }}>Low</th>
              <th style={{ ...cellH, textAlign: "center" }}>Medium</th>
              <th style={{ ...cellH, textAlign: "center" }}>High</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <td style={cell}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: row.color, marginRight: 8 }} />
                  {row.type}
                </td>
                <td style={heatCell(row.low, "low")}>{row.low}</td>
                <td style={heatCell(row.medium, "medium")}>{row.medium}</td>
                <td style={heatCell(row.high, "high")}>{row.high}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontFamily: "Syne, sans-serif", color: C.text, fontSize: 18, margin: "0 0 14px" }}>Duplicate Accounts</div>
      <DataTable columns={dupCols} data={duplicates} loading={false} pageSize={10} />

      <div style={{ fontFamily: "Syne, sans-serif", color: C.text, fontSize: 18, margin: "28px 0 14px" }}>Banned Users</div>
      <DataTable columns={banCols} data={banned} loading={false} pageSize={10} />

      {selectedDup && (
        <Modal onClose={() => setSelectedDup(null)} width={520}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 16px" }}>Duplicate Account</h2>
          <Field label="Phone" value={selectedDup.phone} />
          <Field label="Linked Accounts" value={selectedDup.ids.length} />
          <div style={{ marginTop: 14 }}>
            {selectedDup.ids.map((id: string) => (
              <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: "monospace", color: C.text, fontSize: 12 }}>{id}</span>
                <button onClick={() => banUser(id)} style={{ ...smallBtn, color: C.red, background: "rgba(255,71,87,0.1)", border: `1px solid ${C.red}55` }}>Ban</button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, padding: 12, background: "rgba(245,158,11,0.06)", border: `1px solid ${C.amber}33`, borderRadius: 8, color: C.amber, fontSize: 12 }}>
            Tip: Same phone (with/without +91) creates two records. Hotels are owned by only one — keep the one with hotels active and ban the other.
          </div>
        </Modal>
      )}
    </div>
  );
}

const smallBtn = {
  background: "rgba(212,175,55,0.1)",
  color: C.gold,
  border: `1px solid rgba(212,175,55,0.3)`,
  padding: "5px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
} as const;

const cellH: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  color: C.textDim,
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  borderBottom: `1px solid ${C.border}`,
};
const cell: React.CSSProperties = { padding: "12px", color: C.text, fontSize: 13, borderBottom: `1px solid ${C.border}` };

function heatCell(v: number, level: "low" | "medium" | "high"): React.CSSProperties {
  const intensity = v === 0 ? 0 : Math.min(0.5, 0.1 + v * 0.05);
  const colorMap = { low: "46,204,113", medium: "245,158,11", high: "255,71,87" };
  return {
    ...cell,
    textAlign: "center",
    background: v > 0 ? `rgba(${colorMap[level]},${intensity})` : "transparent",
    fontWeight: 600,
  };
}
