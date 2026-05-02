"use client";
import { useEffect, useState } from "react";
import KPICard from "@/components/admin/kpi-card";
import DataTable from "@/components/admin/data-table";
import Modal, { Field } from "@/components/admin/modal";
import { adminColors as C, btnGhost, h1Style, pageStyle, pill, selectStyle } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

export default function AdminFeedback() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState("all");
  const [selected, setSelected] = useState<any | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/feedback")
      .then((r) => r.json())
      .then((d) => {
        setList(d.feedback || []);
        setLoading(false);
      });
  }

  useEffect(() => { load(); }, []);

  const filtered = rating === "all" ? list : list.filter((f) => Math.round(Number(f.rating || 0)) === Number(rating));

  const avg = list.length ? list.reduce((s, f) => s + Number(f.rating || 0), 0) / list.length : 0;
  const distribution = [1, 2, 3, 4, 5].map((r) => ({
    rating: r,
    count: list.filter((f) => Math.round(Number(f.rating || 0)) === r).length,
  }));
  const max = Math.max(1, ...distribution.map((d) => d.count));

  const cols: any[] = [
    { key: "id", label: "ID", render: (f: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{f.id?.slice(0, 8)}</span> },
    {
      key: "rating",
      label: "Rating",
      render: (f: any) => (
        <span style={{ color: ratingColor(f.rating), fontWeight: 600 }}>
          {"★".repeat(Math.round(Number(f.rating || 0)))}
          <span style={{ color: C.textDim }}>{"★".repeat(5 - Math.round(Number(f.rating || 0)))}</span>
        </span>
      ),
    },
    { key: "hotelName", label: "Hotel", render: (f: any) => f.hotelName || f.hotelId?.slice(0, 8) || "—" },
    { key: "customerPhone", label: "Customer", render: (f: any) => f.customerPhone || f.customerId?.slice(0, 8) || "—" },
    { key: "comment", label: "Comment", render: (f: any) => <span style={{ color: C.text }}>{f.comment?.slice(0, 80) || <span style={{ color: C.textDim }}>—</span>}</span> },
    { key: "submittedAt", label: "Submitted", render: (f: any) => (f.submittedAt ? new Date(f.submittedAt).toLocaleDateString("en-IN") : "—") },
    { key: "actions", label: "", render: (f: any) => <button onClick={() => setSelected(f)} style={smallBtn}>View</button> },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ ...h1Style, margin: 0 }}>Feedback & Ratings</h1>
        <button
          onClick={() => exportRows("feedback", filtered, cols.filter((c: any) => c.key !== "actions"))}
          style={{ ...btnGhost, marginLeft: "auto" }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        <KPICard title="Average Rating" value={avg.toFixed(2)} sub={`${list.length} reviews`} color={ratingColor(avg)} />
        <KPICard title="5-Star" value={distribution[4].count} color={C.green} />
        <KPICard title="≤2-Star" value={distribution[0].count + distribution[1].count} color={C.red} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 24 }}>
        <div style={{ fontFamily: "Syne, sans-serif", color: C.text, fontSize: 18, marginBottom: 14 }}>Rating Distribution</div>
        {distribution.slice().reverse().map((d) => (
          <div key={d.rating} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span style={{ width: 32, color: ratingColor(d.rating), fontWeight: 600, fontSize: 13 }}>{d.rating}★</span>
            <div style={{ flex: 1, height: 10, background: "rgba(255,255,255,0.04)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${(d.count / max) * 100}%`, height: "100%", background: ratingColor(d.rating), transition: "width 0.3s" }} />
            </div>
            <span style={{ color: C.textDim, fontSize: 12, width: 32, textAlign: "right" }}>{d.count}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <select value={rating} onChange={(e) => setRating(e.target.value)} style={selectStyle}>
          <option value="all">All Ratings</option>
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </select>
        <span style={{ marginLeft: "auto", alignSelf: "center", color: C.textDim, fontSize: 13 }}>
          Showing {filtered.length} / {list.length}
        </span>
      </div>

      <DataTable columns={cols} data={filtered} loading={loading} pageSize={15} />

      {selected && (
        <Modal onClose={() => setSelected(null)} width={520}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 16px" }}>Feedback Detail</h2>
          <Field label="Rating" value={<span style={{ color: ratingColor(selected.rating) }}>{"★".repeat(Math.round(Number(selected.rating || 0)))}</span>} />
          <Field label="Hotel" value={selected.hotelName || selected.hotelId || "—"} />
          <Field label="Customer" value={selected.customerPhone || selected.customerId || "—"} />
          <Field label="Booking" value={selected.bookingId?.slice(0, 12) || "—"} />
          <Field label="Submitted" value={selected.submittedAt ? new Date(selected.submittedAt).toLocaleString("en-IN") : "—"} />
          {selected.comment && (
            <div style={{ marginTop: 14, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
              <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6 }}>COMMENT</div>
              <div style={{ color: C.text, fontSize: 13, lineHeight: 1.6 }}>{selected.comment}</div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function ratingColor(r: number) {
  const n = Number(r);
  if (n >= 4) return C.green;
  if (n >= 3) return C.amber;
  if (n >= 2) return "#FF8C42";
  return C.red;
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
