"use client";
import { useEffect, useState } from "react";
import DataTable from "@/components/admin/data-table";
import Modal from "@/components/admin/modal";
import KPICard from "@/components/admin/kpi-card";
import { adminColors as C, btnGold, btnGhost, h1Style, inputStyle, pageStyle, pill } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

type Tab = "status" | "flash" | "overrides";

export default function AdminPricing() {
  const [tab, setTab] = useState<Tab>("status");
  const [status, setStatus] = useState<any>(null);
  const [deals, setDeals] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingRoom, setEditingRoom] = useState<any | null>(null);
  const [floor, setFloor] = useState("");
  const [ai, setAi] = useState("");

  // flash form
  const [fHotel, setFHotel] = useState("");
  const [fRoom, setFRoom] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fDiscount, setFDiscount] = useState("20");
  const [fValid, setFValid] = useState("");

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/pricing/status").then((r) => r.json()),
      fetch("/api/admin/pricing/flash").then((r) => r.json()),
      fetch("/api/admin/pricing/override").then((r) => r.json()),
    ]).then(([s, f, o]) => {
      setStatus(s);
      setDeals(f.deals || []);
      setRooms(o.rooms || []);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function createDeal() {
    if (!fHotel || !fRoom || !fPrice || !fValid) {
      alert("Hotel, Room, Price, and Valid Until are required");
      return;
    }
    await fetch("/api/admin/pricing/flash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotelId: fHotel,
        roomId: fRoom,
        price: Number(fPrice),
        discount: Number(fDiscount),
        validUntil: fValid,
        createdAt: new Date().toISOString(),
      }),
    });
    setCreating(false);
    setFHotel(""); setFRoom(""); setFPrice(""); setFDiscount("20"); setFValid("");
    load();
  }

  async function deleteDeal(id: string) {
    if (!confirm("Delete this flash deal?")) return;
    await fetch(`/api/admin/pricing/flash?id=${id}`, { method: "DELETE" });
    load();
  }

  async function saveOverride() {
    if (!editingRoom) return;
    await fetch("/api/admin/pricing/override", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: editingRoom.id,
        floorPrice: floor ? Number(floor) : null,
        aiPrice: ai ? Number(ai) : null,
      }),
    });
    setEditingRoom(null);
    setFloor(""); setAi("");
    load();
  }

  const dealCols: any[] = [
    { key: "id", label: "ID", render: (d: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{d.id?.slice(0, 8)}</span> },
    { key: "hotelId", label: "Hotel", render: (d: any) => d.hotelName || d.hotelId?.slice(0, 8) || "—" },
    { key: "roomId", label: "Room", render: (d: any) => d.roomId?.slice(0, 8) || "—" },
    { key: "price", label: "Price", render: (d: any) => `₹${Number(d.price || 0).toLocaleString()}` },
    { key: "discount", label: "Discount", render: (d: any) => <span style={pill(C.gold, "")}>{d.discount}%</span> },
    {
      key: "validUntil",
      label: "Valid Until",
      render: (d: any) => {
        const expired = new Date(d.validUntil) < new Date();
        return <span style={{ color: expired ? C.red : C.green, fontSize: 12 }}>{d.validUntil ? new Date(d.validUntil).toLocaleString("en-IN") : "—"}</span>;
      },
    },
    { key: "actions", label: "", render: (d: any) => <button onClick={() => deleteDeal(d.id)} style={{ ...smallBtn, color: C.red, border: `1px solid ${C.red}33`, background: "rgba(255,71,87,0.1)" }}>Delete</button> },
  ];

  const roomCols: any[] = [
    { key: "id", label: "ID", render: (r: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{r.id?.slice(0, 8)}</span> },
    { key: "hotel", label: "Hotel", render: (r: any) => r.hotels?.name || "—" },
    { key: "city", label: "City", render: (r: any) => r.hotels?.city || "—" },
    { key: "type", label: "Type" },
    { key: "floorPrice", label: "Floor", render: (r: any) => `₹${Number(r.floorPrice || 0).toLocaleString()}` },
    { key: "aiPrice", label: "AI Price", render: (r: any) => (r.aiPrice ? <span style={{ color: C.blue }}>₹{Number(r.aiPrice).toLocaleString()}</span> : <span style={{ color: C.textDim }}>—</span>) },
    {
      key: "actions",
      label: "",
      render: (r: any) => (
        <button
          onClick={() => {
            setEditingRoom(r);
            setFloor(r.floorPrice?.toString() || "");
            setAi(r.aiPrice?.toString() || "");
          }}
          style={smallBtn}
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ ...h1Style, margin: 0 }}>Pricing & Deals</h1>
        {tab === "flash" && (
          <button onClick={() => setCreating(true)} style={{ ...btnGold, marginLeft: "auto" }}>+ New Flash Deal</button>
        )}
        {tab === "overrides" && (
          <button
            onClick={() => exportRows("price-overrides", rooms, roomCols.filter((c: any) => c.key !== "actions"))}
            style={{ ...btnGhost, marginLeft: "auto" }}
          >
            Export CSV
          </button>
        )}
        {tab === "flash" && (
          <button
            onClick={() => exportRows("flash-deals", deals, dealCols.filter((c: any) => c.key !== "actions"))}
            style={{ ...btnGhost, marginLeft: 8 }}
          >
            Export CSV
          </button>
        )}
      </div>

      <div className="admin-tabs" style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        {(["status", "flash", "overrides"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              color: tab === t ? C.gold : C.textDim,
              padding: "12px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === t ? `2px solid ${C.gold}` : "2px solid transparent",
              fontFamily: "DM Sans, sans-serif",
              textTransform: "capitalize",
            }}
          >
            {t === "status" ? "AI Status" : t === "flash" ? "Flash Deals" : "Overrides"}
          </button>
        ))}
      </div>

      {tab === "status" && status && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
            <KPICard title="AI-Managed Rooms" value={status.aiManaged} color={C.blue} />
            <KPICard title="Manual Pricing" value={status.manual} color={C.amber} />
            <KPICard title="Total Rooms" value={status.totalRooms} color={C.gold} />
            <KPICard title="Active Flash Deals" value={status.activeDeals} color={C.green} />
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ color: C.textDim, fontSize: 12, marginBottom: 8 }}>LAST RECALC</div>
            <div style={{ color: C.text, fontSize: 14 }}>{new Date(status.lastRecalc).toLocaleString("en-IN")}</div>
            <div style={{ color: C.textDim, fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
              AI prices recalculate every 60 seconds based on demand, day-of-week, and competitor prices. Use the Overrides tab to lock specific rooms.
            </div>
          </div>
        </div>
      )}

      {tab === "flash" && <DataTable columns={dealCols} data={deals} loading={loading} pageSize={15} />}
      {tab === "overrides" && <DataTable columns={roomCols} data={rooms} loading={loading} pageSize={15} />}

      {creating && (
        <Modal onClose={() => setCreating(false)} width={520}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 16px" }}>New Flash Deal</h2>
          <Lbl>Hotel ID</Lbl>
          <input value={fHotel} onChange={(e) => setFHotel(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} placeholder="hotel-1" />
          <Lbl>Room ID</Lbl>
          <input value={fRoom} onChange={(e) => setFRoom(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
          <Lbl>Price (₹)</Lbl>
          <input type="number" value={fPrice} onChange={(e) => setFPrice(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
          <Lbl>Discount %</Lbl>
          <input type="number" value={fDiscount} onChange={(e) => setFDiscount(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
          <Lbl>Valid Until</Lbl>
          <input type="datetime-local" value={fValid} onChange={(e) => setFValid(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createDeal} style={btnGold}>Create</button>
            <button onClick={() => setCreating(false)} style={btnGhost}>Cancel</button>
          </div>
        </Modal>
      )}

      {editingRoom && (
        <Modal onClose={() => setEditingRoom(null)} width={460}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 6px" }}>Override Pricing</h2>
          <div style={{ color: C.textDim, fontSize: 13, marginBottom: 16 }}>
            {editingRoom.hotels?.name || editingRoom.hotelId} — {editingRoom.type}
          </div>
          <Lbl>Floor Price (₹)</Lbl>
          <input type="number" value={floor} onChange={(e) => setFloor(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
          <Lbl>AI Price (₹) — leave blank to revert to AI</Lbl>
          <input type="number" value={ai} onChange={(e) => setAi(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveOverride} style={btnGold}>Save</button>
            <button
              onClick={async () => {
                setAi("");
                await fetch("/api/admin/pricing/override", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ roomId: editingRoom.id, aiPrice: null }),
                });
                setEditingRoom(null);
                load();
              }}
              style={{ ...btnGhost, color: C.blue, borderColor: `${C.blue}55` }}
            >
              Revert to AI
            </button>
            <button onClick={() => setEditingRoom(null)} style={btnGhost}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Lbl({ children }: { children: any }) {
  return <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6, fontWeight: 600, letterSpacing: 0.5 }}>{children}</div>;
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
