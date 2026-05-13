"use client";
// v98 — Admin Notifications Queue viewer.
//
// notification_queue has 36 rows on prod (verified via Supabase) — these
// are accumulated since Session 6 (Apr 2026) when triggers started
// queueing notifications, but nothing in the admin UI surfaced them.
//
// This page lists pending / sent / failed notifications with kind +
// target + payload preview, lets admins manually mark items as sent or
// failed, and shows queue health KPIs.

import { useCallback, useEffect, useMemo, useState } from "react";
import KpiCard from "@/components/admin/kpi-card";
import DataTable from "@/components/admin/data-table";
import { adminColors as C, btnGhost, btnGold, h1Style, pageStyle, pill, selectStyle } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

type Notif = {
  id: string;
  kind: string;
  target?: string;
  status: "pending" | "sent" | "failed" | string;
  priority?: string;
  payload?: any;
  error?: string | null;
  created_at?: string;
  sent_at?: string | null;
  updated_at?: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  pending: C.amber,
  sent:    C.green,
  failed:  C.red,
};

const KIND_ICON: Record<string, string> = {
  bid_accepted: "✅", bid_countered: "💬", bid_rejected: "❌",
  bid_auto_cancelled: "⏰", bid_expiring_soon: "⚡",
  video_like: "❤️", video_comment: "💬", comment_reply: "↪",
  new_follower: "👤", booking_confirm: "📅", complaint_new: "🚩",
  feedback_thanks: "⭐",
};

