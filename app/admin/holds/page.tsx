"use client";
// Admin → Active Holds dashboard. Lists every row in bid_holds with
// filters (status, hotel, search) + KPI cards + manual force actions
// (force expire / complete / cancel). Includes a "Run cron now" button
// that hits /api/cron/expire-holds with the admin token.

import { useEffect, useState } from "react";

type Hold = {
  bid_id: string;
  hotel_id: string;
  hotel_name?: string;
  customer_id: string;
  customer?: { name?: string; phone?: string; email?: string } | null;
  hold_amount: number;
  balance_due: number;
  total_amount: number;
  expires_at: string;
  created_at: string;
  status: "active" | "completed" | "expired" | "cancelled";
  flow?: string;
  pay_at_hotel?: boolean;
  room_type?: string;
  check_in?: string;
  check_out?: string;
};

type Stats = {
  total: number; active: number; completed: number; expired: number; cancelled: number;
  locked_value: number; total_value: number; expiring_24h: number;
};

export default function AdminHolds() {
  const [holds, setHolds]       = useState<Hold[]>([]);
  const [windows, setWindows]   = useState<any[]>([]);
  const [pendingAutoAccepts, setPendingAutoAccepts] = useState<any[]>([]);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch]     = useState("");
  const [err, setErr]           = useState("");
  const [busy, setBusy]         = useState(false);
  const [cronMsg, setCronMsg]   = useState("");

  const load = () => {
    setLoading(true); setErr("");
    const q = new URLSearchParams({ status: statusFilter, search });
    fetch(`/api/admin/holds?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setErr(String(d.error));
        setHolds(d?.holds || []);
        setWindows(d?.windows || []);
        setPendingAutoAccepts(d?.pendingAutoAccepts || []);
        setStats(d?.stats || null);
      })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const runCron = async () => {
    setBusy(true); setCronMsg("");
    try {
      const adminTok = localStorage.getItem("sb_admin_token") || "";
      const r = await fetch("/api/cron/expire-holds", {
        method: "POST",
        headers: { "x-admin-token": adminTok },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Cron failed");
      setCronMsg(`Cron ran · ${d.holds_expired} holds + ${d.windows_expired} windows marked expired`);
      load();
    } catch (e: any) {
      setCronMsg(e?.message || "Cron failed");
    } finally {
      setBusy(false);
      setTimeout(() => setCronMsg(""), 6000);
    }
  };

  const forceAction = async (h: Hold, action: "force_expire" | "force_complete" | "force_cancel") => {
    const labelMap: Record<string, string> = {
      force_expire: "expire",
      force_complete: "mark completed",
      force_cancel: "cancel",
    };
    if (!confirm(`Are you sure you want to ${labelMap[action]} hold for bid ${h.bid_id.slice(0,8)}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/holds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId: h.bid_id, action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Update failed");
      load();
    } catch (e: any) {
      alert(e?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "24px 28px", fontFamily: "DM Sans, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, color: "#E8EAF0", margin: 0 }}>
            🔒 Active Holds
          </h1>
          <p style={{ color: "#8A8FA8", fontSize: 13, margin: "6px 0 0" }}>
            All bid_holds rows · live state · admin override + manual cron trigger
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={runCron} disabled={busy} style={btnGhost}>
            {busy ? "Running…" : "⚡ Run cron now"}
          </button>
          <button onClick={load} disabled={loading} style={btnPrimary}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {cronMsg && (
        <div style={{ background: "rgba(46,204,113,0.12)", border: "1px solid rgba(46,204,113,0.35)", color: "#7EEAB1", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
          {cronMsg}
        </div>
      )}
      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
          {err}
        </div>
      )}

      {/* KPI cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          <Kpi label="Active holds"   value={stats.active.toLocaleString("en-IN")} color="#2ECC71" />
          <Kpi label="₹ locked now"    value={`₹${stats.locked_value.toLocaleString("en-IN")}`} color="#9fb1c2" />
          <Kpi label="₹ booking total" value={`₹${stats.total_value.toLocaleString("en-IN")}`} color="#3D9CF5" />
          <Kpi label="Expiring 24h"    value={String(stats.expiring_24h)} color="#F59E0B" />
          <Kpi label="Completed"        value={String(stats.completed)} color="#A855F7" subtle />
          <Kpi label="Expired"          value={String(stats.expired)} color="#EF4444" subtle />
        </div>
      )}

      {/* Active acceptance windows */}
      {windows.length > 0 && (
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ color: "#E8EAF0", fontSize: 14, fontWeight: 700, margin: 0 }}>
              ⏱ Active acceptance windows ({windows.length})
            </p>
            <span style={{ color: "#8A8FA8", fontSize: 11 }}>Accepted but unpaid · auto-cancels at expiry</span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {windows.slice(0, 8).map((w: any) => {
              const ms = new Date(w.expires_at).getTime() - Date.now();
              const m = Math.max(0, Math.floor(ms / 60_000));
              return (
                <div key={w.bid_id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "rgba(0,0,0,0.25)", borderRadius: 8, fontSize: 12 }}>
                  <span style={{ fontFamily: "monospace", color: "#8A8FA8" }}>{w.bid_id.slice(0, 10)}</span>
                  <span style={{ color: m < 5 ? "#F59E0B" : "#E8EAF0" }}>{m} min left</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Phase 6: bids scheduled for auto-accept */}
      {pendingAutoAccepts.length > 0 && (
        <div style={{ background: "#151820", border: "1px solid rgba(140, 160, 182,0.18)", borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ color: "#E8EAF0", fontSize: 14, fontWeight: 700, margin: 0 }}>
              ⚡ Pending auto-accepts ({pendingAutoAccepts.length})
            </p>
            <span style={{ color: "#8A8FA8", fontSize: 11 }}>Above-floor bids · paid · waiting tier window before flipping ACCEPTED</span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {pendingAutoAccepts.slice(0, 10).map((b: any) => {
              const ms = new Date(b.auto_accept_at).getTime() - Date.now();
              const m = Math.max(0, Math.floor(ms / 60_000));
              const s = Math.max(0, Math.floor((ms % 60_000) / 1000));
              const urgent = ms < 60_000 && ms > 0;
              const overdue = ms <= 0;
              return (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "rgba(0,0,0,0.25)", borderRadius: 8, fontSize: 12, gap: 12 }}>
                  <span style={{ fontFamily: "monospace", color: "#8A8FA8", flexShrink: 0 }}>{b.id.slice(0, 10)}</span>
                  <span style={{ color: "#9fb1c2", flex: 1 }}>₹{Number(b.amount).toLocaleString("en-IN")}</span>
                  {b.bidder_tier && (
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "rgba(255,255,255,0.05)", color: "#8A8FA8" }}>{b.bidder_tier}</span>
                  )}
                  <span style={{ color: overdue ? "#EF4444" : urgent ? "#F59E0B" : "#10b981", fontFamily: "monospace" }}>
                    {overdue ? "running cron…" : `${m}:${String(s).padStart(2, "0")}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {["active", "completed", "expired", "cancelled", "all"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{
              padding: "6px 14px", borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid",
              ...(statusFilter === s
                ? { background: "linear-gradient(135deg,#9fb1c2,#c6d0da)", color: "#0F1117", borderColor: "transparent" }
                : { background: "rgba(255,255,255,0.04)", color: "#8A8FA8", borderColor: "rgba(255,255,255,0.1)" }),
            }}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
          placeholder="Search bid id, hotel, customer…"
          style={{ minWidth: 220, padding: "6px 12px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E8EAF0", fontFamily: "inherit", fontSize: 12, outline: "none" }} />
      </div>

      {/* Table */}
      <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.35)", color: "#8A8FA8" }}>
                <Th>Bid · Hotel</Th>
                <Th>Customer</Th>
                <Th align="right">Hold</Th>
                <Th align="right">Balance</Th>
                <Th align="right">Total</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#8A8FA8" }}>Loading…</td></tr>
              ) : holds.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#8A8FA8" }}>No holds match these filters.</td></tr>
              ) : holds.map((h) => {
                const exp = new Date(h.expires_at);
                const expMs = exp.getTime() - Date.now();
                const expClass = h.status === "active" && expMs < 24 * 3600_000 ? "#F59E0B" : "#8A8FA8";
                return (
                  <tr key={h.bid_id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", verticalAlign: "top" }}>
                    <Td>
                      <div style={{ fontFamily: "monospace", color: "#8A8FA8", fontSize: 11 }}>{h.bid_id.slice(0, 10)}</div>
                      <div style={{ color: "#E8EAF0", fontSize: 13 }}>{h.hotel_name || h.hotel_id}</div>
                      {h.flow && <div style={{ color: "#8A8FA8", fontSize: 10, marginTop: 2 }}>{h.flow}</div>}
                    </Td>
                    <Td>
                      <div style={{ color: "#E8EAF0" }}>{h.customer?.name || "—"}</div>
                      <div style={{ color: "#8A8FA8", fontSize: 11 }}>{h.customer?.phone || h.customer_id.slice(0, 8)}</div>
                    </Td>
                    <Td align="right">
                      <div style={{ color: "#9fb1c2", fontWeight: 700 }}>₹{Number(h.hold_amount).toLocaleString("en-IN")}</div>
                      {h.pay_at_hotel && <div style={{ color: "#8A8FA8", fontSize: 10 }}>+ at hotel</div>}
                    </Td>
                    <Td align="right" style={{ color: "#E8EAF0" }}>₹{Number(h.balance_due).toLocaleString("en-IN")}</Td>
                    <Td align="right" style={{ color: "#E8EAF0", fontWeight: 600 }}>₹{Number(h.total_amount).toLocaleString("en-IN")}</Td>
                    <Td><StatusBadge status={h.status} /></Td>
                    <Td>
                      <div style={{ color: expClass, fontSize: 12 }}>
                        {exp.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </Td>
                    <Td>
                      {h.status === "active" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => forceAction(h, "force_complete")} disabled={busy} style={btnXs("#10b981")}>✓</button>
                          <button onClick={() => forceAction(h, "force_expire")}   disabled={busy} style={btnXs("#f59e0b")}>⏰</button>
                          <button onClick={() => forceAction(h, "force_cancel")}   disabled={busy} style={btnXs("#ef4444")}>✕</button>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, subtle }: { label: string; value: string; color: string; subtle?: boolean }) {
  return (
    <div style={{
      background: "#151820",
      border: `1px solid ${subtle ? "rgba(255,255,255,0.07)" : `${color}33`}`,
      borderRadius: 12, padding: 14,
    }}>
      <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>{label}</p>
      <p style={{ color, fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "Syne, sans-serif" }}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active:    { bg: "rgba(46,204,113,0.12)",  fg: "#2ECC71", label: "Active" },
    completed: { bg: "rgba(168,85,247,0.12)",  fg: "#A855F7", label: "Completed" },
    expired:   { bg: "rgba(239,68,68,0.12)",   fg: "#EF4444", label: "Expired" },
    cancelled: { bg: "rgba(75,85,99,0.16)",    fg: "#9CA3AF", label: "Cancelled" },
  };
  const m = map[status] || map.active;
  return (
    <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: m.bg, color: m.fg, border: `1px solid ${m.fg}33` }}>
      {m.label}
    </span>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" }) {
  return <th style={{ padding: "10px 12px", textAlign: align || "left", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, align, style }: { children: React.ReactNode; align?: "right" | "left"; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 12px", textAlign: align || "left", ...style }}>{children}</td>;
}

const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg,#9fb1c2,#c6d0da)", color: "#0F1117",
  border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", fontSize: 13,
};
const btnGhost: React.CSSProperties = {
  background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "#E8EAF0",
  borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13,
};
const btnXs = (color: string): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${color}55`, color,
  borderRadius: 8, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
});
