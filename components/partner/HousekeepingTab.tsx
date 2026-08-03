"use client";
//
// v170 — Housekeeping room-status board (partner panel, Phase 1).
//
// Per physical room unit: Clean / Dirty / Inspected / Out of Order.
// Front-desk / housekeeping staff tap a room to update its state and
// optionally assign a staff member. Backed by /api/partner/housekeeping.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";
import { Sparkles, SprayCan, CircleCheck, Ban, BedDouble, UserRound, TriangleAlert, RotateCcw, X } from "lucide-react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

type HKStatus = "clean" | "dirty" | "inspected" | "out_of_order";

// Status tiles use Tailwind tint classes (not inline hex) so the partner
// status-tint dark layer flips them in dark; `ring` is a saturated accent that
// reads on both themes, used only for the active/selected state.
const META: Record<HKStatus, { label: string; Ic: any; bg: string; text: string; border: string; ring: string }> = {
  clean:        { label: "Clean",        Ic: Sparkles,    bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", ring: "#10b981" },
  dirty:        { label: "Dirty",        Ic: SprayCan,    bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   ring: "#f59e0b" },
  inspected:    { label: "Inspected",    Ic: CircleCheck, bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    ring: "#3b82f6" },
  out_of_order: { label: "Out of Order", Ic: Ban,         bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     ring: "#ef4444" },
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
          alert("Housekeeping isn't set up in the DB yet — apply the migration (migrations/2026-05-21-room-housekeeping.sql).");
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
        <p className="text-[0.7rem] text-luxury-500 mt-0.5">Each room's status — tap a room to update it.</p>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 bg-amber-50 border-amber-200">
          <p className="text-[0.74rem] text-amber-800 font-semibold inline-flex items-center gap-1.5"><TriangleAlert size={13} strokeWidth={2.3} aria-hidden /> Housekeeping storage isn't set up yet</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            To save statuses, apply <span className="font-mono">migrations/2026-05-21-room-housekeeping.sql</span> in Supabase. Until then the board is read-only.
          </p>
        </div>
      )}

      {roomUnits.length === 0 ? (
        <div className="card-p text-center py-10">
          <BedDouble size={30} strokeWidth={1.8} aria-hidden className="mx-auto mb-2 text-luxury-400" />
          <p className="text-luxury-600 font-semibold text-sm">No room numbers yet</p>
          <p className="text-luxury-400 text-xs mt-0.5">Go to the Rooms tab and add room numbers (101, 102…) to each category — housekeeping runs on those.</p>
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
                  className={`card-p card-tight text-left transition-all hover:-translate-y-0.5 border ${m.bg} ${m.border}`}
                  style={active ? { boxShadow: `0 0 0 1.5px ${m.ring}` } : undefined}>
                  <div className="flex items-center justify-between">
                    <m.Ic size={15} strokeWidth={2.2} aria-hidden className={m.text} />
                    <span className={`text-lg font-bold ${m.text}`}>{counts[s]}</span>
                  </div>
                  <p className={`text-[0.66rem] font-bold mt-0.5 ${m.text}`}>{m.label}</p>
                </button>
              );
            })}
          </div>
          {filter !== "all" && (
            <button onClick={() => setFilter("all")}
              className="text-[0.68rem] font-bold text-gold-600 mb-2.5 inline-flex items-center gap-1"><RotateCcw size={11} strokeWidth={2.4} aria-hidden /> Show all rooms</button>
          )}

          {loading ? (
            <div className="card-p text-center py-8 text-luxury-400 text-sm">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="card-p text-center py-8 text-luxury-400 text-sm">No rooms match this filter.</div>
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
                          className={`rounded-xl p-2 text-left transition-all hover:-translate-y-0.5 border ${m.bg} ${m.border}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[0.86rem] font-extrabold text-luxury-900">#{u.roomNumber}</span>
                            <m.Ic size={13} strokeWidth={2.2} aria-hidden className={m.text} />
                          </div>
                          <p className={`text-[0.63rem] font-bold mt-0.5 ${m.text}`}>{m.label}</p>
                          {meta?.assignedTo && (
                            <p className="text-[0.63rem] text-luxury-500 truncate mt-0.5 inline-flex items-center gap-1"><UserRound size={9} strokeWidth={2.4} aria-hidden /> {meta.assignedTo}</p>
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

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }}
      onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <div>
            <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>Room #{unit.roomNumber}</p>
            <p className="text-[0.66rem] text-luxury-400">{room?.name || room?.type || "Room"}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 flex items-center justify-center transition"><X size={16} strokeWidth={2.2} aria-hidden /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {ORDER.map((s) => {
                const m = META[s];
                const on = status === s;
                return (
                  <button key={s} onClick={() => setStatus(s)}
                    className={`rounded-xl p-2.5 text-left transition-all border ${on ? `${m.bg} ${m.border}` : "bg-white border-luxury-200"}`}
                    style={on ? { boxShadow: `0 0 0 1px ${m.ring}` } : undefined}>
                    <m.Ic size={15} strokeWidth={2.2} aria-hidden className={on ? m.text : "text-luxury-500"} />
                    <p className={`text-[0.74rem] font-bold mt-0.5 ${on ? m.text : "text-luxury-600"}`}>{m.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Assigned to</label>
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Staff name (optional)" className="inp-p" />
          </div>
          <div>
            <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="optional" className="inp-p" />
          </div>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={() => onSave(status, assignedTo.trim(), note.trim())} className="btn-gold flex-1">
            Save Status
          </button>
        </div>
      </div>
    </div>
  );
}
