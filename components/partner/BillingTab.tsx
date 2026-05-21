"use client";
//
// v170 — Guest Billing / Folio / Invoicing (partner panel, Phase 2).
//
// A folio is a guest's running bill. Add room + extra charges, record
// payments, edit GST % / discount, then print a GST invoice and settle.
// Backed by /api/partner/folios (+ /charges). Degrades gracefully until
// migrations/2026-05-21-guest-folios.sql is applied.
//
import { useCallback, useEffect, useMemo, useState } from "react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
const todayISO = () => new Date().toISOString().slice(0, 10);
function fmtD(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const KIND: Record<string, { label: string; icon: string }> = {
  room:    { label: "Room",            icon: "🛏" },
  food:    { label: "Food & Beverage", icon: "🍽" },
  laundry: { label: "Laundry",         icon: "🧺" },
  service: { label: "Service",         icon: "🛎" },
  misc:    { label: "Other",           icon: "➕" },
  payment: { label: "Payment",         icon: "💰" },
};

type Folio = any;
type Charge = any;

// totals for a folio given its charges
function totalsOf(folio: Folio, charges: Charge[]) {
  const mine = charges.filter((c) => c.folio_id === folio.id);
  const subtotal = mine.filter((c) => c.kind !== "payment").reduce((s, c) => s + Number(c.amount || 0), 0);
  const taxPct = Number(folio.tax_pct || 0);
  const discount = Number(folio.discount || 0);
  const tax = subtotal * taxPct / 100;
  const total = Math.max(0, subtotal + tax - discount);
  const paid = mine.filter((c) => c.kind === "payment").reduce((s, c) => s + Number(c.amount || 0), 0);
  const balance = total - paid;
  return { mine, subtotal, taxPct, discount, tax, total, paid, balance };
}

export default function BillingTab({ hotelId }: { hotelId: string }) {
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
      if (r.status === 412) { setProvisioned(false); throw new Error("Billing table abhi setup nahi hua — migration apply karni hai."); }
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
    if (!confirm("Pura folio delete karein?")) return;
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

  // local optimistic field mapping for patchFolio
  function mapPatch(p: any) {
    const o: any = {};
    if (p.taxPct !== undefined)   o.tax_pct = Number(p.taxPct) || 0;
    if (p.discount !== undefined) o.discount = Number(p.discount) || 0;
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

  // ── detail view ──────────────────────────────────────────────────────────
  if (selected) {
    return (
      <FolioDetail
        folio={selected}
        charges={charges}
        onBack={() => setSelId(null)}
        onAddCharge={addCharge}
        onDelCharge={delCharge}
        onPatch={(patch) => patchFolio(selected.id, patch)}
        onDelete={() => delFolio(selected.id)}
      />
    );
  }

  // ── list view ────────────────────────────────────────────────────────────
  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">Billing &amp; Folios</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">Guest bills — charges, GST, payments &amp; invoice.</p>
        </div>
        <button onClick={() => setNewOpen(true)} className="btn-gold">➕ New Folio</button>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.74rem] text-amber-800 font-semibold">⚠ Billing storage abhi setup nahi hua</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            <span className="font-mono">migrations/2026-05-21-guest-folios.sql</span> Supabase me apply karni hai.
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
              style={active ? { background: "linear-gradient(135deg,#c9911a,#f0b429)" } : undefined}>
              {f}<span className="ml-1 opacity-70">({n})</span>
            </button>
          );
        })}
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Guest name / phone" className="inp-p flex-1 min-w-[150px]" />
      </div>

      {loading ? (
        <div className="card-p text-center py-10 text-luxury-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card-p text-center py-10">
          <p className="text-3xl mb-2">🧾</p>
          <p className="text-luxury-600 font-semibold text-sm">
            {folios.length === 0 ? "Abhi koi folio nahi hai" : "Is filter me kuch nahi"}
          </p>
          {folios.length === 0 && (
            <>
              <p className="text-luxury-400 text-xs mt-0.5 mb-3">Guest ka bill banane ke liye naya folio kholo.</p>
              <button onClick={() => setNewOpen(true)} className="btn-gold">➕ New Folio</button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((f) => {
            const t = totalsOf(f, charges);
            return (
              <button key={f.id} onClick={() => setSelId(f.id)}
                className="card-p card-tight w-full text-left flex items-center gap-3 hover:-translate-y-0.5 transition-transform">
                <div className="w-9 h-9 rounded-lg bg-gold-100 flex items-center justify-center text-xs font-bold text-gold-700 shrink-0">
                  {(f.guest_name || "G").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[0.84rem] font-bold text-luxury-900 truncate">{f.guest_name}</p>
                    <span className="text-[0.54rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                      style={f.status === "settled"
                        ? { background: "#dcfce7", color: "#15803d" }
                        : { background: "#fef3c7", color: "#b45309" }}>
                      {f.status}
                    </span>
                  </div>
                  <p className="text-[0.66rem] text-luxury-500 truncate">
                    {f.room_label || "—"}{f.check_in ? ` · ${fmtD(f.check_in)}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[0.8rem] font-bold text-luxury-900">{fmtCur(t.total)}</p>
                  <p className="text-[0.6rem] font-semibold" style={{ color: t.balance > 0 ? "#b91c1c" : "#15803d" }}>
                    {t.balance > 0 ? `${fmtCur(t.balance)} due` : "Paid"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {newOpen && <NewFolioModal onClose={() => setNewOpen(false)} onCreate={createFolio} />}
    </div>
  );
}

// ── New folio modal ────────────────────────────────────────────────────────
function NewFolioModal({ onClose, onCreate }: { onClose: () => void; onCreate: (d: any) => Promise<void> }) {
  const [f, setF] = useState({
    guestName: "", guestPhone: "", guestEmail: "", roomLabel: "",
    checkIn: todayISO(), checkOut: "", taxPct: "12",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const lbl = "text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  async function go() {
    if (!f.guestName.trim()) { setErr("Guest ka naam daalo."); return; }
    setSaving(true); setErr("");
    try {
      await onCreate({
        guestName: f.guestName.trim(), guestPhone: f.guestPhone.trim(), guestEmail: f.guestEmail.trim(),
        roomLabel: f.roomLabel.trim(), checkIn: f.checkIn, checkOut: f.checkOut,
        taxPct: Number(f.taxPct) || 0,
      });
    } catch (e: any) { setErr(e?.message || "Failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>New Folio</p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-3">
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
          <div className="grid grid-cols-3 gap-2.5">
            <div><label className={lbl}>Check-in</label>
              <input type="date" value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} className="inp-p" /></div>
            <div><label className={lbl}>Check-out</label>
              <input type="date" value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} className="inp-p" /></div>
            <div><label className={lbl}>GST %</label>
              <input type="number" inputMode="numeric" value={f.taxPct} onChange={(e) => set("taxPct", e.target.value)} className="inp-p" /></div>
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={go} disabled={saving} className="btn-gold flex-1">{saving ? "Creating…" : "Create Folio"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Folio detail view ──────────────────────────────────────────────────────
function FolioDetail({
  folio, charges, onBack, onAddCharge, onDelCharge, onPatch, onDelete,
}: {
  folio: Folio; charges: Charge[];
  onBack: () => void;
  onAddCharge: (d: any) => Promise<void>;
  onDelCharge: (id: string) => Promise<void>;
  onPatch: (patch: any) => void;
  onDelete: () => void;
}) {
  const t = totalsOf(folio, charges);
  const [c, setC] = useState({ kind: "food", label: "", qty: "1", unitPrice: "" });
  const [pay, setPay] = useState("");
  const setCV = (k: string, v: string) => setC((p) => ({ ...p, [k]: v }));

  async function addItem() {
    if (!c.label.trim()) return;
    await onAddCharge({
      kind: c.kind, label: c.label.trim(),
      qty: Number(c.qty) || 1, unitPrice: Number(c.unitPrice) || 0,
    });
    setC({ kind: c.kind, label: "", qty: "1", unitPrice: "" });
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
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice — ${esc(folio.guest_name)}</title>
      <style>
        body{font-family:Inter,Arial,sans-serif;color:#241a0c;margin:0;padding:28px;max-width:720px}
        h1{font-size:20px;margin:0}
        .gold{color:#c9911a}
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
        th,td{padding:7px 8px;border-bottom:1px solid #eee}
        th{text-align:left;background:#faf6ec;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        .tot td{border:0;padding:3px 8px}
        .tot .grand{font-size:16px;font-weight:800;border-top:2px solid #c9911a}
        .muted{color:#8a795a;font-size:12px}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h1>Tax <span class="gold">Invoice</span></h1>
          <p class="muted">Folio ${esc(folio.id)}</p></div>
        <div style="text-align:right" class="muted">
          Date: ${new Date().toLocaleDateString("en-IN")}<br>Status: ${folio.status}
        </div>
      </div>
      <p class="muted" style="margin-top:14px">
        <b style="color:#241a0c">${esc(folio.guest_name)}</b>${folio.guest_phone ? " · " + esc(folio.guest_phone) : ""}<br>
        ${folio.room_label ? esc(folio.room_label) + "<br>" : ""}
        ${folio.check_in ? "Stay: " + esc(folio.check_in) + " → " + esc(folio.check_out || "") : ""}
      </p>
      <table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No charges</td></tr>`}</tbody></table>
      <table class="tot" style="margin-top:8px">
        <tr><td>Subtotal</td><td style="text-align:right">₹${Math.round(t.subtotal).toLocaleString("en-IN")}</td></tr>
        <tr><td>GST (${t.taxPct}%)</td><td style="text-align:right">₹${Math.round(t.tax).toLocaleString("en-IN")}</td></tr>
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
    else alert("Invoice window block ho gaya — popup allow karo.");
  }

  const lbl = "text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest";

  return (
    <div className="fade-up">
      <button onClick={onBack} className="text-[0.74rem] font-bold text-gold-600 mb-2.5">← All folios</button>

      <div className="card-p card-tight mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>{folio.guest_name}</p>
            <span className="text-[0.54rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={folio.status === "settled" ? { background: "#dcfce7", color: "#15803d" } : { background: "#fef3c7", color: "#b45309" }}>
              {folio.status}
            </span>
          </div>
          <p className="text-[0.68rem] text-luxury-500">
            {folio.room_label || "—"}{folio.guest_phone ? ` · ${folio.guest_phone}` : ""}
            {folio.check_in ? ` · ${fmtD(folio.check_in)} → ${fmtD(folio.check_out)}` : ""}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={printInvoice} className="btn-ghost">🖨 Invoice</button>
          {folio.status === "open" ? (
            <button onClick={() => onPatch({ status: "settled" })} className="btn-gold">✓ Settle</button>
          ) : (
            <button onClick={() => onPatch({ status: "open" })} className="btn-ghost">↺ Reopen</button>
          )}
        </div>
      </div>

      {/* charges */}
      <div className="card-p mb-3">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Charges</p>
        {t.mine.filter((x) => x.kind !== "payment").length === 0 ? (
          <p className="text-xs text-luxury-400 py-2">Abhi koi charge nahi.</p>
        ) : (
          <div className="space-y-1 mb-2">
            {t.mine.filter((x) => x.kind !== "payment").map((x) => (
              <div key={x.id} className="flex items-center gap-2 text-[0.76rem] py-1 border-b border-luxury-50 last:border-0">
                <span>{KIND[x.kind]?.icon || "➕"}</span>
                <span className="flex-1 min-w-0 truncate text-luxury-800">{x.label}
                  <span className="text-luxury-400"> · {x.qty}×{fmtCur(x.unit_price)}</span>
                </span>
                <span className="font-bold text-luxury-900">{fmtCur(x.amount)}</span>
                <button onClick={() => onDelCharge(x.id)} className="text-red-400 hover:text-red-600 text-sm leading-none">×</button>
              </div>
            ))}
          </div>
        )}
        {/* add charge row */}
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_2fr_auto_auto_auto] gap-1.5 mt-2">
          <select value={c.kind} onChange={(e) => setCV("kind", e.target.value)} className="inp-p !py-1.5 text-[0.74rem]">
            {["room", "food", "laundry", "service", "misc"].map((k) => (
              <option key={k} value={k}>{KIND[k].icon} {KIND[k].label}</option>
            ))}
          </select>
          <input value={c.label} onChange={(e) => setCV("label", e.target.value)} placeholder="Item"
            className="inp-p !py-1.5 text-[0.74rem]" onKeyDown={(e) => e.key === "Enter" && addItem()} />
          <input value={c.qty} onChange={(e) => setCV("qty", e.target.value)} type="number" placeholder="Qty"
            className="inp-p !py-1.5 text-[0.74rem] w-16" />
          <input value={c.unitPrice} onChange={(e) => setCV("unitPrice", e.target.value)} type="number" placeholder="₹ rate"
            className="inp-p !py-1.5 text-[0.74rem] w-20" />
          <button onClick={addItem} className="btn-gold !px-3 !py-1.5">Add</button>
        </div>
      </div>

      {/* totals */}
      <div className="card-p mb-3">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Bill summary</p>
        <div className="space-y-1.5 text-[0.78rem]">
          <Row k="Subtotal" v={fmtCur(t.subtotal)} />
          <div className="flex items-center justify-between">
            <span className="text-luxury-500 flex items-center gap-1.5">
              GST
              <input type="number" value={folio.tax_pct} onChange={(e) => onPatch({ taxPct: e.target.value })}
                className="inp-p !py-0.5 !px-1.5 w-14 text-[0.72rem]" /> %
            </span>
            <span className="font-semibold text-luxury-900">{fmtCur(t.tax)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-luxury-500 flex items-center gap-1.5">
              Discount ₹
              <input type="number" value={folio.discount} onChange={(e) => onPatch({ discount: e.target.value })}
                className="inp-p !py-0.5 !px-1.5 w-20 text-[0.72rem]" />
            </span>
            <span className="font-semibold text-red-600">− {fmtCur(t.discount)}</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-luxury-100">
            <span className="font-bold text-luxury-900">Total</span>
            <span className="font-extrabold text-luxury-900 text-base">{fmtCur(t.total)}</span>
          </div>
          <Row k="Paid" v={fmtCur(t.paid)} />
          <div className="flex items-center justify-between">
            <span className="font-bold" style={{ color: t.balance > 0 ? "#b91c1c" : "#15803d" }}>Balance due</span>
            <span className="font-extrabold text-base" style={{ color: t.balance > 0 ? "#b91c1c" : "#15803d" }}>{fmtCur(t.balance)}</span>
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
                <span>💰</span>
                <span className="flex-1 text-luxury-800">{x.label}</span>
                <span className="font-bold text-emerald-700">{fmtCur(x.amount)}</span>
                <button onClick={() => onDelCharge(x.id)} className="text-red-400 hover:text-red-600 text-sm leading-none">×</button>
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

      <button onClick={onDelete} className="text-[0.7rem] font-bold text-red-500 hover:text-red-700">🗑 Delete this folio</button>
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
