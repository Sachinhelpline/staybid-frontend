"use client";
// Admin → Hold Config. Edit global tier defaults + per-hotel overrides for
// the Hold-payment system (Phase 2). Tiers map total booking amount to
// the refundable hold price (₹99, ₹199, etc.). Hotels can disable hold
// entirely or override individual tiers.

import { useEffect, useState } from "react";

const GLOBAL = "_global_defaults";

type Tier = { upTo: number; amount: number };
type Config = {
  hotel_id: string;
  hold_enabled: boolean;
  pay_at_hotel_enabled: boolean;
  tier_overrides: Tier[] | null;
  acceptance_window_min: number;
  updated_at: string;
  hotel?: { id: string; name: string; city?: string; starRating?: number } | null;
};

export default function AdminHoldConfig() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Config | null>(null);
  const [hotelSearch, setHotelSearch] = useState("");
  const [hotelResults, setHotelResults] = useState<Array<{ id: string; name: string; city?: string }>>([]);
  const [hotelSearchOpen, setHotelSearchOpen] = useState(false);

  const load = () => {
    setLoading(true); setErr("");
    fetch("/api/admin/hold-config")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setErr(String(d.error));
        // Sort: global first, then by updated_at desc
        const list = (d?.configs || []) as Config[];
        list.sort((a, b) => {
          if (a.hotel_id === GLOBAL) return -1;
          if (b.hotel_id === GLOBAL) return 1;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
        setConfigs(list);
      })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Hotel search for adding a new override
  useEffect(() => {
    if (!hotelSearchOpen || hotelSearch.length < 2) { setHotelResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/hotels?search=${encodeURIComponent(hotelSearch)}&limit=10`)
        .then((r) => r.json())
        .then((d) => setHotelResults(d?.hotels || []))
        .catch(() => setHotelResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [hotelSearch, hotelSearchOpen]);

  const addOverride = (hotel: { id: string; name: string; city?: string }) => {
    setHotelSearchOpen(false); setHotelSearch(""); setHotelResults([]);
    // Open editor pre-filled with global defaults
    const globalCfg = configs.find((c) => c.hotel_id === GLOBAL);
    setEditing({
      hotel_id: hotel.id,
      hold_enabled: globalCfg?.hold_enabled ?? true,
      pay_at_hotel_enabled: globalCfg?.pay_at_hotel_enabled ?? true,
      tier_overrides: globalCfg?.tier_overrides ? JSON.parse(JSON.stringify(globalCfg.tier_overrides)) : null,
      // v241.23 — default bumped 15 → 30 in lockstep with
      // lib/bid-expiry ACCEPTED_UNPAID_WINDOW_MIN.
      acceptance_window_min: globalCfg?.acceptance_window_min ?? 30,
      updated_at: new Date().toISOString(),
      hotel: { id: hotel.id, name: hotel.name, city: hotel.city },
    });
  };

  return (
    <div style={{ padding: "24px 28px", fontFamily: "DM Sans, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, color: "#E8EAF0", margin: 0 }}>
            🔒 Hold Payment Config
          </h1>
          <p style={{ color: "#8A8FA8", fontSize: 13, margin: "6px 0 0" }}>
            Tiered hold amounts (₹99-499) by total booking value · per-hotel overrides · acceptance window
          </p>
        </div>
        <button
          onClick={() => setHotelSearchOpen(true)}
          style={btnPrimary}>
          + Add Hotel Override
        </button>
      </div>

      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
          {err}
        </div>
      )}

      {/* Hotel search overlay */}
      {hotelSearchOpen && (
        <div
          onClick={() => setHotelSearchOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(7,8,12,0.72)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 88 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 480, maxWidth: "92vw", background: "#151820", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 20 }}>
            <p style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 600, margin: "0 0 12px" }}>Find a hotel to override</p>
            <input autoFocus value={hotelSearch} onChange={(e) => setHotelSearch(e.target.value)}
              placeholder="Search by hotel name or city…"
              style={inp} />
            <div style={{ marginTop: 12, maxHeight: 320, overflowY: "auto" }}>
              {hotelResults.map((h) => (
                <button key={h.id} onClick={() => addOverride(h)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, marginBottom: 6, color: "#E8EAF0", cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ fontWeight: 600 }}>{h.name}</div>
                  {h.city && <div style={{ color: "#8A8FA8", fontSize: 12 }}>{h.city}</div>}
                </button>
              ))}
              {hotelSearch.length >= 2 && hotelResults.length === 0 && (
                <p style={{ color: "#8A8FA8", fontSize: 12, textAlign: "center", padding: 12 }}>No matches.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Config cards */}
      {loading ? (
        <div style={{ color: "#8A8FA8", padding: 40 }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {configs.map((c) => (
            <ConfigCard key={c.hotel_id} config={c} onEdit={() => setEditing(c)} onChanged={load} />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <EditModal
          config={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ConfigCard({ config, onEdit, onChanged }: { config: Config; onEdit: () => void; onChanged: () => void }) {
  const isGlobal = config.hotel_id === GLOBAL;
  const tiers: Tier[] = config.tier_overrides || [];
  const deleteOverride = async () => {
    if (!confirm(`Remove override for ${config.hotel?.name || config.hotel_id}? Hotel will use platform defaults.`)) return;
    const r = await fetch(`/api/admin/hold-config?hotelId=${encodeURIComponent(config.hotel_id)}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d?.error || "Delete failed"); return; }
    onChanged();
  };
  return (
    <div style={{ background: "#151820", border: `1px solid ${isGlobal ? "rgba(212,175,55,0.35)" : "rgba(255,255,255,0.07)"}`, borderRadius: 14, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isGlobal ? (
              <span style={{ background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, letterSpacing: 1, textTransform: "uppercase" }}>
                Platform Defaults
              </span>
            ) : null}
            <p style={{ color: "#E8EAF0", fontSize: 17, fontWeight: 600, margin: 0 }}>
              {isGlobal ? "Global defaults" : config.hotel?.name || config.hotel_id}
            </p>
          </div>
          {!isGlobal && config.hotel?.city && (
            <p style={{ color: "#8A8FA8", fontSize: 12, margin: "4px 0 0" }}>{config.hotel.city}</p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isGlobal && (
            <button onClick={deleteOverride} style={btnGhostRed}>Remove</button>
          )}
          <button onClick={onEdit} style={btnGhost}>Edit</button>
        </div>
      </div>

      {/* Flags */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Pill label="Hold" on={config.hold_enabled} />
        <Pill label="Pay at hotel" on={config.pay_at_hotel_enabled} />
        <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "rgba(61,156,245,0.12)", color: "#3D9CF5", border: "1px solid rgba(61,156,245,0.3)" }}>
          ⏱ Acceptance: {config.acceptance_window_min} min
        </span>
      </div>

      {/* Tier table */}
      {tiers.length > 0 && (
        <div>
          <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 8px" }}>Hold Tiers</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 8 }}>
            {tiers.map((t, i) => {
              const prev = i === 0 ? 0 : tiers[i - 1].upTo;
              return (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px" }}>
                  <p style={{ color: "#8A8FA8", fontSize: 10, margin: 0 }}>
                    ₹{prev.toLocaleString()} — {t.upTo >= 999_999_999 ? "∞" : `₹${t.upTo.toLocaleString()}`}
                  </p>
                  <p style={{ color: "#D4AF37", fontSize: 18, fontWeight: 700, margin: "2px 0 0", fontFamily: "Syne, sans-serif" }}>
                    ₹{t.amount}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Last updated */}
      <p style={{ color: "#666876", fontSize: 11, margin: "12px 0 0" }}>
        Last updated {new Date(config.updated_at).toLocaleString("en-IN")}
      </p>
    </div>
  );
}

function EditModal({ config, onClose, onSaved }: { config: Config; onClose: () => void; onSaved: () => void }) {
  const [holdEnabled, setHoldEnabled]   = useState(config.hold_enabled);
  const [payHotel, setPayHotel]         = useState(config.pay_at_hotel_enabled);
  const [tiers, setTiers]               = useState<Tier[]>(config.tier_overrides || []);
  const [acceptanceWindow, setAcceptanceWindow] = useState(config.acceptance_window_min);
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState("");
  const isGlobal = config.hotel_id === GLOBAL;

  const updateTier = (i: number, field: "upTo" | "amount", val: number) => {
    setTiers((prev) => prev.map((t, j) => j === i ? { ...t, [field]: val } : t));
  };
  const addTier = () => {
    const last = tiers[tiers.length - 1]?.upTo || 0;
    setTiers([...tiers, { upTo: last + 5000, amount: 99 }]);
  };
  const removeTier = (i: number) => setTiers(tiers.filter((_, j) => j !== i));
  const resetToDefault = () => {
    setTiers([
      { upTo: 2000,  amount: 99 },
      { upTo: 5000,  amount: 199 },
      { upTo: 10000, amount: 299 },
      { upTo: 15000, amount: 399 },
      { upTo: 999999999, amount: 499 },
    ]);
  };

  const save = async () => {
    setSaving(true); setErr("");
    try {
      // Validate tiers are sorted by upTo ascending
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].upTo <= tiers[i - 1].upTo) {
          throw new Error(`Tier ${i + 1} 'up to' must be greater than tier ${i}`);
        }
      }
      const r = await fetch("/api/admin/hold-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: config.hotel_id,
          hold_enabled: holdEnabled,
          pay_at_hotel_enabled: payHotel,
          tier_overrides: tiers.length ? tiers : null,
          acceptance_window_min: Math.max(1, Math.min(120, acceptanceWindow)),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Save failed");
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(7,8,12,0.78)", backdropFilter: "blur(6px)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxWidth: "94vw", maxHeight: "92vh", background: "#151820", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 16, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>
              {isGlobal ? "Edit platform defaults" : `Edit override`}
            </p>
            <p style={{ color: "#E8EAF0", fontSize: 18, fontWeight: 600, margin: "4px 0 0", fontFamily: "Syne, sans-serif" }}>
              {isGlobal ? "Global Hold Config" : config.hotel?.name || config.hotel_id}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A8FA8", cursor: "pointer", fontSize: 22 }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          {err && (
            <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
              {err}
            </div>
          )}
          {/* Toggles */}
          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            <Toggle label="Hold payment enabled" value={holdEnabled} onChange={setHoldEnabled} hint="Customer can pay a small refundable hold to lock the price for 24h" />
            <Toggle label="Pay-at-hotel enabled" value={payHotel} onChange={setPayHotel} hint="Customer can pay hold online, settle balance at the hotel desk on check-in" />
          </div>
          {/* Acceptance window */}
          <div style={{ marginBottom: 18 }}>
            <label style={lbl}>Acceptance window (minutes)</label>
            <p style={hint}>Customer has this much time to pay after the hotel accepts their bid. Default 15.</p>
            <input type="number" min={1} max={120} value={acceptanceWindow} onChange={(e) => setAcceptanceWindow(Number(e.target.value) || 15)}
              style={{ ...inp, width: 120 }} />
          </div>
          {/* Tiers */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Hold tiers</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={resetToDefault} style={btnGhostSmall}>Reset to default</button>
                <button onClick={addTier} style={btnGhostSmall}>+ Add tier</button>
              </div>
            </div>
            <p style={hint}>Tiered by TOTAL booking amount. "Up to ₹X = ₹Y hold". Last tier covers everything above.</p>
            <div style={{ display: "grid", gap: 6 }}>
              {tiers.map((t, i) => {
                const prev = i === 0 ? 0 : tiers[i - 1].upTo;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "8px 10px" }}>
                    <span style={{ color: "#8A8FA8", fontSize: 11, fontFamily: "monospace", minWidth: 86 }}>₹{prev.toLocaleString()} →</span>
                    <input type="number" value={t.upTo} onChange={(e) => updateTier(i, "upTo", Number(e.target.value) || 0)}
                      style={{ ...inp, flex: 1, padding: "6px 10px" }} placeholder="Up to ₹" />
                    <span style={{ color: "#8A8FA8", fontSize: 11 }}>= ₹</span>
                    <input type="number" value={t.amount} onChange={(e) => updateTier(i, "amount", Number(e.target.value) || 0)}
                      style={{ ...inp, width: 100, padding: "6px 10px" }} placeholder="Hold" />
                    <button onClick={() => removeTier(i)} style={{ background: "transparent", border: "1px solid rgba(255,71,87,0.4)", color: "#FF9AA8", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>×</button>
                  </div>
                );
              })}
              {tiers.length === 0 && (
                <p style={{ color: "#666876", fontSize: 12, textAlign: "center", padding: 18 }}>No tiers — hotel uses platform defaults. Click "Add tier" or "Reset to default".</p>
              )}
            </div>
          </div>
        </div>
        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pill({ label, on }: { label: string; on: boolean }) {
  return (
    <span style={{
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: on ? "rgba(46,204,113,0.12)" : "rgba(255,71,87,0.12)",
      color: on ? "#2ECC71" : "#FF6B7A",
      border: `1px solid ${on ? "rgba(46,204,113,0.35)" : "rgba(255,71,87,0.35)"}`,
    }}>
      {on ? "✓" : "✕"} {label}
    </span>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10 }}>
      <div style={{ flex: 1 }}>
        <p style={{ color: "#E8EAF0", fontSize: 14, fontWeight: 600, margin: 0 }}>{label}</p>
        {hint && <p style={{ color: "#8A8FA8", fontSize: 11, margin: "3px 0 0" }}>{hint}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 999, border: "none", cursor: "pointer",
          background: value ? "linear-gradient(135deg,#2ECC71,#27ae60)" : "rgba(255,255,255,0.12)",
          position: "relative", transition: "background 0.2s",
        }}>
        <span style={{
          position: "absolute", top: 2, left: value ? 22 : 2,
          width: 20, height: 20, borderRadius: 999, background: "#fff",
          transition: "left 0.2s", boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
        }} />
      </button>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "10px 12px", background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#E8EAF0",
  fontFamily: "inherit", fontSize: 14, outline: "none",
};
const lbl: React.CSSProperties = {
  display: "block", color: "#E8EAF0", fontSize: 13, fontWeight: 600, marginBottom: 6,
};
const hint: React.CSSProperties = {
  color: "#8A8FA8", fontSize: 11, margin: "0 0 8px",
};
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117",
  border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", fontSize: 13, letterSpacing: 0.3,
};
const btnGhost: React.CSSProperties = {
  background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "#E8EAF0",
  borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
};
const btnGhostRed: React.CSSProperties = {
  background: "transparent", border: "1px solid rgba(255,71,87,0.4)", color: "#FF9AA8",
  borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
};
const btnGhostSmall: React.CSSProperties = {
  background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#8A8FA8",
  borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 11,
};
