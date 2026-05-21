"use client";
//
// v170 — Housekeeping room-status board (partner panel, Phase 1).
//
// Per physical room unit: Clean / Dirty / Inspected / Out of Order.
// Front-desk / housekeeping staff tap a room to update its state and
// optionally assign a staff member. Backed by /api/partner/housekeeping.
//
import { useCallback, useEffect, useMemo, useState } from "react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

type HKStatus = "clean" | "dirty" | "inspected" | "out_of_order";

const META: Record<HKStatus, { label: string; icon: string; bg: string; c: string; border: string }> = {
  clean:        { label: "Clean",        icon: "✨", bg: "#ecfdf5", c: "#15803d", border: "#a7f3d0" },
  dirty:        { label: "Dirty",        icon: "🧹", bg: "#fffbeb", c: "#b45309", border: "#fde68a" },
  inspected:    { label: "Inspected",    icon: "✅", bg: "#eff6ff", c: "#1d4ed8", border: "#bfdbfe" },
  out_of_order: { label: "Out of Order", icon: "🚫", bg: "#fef2f2", c: "#b91c1c", border: "#fecaca" },
};
const ORDER: HKStatus[] = ["clean", "dirty", "inspected", "out_of_order"];

export default function HousekeepingTab({
  hotelId, rooms, roomUnits,
}: {
  hotelId: string;
  rooms: any[];
  roomUnits: any[];
}) {
  const [statuses, setStatuses] = useState<Record<string, any>>({});
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HKStatus | "all">("all");
  const [picker, setPicker] = useState<any>(null); // a unit row

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/housekeeping?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setStatuses(d.statuses || {});
      setProvisioned(d.provisioned !== false);
    } catch { /* keep prior */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  // Effective status for a unit — default "clean" when never set.
  const statusOf = (unitId: string): HKStatus => {
    const s = statuses[unitId]?.status;
    return (ORDER.includes(s) ? s : "clean") as HKStatus;
  };

  async function saveUnit(unitId: string, status: HKStatus, assignedTo: string, note: string) {
    // optimistic
    setStatuses((p) => ({ ...p, [unitId]: { status, assignedTo, note, updatedAt: new Date().toISOString() } }));
    setPicker(null);
    try {
      const r = await fetch("/api/partner/housekeeping", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hotelId, unitId, status, assignedTo, note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        if (r.status === 412) {
          setProvisioned(false);
          alert("⚠ Housekeeping abhi DB me set nahi hua — migration apply karni hai (migrations/2026-05-21-room-housekeeping.sql).");
        } else {
          alert("❌ " + (d.error || "Save failed"));
        }
        load(); // resync truth
      }
    } catch {
      alert("❌ Network error");
      load();
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { clean: 0, dirty: 0, inspected: 0, out_of_order: 0 };
    roomUnits.forEach((u) => { c[statusOf(u.id)]++; });
    return c;
  }, [roomUnits, statuses]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleUnits = useMemo(
    () => roomUnits.filter((u) => filter === "all" || statusOf(u.id) === filter),
    [roomUnits, filter, statuses] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Group visible units by room category.
  const groups = useMemo(() => {
    const byRoom: Record<string, any[]> = {};
    visibleUnits.forEach((u) => { (byRoom[u.roomId] = byRoom[u.roomId] || []).push(u); });
    return Object.entries(byRoom).map(([roomId, units]) => ({
      room: rooms.find((r) => r.id === roomId),
      roomId,
      units: units.sort((a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true })),
    }));
  }, [visibleUnits, rooms]);

  return (
    <div className="fade-up">
      <div className="mb-4">
        <h2 className="sec-title text-xl">Housekeeping</h2>
        <p className="text-[0.7rem] text-luxury-500 mt-0.5">Har kamre ka status — kisi room par tap karke update karo.</p>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.74rem] text-amber-800 font-semibold">⚠ Housekeeping storage abhi setup nahi hua</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            Status save karne ke liye <span className="font-mono">migrations/2026-05-21-room-housekeeping.sql</span> Supabase me apply karni hai. Tab tak board read-only hai.
          </p>
        </div>
      )}

      {roomUnits.length === 0 ? (
        <div className="card-p text-center py-10">
          <p className="text-3xl mb-2">🛏️</p>
          <p className="text-luxury-600 font-semibold text-sm">Abhi koi room number nahi hai</p>
          <p className="text-luxury-400 text-xs mt-0.5">Rooms tab me jaa kar har category me room numbers (101, 102…) add karo — housekeeping unhi par chalega.</p>
        </div>
      ) : (
        <>
          {/* status summary + filter */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3.5">
            {ORDER.map((s) => {
              const m = META[s];
              const active = filter === s;
              return (
                <button key={s} onClick={() => setFilter(active ? "all" : s)}
                  className="card-p card-tight text-left transition-all hover:-translate-y-0.5"
                  style={{ background: m.bg, borderColor: active ? m.c : m.border, borderWidth: active ? 1.5 : 1 }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{m.icon}</span>
                    <span className="text-lg font-bold" style={{ color: m.c }}>{counts[s]}</span>
                  </div>
                  <p className="text-[0.66rem] font-bold mt-0.5" style={{ color: m.c }}>{m.label}</p>
                </button>
              );
            })}
          </div>
          {filter !== "all" && (
            <button onClick={() => setFilter("all")}
              className="text-[0.68rem] font-bold text-gold-600 mb-2.5">↺ Show all rooms</button>
          )}

          {loading ? (
            <div className="card-p text-center py-8 text-luxury-400 text-sm">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="card-p text-center py-8 text-luxury-400 text-sm">Is filter me koi room nahi.</div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.roomId} className="card-p card-tight">
                  <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">{g.room?.name || g.room?.type || "Room"}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {g.units.map((u) => {
                      const st = statusOf(u.id);
                      const m = META[st];
                      const meta = statuses[u.id];
                      return (
                        <button key={u.id} onClick={() => setPicker(u)}
                          className="rounded-xl p-2 text-left transition-all hover:-translate-y-0.5"
                          style={{ background: m.bg, border: `1px solid ${m.border}` }}>
                          <div className="flex items-center justify-between">
                            <span className="text-[0.86rem] font-extrabold text-luxury-900">#{u.roomNumber}</span>
                            <span className="text-xs">{m.icon}</span>
                          </div>
                          <p className="text-[0.58rem] font-bold mt-0.5" style={{ color: m.c }}>{m.label}</p>
                          {meta?.assignedTo && (
                            <p className="text-[0.54rem] text-luxury-500 truncate mt-0.5">👤 {meta.assignedTo}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {picker && (
        <UnitPicker
          unit={picker}
          room={rooms.find((r) => r.id === picker.roomId)}
          current={statusOf(picker.id)}
          meta={statuses[picker.id]}
          onClose={() => setPicker(null)}
          onSave={(status, assignedTo, note) => saveUnit(picker.id, status, assignedTo, note)}
        />
      )}
    </div>
  );
}

// ── per-unit status picker ────────────────────────────────────────────────
function UnitPicker({
  unit, room, current, meta, onClose, onSave,
}: {
  unit: any;
  room: any;
  current: HKStatus;
  meta: any;
  onClose: () => void;
  onSave: (s: HKStatus, assignedTo: string, note: string) => void;
}) {
  const [status, setStatus] = useState<HKStatus>(current);
  const [assignedTo, setAssignedTo] = useState<string>(meta?.assignedTo || "");
  const [note, setNote] = useState<string>(meta?.note || "");

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }}
      onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100">
          <div>
            <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>Room #{unit.roomNumber}</p>
            <p className="text-[0.66rem] text-luxury-400">{room?.name || room?.type || "Room"}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center transition">×</button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {ORDER.map((s) => {
                const m = META[s];
                const on = status === s;
                return (
                  <button key={s} onClick={() => setStatus(s)}
                    className="rounded-xl p-2.5 text-left transition-all"
                    style={{
                      background: on ? m.bg : "#fff",
                      border: `1.5px solid ${on ? m.c : "#e6ddc8"}`,
                    }}>
                    <span className="text-sm">{m.icon}</span>
                    <p className="text-[0.74rem] font-bold mt-0.5" style={{ color: on ? m.c : "#7a6645" }}>{m.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Assigned to</label>
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Staff ka naam (optional)" className="inp-p" />
          </div>
          <div>
            <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="optional" className="inp-p" />
          </div>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={() => onSave(status, assignedTo.trim(), note.trim())} className="btn-gold flex-1">
            Save Status
          </button>
        </div>
      </div>
    </div>
  );
}
