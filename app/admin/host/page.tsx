"use client";
// v276 — Admin → StayBid for Hosts hub. One dashboard over the whole host
// vertical: leads, design projects, store orders, property inquiries,
// workforce jobs, channel-connection requests + analytics KPIs. Dark-luxury
// inline styles (matches /admin/holds). Auth via x-admin-token.

import { useEffect, useState } from "react";

type Kpis = {
  leads: number; leadsNew: number;
  projects: number;
  orders: number; storeGmv: number;
  inquiries: number; inquiriesNew: number;
  jobs: number; jobsActive: number; workforceRevenue: number;
  channels: number; channelsNew: number;
};

type HostData = {
  kpis: Kpis;
  leads: any[];
  projects: any[];
  orders: any[];
  inquiries: any[];
  jobs: any[];
  channels: any[];
};

type Tab = "leads" | "projects" | "orders" | "inquiries" | "jobs" | "channels";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "leads", label: "Leads", icon: "📨" },
  { id: "inquiries", label: "Property Inquiries", icon: "🔍" },
  { id: "projects", label: "Design Studio", icon: "🎨" },
  { id: "orders", label: "Store Orders", icon: "🛋️" },
  { id: "jobs", label: "Workforce Jobs", icon: "🧑‍🔧" },
  { id: "channels", label: "Channel Requests", icon: "🔗" },
];

