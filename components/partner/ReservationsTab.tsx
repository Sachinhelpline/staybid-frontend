"use client";
//
// v170 — Front-desk Reservations (Phase 1).
//
// A dedicated reservations desk on top of the proven room_blocks
// infrastructure (the same store the walk-in flow + calendar already use).
//   • List every front-desk reservation (walk-in / phone / group)
//   • Filter by Upcoming / In-house / Departed, search by guest
//   • Create a full reservation (richer than the calendar's quick walk-in)
//   • Edit dates / room / guest / rate, or cancel
//
// Status is date-derived — no schema change, fully bulletproof.
//
import { useCallback, useEffect, useMemo, useState } from "react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
const todayISO = () => new Date().toISOString().slice(0, 10);
function nights(a?: string, b?: string) {
  if (!a || !b) return 1;
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}
function fmtD(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
function statusOf(r: any): "upcoming" | "inhouse" | "departed" {
  const t = todayISO();
  if ((r.toDate || "") <= t) return "departed";
  if ((r.fromDate || "") > t) return "upcoming";
  return "inhouse";
}
const ST: Record<string, { label: string; bg: string; c: string }> = {
  upcoming: { label: "Upcoming", bg: "#dbeafe", c: "#1d4ed8" },
  inhouse:  { label: "In-house", bg: "#dcfce7", c: "#15803d" },
  departed: { label: "Departed", bg: "#f1efe9", c: "#78716c" },
};

export default function ReservationsTab({ hotelId, rooms }: { hotelId: string; rooms: any[] }) {
  const [list, setList]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"upcoming" | "inhouse" | "departed" | "all">("upcoming");
  const [q, setQ]           = useState("");
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; res?: any } | null>(null);

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/walk-in?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      // Only guest reservations — `manual` rows are maintenance holds.
      const rows = (d.reservations || []).filter((x: any) => x.source === "walk_in" || x.source === "group");
      setList(rows);
    } catch { /* keep prior list */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  async function cancelRes(id: string) {
    if (!confirm("Is reservation ko cancel karein? Room ki dates free ho jayengi.")) return;
    try {
      const r = await fetch(`/api/partner/walk-in?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Cancel failed");
      setList((p) => p.filter((x) => x.id !== id));
    } catch (e: any) { alert("❌ " + (e?.message || "Cancel failed")); }
  }

  const counts = useMemo(() => {
    const c = { upcoming: 0, inhouse: 0, departed: 0 };
    list.forEach((r) => { (c as any)[statusOf(r)]++; });
    return c;
  }, [list]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter((r) => {
      if (filter !== "all" && statusOf(r) !== filter) return false;
      if (qq) {
        const hay = `${r.guestName || ""} ${r.guestPhone || ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [list, filter, q]);

  const FILTERS: Array<{ id: typeof filter; label: string; n?: number }> = [
    { id: "upcoming", label: "Upcoming", n: counts.upcoming },
    { id: "inhouse",  label: "In-house", n: counts.inhouse },
    { id: "departed", label: "Departed", n: counts.departed },
    { id: "all",      label: "All",      n: list.length },
  ];

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">Front Desk &middot; Reservations</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">Walk-in, phone &amp; group bookings — banao, edit karo, manage karo.</p>
        </div>
        <button onClick={() => setEditor({ mode: "create" })} className="btn-gold">➕ New Reservation</button>
      </div>

      {/* filters + search */}
      <div className="flex items-center gap-2 mb-3.5 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-[0.74rem] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                active ? "text-white border-transparent" : "bg-white text-luxury-500 border-luxury-200 hover:border-luxury-400"
              }`}
              style={active ? { background: "linear-gradient(135deg,#c9911a,#f0b429)" } : undefined}>
              {f.label}{f.n != null && <span className="ml-1 opacity-70">({f.n})</span>}
            </button>
          );
        })}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Guest name / phone"
          className="inp-p flex-1 min-w-[150px]"
        />
      </div>

      {loading ? (
        <div className="card-p text-center py-10 text-luxury-400 text-sm">Loading reservations…</div>
      ) : filtered.length === 0 ? (
        <div className="card-p text-center py-10">
          <p className="text-3xl mb-2">🛎️</p>
          <p className="text-luxury-600 font-semibold text-sm">
            {list.length === 0 ? "Abhi koi reservation nahi hai" : "Is filter me kuch nahi mila"}
          </p>
          {list.length === 0 && (
            <>
              <p className="text-luxury-400 text-xs mt-0.5 mb-3">Front desk se pehli booking add karo.</p>
              <button onClick={() => setEditor({ mode: "create" })} className="btn-gold">➕ New Reservation</button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((r) => {
            const st = ST[statusOf(r)];
            const room = rooms.find((x) => x.id === r.roomId);
            const n = nights(r.fromDate, r.toDate);
            return (
              <div key={r.id} className="card-p card-tight flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gold-100 flex items-center justify-center text-xs font-bold text-gold-700 shrink-0">
                  {(r.guestName || "G").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[0.84rem] font-bold text-luxury-900 truncate">{r.guestName || "Guest"}</p>
                    <span className="text-[0.56rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                      style={{ background: st.bg, color: st.c }}>{st.label}</span>
                  </div>
                  <p className="text-[0.68rem] text-luxury-500 truncate">
                    {room?.name || room?.type || "Room"}
                    {r.assignedUnitNumber ? ` · #${r.assignedUnitNumber}` : ""}
                    {" · "}{fmtD(r.fromDate)} → {fmtD(r.toDate)} · {n} night{n > 1 ? "s" : ""}
                    {r.guestPhone ? ` · ${r.guestPhone}` : ""}
                  </p>
                </div>
                {r.amount != null && (
                  <p className="text-[0.78rem] font-bold text-luxury-900 shrink-0 hidden sm:block">
                    {fmtCur(r.amount * n)}
                  </p>
                )}
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => setEditor({ mode: "edit", res: r })} className="btn-ghost !px-2.5 !py-1.5">✏️</button>
                  <button onClick={() => cancelRes(r.id)}
                    className="btn-ghost !px-2.5 !py-1.5 !text-red-600 hover:!border-red-300">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <ReservationForm
          mode={editor.mode}
          res={editor.res}
          hotelId={hotelId}
          rooms={rooms}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Create / edit reservation modal ───────────────────────────────────────
function ReservationForm({
  mode, res, hotelId, rooms, onClose, onSaved,
}: {
  mode: "create" | "edit";
  res?: any;
  hotelId: string;
  rooms: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    guestName:  res?.guestName ?? "",
    guestPhone: res?.guestPhone ?? "",
    guestEmail: res?.guestEmail ?? "",
    roomId:     res?.roomId ?? (rooms[0]?.id ?? ""),
    fromDate:   res?.fromDate ?? todayISO(),
    toDate:     res?.toDate ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    amount:     res?.amount != null ? String(res.amount) : "",
    note:       res?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const n = nights(f.fromDate, f.toDate);

  async function save() {
    if (!f.guestName.trim()) { setErr("Guest ka naam daalo."); return; }
    if (!f.roomId)           { setErr("Room category select karo."); return; }
    if (!f.fromDate || !f.toDate) { setErr("Check-in aur check-out dates daalo."); return; }
    if (f.toDate <= f.fromDate)   { setErr("Check-out, check-in ke baad honi chahiye."); return; }
    setSaving(true); setErr("");
    try {
      const payload: any = {
        hotelId,
        roomId: f.roomId,
        fromDate: f.fromDate,
        toDate: f.toDate,
        guestName: f.guestName.trim(),
        guestPhone: f.guestPhone.trim(),
        guestEmail: f.guestEmail.trim(),
        amount: f.amount ? Number(f.amount) : null,
        note: f.note.trim(),
        source: "walk_in",
      };
      let r: Response;
      if (mode === "edit") {
        r = await fetch("/api/partner/walk-in", {
          method: "PATCH",
          headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: res.id }),
        });
      } else {
        r = await fetch("/api/partner/walk-in", {
          method: "POST",
          headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok || (!d.ok && !d.block && !d.reservation)) throw new Error(d.error || "Save failed");
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally { setSaving(false); }
  }

  const lbl = "text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }}
      onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {mode === "create" ? "New Reservation" : "Edit Reservation"}
          </p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center transition">×</button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className={lbl}>Guest name *</label>
            <input value={f.guestName} onChange={(e) => set("guestName", e.target.value)}
              placeholder="Guest ka naam" className="inp-p" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={lbl}>Phone</label>
              <input value={f.guestPhone} onChange={(e) => set("guestPhone", e.target.value)}
                inputMode="tel" placeholder="Mobile" className="inp-p" />
            </div>
            <div>
              <label className={lbl}>Email</label>
              <input value={f.guestEmail} onChange={(e) => set("guestEmail", e.target.value)}
                placeholder="optional" className="inp-p" />
            </div>
          </div>
          <div>
            <label className={lbl}>Room category *</label>
            <select value={f.roomId} onChange={(e) => set("roomId", e.target.value)} className="inp-p">
              {rooms.length === 0 && <option value="">No rooms — add one first</option>}
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name || r.type}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={lbl}>Check-in *</label>
              <input type="date" value={f.fromDate} onChange={(e) => set("fromDate", e.target.value)} className="inp-p" />
            </div>
            <div>
              <label className={lbl}>Check-out *</label>
              <input type="date" value={f.toDate} onChange={(e) => set("toDate", e.target.value)} className="inp-p" />
            </div>
          </div>
          <div>
            <label className={lbl}>Rate / night (₹)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm">₹</span>
              <input type="number" inputMode="numeric" value={f.amount}
                onChange={(e) => set("amount", e.target.value)} placeholder="optional"
                className="inp-p pl-7" />
            </div>
            {f.amount && (
              <p className="text-[0.6rem] text-luxury-500 mt-1">
                {n} night{n > 1 ? "s" : ""} · total {fmtCur(Number(f.amount) * n)}
              </p>
            )}
          </div>
          <div>
            <label className={lbl}>Notes / special requests</label>
            <textarea value={f.note} onChange={(e) => set("note", e.target.value)} rows={2}
              placeholder="ID details, early check-in, extra bed…" className="inp-p resize-none" />
          </div>
          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">
            {saving ? "Saving…" : mode === "create" ? "Create Reservation" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
