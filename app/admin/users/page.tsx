"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  function load() {
    setLoading(true);
    const q = new URLSearchParams({ tier, status, search });
    fetch(`/api/admin/users?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tier, status]);

  async function updateTier(userId: string, newTier: string) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "tier", value: newTier }),
    });
    setSelected(null);
    load();
  }

  async function updateStatus(userId: string, newStatus: string) {
    if (!confirm(`Set this user's status to "${newStatus}"?`)) return;
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "status", value: newStatus }),
    });
    setSelected(null);
    load();
  }

  const columns = [
    {
      key: "id",
      label: "ID",
      render: (u: any) => <span style={{ fontFamily: "monospace", color: "#8A8FA8", fontSize: 12 }}>{u.id?.slice(0, 8)}</span>,
    },
    { key: "name", label: "Name", render: (u: any) => u.name || <span style={{ color: "#8A8FA8" }}>—</span> },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", render: (u: any) => u.email || <span style={{ color: "#8A8FA8" }}>—</span> },
    {
      key: "tier",
      label: "Tier",
      render: (u: any) => (
        <span
          style={{
            background: tierColor(u.tier) + "22",
            color: tierColor(u.tier),
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {u.tier || "silver"}
        </span>
      ),
    },
    {
      key: "totalSpend",
      label: "Spend",
      render: (u: any) => `₹${Number(u.totalSpend || 0).toLocaleString()}`,
    },
    {
      key: "status",
      label: "Status",
      render: (u: any) => (
        <span
          style={{
            background: statusColor(u.status) + "22",
            color: statusColor(u.status),
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {u.status || "active"}
        </span>
      ),
    },
    {
      key: "createdAt",
      label: "Joined",
      render: (u: any) => new Date(u.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      label: "",
      render: (u: any) => (
        <button
          onClick={() => setSelected(u)}
          style={{
            background: "rgba(212,175,55,0.1)",
            color: "#D4AF37",
            border: "1px solid rgba(212,175,55,0.3)",
            padding: "5px 12px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      <h1 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 28, margin: "0 0 20px" }}>
        Users Management
      </h1>

      {/* Filters */}
      <div className="admin-filters" style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={inputStyle}
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={selectStyle}>
          <option value="all">All Tiers</option>
          <option value="silver">Silver</option>
          <option value="gold">Gold</option>
          <option value="platinum">Platinum</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
        <button onClick={load} style={btnStyle}>Search</button>
        <span style={{ marginLeft: "auto", color: "#8A8FA8", alignSelf: "center", fontSize: 13 }}>
          Total: {users.length} users
        </span>
      </div>

      <DataTable columns={columns} data={users} loading={loading} pageSize={15} />

      {/* User detail modal */}
      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <h2 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", margin: "0 0 16px" }}>
            {selected.name || "Unnamed User"}
          </h2>
          <Field label="ID" value={selected.id} />
          <Field label="Phone" value={selected.phone} />
          <Field label="Email" value={selected.email || "—"} />
          <Field label="Tier" value={selected.tier || "silver"} />
          <Field label="Total Spend" value={`₹${Number(selected.totalSpend || 0).toLocaleString()}`} />
          <Field label="Role" value={selected.role || "customer"} />
          <Field label="Status" value={selected.status || "active"} />
          <Field label="Joined" value={new Date(selected.createdAt).toLocaleString("en-IN")} />

          <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
            <div style={{ color: "#8A8FA8", fontSize: 12, marginBottom: 10 }}>OVERRIDE TIER</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["silver", "gold", "platinum"].map((t) => (
                <button key={t} onClick={() => updateTier(selected.id, t)} style={{ ...btnStyle, background: tierColor(t) + "22", color: tierColor(t), border: `1px solid ${tierColor(t)}44` }}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ color: "#8A8FA8", fontSize: 12, margin: "16px 0 10px" }}>STATUS ACTIONS</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => updateStatus(selected.id, "active")} style={{ ...btnStyle, background: "rgba(46,204,113,0.1)", color: "#2ECC71", border: "1px solid rgba(46,204,113,0.3)" }}>Activate</button>
              <button onClick={() => updateStatus(selected.id, "suspended")} style={{ ...btnStyle, background: "rgba(240,208,96,0.1)", color: "#F0D060", border: "1px solid rgba(240,208,96,0.3)" }}>Suspend</button>
              <button onClick={() => updateStatus(selected.id, "banned")} style={{ ...btnStyle, background: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.3)" }}>Ban</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ color: "#8A8FA8", fontSize: 13 }}>{label}</span>
      <span style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#151820",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: 28,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function tierColor(t: string) {
  if (t === "platinum") return "#A855F7";
  if (t === "gold") return "#D4AF37";
  return "#8A8FA8";
}
function statusColor(s: string) {
  if (s === "banned") return "#FF4757";
  if (s === "suspended") return "#F0D060";
  return "#2ECC71";
}
const inputStyle: React.CSSProperties = {
  background: "#151820",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "10px 14px",
  color: "#E8EAF0",
  fontSize: 14,
  outline: "none",
  fontFamily: "DM Sans, sans-serif",
  minWidth: 220,
};
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 140, cursor: "pointer" };
const btnStyle: React.CSSProperties = {
  background: "#D4AF37",
  color: "#000",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "DM Sans, sans-serif",
};
