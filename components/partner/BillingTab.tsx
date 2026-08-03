"use client";
//
// v171 — Guest Billing / Folio / Invoicing (partner panel).
//
// Two billing modes:
//   • Online booking folio  — linked to an accepted bid. The room
//     category + booked amount are auto-fetched and LOCKED (not editable).
//   • Walk-in / offline folio — fully flexible. Room charges pick from the
//     hotel's room categories (price auto-fills, still editable).
//
// Bill summary: GST Inclusive / Exclusive toggle + GST slab dropdown
// (standard Indian rates only). Printable GST invoice.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";
import {
  Plus, TriangleAlert, Search, ReceiptText, Globe, Footprints, X, Printer,
  Check, RotateCcw, Lock, Wallet, Trash2, BedDouble, UtensilsCrossed, Shirt,
  ConciergeBell, ArrowLeft,
} from "lucide-react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
const todayISO = () => new Date().toISOString().slice(0, 10);
function fmtD(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function nights(a?: string, b?: string) {
  if (!a || !b) return 1;
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}
// Small inline lucide renderer (baseline-aligned with adjacent text).
function BIc({ I, size = 13, className = "" }: { I: any; size?: number; className?: string }) {
  return <I size={size} strokeWidth={2.3} aria-hidden className={className} style={{ display: "inline-block", verticalAlign: "-2px" }} />;
}
// Standard Indian GST slabs — partner picks one, no free value.
const GST_SLABS = [
  { v: 0,  label: "0% — exempt" },
  { v: 5,  label: "5%" },
  { v: 12, label: "12% — room ≤ ₹7,500" },
  { v: 18, label: "18% — room > ₹7,500" },
  { v: 28, label: "28%" },
];

const KIND: Record<string, { label: string; Ic: any }> = {
  room:    { label: "Room",            Ic: BedDouble },
  food:    { label: "Food & Beverage", Ic: UtensilsCrossed },
  laundry: { label: "Laundry",         Ic: Shirt },
  service: { label: "Room Service",    Ic: ConciergeBell },
  misc:    { label: "Other",           Ic: Plus },
  payment: { label: "Payment",         Ic: Wallet },
};
const EXTRA_KINDS = ["food", "laundry", "service", "misc"];

type Folio = any;
type Charge = any;

// Bill totals — honours the GST inclusive/exclusive mode.
function totalsOf(folio: Folio, charges: Charge[]) {
  const mine = charges.filter((c) => c.folio_id === folio.id);
  const subtotal = mine.filter((c) => c.kind !== "payment").reduce((s, c) => s + Number(c.amount || 0), 0);
  const taxPct = Number(folio.tax_pct || 0);
  const discount = Number(folio.discount || 0);
  const inclusive = folio.gst_mode === "inclusive";
  let taxable: number, tax: number, total: number;
  if (inclusive) {
    taxable = taxPct > 0 ? subtotal / (1 + taxPct / 100) : subtotal;
    tax = subtotal - taxable;
    total = Math.max(0, subtotal - discount);
  } else {
    taxable = subtotal;
    tax = subtotal * taxPct / 100;
    total = Math.max(0, subtotal + tax - discount);
  }
  const paid = mine.filter((c) => c.kind === "payment").reduce((s, c) => s + Number(c.amount || 0), 0);
  return { mine, subtotal, taxable, taxPct, discount, tax, total, paid, balance: total - paid, inclusive };
}

export default function BillingTab({
  hotelId, rooms, bids,
}: {
  hotelId: string;
  rooms: any[];
  bids: any[];
}) {
  const [folios, setFolios]   = useState<Folio[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<"open" | "settled" | "all">("open");
  const [q, setQ]             = useState("");
  const [selId, setSelId]     = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/folios?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setFolios(d.folios || []);
      setCharges(d.charges || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const selected = folios.find((f) => f.id === selId) || null;

  async function api(path: string, method: string, body?: any) {
    const r = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) {
      if (r.status === 412) { setProvisioned(false); throw new Error("Billing storage isn't set up yet — the migration needs to be applied."); }
      throw new Error(d.error || "Request failed");
    }
    return d;
  }

  async function createFolio(data: any) {
    const d = await api("/api/partner/folios", "POST", { hotelId, ...data });
    await load();
    setNewOpen(false);
    if (d.folio?.id) setSelId(d.folio.id);
  }
  async function patchFolio(id: string, patch: any) {
    setFolios((p) => p.map((f) => (f.id === id ? { ...f, ...mapPatch(patch) } : f)));
    try { await api("/api/partner/folios", "PATCH", { id, ...patch }); await load(); }
    catch (e: any) { alert("❌ " + e.message); load(); }
  }
  async function delFolio(id: string) {
    if (!confirm("Delete this entire folio?")) return;
    try { await api(`/api/partner/folios?id=${encodeURIComponent(id)}`, "DELETE"); setSelId(null); await load(); }
    catch (e: any) { alert("❌ " + e.message); }
  }
  async function addCharge(data: any) {
    try { await api("/api/partner/folios/charges", "POST", { hotelId, folioId: selId, ...data }); await load(); }
    catch (e: any) { alert("❌ " + e.message); }
  }
  async function delCharge(id: string) {
    setCharges((p) => p.filter((c) => c.id !== id));
    try { await api(`/api/partner/folios/charges?id=${encodeURIComponent(id)}`, "DELETE"); await load(); }
    catch (e: any) { alert("❌ " + e.message); load(); }
  }

  function mapPatch(p: any) {
    const o: any = {};
    if (p.taxPct !== undefined)   o.tax_pct = Number(p.taxPct) || 0;
    if (p.discount !== undefined) o.discount = Number(p.discount) || 0;
    if (p.gstMode !== undefined)  o.gst_mode = p.gstMode;
    if (p.status !== undefined)   o.status = p.status;
    return o;
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return folios.filter((f) => {
      if (filter !== "all" && f.status !== filter) return false;
      if (qq && !`${f.guest_name || ""} ${f.guest_phone || ""}`.toLowerCase().includes(qq)) return false;
      return true;
    });
  }, [folios, filter, q]);

  if (selected) {
    return (
      <FolioDetail
        folio={selected}
        charges={charges}
        rooms={rooms}
        onBack={() => setSelId(null)}
        onAddCharge={addCharge}
        onDelCharge={delCharge}
        onPatch={(patch) => patchFolio(selected.id, patch)}
        onDelete={() => delFolio(selected.id)}
      />
    );
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">Billing &amp; Folios</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">Online booking or walk-in — guest bill, GST &amp; invoice.</p>
        </div>
        <button onClick={() => setNewOpen(true)} className="btn-gold inline-flex items-center gap-1.5">
          <Plus size={14} strokeWidth={2.4} aria-hidden />New Folio
        </button>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200">
          <p className="text-[0.74rem] text-amber-700 font-semibold inline-flex items-center gap-1.5">
            <TriangleAlert size={13} strokeWidth={2.4} aria-hidden />Billing storage isn&apos;t set up yet
          </p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            <span className="font-mono">migrations/2026-05-21-guest-folios.sql</span> + <span className="font-mono">folio-gst-mode.sql</span> need to be applied.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3.5 flex-wrap">
        {(["open", "settled", "all"] as const).map((f) => {
          const active = filter === f;
          const n = f === "all" ? folios.length : folios.filter((x) => x.status === f).length;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-[0.74rem] font-bold px-2.5 py-1.5 rounded-lg border transition-all capitalize ${
                active ? "text-white border-transparent" : "bg-white text-luxury-500 border-luxury-200 hover:border-luxury-400"
              }`}
              style={active ? { background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" } : undefined}>
              {f}<span className="ml-1 opacity-70">({n})</span>
            </button>
          );
        })}
        <div className="relative flex-1 min-w-[150px]">
          <Search size={14} strokeWidth={2.2} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-luxury-400 pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Guest name / phone" className="inp-p w-full pl-8" />
        </div>
      </div>

      {loading ? (
        <div className="card-p text-center py-10 text-luxury-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card-p text-center py-10">
          <ReceiptText className="mx-auto mb-2 text-luxury-300" size={30} strokeWidth={1.7} aria-hidden />
          <p className="text-luxury-600 font-semibold text-sm">
            {folios.length === 0 ? "No folios yet" : "Nothing in this filter"}
          </p>
          {folios.length === 0 && (
            <>
              <p className="text-luxury-400 text-xs mt-0.5 mb-3">Open a new folio to start a guest bill.</p>
              <button onClick={() => setNewOpen(true)} className="btn-gold inline-flex items-center gap-1.5">
                <Plus size={14} strokeWidth={2.4} aria-hidden />New Folio
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((f) => {
            const t = totalsOf(f, charges);
            const online = f.ref_type === "bid";
            return (
              <button key={f.id} onClick={() => setSelId(f.id)}
                className="card-p card-tight w-full text-left flex items-center gap-3 hover:-translate-y-0.5 transition-transform">
                <div className="w-9 h-9 rounded-lg bg-gold-100 flex items-center justify-center text-xs font-bold text-gold-700 shrink-0">
                  {(f.guest_name || "G").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[0.84rem] font-bold text-luxury-900 truncate">{f.guest_name}</p>
                    <span className={`text-[0.52rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                      online ? "bg-blue-100 text-blue-700" : "bg-luxury-100 text-luxury-500"}`}>
                      {online ? <Globe size={9} strokeWidth={2.6} aria-hidden /> : <Footprints size={9} strokeWidth={2.6} aria-hidden />}
                      {online ? "Online" : "Walk-in"}
                    </span>
                    <span className={`text-[0.52rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                      f.status === "settled" ? "bg-emerald-100 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {f.status}
                    </span>
                  </div>
                  <p className="text-[0.66rem] text-luxury-500 truncate">
                    {f.room_label || "—"}{f.check_in ? ` · ${fmtD(f.check_in)}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[0.8rem] font-bold text-luxury-900">{fmtCur(t.total)}</p>
                  <p className={`text-[0.6rem] font-semibold ${t.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {t.balance > 0 ? `${fmtCur(t.balance)} due` : "Paid"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {newOpen && (
        <NewFolioModal
          rooms={rooms}
          bids={bids}
          onClose={() => setNewOpen(false)}
          onCreate={createFolio}
        />
      )}
    </div>
  );
}

// ── New folio modal — online booking OR walk-in ────────────────────────────
function NewFolioModal({
  rooms, bids, onClose, onCreate,
}: {
  rooms: any[];
  bids: any[];
  onClose: () => void;
  onCreate: (d: any) => Promise<void>;
}) {
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // online
  const [pickBidId, setPickBidId] = useState("");
  const [bq, setBq] = useState("");
  const acceptedBids = useMemo(
    () => bids.filter((b) => b.status === "ACCEPTED"),
    [bids]
  );
  const bidList = useMemo(() => {
    const qq = bq.trim().toLowerCase();
    const list = acceptedBids.filter((b) =>
      !qq || `${b.guestName || ""} ${b.guestPhone || ""}`.toLowerCase().includes(qq)
    );
    // today's check-ins first
    const t = todayISO();
    return list.sort((a, b) => {
      const at = String(a.checkIn || "").slice(0, 10) === t ? 0 : 1;
      const bt = String(b.checkIn || "").slice(0, 10) === t ? 0 : 1;
      return at - bt;
    });
  }, [acceptedBids, bq]);

  // offline
  const [f, setF] = useState({
    guestName: "", guestPhone: "", guestEmail: "", roomLabel: "",
    checkIn: todayISO(), checkOut: "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const lbl = "text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  async function go() {
    setErr("");
    if (mode === "online") {
      const b = acceptedBids.find((x) => x.id === pickBidId);
      if (!b) { setErr("Select an online booking."); return; }
      const n = nights(b.checkIn, b.checkOut);
      const perNight = Number(b.counterAmount || b.amount || 0);
      setSaving(true);
      try {
        await onCreate({
          guestName: b.guestName || b.customer?.name || "Guest",
          guestPhone: b.guestPhone || b.customer?.phone || "",
          refType: "bid", refId: b.id,
          roomLabel: b.room?.name || b.room?.type || "Room",
          checkIn: b.checkIn || "", checkOut: b.checkOut || "",
          taxPct: 12, gstMode: "exclusive",
          // server seeds this as a locked room charge
          roomCharge: { label: b.room?.name || b.room?.type || "Room", qty: n, unitPrice: perNight },
        });
      } catch (e: any) { setErr(e?.message || "Failed"); setSaving(false); }
    } else {
      if (!f.guestName.trim()) { setErr("Enter the guest's name."); return; }
      setSaving(true);
      try {
        await onCreate({
          guestName: f.guestName.trim(), guestPhone: f.guestPhone.trim(), guestEmail: f.guestEmail.trim(),
          refType: "manual", roomLabel: f.roomLabel.trim(),
          checkIn: f.checkIn, checkOut: f.checkOut, taxPct: 12, gstMode: "exclusive",
        });
      } catch (e: any) { setErr(e?.message || "Failed"); setSaving(false); }
    }
  }

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>New Folio</p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 flex items-center justify-center">
            <X size={16} strokeWidth={2.4} aria-hidden />
          </button>
        </div>

        {/* mode toggle */}
        <div className="flex gap-1.5 px-4 pt-3 shrink-0">
          {([["online", Globe, "Online booking"], ["offline", Footprints, "Walk-in / Offline"]] as const).map(([id, Icn, label]) => (
            <button key={id} onClick={() => { setMode(id); setErr(""); }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[0.74rem] font-bold py-1.5 rounded-lg border transition-all ${
                mode === id ? "text-white border-transparent" : "bg-white text-luxury-500 border-luxury-200"
              }`}
              style={mode === id ? { background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" } : undefined}>
              <Icn size={13} strokeWidth={2.4} aria-hidden />{label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {mode === "online" ? (
            <>
              <p className="text-[0.66rem] text-luxury-500">
                Select the customer&apos;s online booking — room category &amp; booked amount are fetched automatically (locked).
              </p>
              <div className="relative">
                <Search size={14} strokeWidth={2.2} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-luxury-400 pointer-events-none" />
                <input value={bq} onChange={(e) => setBq(e.target.value)}
                  placeholder="Search by guest name / phone" className="inp-p w-full pl-8" autoFocus />
              </div>
              {bidList.length === 0 ? (
                <p className="text-xs text-luxury-400 py-3 text-center">No confirmed online booking found.</p>
              ) : (
                <div className="space-y-1.5">
                  {bidList.map((b) => {
                    const on = pickBidId === b.id;
                    const isToday = String(b.checkIn || "").slice(0, 10) === todayISO();
                    const n = nights(b.checkIn, b.checkOut);
                    return (
                      <button key={b.id} onClick={() => setPickBidId(b.id)}
                        className={`w-full text-left rounded-xl p-2.5 transition-all border ${on ? "bg-luxury-50 border-transparent" : "bg-white border-luxury-200"}`}
                        style={on ? { boxShadow: "0 0 0 1.5px #8198ae" } : undefined}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[0.8rem] font-bold text-luxury-900">{b.guestName || `Guest …${String(b.customerId || "").slice(-4)}`}</span>
                          {isToday && <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">TODAY CHECK-IN</span>}
                        </div>
                        <p className="text-[0.64rem] text-luxury-500">
                          {b.room?.name || b.room?.type || "Room"} · {fmtD(b.checkIn)} → {fmtD(b.checkOut)} · {n} night{n > 1 ? "s" : ""}
                          {" · "}{fmtCur(Number(b.counterAmount || b.amount || 0))}/night
                          {b.guestPhone ? ` · ${b.guestPhone}` : ""}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className={lbl}>Guest name *</label>
                <input value={f.guestName} onChange={(e) => set("guestName", e.target.value)} className="inp-p" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className={lbl}>Phone</label>
                  <input value={f.guestPhone} onChange={(e) => set("guestPhone", e.target.value)} inputMode="tel" className="inp-p" /></div>
                <div><label className={lbl}>Email</label>
                  <input value={f.guestEmail} onChange={(e) => set("guestEmail", e.target.value)} className="inp-p" /></div>
              </div>
              <div><label className={lbl}>Room / label</label>
                <input value={f.roomLabel} onChange={(e) => set("roomLabel", e.target.value)}
                  placeholder="Deluxe · #101" className="inp-p" /></div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className={lbl}>Check-in</label>
                  <input type="date" value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} className="inp-p" /></div>
                <div><label className={lbl}>Check-out</label>
                  <input type="date" value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} className="inp-p" /></div>
              </div>
              <p className="text-[0.62rem] text-luxury-400">Walk-in bills are flexible — pick a room charge from the category and edit the price.</p>
            </>
          )}
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={go} disabled={saving} className="btn-gold flex-1">
            {saving ? "Creating…" : "Create Folio"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Folio detail view ──────────────────────────────────────────────────────
function FolioDetail({
  folio, charges, rooms, onBack, onAddCharge, onDelCharge, onPatch, onDelete,
}: {
  folio: Folio; charges: Charge[]; rooms: any[];
  onBack: () => void;
  onAddCharge: (d: any) => Promise<void>;
  onDelCharge: (id: string) => Promise<void>;
  onPatch: (patch: any) => void;
  onDelete: () => void;
}) {
  const t = totalsOf(folio, charges);
  const online = folio.ref_type === "bid";
  // online folio → room charge is auto/locked; can't add more room lines
  const kindOptions = online ? EXTRA_KINDS : ["room", ...EXTRA_KINDS];
  const [c, setC] = useState({ kind: online ? "food" : "room", label: "", qty: "1", unitPrice: "", roomId: "" });
  const [pay, setPay] = useState("");
  const setCV = (k: string, v: string) => setC((p) => ({ ...p, [k]: v }));

  function pickRoom(roomId: string) {
    const room = rooms.find((r) => r.id === roomId);
    setC((p) => ({
      ...p, roomId,
      label: room ? (room.name || room.type || "Room") : "",
      unitPrice: room ? String(Math.round(room.mrp || room.floorPrice || 0)) : "",
    }));
  }

  async function addItem() {
    if (!c.label.trim()) return;
    await onAddCharge({
      kind: c.kind, label: c.label.trim(),
      qty: Number(c.qty) || 1, unitPrice: Number(c.unitPrice) || 0,
    });
    setC({ kind: c.kind, label: "", qty: "1", unitPrice: "", roomId: "" });
  }
  async function addPayment() {
    const amt = Number(pay) || 0;
    if (amt <= 0) return;
    await onAddCharge({ kind: "payment", label: "Payment received", qty: 1, unitPrice: amt, amount: amt });
    setPay("");
  }

  function printInvoice() {
    const rows = t.mine.filter((x) => x.kind !== "payment").map((x) => `
      <tr><td>${KIND[x.kind]?.label || x.kind} — ${esc(x.label)}</td>
      <td style="text-align:center">${x.qty}</td>
      <td style="text-align:right">₹${Math.round(x.unit_price).toLocaleString("en-IN")}</td>
      <td style="text-align:right">₹${Math.round(x.amount).toLocaleString("en-IN")}</td></tr>`).join("");
    const payRows = t.mine.filter((x) => x.kind === "payment")
      .map((x) => `<tr><td colspan="3">${esc(x.label)}</td><td style="text-align:right">− ₹${Math.round(x.amount).toLocaleString("en-IN")}</td></tr>`).join("");
    const gstRows = t.inclusive
      ? `<tr><td>Taxable value</td><td style="text-align:right">₹${Math.round(t.taxable).toLocaleString("en-IN")}</td></tr>
         <tr><td>GST (${t.taxPct}%) — included</td><td style="text-align:right">₹${Math.round(t.tax).toLocaleString("en-IN")}</td></tr>`
      : `<tr><td>Subtotal</td><td style="text-align:right">₹${Math.round(t.subtotal).toLocaleString("en-IN")}</td></tr>
         <tr><td>GST (${t.taxPct}%)</td><td style="text-align:right">₹${Math.round(t.tax).toLocaleString("en-IN")}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice — ${esc(folio.guest_name)}</title>
      <style>
        body{font-family:Inter,Arial,sans-serif;color:#241a0c;margin:0;padding:28px;max-width:720px}
        h1{font-size:20px;margin:0}.gold{color:#8198ae}
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
        th,td{padding:7px 8px;border-bottom:1px solid #eee}
        th{text-align:left;background:#f5f6f8;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        .tot td{border:0;padding:3px 8px}.tot .grand{font-size:16px;font-weight:800;border-top:2px solid #8198ae}
        .muted{color:#8a795a;font-size:12px}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h1>Tax <span class="gold">Invoice</span></h1><p class="muted">Folio ${esc(folio.id)}</p></div>
        <div style="text-align:right" class="muted">Date: ${new Date().toLocaleDateString("en-IN")}<br>
          ${t.inclusive ? "GST inclusive" : "GST exclusive"} · ${folio.status}</div>
      </div>
      <p class="muted" style="margin-top:14px">
        <b style="color:#241a0c">${esc(folio.guest_name)}</b>${folio.guest_phone ? " · " + esc(folio.guest_phone) : ""}<br>
        ${folio.room_label ? esc(folio.room_label) + "<br>" : ""}
        ${folio.check_in ? "Stay: " + esc(folio.check_in) + " → " + esc(folio.check_out || "") : ""}</p>
      <table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No charges</td></tr>`}</tbody></table>
      <table class="tot" style="margin-top:8px">
        ${gstRows}
        ${t.discount ? `<tr><td>Discount</td><td style="text-align:right">− ₹${Math.round(t.discount).toLocaleString("en-IN")}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td style="text-align:right">₹${Math.round(t.total).toLocaleString("en-IN")}</td></tr>
      </table>
      ${payRows ? `<table style="margin-top:6px">${payRows}</table>` : ""}
      <table class="tot" style="margin-top:6px">
        <tr><td>Paid</td><td style="text-align:right">₹${Math.round(t.paid).toLocaleString("en-IN")}</td></tr>
        <tr class="grand"><td>Balance due</td><td style="text-align:right">₹${Math.round(t.balance).toLocaleString("en-IN")}</td></tr>
      </table>
      <p class="muted" style="margin-top:24px;text-align:center">Thank you for staying with us · Powered by StayBid</p>
      <script>window.onload=function(){window.print()}</script></body></html>`;
    const w = window.open("", "_blank", "width=760,height=900");
    if (w) { w.document.write(html); w.document.close(); }
    else alert("The invoice window was blocked — please allow pop-ups.");
  }

  return (
    <div className="fade-up">
      <button onClick={onBack} className="text-[0.74rem] font-bold text-gold-600 mb-2.5 inline-flex items-center gap-1">
        <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />All folios
      </button>

      <div className="card-p card-tight mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>{folio.guest_name}</p>
            <span className={`text-[0.52rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
              online ? "bg-blue-100 text-blue-700" : "bg-luxury-100 text-luxury-500"}`}>
              {online ? <Globe size={9} strokeWidth={2.6} aria-hidden /> : <Footprints size={9} strokeWidth={2.6} aria-hidden />}
              {online ? "Online booking" : "Walk-in"}
            </span>
            <span className={`text-[0.52rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
              folio.status === "settled" ? "bg-emerald-100 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {folio.status}
            </span>
          </div>
          <p className="text-[0.68rem] text-luxury-500">
            {folio.room_label || "—"}{folio.guest_phone ? ` · ${folio.guest_phone}` : ""}
            {folio.check_in ? ` · ${fmtD(folio.check_in)} → ${fmtD(folio.check_out)}` : ""}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={printInvoice} className="btn-ghost inline-flex items-center gap-1.5">
            <Printer size={13} strokeWidth={2.3} aria-hidden />Invoice
          </button>
          {folio.status === "open" ? (
            <button onClick={() => onPatch({ status: "settled" })} className="btn-gold inline-flex items-center gap-1.5">
              <Check size={13} strokeWidth={2.6} aria-hidden />Settle
            </button>
          ) : (
            <button onClick={() => onPatch({ status: "open" })} className="btn-ghost inline-flex items-center gap-1.5">
              <RotateCcw size={13} strokeWidth={2.3} aria-hidden />Reopen
            </button>
          )}
        </div>
      </div>

      {/* charges */}
      <div className="card-p mb-3">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Charges</p>
        {t.mine.filter((x) => x.kind !== "payment").length === 0 ? (
          <p className="text-xs text-luxury-400 py-2">No charges yet.</p>
        ) : (
          <div className="space-y-1 mb-2">
            {t.mine.filter((x) => x.kind !== "payment").map((x) => {
              const lockedRoom = online && x.kind === "room";
              return (
                <div key={x.id} className="flex items-center gap-2 text-[0.76rem] py-1 border-b border-luxury-50 last:border-0">
                  <BIc I={KIND[x.kind]?.Ic || Plus} className="text-luxury-500 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-luxury-800">
                    {x.label}
                    <span className="text-luxury-400"> · {x.qty}×{fmtCur(x.unit_price)}</span>
                    {lockedRoom && <span className="text-[0.58rem] text-blue-600 font-bold"> · <Lock size={9} strokeWidth={2.6} aria-hidden className="inline align-[-1px]" /> booked</span>}
                  </span>
                  <span className="font-bold text-luxury-900">{fmtCur(x.amount)}</span>
                  {lockedRoom ? (
                    <span className="text-luxury-300 w-3 flex items-center justify-center"><Lock size={12} strokeWidth={2.2} aria-hidden /></span>
                  ) : (
                    <button onClick={() => onDelCharge(x.id)} className="text-red-400 hover:text-red-600 flex items-center"><X size={14} strokeWidth={2.4} aria-hidden /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {online && (
          <p className="text-[0.62rem] text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 mb-2 flex items-start gap-1.5">
            <Globe size={12} strokeWidth={2.4} aria-hidden className="mt-0.5 shrink-0" />
            <span>Online booking — room category &amp; booked amount are locked. You can only add extra charges (food, laundry…).</span>
          </p>
        )}

        {/* add charge row */}
        <div className="grid grid-cols-2 sm:grid-cols-[1.1fr_1.9fr_auto_auto_auto] gap-1.5 mt-2">
          <select value={c.kind} onChange={(e) => setC({ kind: e.target.value, label: "", qty: "1", unitPrice: "", roomId: "" })}
            className="inp-p py-1.5! text-[0.74rem]">
            {kindOptions.map((k) => (
              <option key={k} value={k}>{KIND[k].label}</option>
            ))}
          </select>
          {c.kind === "room" ? (
            <select value={c.roomId} onChange={(e) => pickRoom(e.target.value)} className="inp-p py-1.5! text-[0.74rem]">
              <option value="">Select room category…</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name || r.type} — {fmtCur(r.mrp || r.floorPrice || 0)}</option>
              ))}
            </select>
          ) : (
            <input value={c.label} onChange={(e) => setCV("label", e.target.value)} placeholder="Item"
              className="inp-p py-1.5! text-[0.74rem]" onKeyDown={(e) => e.key === "Enter" && addItem()} />
          )}
          <input value={c.qty} onChange={(e) => setCV("qty", e.target.value)} type="number" placeholder="Qty"
            className="inp-p py-1.5! text-[0.74rem] w-16" />
          <input value={c.unitPrice} onChange={(e) => setCV("unitPrice", e.target.value)} type="number" placeholder="₹ rate"
            className="inp-p py-1.5! text-[0.74rem] w-20" />
          <button onClick={addItem} className="btn-gold px-3! py-1.5!">Add</button>
        </div>
        {c.kind === "room" && !online && (
          <p className="text-[0.6rem] text-luxury-400 mt-1">Pick a room category — the price auto-fills, and you can still edit it on a walk-in bill (flexible).</p>
        )}
      </div>

      {/* bill summary */}
      <div className="card-p mb-3">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Bill summary</p>

        {/* GST mode toggle */}
        <div className="flex gap-1.5 mb-2.5">
          {([["exclusive", "GST Exclusive"], ["inclusive", "GST Inclusive"]] as const).map(([id, label]) => {
            const active = (folio.gst_mode || "exclusive") === id;
            return (
              <button key={id} onClick={() => onPatch({ gstMode: id })}
                className={`flex-1 text-[0.7rem] font-bold py-1.5 rounded-lg border transition-all ${
                  active ? "text-white border-transparent" : "bg-white text-luxury-500 border-luxury-200"
                }`}
                style={active ? { background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" } : undefined}>
                {label}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5 text-[0.78rem]">
          {t.inclusive ? (
            <>
              <Row k="Items (incl. GST)" v={fmtCur(t.subtotal)} />
              <Row k="Taxable value" v={fmtCur(t.taxable)} />
            </>
          ) : (
            <Row k="Subtotal" v={fmtCur(t.subtotal)} />
          )}
          <div className="flex items-center justify-between">
            <span className="text-luxury-500 flex items-center gap-1.5">
              GST
              <select value={String(folio.tax_pct ?? 12)} onChange={(e) => onPatch({ taxPct: e.target.value })}
                className="inp-p py-0.5! px-1.5! text-[0.72rem]" style={{ width: "auto" }}>
                {GST_SLABS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
              {t.inclusive && <span className="text-[0.62rem] text-luxury-400">incl.</span>}
            </span>
            <span className="font-semibold text-luxury-900">{fmtCur(t.tax)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-luxury-500 flex items-center gap-1.5">
              Discount ₹
              <input type="number" value={folio.discount} onChange={(e) => onPatch({ discount: e.target.value })}
                className="inp-p py-0.5! px-1.5! w-20 text-[0.72rem]" />
            </span>
            <span className="font-semibold text-red-600">− {fmtCur(t.discount)}</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-luxury-100">
            <span className="font-bold text-luxury-900">Total {t.inclusive && <span className="text-[0.6rem] text-luxury-400 font-normal">(GST inside)</span>}</span>
            <span className="font-extrabold text-luxury-900 text-base">{fmtCur(t.total)}</span>
          </div>
          <Row k="Paid" v={fmtCur(t.paid)} />
          <div className="flex items-center justify-between">
            <span className={`font-bold ${t.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>Balance due</span>
            <span className={`font-extrabold text-base ${t.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>{fmtCur(t.balance)}</span>
          </div>
        </div>
      </div>

      {/* payments */}
      <div className="card-p mb-3">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Payments</p>
        {t.mine.filter((x) => x.kind === "payment").length > 0 && (
          <div className="space-y-1 mb-2">
            {t.mine.filter((x) => x.kind === "payment").map((x) => (
              <div key={x.id} className="flex items-center gap-2 text-[0.76rem] py-1 border-b border-luxury-50 last:border-0">
                <BIc I={Wallet} className="text-emerald-700 shrink-0" />
                <span className="flex-1 text-luxury-800">{x.label}</span>
                <span className="font-bold text-emerald-700">{fmtCur(x.amount)}</span>
                <button onClick={() => onDelCharge(x.id)} className="text-red-400 hover:text-red-600 flex items-center"><X size={14} strokeWidth={2.4} aria-hidden /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm">₹</span>
            <input value={pay} onChange={(e) => setPay(e.target.value)} type="number" inputMode="numeric"
              placeholder="Amount received" className="inp-p pl-7"
              onKeyDown={(e) => e.key === "Enter" && addPayment()} />
          </div>
          <button onClick={addPayment} className="btn-gold whitespace-nowrap">Record Payment</button>
        </div>
      </div>

      <button onClick={onDelete} className="text-[0.7rem] font-bold text-red-500 hover:text-red-700 inline-flex items-center gap-1">
        <Trash2 size={13} strokeWidth={2.3} aria-hidden />Delete this folio
      </button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-luxury-500">{k}</span>
      <span className="font-semibold text-luxury-900">{v}</span>
    </div>
  );
}

function esc(s: any) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m] as string));
}
