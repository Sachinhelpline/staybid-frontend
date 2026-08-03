"use client";
// v341 — Circle Marketplace Phase M2: Model-3 supply admin.
//
// Lists every host-circle (StayBid-operated) property, lets ops flip it into
// browsable Model-3 pre-buy supply (prebuy_enabled) + set an optional check-in
// window (prebuy_window_start .. prebuy_window_end EXCLUSIVE). Dark-luxury,
// mirrors /admin/circle-inventory.
//
// prebuy_enabled is DECOUPLED from approval_status (the SINGLE customer-feed
// gate, v336). This surface governs Model-3 supply visibility + the window
// only — never the customer-feed gate.
import { useCallback, useEffect, useState } from "react";
import { Building2, RotateCw } from "lucide-react";

function adminId(): string {
  if (typeof window === "undefined") return "";
  try { return JSON.parse(localStorage.getItem("sb_admin_user") || "null")?.id || ""; } catch { return ""; }
}

type Hotel = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  image: string | null;
  prebuyEnabled: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  approvalStatus: string | null;
  status: string | null;
  rooms: number;
  units: number;
  ownedUnits: number;
};

export default function AdminCircleSupply() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Hotel | null>(null);
  const [wStart, setWStart] = useState("");
  const [wEnd, setWEnd] = useState("");

  const headers = useCallback((): HeadersInit => ({
    "x-admin-token": typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "",
    "x-admin-id": adminId(),
  }), []);

  const load = useCallback(() => {
    setLoading(true); setErr("");
    fetch("/api/admin/circle-supply", { headers: headers(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(String(d.error)); else setHotels(Array.isArray(d?.hotels) ? d.hotels : []); })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const post = async (body: any, key: string): Promise<Hotel | null> => {
    setBusy(key); setFlash(""); setErr("");
    try {
      const r = await fetch("/api/admin/circle-supply", {
        method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d?.error) throw new Error(d?.error || "Action failed");
      setFlash("Saved ✓");
      load();
      return d?.hotel || null;
    } catch (e: any) { setErr(e?.message || "Action failed"); return null; }
    finally { setBusy(""); }
  };

  const togglePrebuy = (h: Hotel) => post({ hotelId: h.id, prebuyEnabled: !h.prebuyEnabled }, h.id);

  const openEdit = (h: Hotel) => {
    setEdit(h);
    setWStart(h.windowStart || "");
    setWEnd(h.windowEnd || "");
  };
  const saveWindow = async () => {
    if (!edit) return;
    // "" clears the edge (NULL = unbounded); a date sets it.
    const ok = await post({ hotelId: edit.id, windowStart: wStart, windowEnd: wEnd }, `w-${edit.id}`);
    if (ok) setEdit(null);
  };

  const shown = hotels.filter((h) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (h.name || "").toLowerCase().includes(s) || (h.city || "").toLowerCase().includes(s);
  });

  const th: React.CSSProperties = { textAlign: "left", color: "#8A8FA8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: "10px 12px" };
  const td: React.CSSProperties = { padding: "11px 12px", color: "#E8EAF0", fontSize: 12.5, borderTop: "1px solid rgba(255,255,255,0.05)" };
  const btn = (color: string): React.CSSProperties => ({ background: `${color}22`, border: `1px solid ${color}55`, color, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
  const inputCss: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", fontSize: 13, colorScheme: "dark" as any };

  const enabledCount = hotels.filter((h) => h.prebuyEnabled).length;

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ color: "#E8EAF0", fontSize: 24, fontWeight: 800, margin: 0, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 9 }}><Building2 size={22} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />Circle Supply</h1>
          <div style={{ color: "#8A8FA8", fontSize: 13, marginTop: 4 }}>Mark operated properties available for Model-3 pre-buy + set the check-in window</div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#E8EAF0", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {loading ? "…" : <><RotateCw size={14} strokeWidth={2.2} aria-hidden />Refresh</>}
        </button>
      </div>

      {err && <div style={{ background: "rgba(255,71,87,0.12)", border: "1px solid rgba(255,71,87,0.3)", color: "#FF4757", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{err}</div>}
      {flash && <div style={{ background: "rgba(46,204,113,0.12)", border: "1px solid rgba(46,204,113,0.3)", color: "#2ECC71", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{flash}</div>}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { v: String(hotels.length), label: "Host-circle properties", color: "#E8EAF0" },
          { v: String(enabledCount), label: "Pre-buy enabled", color: "#2ECC71" },
          { v: String(hotels.length - enabledCount), label: "Not enabled", color: "#8A8FA8" },
        ].map((c, i) => (
          <div key={i} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ color: c.color, fontSize: 22, fontWeight: 800, fontFamily: "Syne, sans-serif" }}>{c.v}</div>
            <div style={{ color: "#8A8FA8", fontSize: 12, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or city…"
          style={{ ...inputCss, width: "100%", maxWidth: 340 }} />
      </div>

      <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
        {shown.length === 0 ? (
          <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>
            {loading ? "Loading…" : hotels.length === 0 ? "No host-circle properties yet. Provision one from Property Listings." : "No matches."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                {["Property", "Rooms / Units", "Pre-buy window", "Live?", "Supply", "Actions"].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map((h) => {
                  const windowLabel = h.windowStart || h.windowEnd
                    ? `${h.windowStart || "any"} → ${h.windowEnd ? `<${h.windowEnd}` : "any"}`
                    : "Always open";
                  return (
                    <tr key={h.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{h.name}</div>
                        <div style={{ color: "#8A8FA8", fontSize: 11 }}>{[h.city, h.state].filter(Boolean).join(", ") || "—"}</div>
                      </td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{h.rooms} rooms · {h.units} units{h.ownedUnits ? ` · ${h.ownedUnits} owned` : ""}</td>
                      <td style={{ ...td, color: h.windowStart || h.windowEnd ? "#3D9CF5" : "#8A8FA8" }}>{windowLabel}</td>
                      <td style={td}>
                        {h.approvalStatus === "approved"
                          ? <span style={{ color: "#2ECC71", fontSize: 11.5, fontWeight: 700 }}>✓ live</span>
                          : <span style={{ color: "#8A8FA8", fontSize: 11.5 }}>draft</span>}
                      </td>
                      <td style={td}>
                        <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: h.prebuyEnabled ? "#2ECC7122" : "#8A8FA822", color: h.prebuyEnabled ? "#2ECC71" : "#8A8FA8", border: `1px solid ${h.prebuyEnabled ? "#2ECC7144" : "#8A8FA844"}` }}>
                          {h.prebuyEnabled ? "enabled" : "off"}
                        </span>
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button disabled={busy === h.id} onClick={() => togglePrebuy(h)} style={btn(h.prebuyEnabled ? "#FF4757" : "#2ECC71")}>
                            {busy === h.id ? "…" : h.prebuyEnabled ? "Disable" : "Enable"}
                          </button>
                          <button disabled={busy === `w-${h.id}`} onClick={() => openEdit(h)} style={btn("#3D9CF5")}>Window</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Window editor modal */}
      {edit && (
        <div onClick={() => setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 440 }}>
            <div style={{ color: "#E8EAF0", fontSize: 18, fontWeight: 800, fontFamily: "Syne, sans-serif" }}>Pre-buy check-in window</div>
            <div style={{ color: "#8A8FA8", fontSize: 12.5, marginTop: 4 }}>{edit.name}</div>
            <div style={{ color: "#8A8FA8", fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
              Bounds the CHECK-IN date of a pre-buy block. Leave a field empty for no bound on that edge — both empty = <b style={{ color: "#E8EAF0" }}>always open</b>. The end date is EXCLUSIVE (check-in must be before it).
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
              <label style={{ display: "block" }}>
                <div style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Start (inclusive)</div>
                <input type="date" value={wStart} onChange={(e) => setWStart(e.target.value)} style={{ ...inputCss, width: "100%" }} />
              </label>
              <label style={{ display: "block" }}>
                <div style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>End (exclusive)</div>
                <input type="date" value={wEnd} onChange={(e) => setWEnd(e.target.value)} style={{ ...inputCss, width: "100%" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
              <button onClick={() => { setWStart(""); setWEnd(""); }} style={{ ...btn("#8A8FA8"), padding: "9px 14px" }}>Clear both</button>
              <button onClick={() => setEdit(null)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#E8EAF0", borderRadius: 8, padding: "9px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12.5 }}>Cancel</button>
              <button disabled={busy === `w-${edit.id}`} onClick={saveWindow} style={{ ...btn("#2ECC71"), padding: "9px 16px" }}>{busy === `w-${edit.id}` ? "Saving…" : "Save window"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
