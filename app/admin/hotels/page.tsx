"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";

export default function AdminHotels() {
  const [hotels, setHotels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  function load() {
    setLoading(true);
    const q = new URLSearchParams({ city, status, search });
    fetch(`/api/admin/hotels?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => { setHotels(d.hotels || []); setLoading(false); })
      .catch(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [city, status]);

  async function patch(action: string, value: any) {
    if (!selected) return;
    await fetch("/api/admin/hotels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotelId: selected.id, action, value }),
    });
    setSelected(null);
    load();
  }

  const cities = Array.from(new Set(hotels.map((h) => h.city).filter(Boolean)));

  const columns = [
    { key: "id", label: "ID", render: (h: any) => <code style={{ color: "#8A8FA8", fontSize: 12 }}>{h.id}</code> },
    { key: "name", label: "Hotel" },
    { key: "city", label: "City" },
    {
      key: "starRating",
      label: "Rating",
      render: (h: any) => <span style={{ color: "#D4AF37" }}>{"★".repeat(h.starRating || 0)}</span>,
    },
    { key: "roomsCount", label: "Rooms" },
    { key: "bookingsThisMonth", label: "Bookings (MTD)" },
    {
      key: "gmv",
      label: "GMV",
      render: (h: any) => `₹${Number(h.gmv || 0).toLocaleString()}`,
    },
    {
      key: "commission",
      label: "Commission",
      render: (h: any) => `${h.commission || 5}%`,
    },
    {
      key: "status",
      label: "Status",
      render: (h: any) => (
        <span
          style={{
            background: hotelStatusColor(h.status) + "22",
            color: hotelStatusColor(h.status),
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {h.status || "active"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (h: any) => (
        <button
          onClick={() => setSelected(h)}
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
          Manage
        </button>
      ),
    },
  ];

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      <h1 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 28, margin: "0 0 20px" }}>
        Hotels Management
      </h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Search hotel name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={inputStyle}
        />
        <select value={city} onChange={(e) => setCity(e.target.value)} style={selectStyle}>
          <option value="all">All Cities</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="pending">Pending</option>
        </select>
        <button onClick={load} style={btnStyle}>Search</button>
        <span style={{ marginLeft: "auto", color: "#8A8FA8", alignSelf: "center", fontSize: 13 }}>
          {hotels.length} hotels
        </span>
      </div>

      <DataTable columns={columns} data={hotels} loading={loading} pageSize={15} />

      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <h2 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", margin: "0 0 16px" }}>
            {selected.name}
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Stat label="Rooms" value={selected.roomsCount || 0} />
            <Stat label="Bookings (MTD)" value={selected.bookingsThisMonth || 0} />
            <Stat label="GMV" value={`₹${Number(selected.gmv || 0).toLocaleString()}`} />
            <Stat label="Commission" value={`${selected.commission || 5}%`} />
          </div>

          <Field label="ID" value={selected.id} />
          <Field label="City" value={selected.city || "—"} />
          <Field label="State" value={selected.state || "—"} />
          <Field label="Owner" value={selected.ownerId?.slice(0, 12) + "…"} />
          <Field label="Created" value={new Date(selected.createdAt).toLocaleDateString("en-IN")} />

          <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
            <div style={{ color: "#8A8FA8", fontSize: 12, marginBottom: 10 }}>STATUS ACTIONS</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => patch("status", "active")} style={{ ...btnStyle, background: "rgba(46,204,113,0.1)", color: "#2ECC71", border: "1px solid rgba(46,204,113,0.3)" }}>Approve / Activate</button>
              <button onClick={() => patch("status", "suspended")} style={{ ...btnStyle, background: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.3)" }}>Suspend</button>
            </div>
            <div style={{ color: "#8A8FA8", fontSize: 12, margin: "16px 0 10px" }}>OVERRIDE COMMISSION</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[3, 5, 7, 10, 15].map((c) => (
                <button key={c} onClick={() => patch("commission", c)} style={{ ...btnStyle, background: "#0F1117", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.3)" }}>
                  {c}%
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}
function hotelStatusColor(s: string) {
  if (s === "suspended") return "#FF4757";
  if (s === "pending") return "#F0D060";
  return "#2ECC71";
}
const inputStyle: React.CSSProperties = { background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px", color: "#E8EAF0", fontSize: 14, outline: "none", fontFamily: "DM Sans, sans-serif", minWidth: 220 };
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 140, cursor: "pointer" };
const btnStyle: React.CSSProperties = { background: "#D4AF37", color: "#000", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" };
