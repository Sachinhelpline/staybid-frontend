"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";
import Modal, { Field } from "@/components/admin/modal";
import { adminColors as C, btnGold, btnGhost, h1Style, inputStyle, pageStyle, pill, selectStyle } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

export default function AdminComplaints() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<any | null>(null);
  const [resolution, setResolution] = useState("resolved");
  const [refund, setRefund] = useState("0");
  const [notes, setNotes] = useState("");
  const [paymentId, setPaymentId] = useState("");

  function load() {
    setLoading(true);
    const q = new URLSearchParams({ type, status });
    fetch(`/api/admin/complaints?${q}`)
      .then((r) => r.json())
      .then((d) => {
        setList(d.complaints || []);
        setLoading(false);
      });
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [type, status]);

  async function resolve() {
    if (!selected) return;
    const r = await fetch("/api/admin/complaints/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        complaintId: selected.id,
        resolution,
        refundAmount: Number(refund) || 0,
        notes,
        paymentId: paymentId || selected.paymentId,
      }),
    });
    const result = await r.json();
    if (result.refund?.error) alert(`Refund failed: ${result.refund.error}`);
    setSelected(null);
    setNotes("");
    setRefund("0");
    setPaymentId("");
    setResolution("resolved");
    load();
  }

  const aiSuggestion = (c: any) => {
    if (!c) return null;
    if (c.priority === "high") return "Recommend full refund + hotel warning";
    if (c.type === "video") return "Review video evidence before deciding";
    if (c.type === "bid") return "Verify bid trail and consider partial refund";
    return "Mark resolved with explanation note";
  };

  const columns: any[] = [
    { key: "id", label: "ID", render: (r: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{r.id?.slice(0, 8)}</span> },
    { key: "type", label: "Type", render: (r: any) => <span style={pill(C.purple, "")}>{r.type || "general"}</span> },
    { key: "subject", label: "Subject", render: (r: any) => <span style={{ color: C.text }}>{r.subject || r.description?.slice(0, 60) || "—"}</span> },
    { key: "customerId", label: "Customer", render: (r: any) => r.customerPhone || r.customerId?.slice(0, 8) || "—" },
    { key: "priority", label: "Priority", render: (r: any) => <span style={pill(r.priority === "high" ? C.red : r.priority === "medium" ? C.amber : C.textDim, "")}>{r.priority || "low"}</span> },
    { key: "status", label: "Status", render: (r: any) => <span style={pill(r.status === "resolved" ? C.green : r.status === "rejected" ? C.red : C.amber, "")}>{r.status || "open"}</span> },
    { key: "createdAt", label: "Created", render: (r: any) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—") },
    { key: "actions", label: "", render: (r: any) => <button onClick={() => setSelected(r)} style={smallBtn}>Review</button> },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ ...h1Style, margin: 0 }}>Complaints</h1>
        <button
          onClick={() => exportRows("complaints", list, columns.filter((c: any) => c.key !== "actions"))}
          style={{ ...btnGhost, marginLeft: "auto" }}
        >
          Export CSV
        </button>
      </div>

      <div className="admin-filters" style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
          <option value="all">All Types</option>
          <option value="bid">Bid</option>
          <option value="booking">Booking</option>
          <option value="video">Video</option>
          <option value="general">General</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="rejected">Rejected</option>
        </select>
        <span style={{ marginLeft: "auto", color: C.textDim, alignSelf: "center", fontSize: 13 }}>
          Total: {list.length}
        </span>
      </div>

      <DataTable columns={columns} data={list} loading={loading} pageSize={15} />

      {selected && (
        <Modal onClose={() => setSelected(null)} width={600}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 16px" }}>
            Complaint #{selected.id?.slice(0, 8)}
          </h2>
          <Field label="Type" value={selected.type || "general"} />
          <Field label="Priority" value={<span style={pill(selected.priority === "high" ? C.red : selected.priority === "medium" ? C.amber : C.textDim, "")}>{selected.priority || "low"}</span>} />
          <Field label="Customer" value={selected.customerPhone || selected.customerId || "—"} />
          <Field label="Booking" value={selected.bookingId?.slice(0, 12) || "—"} />
          <Field label="Status" value={selected.status || "open"} />
          <Field label="Created" value={selected.createdAt ? new Date(selected.createdAt).toLocaleString("en-IN") : "—"} />

          <div style={{ marginTop: 14, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
            <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6 }}>DESCRIPTION</div>
            <div style={{ color: C.text, fontSize: 13, lineHeight: 1.6 }}>{selected.description || "No description provided."}</div>
          </div>

          <div style={{ marginTop: 14, padding: 14, background: "rgba(168,85,247,0.06)", border: `1px solid rgba(168,85,247,0.2)`, borderRadius: 10 }}>
            <div style={{ color: C.purple, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>AI SUGGESTED RESOLUTION</div>
            <div style={{ color: C.text, fontSize: 13 }}>{aiSuggestion(selected)}</div>
          </div>

          <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ color: C.textDim, fontSize: 12, marginBottom: 10 }}>RESOLUTION</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { v: "resolved", c: C.green, l: "Resolve" },
                { v: "rejected", c: C.red, l: "Reject" },
                { v: "escalate", c: C.purple, l: "Escalate" },
              ].map((b) => (
                <button
                  key={b.v}
                  onClick={() => setResolution(b.v)}
                  style={{
                    background: resolution === b.v ? b.c : "transparent",
                    color: resolution === b.v ? "#000" : b.c,
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
            <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6 }}>REFUND (₹) — leave 0 to skip</div>
            <input type="number" value={refund} onChange={(e) => setRefund(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
            {Number(refund) > 0 && (
              <input
                type="text"
                placeholder="Razorpay payment_id (e.g. pay_XXX)"
                value={paymentId}
                onChange={(e) => setPaymentId(e.target.value)}
                style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
              />
            )}
            <textarea
              placeholder="Internal notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={resolve} style={btnGold}>Submit</button>
              <button onClick={() => setSelected(null)} style={btnGhost}>Cancel</button>
            </div>
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
