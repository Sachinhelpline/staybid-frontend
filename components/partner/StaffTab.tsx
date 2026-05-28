"use client";
//
// v170 — Staff & Roles management (partner panel, Phase 3).
//
// The hotel owner creates staff logins here. Each gets a login code +
// PIN to sign in at /partner/staff with a role-scoped dashboard.
// Backed by /api/partner/staff. Owner-only tab.
//
import { useCallback, useEffect, useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

export const ROLE_META: Record<string, { label: string; c: string; bg: string; desc: string }> = {
  manager:      { label: "Manager",      c: "#6d28d9", bg: "#ede9fe", desc: "Sabhi operations tabs" },
  front_desk:   { label: "Front Desk",   c: "#0d9488", bg: "#ccfbf1", desc: "Bids · Reservations · Bookings · Redeem · Guests" },
  housekeeping: { label: "Housekeeping", c: "#0e7490", bg: "#cffafe", desc: "Sirf Housekeeping" },
};
const ROLE_KEYS = ["manager", "front_desk", "housekeeping"];

export default function StaffTab({ hotelId }: { hotelId: string }) {
  const [staff, setStaff] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; row?: any } | null>(null);

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/staff?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setStaff(d.staff || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(s: any) {
    setStaff((p) => p.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)));
    try {
      await fetch("/api/partner/staff", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, active: !s.active }),
      });
    } catch { load(); }
  }
  async function removeStaff(id: string) {
    if (!confirm("Is staff login ko delete karein?")) return;
    try {
      await fetch(`/api/partner/staff?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      setStaff((p) => p.filter((x) => x.id !== id));
    } catch { load(); }
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">Staff &amp; Roles</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">Apni team ke logins banao — har role ko apna scoped dashboard milta hai.</p>
        </div>
        <button onClick={() => setEditor({ mode: "create" })} className="btn-gold">➕ Add Staff</button>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.74rem] text-amber-800 font-semibold">⚠ Staff storage abhi setup nahi hua</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            <span className="font-mono">migrations/2026-05-21-hotel-staff.sql</span> apply karni hai.
          </p>
        </div>
      )}

      <div className="card-p card-tight mb-3" style={{ background: "#f6f1e6" }}>
        <p className="text-[0.7rem] text-luxury-600">
          📲 Staff <span className="font-mono font-bold">staybids.in/partner/staff</span> par login code + PIN se sign-in karte hain.
        </p>
      </div>

      {loading ? (
        <div className="card-p text-center py-8 text-luxury-400 text-sm">Loading…</div>
      ) : staff.length === 0 ? (
        <div className="card-p text-center py-10">
          <p className="text-3xl mb-2">🧑‍💼</p>
          <p className="text-luxury-600 font-semibold text-sm">Abhi koi staff login nahi hai</p>
          <p className="text-luxury-400 text-xs mt-0.5 mb-3">Front desk ya housekeeping ke liye login banao.</p>
          <button onClick={() => setEditor({ mode: "create" })} className="btn-gold">➕ Add Staff</button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {staff.map((s) => {
            const m = ROLE_META[s.role] || ROLE_META.front_desk;
            return (
              <div key={s.id} className={`card-p card-tight ${s.active ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: m.bg, color: m.c }}>
                    {(s.name || "S").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[0.84rem] font-bold text-luxury-900 truncate">{s.name}</p>
                      <span className="text-[0.54rem] font-bold px-1.5 py-0.5 rounded-full" style={{ background: m.bg, color: m.c }}>
                        {m.label}
                      </span>
                      {!s.active && <span className="text-[0.54rem] font-bold px-1.5 py-0.5 rounded-full bg-luxury-100 text-luxury-500">Disabled</span>}
                    </div>
                    <p className="text-[0.66rem] text-luxury-500">
                      Code <span className="font-mono font-bold text-luxury-700">{s.login_code}</span>
                      {s.last_login_at ? ` · last login ${new Date(s.last_login_at).toLocaleDateString("en-IN")}` : " · never logged in"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => setEditor({ mode: "edit", row: s })} className="btn-ghost px-2.5! py-1! text-[0.7rem]">✏️ Edit</button>
                  <button onClick={() => toggleActive(s)} className="btn-ghost px-2.5! py-1! text-[0.7rem]">
                    {s.active ? "⏸ Disable" : "▶ Enable"}
                  </button>
                  <button onClick={() => removeStaff(s.id)} className="btn-ghost px-2.5! py-1! text-[0.7rem] text-red-600! hover:border-red-300!">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <StaffEditor
          mode={editor.mode}
          row={editor.row}
          hotelId={hotelId}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}

// ── create / edit modal ───────────────────────────────────────────────────
function StaffEditor({
  mode, row, hotelId, onClose, onSaved,
}: {
  mode: "create" | "edit";
  row?: any;
  hotelId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name || "");
  const [role, setRole] = useState(row?.role || "front_desk");
  const [pin, setPin]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]   = useState("");
  const [created, setCreated] = useState<any>(null);

  async function save() {
    if (!name.trim()) { setErr("Naam daalo."); return; }
    if (mode === "create" && !/^\d{4,6}$/.test(pin)) { setErr("PIN 4–6 digit ka ho."); return; }
    if (mode === "edit" && pin && !/^\d{4,6}$/.test(pin)) { setErr("PIN 4–6 digit ka ho."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/partner/staff", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "create"
            ? { hotelId, name: name.trim(), role, pin }
            : { id: row.id, name: name.trim(), role, ...(pin ? { pin } : {}) }
        ),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Save failed");
      if (mode === "create") setCreated({ ...d.staff, pin });
      else onSaved();
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setSaving(false); }
  }

  const lbl = "text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {created ? "Staff Login Ready" : mode === "create" ? "Add Staff" : "Edit Staff"}
          </p>
          <button onClick={created ? onSaved : onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>

        {created ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <p className="text-[0.78rem] text-luxury-600 mb-3">
              <b>{created.name}</b> ko ye details do — inse wo <span className="font-mono">/partner/staff</span> par login karega:
            </p>
            <div className="rounded-xl p-3 mb-3" style={{ background: "linear-gradient(135deg,#fff8e6,#fdf1cf)", border: "1px solid #f0e0b0" }}>
              <div className="flex justify-between py-1">
                <span className="text-[0.7rem] text-luxury-500">Login code</span>
                <span className="font-mono font-extrabold text-luxury-900 tracking-wider">{created.login_code}</span>
              </div>
              <div className="flex justify-between py-1 border-t border-gold-200/60">
                <span className="text-[0.7rem] text-luxury-500">PIN</span>
                <span className="font-mono font-extrabold text-luxury-900 tracking-wider">{created.pin}</span>
              </div>
            </div>
            <p className="text-[0.62rem] text-luxury-400 mb-3">⚠ PIN dobara nahi dikhega — abhi note kar lo. Baad me Edit se reset kar sakte ho.</p>
            <button onClick={onSaved} className="btn-gold w-full">Done</button>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
              <div>
                <label className={lbl}>Staff name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="inp-p" autoFocus />
              </div>
              <div>
                <label className={lbl}>Role</label>
                <div className="space-y-1.5">
                  {ROLE_KEYS.map((k) => {
                    const m = ROLE_META[k];
                    const on = role === k;
                    return (
                      <button key={k} type="button" onClick={() => setRole(k)}
                        className="w-full text-left rounded-xl p-2.5 transition-all"
                        style={{ background: on ? m.bg : "#fff", border: `1.5px solid ${on ? m.c : "#e6ddc8"}` }}>
                        <p className="text-[0.78rem] font-bold" style={{ color: on ? m.c : "#3d2c14" }}>{on ? "● " : "○ "}{m.label}</p>
                        <p className="text-[0.62rem] text-luxury-500 mt-0.5">{m.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className={lbl}>{mode === "create" ? "PIN (4–6 digits) *" : "Reset PIN (optional)"}</label>
                <input value={pin} inputMode="numeric" type="password"
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={mode === "edit" ? "Khali chhodo to PIN same rahega" : "e.g. 1234"}
                  className="inp-p" />
              </div>
              {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
              <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-gold flex-1">
                {saving ? "Saving…" : mode === "create" ? "Create Login" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
