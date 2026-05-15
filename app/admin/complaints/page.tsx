"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";
import Modal, { Field } from "@/components/admin/modal";
import { adminColors as C, btnGold, btnGhost, h1Style, inputStyle, pageStyle, pill, selectStyle } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

// v127 — stay-feedback smiley grid + side-by-side video block
const SMILEY_GLYPH: Record<string, { icon: string; color: string; label: string }> = {
  positive: { icon: "😊", color: "#16a34a", label: "Loved it" },
  neutral:  { icon: "😐", color: "#a16207", label: "It's okay" },
  negative: { icon: "😞", color: "#dc2626", label: "Not good" },
};
const CHECKPOINT_LABELS: Record<string, string> = {
  roomMatch:    "Room matches video",
  staff:        "Staff behavior",
  hygiene:      "Hygiene & cleanliness",
  food:         "Food quality",
  staffResponse:"Staff response",
};

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
        <h1 className="admin-h1" style={{ ...h1Style, margin: 0 }}>Complaints</h1>
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
          <option value="stay_feedback">Stay Feedback (smiley)</option>
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

          {/* v127 — Smiley feedback grid + side-by-side videos */}
          {selected.feedbackType === "stay_feedback" && (
            <StayFeedbackBlock complaint={selected} />
          )}

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

// v127 — renders the smiley grid + side-by-side videos inside the admin
// complaint detail modal. Self-fetches the hotel + customer video URLs.
function StayFeedbackBlock({ complaint }: { complaint: any }) {
  const fb = (complaint?.feedback || {}) as Record<string, any>;
  const checkpointKeys = Object.keys(CHECKPOINT_LABELS);
  const negCount = checkpointKeys.filter((k) => fb[k] === "negative").length;
  const evidenceUrls: string[] = Array.isArray(fb.evidenceVideoUrls) ? fb.evidenceVideoUrls : [];

  const [videos, setVideos] = useState<{ hotelVideo: any; customerVideo: any } | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(false);

  useEffect(() => {
    const reqId = complaint?.verificationRequestId;
    const evId  = complaint?.evidenceVideoId;
    if (!reqId && !evId) { setVideos(null); return; }
    setLoadingVideos(true);
    const qs = new URLSearchParams();
    if (reqId) qs.set("requestId", reqId);
    if (evId)  qs.set("evidenceVideoId", evId);
    fetch(`/api/admin/complaints/videos?${qs.toString()}`)
      .then((r) => r.json())
      .then((j) => setVideos({ hotelVideo: j.hotelVideo, customerVideo: j.customerVideo }))
      .catch(() => setVideos(null))
      .finally(() => setLoadingVideos(false));
  }, [complaint?.verificationRequestId, complaint?.evidenceVideoId, complaint?.id]);

  // Pick the most-playable URL out of a vp_videos row (urls.mp4 / urls.webm / url).
  const pickUrl = (v: any): string | null => {
    if (!v) return null;
    if (v.urls && typeof v.urls === "object") {
      return v.urls.mp4 || v.urls.webm || v.urls.original || v.url || null;
    }
    return v.url || null;
  };

  const hotelUrl = pickUrl(videos?.hotelVideo);
  const customerUrl = pickUrl(videos?.customerVideo) || evidenceUrls[0] || null;

  return (
    <div style={{
      marginTop: 14, padding: 14,
      background: "rgba(212,175,55,0.06)",
      border: `1px solid rgba(212,175,55,0.25)`,
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ color: C.gold, fontSize: 11, fontWeight: 600 }}>STAY FEEDBACK · SMILEY CHECKPOINTS</div>
        <span style={pill(negCount >= 2 ? C.red : negCount === 1 ? C.amber : C.green, "")}>
          {negCount} negative
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
        {checkpointKeys.map((k) => {
          const v = fb[k];
          const g = v ? SMILEY_GLYPH[v] : null;
          return (
            <div key={k} style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: g ? `${g.color}15` : "rgba(255,255,255,0.03)",
              border: `1px solid ${g ? `${g.color}55` : "rgba(255,255,255,0.06)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 18 }}>{g?.icon || "—"}</span>
                <span style={{ fontSize: 11, color: g?.color || C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {g?.label || "—"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>{CHECKPOINT_LABELS[k]}</div>
            </div>
          );
        })}
      </div>

      {fb.note && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ color: C.textDim, fontSize: 10, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>Customer note</div>
          <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5 }}>{fb.note}</div>
        </div>
      )}

      {(complaint.verificationRequestId || complaint.evidenceVideoId || evidenceUrls.length > 0) && (
        <div>
          <div style={{ color: C.textDim, fontSize: 10, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Side-by-side review
          </div>
          {loadingVideos && !videos ? (
            <div style={{ color: C.textDim, fontSize: 12 }}>Loading videos…</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <VideoSlot title="Hotel's verification video" url={hotelUrl} emptyMsg="Hotel hasn't uploaded a verification video for this booking." />
              <VideoSlot title="Customer evidence" url={customerUrl}      emptyMsg="No evidence video — customer submitted feedback only." />
            </div>
          )}
          {evidenceUrls.length > 1 && (
            <div style={{ marginTop: 8, color: C.textDim, fontSize: 11 }}>
              + {evidenceUrls.length - 1} additional evidence segment{evidenceUrls.length - 1 > 1 ? "s" : ""} —{" "}
              {evidenceUrls.slice(1).map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ color: C.gold, marginRight: 8 }}>
                  segment {i + 2}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VideoSlot({ title, url, emptyMsg }: { title: string; url: string | null; emptyMsg: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600 }}>{title}</div>
      {url ? (
        <video src={url} controls playsInline preload="metadata"
               style={{ width: "100%", aspectRatio: "16 / 9", background: "#000", borderRadius: 6, border: `1px solid ${C.border}` }} />
      ) : (
        <div style={{
          aspectRatio: "16 / 9", background: "rgba(255,255,255,0.02)",
          border: `1px dashed ${C.border}`, borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 10,
          color: C.textDim, fontSize: 11, textAlign: "center",
        }}>
          {emptyMsg}
        </div>
      )}
    </div>
  );
}
