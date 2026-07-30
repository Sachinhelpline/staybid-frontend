"use client";
// /admin/hotel-commission-rules — per-hotel commission overrides.
// Lists every hotel with its effective commission (override OR platform default).
// Admin can set a flat % OR slab-based commission per hotel.

import { useEffect, useMemo, useState } from "react";

type Slab = { minBookings: number; maxBookings: number; pct: number };
type Rule = {
  id?: string;
  hotel_id?: string;
  platform_pct?: number | null;
  slabs?: Slab[] | null;
  notes?: string | null;
  active?: boolean;
};
type Row = {
  hotel: { id: string; name: string; city: string };
  rule: Rule;
  source: "hotel-override" | "platform-default";
};

export default function AdminHotelCommissionRulesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [globalDefault, setGlobalDefault] = useState<{ platform_pct: number; slabs: Slab[] | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<"all" | "hotel-override" | "platform-default">("all");
  const [editing, setEditing] = useState<Row | null>(null);
  const [mode, setMode] = useState<"flat" | "slabs">("flat");
  const [flatPct, setFlatPct] = useState("5");
  const [slabs, setSlabs] = useState<Slab[]>([{ minBookings: 1, maxBookings: 50, pct: 5 }]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    fetch("/api/admin/hotel-commission-rules", {
      headers: { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) },
    })
      .then((r) => r.json())
      .then((d) => {
        setRows(d?.hotels || []);
        setGlobalDefault(d?.globalDefault || null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (filterSource !== "all") list = list.filter((r) => r.source === filterSource);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.hotel.name?.toLowerCase().includes(q) || r.hotel.city?.toLowerCase().includes(q) || r.hotel.id.includes(q),
      );
    }
    return list;
  }, [rows, filterSource, search]);

  function openEdit(row: Row) {
    setEditing(row);
    setError("");
    if (row.rule.slabs && Array.isArray(row.rule.slabs) && row.rule.slabs.length > 0) {
      setMode("slabs");
      setSlabs(row.rule.slabs);
      setFlatPct("5");
    } else {
      setMode("flat");
      setFlatPct(String(row.rule.platform_pct ?? globalDefault?.platform_pct ?? 5));
      setSlabs([{ minBookings: 1, maxBookings: 50, pct: 5 }]);
    }
    setNotes(row.rule.notes || "");
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    const body =
      mode === "flat"
        ? { hotel_id: editing.hotel.id, platform_pct: Number(flatPct), notes: notes || null }
        : { hotel_id: editing.hotel.id, slabs, notes: notes || null };
    const res = await fetch("/api/admin/hotel-commission-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(t ? { "x-admin-token": t } : {}),
        ...(u?.id ? { "x-admin-id": u.id } : {}),
      },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    setBusy(false);
    if (res?.ok) {
      setEditing(null);
      showToast("Saved");
      load();
    } else {
      setError(res?.error || "Save failed");
    }
  }

  async function revertToDefault(row: Row) {
    if (!row.rule.id) return;
    if (!confirm(`Revert ${row.hotel.name} to platform default?`)) return;
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    await fetch(`/api/admin/hotel-commission-rules?id=${encodeURIComponent(row.rule.id)}`, {
      method: "DELETE",
      headers: { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) },
    });
    showToast("Reverted to default");
    load();
  }

  return (
    <div style={{ padding: 0, fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h1 className="admin-h1" style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 22, color: "#E8EAF0", margin: 0 }}>
          🏨 Hotel Commission Rules
        </h1>
        {globalDefault && (
          <span style={{ fontSize: 11, color: "#8A8FA8" }}>
            Platform default: <strong style={{ color: "#9fb1c2" }}>{globalDefault.platform_pct}%</strong>
          </span>
        )}
      </div>

      <div className="admin-filters" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as any)} style={inp}>
          <option value="all">All hotels</option>
          <option value="hotel-override">With override</option>
          <option value="platform-default">Using default</option>
        </select>
        <input type="text" placeholder="Search hotel name / city" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }} />
      </div>

      {loading ? (
        <p style={{ color: "#8A8FA8" }}>Loading…</p>
      ) : (
        <div className="admin-data-table-wrap" style={{ background: "#151820", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", textAlign: "left" }}>
                {["Hotel", "City", "Source", "Rule", "Notes", ""].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.hotel.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={td}>
                    <p style={{ color: "#E8EAF0", fontWeight: 600, margin: 0 }}>{r.hotel.name}</p>
                  </td>
                  <td style={td}>
                    <span style={{ color: "#8A8FA8" }}>{r.hotel.city || "—"}</span>
                  </td>
                  <td style={td}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                      background: r.source === "hotel-override" ? "rgba(140, 160, 182,0.15)" : "rgba(138,143,168,0.15)",
                      color:      r.source === "hotel-override" ? "#9fb1c2" : "#8A8FA8",
                      letterSpacing: "0.08em",
                    }}>{r.source === "hotel-override" ? "OVERRIDE" : "DEFAULT"}</span>
                  </td>
                  <td style={td}>
                    {r.rule.slabs && r.rule.slabs.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {r.rule.slabs.map((s, i) => (
                          <span key={i} style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 999,
                            background: "rgba(46,204,113,0.1)", color: "#2ECC71", border: "1px solid rgba(46,204,113,0.25)",
                          }}>{s.minBookings}–{s.maxBookings} · {s.pct}%</span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "#E8EAF0", fontWeight: 700 }}>{r.rule.platform_pct ?? globalDefault?.platform_pct ?? 5}%</span>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{ color: "#8A8FA8", fontSize: 11 }}>{r.rule.notes || "—"}</span>
                  </td>
                  <td style={td}>
                    <button onClick={() => openEdit(r)} style={btnGhost}>{r.source === "hotel-override" ? "Edit" : "Set override"}</button>
                    {r.source === "hotel-override" && (
                      <button onClick={() => revertToDefault(r)} style={{ ...btnGhost, color: "#FF4757", borderColor: "rgba(255,71,87,0.3)", marginLeft: 6 }}>Revert</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p style={{ textAlign: "center", padding: 24, color: "#8A8FA8" }}>No hotels match.</p>}
        </div>
      )}

      {editing && (
        <div onClick={() => !busy && setEditing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#0F1117", borderRadius: 16, width: "100%", maxWidth: 560, padding: 18, border: "1px solid rgba(255,255,255,0.1)", maxHeight: "92vh", overflowY: "auto" }}>
            <h2 style={{ fontFamily: "Syne, sans-serif", color: "#9fb1c2", marginTop: 0, fontSize: 16, marginBottom: 4 }}>
              {editing.hotel.name}
            </h2>
            <p style={{ color: "#8A8FA8", fontSize: 11, marginTop: 0, marginBottom: 14 }}>{editing.hotel.city || "—"}</p>

            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button onClick={() => setMode("flat")} style={{ ...btnGhost, background: mode === "flat" ? "rgba(140, 160, 182,0.15)" : "transparent" }}>Flat %</button>
              <button onClick={() => setMode("slabs")} style={{ ...btnGhost, background: mode === "slabs" ? "rgba(140, 160, 182,0.15)" : "transparent" }}>Volume slabs</button>
            </div>

            {mode === "flat" ? (
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Platform commission %</label>
                <input type="number" step="0.5" min="0" max="50" value={flatPct} onChange={(e) => setFlatPct(e.target.value)} style={inp} />
                <p style={{ fontSize: 11, color: "#8A8FA8", marginTop: 6 }}>This hotel's commission stays at {flatPct}% on every booking, regardless of volume.</p>
              </div>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Slabs by THIS-MONTH bookings count</label>
                {slabs.map((s, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 30px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <input type="number" min="0" value={s.minBookings} onChange={(e) => setSlabs(slabs.map((x, j) => j === i ? { ...x, minBookings: Number(e.target.value) } : x))} style={inp} placeholder="Min" />
                    <input type="number" min="0" value={s.maxBookings} onChange={(e) => setSlabs(slabs.map((x, j) => j === i ? { ...x, maxBookings: Number(e.target.value) } : x))} style={inp} placeholder="Max" />
                    <input type="number" step="0.5" min="0" max="50" value={s.pct} onChange={(e) => setSlabs(slabs.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x))} style={inp} placeholder="%" />
                    <button onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} disabled={slabs.length === 1} style={{ ...btnGhost, padding: "5px 8px", opacity: slabs.length === 1 ? 0.4 : 1 }}>✕</button>
                  </div>
                ))}
                <button onClick={() => setSlabs([...slabs, { minBookings: (slabs[slabs.length - 1]?.maxBookings || 0) + 1, maxBookings: (slabs[slabs.length - 1]?.maxBookings || 0) + 50, pct: 5 }])} style={btnGhost}>+ Add slab</button>
                <p style={{ fontSize: 11, color: "#8A8FA8", marginTop: 8 }}>Bookings above the top slab use that slab's %.</p>
              </div>
            )}

            <label style={lbl}>Notes (audit trail)</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inp, minHeight: 50, resize: "vertical", marginBottom: 12 }} placeholder="e.g. Mumbai pilot, lower commission for promo period" />

            {error && <p style={{ color: "#FF4757", fontSize: 12, marginBottom: 8 }}>{error}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button onClick={() => setEditing(null)} disabled={busy} style={btnGhost}>Cancel</button>
              <button onClick={save} disabled={busy} style={btnGold}>{busy ? "Saving…" : "Save Override"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "#0F1117", color: "#9fb1c2", padding: "10px 18px", borderRadius: 999, fontSize: 13, fontWeight: 600, border: "1px solid rgba(140, 160, 182,0.3)", zIndex: 60 }}>{toast}</div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", background: "#07080C", color: "#E8EAF0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit" };
const th: React.CSSProperties = { padding: "10px 12px", fontSize: 11, color: "#8A8FA8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 12 };
const btnGhost: React.CSSProperties = { background: "transparent", color: "#9fb1c2", border: "1px solid rgba(140, 160, 182,0.3)", padding: "5px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" };
const btnGold: React.CSSProperties = { background: "linear-gradient(160deg,#d4dde6 0%,#b1bfd0 52%,#93a7bc 100%)", color: "#1a1205", border: "none", padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" };
const lbl: React.CSSProperties = { display: "block", color: "#8A8FA8", fontSize: 11, marginBottom: 4, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" };