export default function AdminNotifications() {
  const [list, setList] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"pending" | "sent" | "failed" | "all">("pending");
  const [kindFilter, setKindFilter] = useState("all");
  const [selected, setSelected] = useState<Notif | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/notifications?status=${status}`)
      .then((r) => r.json())
      .then((d) => setList(Array.isArray(d.notifications) ? d.notifications : []))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (kindFilter === "all") return list;
    return list.filter((n) => n.kind === kindFilter);
  }, [list, kindFilter]);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    list.forEach((n) => n.kind && s.add(n.kind));
    return Array.from(s).sort();
  }, [list]);

  const counts = useMemo(() => {
    const c = { pending: 0, sent: 0, failed: 0, total: list.length };
    list.forEach((n) => {
      if (n.status === "pending") c.pending++;
      else if (n.status === "sent") c.sent++;
      else if (n.status === "failed") c.failed++;
    });
    return c;
  }, [list]);

  async function setRowStatus(id: string, newStatus: "sent" | "failed" | "pending", note?: string) {
    setBusy(true);
    try {
      const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
      const r = await fetch("/api/admin/notifications/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ id, status: newStatus, note }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert(e?.error || "Update failed");
      } else {
        setSelected(null);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  const cols: any[] = [
    {
      key: "kind",
      label: "Kind",
      render: (n: Notif) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>{KIND_ICON[n.kind] || "📨"}</span>
          <span style={{ color: C.text, fontWeight: 500 }}>{n.kind}</span>
        </span>
      ),
    },
    { key: "target", label: "Target", render: (n: Notif) => <span style={{ color: C.textDim }}>{n.target || "—"}</span> },
    {
      key: "priority",
      label: "Priority",
      render: (n: Notif) => <span style={pill(n.priority === "high" ? C.red : n.priority === "low" ? C.textDim : C.amber, "")}>{n.priority || "normal"}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (n: Notif) => <span style={pill(STATUS_COLOR[n.status] || C.textDim, "")}>{n.status}</span>,
    },
    {
      key: "preview",
      label: "Payload",
      render: (n: Notif) => {
        const p = n.payload;
        const t = typeof p === "string" ? p : JSON.stringify(p || {});
        return <span style={{ color: C.textDim, fontSize: 12 }}>{t.slice(0, 90)}{t.length > 90 ? "…" : ""}</span>;
      },
    },
    {
      key: "created_at",
      label: "Queued",
      render: (n: Notif) => (n.created_at ? new Date(n.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"),
    },
    {
      key: "actions",
      label: "",
      render: (n: Notif) => (
        <button onClick={() => setSelected(n)} style={smallBtn}>View</button>
      ),
    },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ ...h1Style, margin: 0 }} className="admin-h1">📨 Notification Queue</h1>
        <button
          onClick={load}
          style={{ ...btnGhost, padding: "8px 14px" }}
        >
          ↻ Refresh
        </button>
        <button
          onClick={() => exportRows(`notifications-${status}`, filtered, cols.filter((c: any) => c.key !== "actions"))}
          style={{ ...btnGhost, marginLeft: "auto" }}
        >
          Export CSV
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
        <KpiCard title="Pending"  value={counts.pending} icon="⏳" color={C.amber} />
        <KpiCard title="Sent"     value={counts.sent}    icon="✅" color={C.green} />
        <KpiCard title="Failed"   value={counts.failed}  icon="⚠️" color={C.red}   />
        <KpiCard title="Total"    value={counts.total}   icon="📨" color={C.gold}  />
      </div>

      {/* Filters */}
      <div className="admin-filters" style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={selectStyle}>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="all">All</option>
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={selectStyle}>
          <option value="all">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_ICON[k] || "📨"} {k}</option>)}
        </select>
        <span style={{ marginLeft: "auto", alignSelf: "center", color: C.textDim, fontSize: 13 }}>
          Showing {filtered.length} / {list.length}
        </span>
      </div>

      {/* Worker status hint */}
      <div style={{ background: "rgba(212,175,55,0.06)", border: `1px solid ${C.gold}33`, borderRadius: 12, padding: 14, marginBottom: 16, color: C.text, fontSize: 13 }}>
        <strong style={{ color: C.gold }}>Worker status:</strong> push/SMS/email dispatch worker is not yet wired
        (depends on MSG91 + SendGrid/FCM keys). Until then, items stay <code style={{ color: C.amber }}>pending</code> here
        — use the "Mark sent" action after handling out-of-band, or "Mark failed" if the underlying event is no longer relevant.
      </div>

      <DataTable columns={cols} data={filtered} loading={loading} pageSize={20} />

      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(7,8,12,0.7)", backdropFilter: "blur(4px)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 520, maxWidth: "92vw", background: "#0F1117", borderLeft: `1px solid ${C.border}`, height: "100vh", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ color: C.textDim, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>Notification</p>
                <p style={{ color: C.text, fontSize: 15, fontWeight: 600, margin: "3px 0 0" }}>
                  <span style={{ marginRight: 6 }}>{KIND_ICON[selected.kind] || "📨"}</span>{selected.kind}
                </p>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: C.textDim, fontSize: 22, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              <Row label="ID"        value={<span style={{ fontFamily: "monospace", color: C.text }}>{selected.id}</span>} />
              <Row label="Status"    value={<span style={pill(STATUS_COLOR[selected.status] || C.textDim, "")}>{selected.status}</span>} />
              <Row label="Priority"  value={selected.priority || "normal"} />
              <Row label="Target"    value={selected.target || "—"} />
              <Row label="Queued"    value={selected.created_at ? new Date(selected.created_at).toLocaleString("en-IN") : "—"} />
              {selected.sent_at && <Row label="Sent at" value={new Date(selected.sent_at).toLocaleString("en-IN")} />}
              {selected.error    && <Row label="Error"   value={<span style={{ color: C.red }}>{selected.error}</span>} />}
              <div style={{ marginTop: 14, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
                <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6, fontWeight: 600 }}>PAYLOAD</div>
                <pre style={{ color: C.text, fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                  {JSON.stringify(selected.payload || {}, null, 2)}
                </pre>
              </div>
            </div>
            <div style={{ padding: 16, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selected.status !== "sent" && (
                <button onClick={() => setRowStatus(selected.id, "sent")} disabled={busy} style={{ ...btnGold, flex: 1, background: C.green, color: "#0F1117" }}>
                  ✓ Mark sent
                </button>
              )}
              {selected.status !== "failed" && (
                <button onClick={() => setRowStatus(selected.id, "failed", "Manually closed by admin")} disabled={busy} style={{ ...btnGhost, color: C.red, borderColor: `${C.red}55` }}>
                  ⊘ Mark failed
                </button>
              )}
              {selected.status !== "pending" && (
                <button onClick={() => setRowStatus(selected.id, "pending")} disabled={busy} style={btnGhost}>
                  ↺ Re-queue
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginBottom: 10 }}>
      <div style={{ color: C.textDim, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: C.text, fontSize: 13 }}>{value}</div>
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
