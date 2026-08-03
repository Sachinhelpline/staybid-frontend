"use client";
import { useEffect, useState } from "react";
import { Flag, ShieldAlert, ClipboardList, MessageSquare } from "lucide-react";
import KPICard from "@/components/admin/kpi-card";
import DataTable from "@/components/admin/data-table";
import { adminColors as C, h1Style, pageStyle, pill } from "@/lib/admin/styles";

const smallBtn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: "pointer", background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)", color: C.text,
};

const REASON_LABEL: Record<string, string> = {
  spam: "Spam / scam", inappropriate: "Inappropriate", misleading: "Misleading / fake",
  offplatform: "Off-platform contact", other: "Other",
};
function statusPill(s: string) {
  const map: Record<string, string> = { open: C.amber, reviewed: C.green, dismissed: C.textDim, actioned: C.purple };
  return <span style={pill(map[s] || C.textDim, "")}>{s}</span>;
}
function fmtWhen(ts?: string) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ts; }
}

export default function AdminModeration() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"reports" | "flags">("reports");

  function load() {
    setLoading(true);
    fetch("/api/admin/moderation").then((r) => r.json()).then((d) => { setData(d); setLoading(false); });
  }
  useEffect(() => { load(); }, []);

  async function setStatus(table: string, id: string, status: string) {
    await fetch("/api/admin/moderation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, id, status }),
    });
    load();
  }

  if (loading) {
    return <div style={pageStyle}><h1 style={h1Style}>Moderation</h1><div style={{ color: C.textDim }}>Loading…</div></div>;
  }

  const kpis = data?.kpis || {};
  const reports: any[] = data?.reports || [];
  const flags: any[] = data?.flags || [];

  const reportCols: any[] = [
    { key: "reason", label: "Reason", render: (r: any) => <span style={pill(C.red, "")}>{REASON_LABEL[r.reason] || r.reason}</span> },
    { key: "target", label: "Reel / Hotel", render: (r: any) => (
      <span style={{ color: C.text, fontSize: 13 }}>
        {r.hotel_name || r.hotel_id || "—"}
        <span style={{ color: C.textDim, fontFamily: "monospace", fontSize: 11, display: "block" }}>{(r.post_id || "").slice(0, 18)}</span>
      </span>
    ) },
    { key: "author", label: "Author", render: (r: any) => <span style={{ color: C.textDim, fontSize: 12 }}>{r.author_handle || "—"}</span> },
    { key: "reporter_id", label: "Reporter", render: (r: any) => <span style={{ color: C.textDim, fontFamily: "monospace", fontSize: 11 }}>{r.reporter_id ? String(r.reporter_id).slice(0, 8) : "anon"}</span> },
    { key: "created_at", label: "When", render: (r: any) => <span style={{ color: C.textDim, fontSize: 12 }}>{fmtWhen(r.created_at)}</span> },
    { key: "status", label: "Status", render: (r: any) => statusPill(r.status) },
    { key: "actions", label: "", render: (r: any) => (
      <div style={{ display: "flex", gap: 6 }}>
        {r.status !== "reviewed" && <button onClick={() => setStatus("content_reports", r.id, "reviewed")} style={{ ...smallBtn, color: C.green, borderColor: `${C.green}55` }}>Reviewed</button>}
        {r.status !== "dismissed" && <button onClick={() => setStatus("content_reports", r.id, "dismissed")} style={smallBtn}>Dismiss</button>}
      </div>
    ) },
  ];

  const flagCols: any[] = [
    { key: "reasons", label: "Tripped", render: (f: any) => <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{(f.reasons || []).map((x: string) => <span key={x} style={pill(C.amber, "")}>{x}</span>)}</span> },
    { key: "raw_text", label: "Attempted comment", render: (f: any) => (
      <span style={{ color: C.text, fontSize: 13, maxWidth: 320, display: "inline-block" }}>
        {f.raw_text}
        <span style={{ color: C.textDim, fontSize: 11, display: "block" }}>shown as: {f.masked_text}</span>
      </span>
    ) },
    { key: "author_id", label: "By", render: (f: any) => <span style={{ color: C.textDim, fontFamily: "monospace", fontSize: 11 }}>{f.author_name || (f.author_id ? String(f.author_id).slice(0, 8) : "anon")}</span> },
    { key: "hotel_name", label: "On", render: (f: any) => <span style={{ color: C.textDim, fontSize: 12 }}>{f.hotel_name || f.hotel_id || "—"}</span> },
    { key: "created_at", label: "When", render: (f: any) => <span style={{ color: C.textDim, fontSize: 12 }}>{fmtWhen(f.created_at)}</span> },
    { key: "status", label: "Status", render: (f: any) => statusPill(f.status) },
    { key: "actions", label: "", render: (f: any) => (
      <div style={{ display: "flex", gap: 6 }}>
        {f.status !== "reviewed" && <button onClick={() => setStatus("comment_flags", f.id, "reviewed")} style={{ ...smallBtn, color: C.green, borderColor: `${C.green}55` }}>Reviewed</button>}
        {f.status !== "dismissed" && <button onClick={() => setStatus("comment_flags", f.id, "dismissed")} style={smallBtn}>Dismiss</button>}
      </div>
    ) },
  ];

  const tabBtn = (key: "reports" | "flags", label: string): React.CSSProperties => ({
    padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
    background: tab === key ? "rgba(140, 160, 182,0.14)" : "transparent",
    border: `1px solid ${tab === key ? "rgba(140, 160, 182,0.4)" : "rgba(255,255,255,0.1)"}`,
    color: tab === key ? C.gold : C.textDim,
  });

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>Moderation</h1>
      <p style={{ color: C.textDim, marginTop: -8, marginBottom: 18, fontSize: 13 }}>
        Reported reels + comments where contact info was auto-blocked. Mark items Reviewed or Dismiss once handled.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
        <KPICard title="Open reel reports" value={kpis.openReports ?? 0} icon={<Flag size={18} strokeWidth={2} aria-hidden />} color={C.red} />
        <KPICard title="Open comment flags" value={kpis.openFlags ?? 0} icon={<ShieldAlert size={18} strokeWidth={2} aria-hidden />} color={C.amber} />
        <KPICard title="Total reports" value={kpis.totalReports ?? 0} icon={<ClipboardList size={18} strokeWidth={2} aria-hidden />} color={C.textDim} />
        <KPICard title="Total flags" value={kpis.totalFlags ?? 0} icon={<MessageSquare size={18} strokeWidth={2} aria-hidden />} color={C.textDim} />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button style={{ ...tabBtn("reports", "reports"), display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setTab("reports")}><Flag size={14} strokeWidth={2.2} aria-hidden />Reported reels ({reports.length})</button>
        <button style={{ ...tabBtn("flags", "flags"), display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setTab("flags")}><ShieldAlert size={14} strokeWidth={2.2} aria-hidden />Blocked-contact comments ({flags.length})</button>
      </div>

      {tab === "reports"
        ? <DataTable columns={reportCols} data={reports as any} emptyMessage="No reports yet" />
        : <DataTable columns={flagCols} data={flags as any} emptyMessage="No blocked comments yet" />}
    </div>
  );
}
