"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";
import Modal, { Field } from "@/components/admin/modal";
import { adminColors as C, btnGold, btnGhost, h1Style, inputStyle, pageStyle, pill } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";
import TrustRing from "@/components/verify/TrustRing";
import VerifChecklist from "@/components/verify/VerifChecklist";
import { CountUp } from "@/components/CountUp";

// Defensive extraction — admin rows may carry the AI report as an object,
// a JSON string, or not at all. Never throw.
function aiReportObj(sel: any): any | null {
  const raw = sel?.aiReport ?? sel?.ai_report ?? sel?.report ?? null;
  if (!raw) return null;
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return null; } }
  return raw;
}
function trustOf(sel: any): number | null {
  const rep = aiReportObj(sel);
  const v = rep?.trust_score ?? sel?.trustScore ?? sel?.trust_score;
  return typeof v === "number" ? v : null;
}

type Tab = "pending" | "submitted" | "complaints";

export default function AdminVerification() {
  const [tab, setTab] = useState<Tab>("pending");
  const [pending, setPending] = useState<any[]>([]);
  const [submitted, setSubmitted] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [verdict, setVerdict] = useState<string>("approved");
  const [notes, setNotes] = useState("");
  const [refund, setRefund] = useState("0");

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/verification/pending").then((r) => r.json()),
      fetch("/api/admin/verification/submitted").then((r) => r.json()),
      fetch("/api/admin/complaints?type=video").then((r) => r.json()),
    ]).then(([p, s, c]) => {
      setPending(p.pending || []);
      setSubmitted(s.videos || []);
      setComplaints(c.complaints || []);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function submitVerdict() {
    if (!selected) return;
    await fetch("/api/admin/verification/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: selected.id,
        verdict,
        notes,
        refundAmount: Number(refund) || 0,
      }),
    });
    setSelected(null);
    setNotes("");
    setRefund("0");
    setVerdict("approved");
    load();
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "pending", label: "Pending Review", count: pending.length },
    { id: "submitted", label: "Submitted Videos", count: submitted.length },
    { id: "complaints", label: "Complaints", count: complaints.length },
  ];

  const rows = tab === "pending" ? pending : tab === "submitted" ? submitted : complaints;
  const columns =
    tab === "pending" ? pendingCols(setSelected) : tab === "submitted" ? submittedCols() : complaintCols();

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h1 className="admin-h1" style={{ ...h1Style, margin: 0 }}>Video Verification</h1>
        <button
          onClick={() => exportRows(`verification-${tab}`, rows, columns.filter((c: any) => c.key !== "actions" && c.key !== "url"))}
          style={{ ...btnGhost, marginLeft: "auto" }}
        >
          Export CSV
        </button>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Pending review", value: pending.length, c: C.amber, hint: "Awaiting verdict" },
          { label: "Submitted videos", value: submitted.length, c: C.green, hint: "Recorded proofs" },
          { label: "Complaints", value: complaints.length, c: C.purple, hint: "Disputes raised" },
        ].map((k) => (
          <div key={k.label}
               style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -12, top: -12, width: 56, height: 56, borderRadius: 999, background: `${k.c}1a` }} />
            <div style={{ fontSize: 26, fontWeight: 800, color: k.c, fontVariantNumeric: "tabular-nums", position: "relative" }}>
              <CountUp value={k.value} duration={850} />
            </div>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginTop: 2 }}>{k.label}</div>
            <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 1 }}>{k.hint}</div>
          </div>
        ))}
      </div>

      <div className="admin-tabs" style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "transparent",
              border: "none",
              color: tab === t.id ? C.gold : C.textDim,
              padding: "12px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === t.id ? `2px solid ${C.gold}` : "2px solid transparent",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            {t.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>({t.count})</span>
          </button>
        ))}
      </div>

      <DataTable columns={columns} data={rows} loading={loading} pageSize={15} />

      {selected && (
        <Modal onClose={() => setSelected(null)} width={720}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 16px" }}>Verification Review</h2>

          {trustOf(selected) != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18, padding: 14, borderRadius: 12, background: C.surface, border: `1px solid ${C.border}` }}>
              <TrustRing score={trustOf(selected) as number} size={88} tone="dark" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, fontWeight: 700 }}>AI Trust Score</div>
                <div style={{ fontFamily: "Syne, sans-serif", fontSize: 17, color: C.text, marginTop: 2 }}>
                  {(trustOf(selected) as number) >= 80 ? "Room matches the promise" : (trustOf(selected) as number) >= 50 ? "Partial match — review" : "Low confidence — inspect"}
                </div>
                {Array.isArray(aiReportObj(selected)?.issues_detected) && aiReportObj(selected).issues_detected.length > 0 && (
                  <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>{aiReportObj(selected).issues_detected[0]}</div>
                )}
              </div>
            </div>
          )}

          <Field label="Request ID" value={selected.id?.slice(0, 12)} />
          <Field label="Hotel" value={selected.hotelName || selected.hotelId || "—"} />
          <Field label="Customer" value={selected.customerPhone || selected.customerId || "—"} />
          <Field label="Booking ID" value={selected.bookingId || "—"} />
          <Field label="Status" value={<span style={pill(C.amber, "")}>{selected.status}</span>} />
          <Field label="Submitted" value={selected.createdAt ? new Date(selected.createdAt).toLocaleString("en-IN") : "—"} />

          {selected.videoUrl && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: C.textDim, fontSize: 12, marginBottom: 8 }}>VIDEO EVIDENCE</div>
              <video src={selected.videoUrl} controls style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 360 }} />
            </div>
          )}

          {selected.aiReport && (
            <div style={{ marginTop: 16, background: "rgba(61,156,245,0.06)", border: `1px solid rgba(61,156,245,0.2)`, padding: 14, borderRadius: 10 }}>
              <div style={{ color: C.blue, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>AI ANALYSIS</div>
              {aiReportObj(selected)?.checks && (
                <div style={{ marginBottom: 10 }}>
                  <VerifChecklist checks={aiReportObj(selected).checks} tone="dark" columns={2} />
                </div>
              )}
              <div style={{ color: C.text, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {typeof selected.aiReport === "string" ? selected.aiReport : JSON.stringify(selected.aiReport, null, 2)}
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ color: C.textDim, fontSize: 12, marginBottom: 10 }}>VERDICT</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { v: "approved", c: C.green, l: "Approve" },
                { v: "rejected", c: C.red, l: "Reject" },
                { v: "refund", c: C.amber, l: "Refund" },
                { v: "escalate", c: C.purple, l: "Escalate" },
              ].map((b) => (
                <button
                  key={b.v}
                  onClick={() => setVerdict(b.v)}
                  style={{
                    background: verdict === b.v ? b.c : "transparent",
                    color: verdict === b.v ? "#000" : b.c,
                    border: `1px solid ${b.c}66`,
                    padding: "8px 14px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {b.l}
                </button>
              ))}
            </div>
            {verdict === "refund" && (
              <input
                type="number"
                placeholder="Refund amount (₹)"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
                style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
              />
            )}
            <textarea
              placeholder="Admin notes (optional)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={submitVerdict} style={btnGold}>Submit Verdict</button>
              <button onClick={() => setSelected(null)} style={btnGhost}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function pendingCols(setSelected: (r: any) => void) {
  return [
    { key: "id", label: "ID", render: (r: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{r.id?.slice(0, 8)}</span> },
    { key: "hotelName", label: "Hotel", render: (r: any) => r.hotelName || r.hotelId?.slice(0, 8) || "—" },
    { key: "customerPhone", label: "Customer", render: (r: any) => r.customerPhone || r.customerId?.slice(0, 8) || "—" },
    { key: "bookingId", label: "Booking", render: (r: any) => r.bookingId?.slice(0, 8) || "—" },
    { key: "status", label: "Status", render: (r: any) => <span style={pill(C.amber, "")}>{r.status}</span> },
    { key: "createdAt", label: "Created", render: (r: any) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—") },
    { key: "actions", label: "", render: (r: any) => <button onClick={() => setSelected(r)} style={smallBtn}>Review</button> },
  ];
}

function submittedCols() {
  return [
    { key: "id", label: "ID", render: (r: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{r.id?.slice(0, 8)}</span> },
    { key: "bookingId", label: "Booking", render: (r: any) => r.bookingId?.slice(0, 8) || "—" },
    { key: "duration", label: "Duration", render: (r: any) => (r.duration ? `${r.duration}s` : "—") },
    { key: "size", label: "Size", render: (r: any) => (r.size ? `${(r.size / 1024 / 1024).toFixed(1)} MB` : "—") },
    { key: "uploadedAt", label: "Uploaded", render: (r: any) => (r.uploadedAt ? new Date(r.uploadedAt).toLocaleString("en-IN") : "—") },
    {
      key: "url",
      label: "",
      render: (r: any) =>
        r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: "none", display: "inline-block" }}>
            Watch
          </a>
        ) : null,
    },
  ];
}

function complaintCols() {
  return [
    { key: "id", label: "ID", render: (r: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{r.id?.slice(0, 8)}</span> },
    { key: "type", label: "Type", render: (r: any) => <span style={pill(C.purple, "")}>{r.type || "general"}</span> },
    { key: "subject", label: "Subject", render: (r: any) => r.subject || r.description?.slice(0, 60) || "—" },
    {
      key: "priority",
      label: "Priority",
      render: (r: any) => (
        <span style={pill(r.priority === "high" ? C.red : r.priority === "medium" ? C.amber : C.textDim, "")}>{r.priority || "low"}</span>
      ),
    },
    { key: "status", label: "Status", render: (r: any) => <span style={pill(r.status === "resolved" ? C.green : C.amber, "")}>{r.status || "open"}</span> },
    { key: "createdAt", label: "Created", render: (r: any) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—") },
  ];
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
