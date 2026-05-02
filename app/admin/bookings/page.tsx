"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";

export default function AdminBookings() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [hotel, setHotel] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  function load() {
    setLoading(true);
    const q = new URLSearchParams({ status, hotel });
    fetch(`/api/admin/bookings?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => { setBookings(d.bookings || []); setLoading(false); })
      .catch(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const columns = [
    { key: "id", label: "Bid ID", render: (b: any) => <code style={{ color: "#8A8FA8", fontSize: 12 }}>BID-{b.id?.slice(0, 8)}</code> },
    { key: "hotelName", label: "Hotel", render: (b: any) => <span>{b.hotelName} <span style={{ color: "#8A8FA8", fontSize: 11 }}>· {b.hotelCity}</span></span> },
    {
      key: "checkIn",
      label: "Stay",
      render: (b: any) => b.checkIn ? `${new Date(b.checkIn).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} → ${new Date(b.checkOut).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : "—",
    },
    {
      key: "amount",
      label: "Bid",
      render: (b: any) => `₹${Number(b.amount).toLocaleString()}`,
    },
    {
      key: "paidTotal",
      label: "Paid",
      render: (b: any) => b.paidTotal ? <span style={{ color: "#2ECC71" }}>₹{Number(b.paidTotal).toLocaleString()}</span> : <span style={{ color: "#8A8FA8" }}>—</span>,
    },
    {
      key: "flowType",
      label: "Flow",
      render: (b: any) => b.flowType ? <span style={{ background: "rgba(168,85,247,0.15)", color: "#A855F7", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}>{b.flowType}</span> : "—",
    },
    {
      key: "status",
      label: "Status",
      render: (b: any) => (
        <span
          style={{
            background: bidStatusColor(b.status) + "22",
            color: bidStatusColor(b.status),
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {b.status}
        </span>
      ),
    },
    {
      key: "createdAt",
      label: "Created",
      render: (b: any) => new Date(b.createdAt).toLocaleDateString("en-IN"),
    },
    {
      key: "actions",
      label: "",
      render: (b: any) => (
        <button
          onClick={() => setSelected(b)}
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
          Timeline
        </button>
      ),
    },
  ];

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      <h1 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 28, margin: "0 0 20px" }}>
        Bookings & Bids
      </h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Filter by hotel name…"
          value={hotel}
          onChange={(e) => setHotel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={inputStyle}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="counter">Countered</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Checked In</option>
          <option value="checked_out">Checked Out</option>
        </select>
        <button onClick={load} style={btnStyle}>Search</button>
        <span style={{ marginLeft: "auto", color: "#8A8FA8", alignSelf: "center", fontSize: 13 }}>
          {bookings.length} bids
        </span>
      </div>

      <DataTable columns={columns} data={bookings} loading={loading} pageSize={15} />

      {selected && <BidTimelineModal bid={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BidTimelineModal({ bid, onClose }: { bid: any; onClose: () => void }) {
  const steps = [
    { label: "Bid Created", date: bid.createdAt, done: true },
    { label: "Hotel Countered", date: bid.counterAmount ? bid.createdAt : null, done: !!bid.counterAmount },
    { label: "Accepted", date: ["accepted", "confirmed", "checked_in", "checked_out"].includes(bid.status?.toLowerCase()) ? bid.createdAt : null, done: ["accepted", "confirmed", "checked_in", "checked_out"].includes(bid.status?.toLowerCase()) },
    { label: "Payment", date: bid.paidTotal ? bid.createdAt : null, done: !!bid.paidTotal },
    { label: "Checked In", date: ["checked_in", "checked_out"].includes(bid.status?.toLowerCase()) ? bid.checkIn : null, done: ["checked_in", "checked_out"].includes(bid.status?.toLowerCase()) },
    { label: "Checked Out", date: bid.status?.toLowerCase() === "checked_out" ? bid.checkOut : null, done: bid.status?.toLowerCase() === "checked_out" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 640, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", margin: "0 0 4px" }}>BID-{bid.id?.slice(0, 8)}</h2>
            <div style={{ color: "#8A8FA8", fontSize: 13 }}>{bid.hotelName} · {bid.hotelCity}</div>
          </div>
          <span
            style={{
              background: bidStatusColor(bid.status) + "22",
              color: bidStatusColor(bid.status),
              padding: "6px 14px",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {bid.status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "20px 0" }}>
          <Stat label="Bid Amount" value={`₹${Number(bid.amount).toLocaleString()}`} />
          <Stat label="Counter" value={bid.counterAmount ? `₹${Number(bid.counterAmount).toLocaleString()}` : "—"} />
          <Stat label="Paid Total" value={bid.paidTotal ? `₹${Number(bid.paidTotal).toLocaleString()}` : "—"} />
          <Stat label="Flow Type" value={bid.flowType || "—"} />
        </div>

        {/* Timeline */}
        <div style={{ marginTop: 24 }}>
          <div style={{ color: "#8A8FA8", fontSize: 12, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Workflow Timeline
          </div>
          <div style={{ position: "relative", paddingLeft: 24 }}>
            <div style={{ position: "absolute", left: 7, top: 4, bottom: 4, width: 2, background: "rgba(255,255,255,0.07)" }} />
            {steps.map((s, i) => (
              <div key={i} style={{ position: "relative", paddingBottom: 18 }}>
                <div
                  style={{
                    position: "absolute",
                    left: -22,
                    top: 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: s.done ? "#2ECC71" : "#0F1117",
                    border: `2px solid ${s.done ? "#2ECC71" : "rgba(255,255,255,0.15)"}`,
                  }}
                />
                <div style={{ color: s.done ? "#E8EAF0" : "#8A8FA8", fontSize: 14, fontWeight: s.done ? 600 : 400 }}>
                  {s.label}
                </div>
                {s.date && (
                  <div style={{ color: "#8A8FA8", fontSize: 11, marginTop: 2 }}>
                    {new Date(s.date).toLocaleString("en-IN")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {bid.message && (
          <div style={{ marginTop: 16, padding: 14, background: "#0F1117", borderRadius: 10, borderLeft: "3px solid #D4AF37" }}>
            <div style={{ color: "#8A8FA8", fontSize: 11, marginBottom: 4 }}>MESSAGE</div>
            <div style={{ color: "#E8EAF0", fontSize: 13 }}>{bid.message}</div>
          </div>
        )}

        <div style={{ marginTop: 24, display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
          <button
            onClick={() => alert(`Refund stub: ₹${bid.paidTotal} would be refunded via Razorpay`)}
            style={{ ...btnStyle, background: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.3)" }}
          >
            Trigger Refund
          </button>
          <button
            onClick={() => alert("Booking flagged for manual review")}
            style={{ ...btnStyle, background: "rgba(240,208,96,0.1)", color: "#F0D060", border: "1px solid rgba(240,208,96,0.3)" }}
          >
            Escalate
          </button>
          <button onClick={onClose} style={{ ...btnStyle, marginLeft: "auto", background: "#0F1117", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.07)" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: "#0F1117", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ color: "#8A8FA8", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ color: "#E8EAF0", fontSize: 18, fontWeight: 600, marginTop: 4, fontFamily: "Syne, sans-serif" }}>{value}</div>
    </div>
  );
}
function bidStatusColor(s: string) {
  const x = (s || "").toLowerCase();
  if (["accepted", "confirmed", "checked_in", "checked_out"].includes(x)) return "#2ECC71";
  if (["rejected", "cancelled"].includes(x)) return "#FF4757";
  if (["counter", "open", "pending"].includes(x)) return "#D4AF37";
  return "#8A8FA8";
}
const inputStyle: React.CSSProperties = { background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px", color: "#E8EAF0", fontSize: 14, outline: "none", fontFamily: "DM Sans, sans-serif", minWidth: 220 };
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 160, cursor: "pointer" };
const btnStyle: React.CSSProperties = { background: "#D4AF37", color: "#000", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" };