// Per-source status options offered as quick-set actions.
const STATUS_OPTS: Record<string, string[]> = {
  lead:    ["new", "contacted", "qualified", "converted", "closed"],
  inquiry: ["new", "contacted", "visited", "converted", "closed"],
  order:   ["pending", "paid", "processing", "delivered", "cancelled"],
  job:     ["requested", "assigned", "in_progress", "completed", "cancelled"],
  channel: ["requested", "connected", "syncing", "error", "paused"],
};

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const when = (s?: string) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function AdminHost() {
  const [data, setData] = useState<HostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("leads");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => {
    setLoading(true); setErr("");
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
    const id = typeof window !== "undefined" ? localStorage.getItem("sb_admin_id") || "" : "";
    fetch("/api/admin/host", { headers: { "x-admin-token": tok, "x-admin-id": id } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setErr(String(d.error));
        else setData(d);
      })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const setStatus = async (source: string, id: string, status: string) => {
    setBusy(id);
    try {
      const tok = localStorage.getItem("sb_admin_token") || "";
      const adminId = localStorage.getItem("sb_admin_id") || "";
      const r = await fetch("/api/admin/host", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-token": tok, "x-admin-id": adminId },
        body: JSON.stringify({ source, id, status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Update failed");
      load();
    } catch (e: any) {
      setErr(e?.message || "Update failed");
    } finally {
      setBusy("");
    }
  };

  const k = data?.kpis;

  return (
    <div style={{ padding: "0 4px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ color: "#E8EAF0", fontSize: 24, fontWeight: 800, margin: 0, fontFamily: "Syne, sans-serif" }}>
            🏠 StayBid for Hosts
          </h1>
          <p style={{ color: "#8A8FA8", fontSize: 13, margin: "4px 0 0" }}>
            Managed-portfolio vertical — leads, design, store, discovery, workforce & channels.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/admin/host/pricing" style={{ ...btnPrimary, textDecoration: "none", background: "transparent", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0" }}>🧮 Wizard Pricing</a>
          <button onClick={load} disabled={loading} style={btnPrimary}>↻ Refresh</button>
        </div>
      </div>

      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
          {err}
        </div>
      )}

      {/* KPI cards */}
      {k && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>
          <Kpi label="Leads" value={String(k.leads)} sub={`${k.leadsNew} new`} color="#D4AF37" />
          <Kpi label="Property inquiries" value={String(k.inquiries)} sub={`${k.inquiriesNew} new`} color="#3D9CF5" />
          <Kpi label="Design projects" value={String(k.projects)} color="#A855F7" subtle />
          <Kpi label="Store orders" value={String(k.orders)} sub={inr(k.storeGmv) + " GMV"} color="#0EA5A0" />
          <Kpi label="Workforce jobs" value={String(k.jobs)} sub={`${k.jobsActive} open · ${inr(k.workforceRevenue)}`} color="#F59E0B" />
          <Kpi label="Channel requests" value={String(k.channels)} sub={`${k.channelsNew} new`} color="#2563EB" />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => {
          const count =
            t.id === "leads" ? data?.leads.length
            : t.id === "inquiries" ? data?.inquiries.length
            : t.id === "projects" ? data?.projects.length
            : t.id === "orders" ? data?.orders.length
            : t.id === "jobs" ? data?.jobs.length
            : data?.channels.length;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "7px 15px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: "1px solid",
                ...(tab === t.id
                  ? { background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117", borderColor: "transparent" }
                  : { background: "rgba(255,255,255,0.04)", color: "#8A8FA8", borderColor: "rgba(255,255,255,0.1)" }),
              }}>
              {t.icon} {t.label}{count !== undefined ? ` · ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#8A8FA8" }}>Loading…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {tab === "leads" && <LeadsTable rows={data?.leads || []} busy={busy} onStatus={setStatus} />}
            {tab === "inquiries" && <InquiriesTable rows={data?.inquiries || []} busy={busy} onStatus={setStatus} />}
            {tab === "projects" && <ProjectsTable rows={data?.projects || []} />}
            {tab === "orders" && <OrdersTable rows={data?.orders || []} busy={busy} onStatus={setStatus} />}
            {tab === "jobs" && <JobsTable rows={data?.jobs || []} busy={busy} onStatus={setStatus} />}
            {tab === "channels" && <ChannelsTable rows={data?.channels || []} busy={busy} onStatus={setStatus} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────── */

function LeadsTable({ rows, busy, onStatus }: TableProps) {
  if (!rows.length) return <Empty label="No host leads yet." />;
  return (
    <table style={tbl}>
      <thead><tr style={trHead}><Th>Lead</Th><Th>Interest</Th><Th>City</Th><Th>Message</Th><Th>Status</Th><Th>When</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={trBody}>
            <Td>
              <div style={{ color: "#E8EAF0", fontWeight: 600 }}>{r.name || "—"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r.phone || ""}{r.email ? ` · ${r.email}` : ""}</div>
            </Td>
            <Td>
              <span style={pill}>{r.interest || "general"}</span>
              {r.metadata?.tier && <div style={{ color: "#D4AF37", fontSize: 11, marginTop: 3 }}>{r.metadata.tier}</div>}
            </Td>
            <Td style={{ color: "#8A8FA8" }}>{r.city || "—"}</Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12, maxWidth: 240 }}>{r.message || "—"}</Td>
            <Td><StatusPicker source="lead" id={r.id} status={r.status} busy={busy} onStatus={onStatus} /></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12 }}>{when(r.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InquiriesTable({ rows, busy, onStatus }: TableProps) {
  if (!rows.length) return <Empty label="No property inquiries yet." />;
  return (
    <table style={tbl}>
      <thead><tr style={trHead}><Th>Guest</Th><Th>Property</Th><Th>Message</Th><Th>Status</Th><Th>When</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={trBody}>
            <Td>
              <div style={{ color: "#E8EAF0", fontWeight: 600 }}>{r.name || "—"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r.phone || ""}</div>
            </Td>
            <Td>
              <div style={{ color: "#E8EAF0" }}>{r._property?.title || r.property_id}</div>
              {r._property?.city && <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r._property.city}</div>}
            </Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12, maxWidth: 240 }}>{r.message || "—"}</Td>
            <Td><StatusPicker source="inquiry" id={r.id} status={r.status} busy={busy} onStatus={onStatus} /></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12 }}>{when(r.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProjectsTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty label="No design projects yet." />;
  return (
    <table style={tbl}>
      <thead><tr style={trHead}><Th>Project</Th><Th>Owner</Th><Th>Style · Room</Th><Th align="right">Budget</Th><Th align="right">Options</Th><Th>Status</Th><Th>When</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={trBody}>
            <Td><div style={{ color: "#E8EAF0", fontWeight: 600 }}>{r.title || "Untitled"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 10, fontFamily: "monospace" }}>{r.id.slice(0, 10)}</div></Td>
            <Td><div style={{ color: "#E8EAF0" }}>{r._user?.name || "—"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r._user?.phone || ""}</div></Td>
            <Td style={{ color: "#8A8FA8" }}>{r.style || "—"}{r.room_type ? ` · ${r.room_type}` : ""}</Td>
            <Td align="right" style={{ color: "#8A8FA8", fontSize: 12 }}>
              {r.budget_min || r.budget_max ? `${inr(r.budget_min)}–${inr(r.budget_max)}` : "—"}
            </Td>
            <Td align="right" style={{ color: "#A855F7", fontWeight: 700 }}>{r._optionCount}</Td>
            <Td><StaticBadge status={r.status} /></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12 }}>{when(r.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrdersTable({ rows, busy, onStatus }: TableProps) {
  if (!rows.length) return <Empty label="No store orders yet." />;
  return (
    <table style={tbl}>
      <thead><tr style={trHead}><Th>Order</Th><Th>Customer</Th><Th>Items</Th><Th>Mode</Th><Th align="right">Total</Th><Th>Status</Th><Th>When</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={trBody}>
            <Td><div style={{ color: "#8A8FA8", fontSize: 10, fontFamily: "monospace" }}>{r.id.slice(0, 10)}</div>
              {r.razorpay_payment_id && <div style={{ color: "#2ECC71", fontSize: 10 }}>paid ✓</div>}</Td>
            <Td><div style={{ color: "#E8EAF0" }}>{r.contact?.name || r._user?.name || "—"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r.contact?.phone || r._user?.phone || ""}</div></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12, maxWidth: 220 }}>
              {(r.items || []).slice(0, 3).map((it: any) => `${it.name}×${it.qty}`).join(", ") || "—"}
              {(r.items || []).length > 3 ? ` +${r.items.length - 3}` : ""}
            </Td>
            <Td><span style={pill}>{r.mode || "buy"}</span>{r.emi_months ? <div style={{ color: "#8A8FA8", fontSize: 10 }}>{r.emi_months}mo EMI</div> : null}</Td>
            <Td align="right" style={{ color: "#0EA5A0", fontWeight: 700 }}>{inr(r.total)}</Td>
            <Td><StatusPicker source="order" id={r.id} status={r.status} busy={busy} onStatus={onStatus} /></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12 }}>{when(r.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JobsTable({ rows, busy, onStatus }: TableProps) {
  if (!rows.length) return <Empty label="No workforce jobs yet." />;
  return (
    <table style={tbl}>
      <thead><tr style={trHead}><Th>Job</Th><Th>Requester</Th><Th>Worker</Th><Th>Skill</Th><Th align="right">Amount</Th><Th>Status</Th><Th>Scheduled</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={trBody}>
            <Td><div style={{ color: "#8A8FA8", fontSize: 10, fontFamily: "monospace" }}>{r.id.slice(0, 10)}</div>
              {r.razorpay_payment_id && <div style={{ color: "#2ECC71", fontSize: 10 }}>paid ✓</div>}</Td>
            <Td><div style={{ color: "#E8EAF0" }}>{r.contact?.name || r._user?.name || "—"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r.contact?.phone || r._user?.phone || ""}</div></Td>
            <Td><div style={{ color: "#E8EAF0" }}>{r._worker?.name || "—"}</div>
              {r._worker?.city && <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r._worker.city}</div>}</Td>
            <Td><span style={pill}>{r.skill || r._worker?.skill || "—"}</span></Td>
            <Td align="right" style={{ color: "#F59E0B", fontWeight: 700 }}>{r.amount ? inr(r.amount) : "—"}</Td>
            <Td><StatusPicker source="job" id={r.id} status={r.status} busy={busy} onStatus={onStatus} /></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12 }}>{r.scheduled_at ? when(r.scheduled_at) : when(r.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChannelsTable({ rows, busy, onStatus }: TableProps) {
  if (!rows.length) return <Empty label="No channel-connection requests yet." />;
  return (
    <table style={tbl}>
      <thead><tr style={trHead}><Th>Channel</Th><Th>Host</Th><Th>Property · Listing</Th><Th>Status</Th><Th>When</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={trBody}>
            <Td><span style={{ color: "#E8EAF0", fontWeight: 600 }}>{r.channel}</span></Td>
            <Td><div style={{ color: "#E8EAF0" }}>{r.contact?.name || r._user?.name || "—"}</div>
              <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r.contact?.phone || r._user?.phone || ""}</div></Td>
            <Td style={{ maxWidth: 260 }}>
              <div style={{ color: "#8A8FA8", fontSize: 12 }}>{r.property_ref || "—"}</div>
              {r.listing_url && <a href={r.listing_url} target="_blank" rel="noreferrer" style={{ color: "#3D9CF5", fontSize: 11, wordBreak: "break-all" }}>{r.listing_url.slice(0, 48)}</a>}
            </Td>
            <Td><StatusPicker source="channel" id={r.id} status={r.status} busy={busy} onStatus={onStatus} /></Td>
            <Td style={{ color: "#8A8FA8", fontSize: 12 }}>{when(r.created_at)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────── */

type TableProps = { rows: any[]; busy: string; onStatus: (s: string, id: string, st: string) => void };

function StatusPicker({ source, id, status, busy, onStatus }:
  { source: string; id: string; status?: string; busy: string; onStatus: (s: string, id: string, st: string) => void }) {
  const opts = STATUS_OPTS[source] || [];
  return (
    <select
      value={status || opts[0]}
      disabled={busy === id}
      onChange={(e) => onStatus(source, id, e.target.value)}
      style={{
        background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)",
        color: statusColor(status), borderRadius: 8, padding: "4px 8px",
        fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", outline: "none",
      }}>
      {opts.map((o) => <option key={o} value={o} style={{ color: "#0F1117" }}>{o}</option>)}
    </select>
  );
}

function StaticBadge({ status }: { status?: string }) {
  return (
    <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: `${statusColor(status)}1a`, color: statusColor(status), border: `1px solid ${statusColor(status)}33` }}>
      {status || "—"}
    </span>
  );
}

function statusColor(s?: string): string {
  switch (s) {
    case "converted": case "connected": case "completed": case "delivered": case "paid": return "#2ECC71";
    case "qualified": case "contacted": case "assigned": case "visited": case "syncing": case "processing": case "in_progress": return "#3D9CF5";
    case "cancelled": case "closed": case "error": return "#EF4444";
    case "paused": return "#9CA3AF";
    default: return "#F59E0B"; // new / requested / pending
  }
}

function Kpi({ label, value, sub, color, subtle }: { label: string; value: string; sub?: string; color: string; subtle?: boolean }) {
  return (
    <div style={{ background: "#151820", border: `1px solid ${subtle ? "rgba(255,255,255,0.07)" : `${color}33`}`, borderRadius: 12, padding: 14 }}>
      <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>{label}</p>
      <p style={{ color, fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "Syne, sans-serif" }}>{value}</p>
      {sub && <p style={{ color: "#8A8FA8", fontSize: 11, margin: "2px 0 0" }}>{sub}</p>}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div style={{ padding: 36, textAlign: "center", color: "#8A8FA8", fontSize: 13 }}>{label}</div>;
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" | "left" }) {
  return <th style={{ padding: "10px 12px", textAlign: align || "left", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, align, style }: { children: React.ReactNode; align?: "right" | "left"; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 12px", textAlign: align || "left", verticalAlign: "top", ...style }}>{children}</td>;
}

const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const trHead: React.CSSProperties = { background: "rgba(0,0,0,0.35)", color: "#8A8FA8" };
const trBody: React.CSSProperties = { borderTop: "1px solid rgba(255,255,255,0.06)" };
const pill: React.CSSProperties = { padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.05)", color: "#C9CEDB", border: "1px solid rgba(255,255,255,0.1)" };
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117",
  border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", fontSize: 13,
};
