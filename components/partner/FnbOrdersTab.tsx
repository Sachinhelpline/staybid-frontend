"use client";
//
// v173 — F&B QR Ordering — outlets & QR codes (partner panel, Phase 2).
//
// The hotel creates ordering "outlets" (Room Service, Restaurant…), each
// with a QR code. Guests scan the QR → public /order/<id> menu page.
// Phase 3 adds the incoming-orders verification queue to this tab.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";
import {
  Plus, TriangleAlert, QrCode, Printer, Pencil, Play, Pause, Trash2, Lightbulb,
  X, ConciergeBell, Utensils, ClipboardList, MapPin, StickyNote, Check, FilePlus,
  CircleDot, Circle, ChevronDown, ChevronRight,
} from "lucide-react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
function fmtTime(s: string) {
  if (!s) return "";
  return new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const OUTLET_TYPE: Record<string, { label: string; Ic: any; desc: string }> = {
  room_service: { label: "Room Service", Ic: ConciergeBell, desc: "A QR in every room — guests order from their room" },
  restaurant:   { label: "Restaurant",   Ic: Utensils,      desc: "QR codes for restaurant tables" },
  other:        { label: "Other",        Ic: ClipboardList, desc: "Pool bar, lounge — any outlet" },
};

// qrserver.com — same QR provider used across the app (stable, ~1KB).
function QRImg({ url, size }: { url: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !url) {
    return (
      <div style={{ width: size, height: size, borderRadius: 10, border: "1.5px solid #d7dee6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#768fa7" }}>
        QR
      </div>
    );
  }
  const src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=${size}x${size}&margin=2&format=svg`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="QR" onError={() => setFailed(true)}
    style={{ borderRadius: 10, background: "#fff", display: "block" }} />;
}

export default function FnbOrdersTab({ hotelId, hotelName }: { hotelId: string; hotelName: string }) {
  const [outlets, setOutlets] = useState<any[]>([]);
  const [orders, setOrders]   = useState<any[]>([]);
  const [folios, setFolios]   = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; outlet?: any } | null>(null);
  const [verifyOrder, setVerifyOrder] = useState<any>(null);
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => { if (typeof window !== "undefined") setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const [oR, ordR] = await Promise.all([
        fetch(`/api/partner/outlets?hotelId=${encodeURIComponent(hotelId)}`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" }),
        fetch(`/api/partner/orders?hotelId=${encodeURIComponent(hotelId)}`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" }),
      ]);
      const od = await oR.json().catch(() => ({}));
      const ordD = await ordR.json().catch(() => ({}));
      setOutlets(od.outlets || []);
      setProvisioned(od.provisioned !== false);
      setOrders(ordD.orders || []);
      setFolios(ordD.folios || []);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  // refresh incoming orders every 30s so the desk sees new ones
  useEffect(() => {
    const t = setInterval(() => { load(); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(""), 2200); }

  async function rejectOrder(id: string) {
    if (!confirm("Reject this order?")) return;
    setOrders((p) => p.map((o) => (o.id === id ? { ...o, status: "rejected" } : o)));
    try {
      await fetch("/api/partner/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "reject" }),
      });
    } catch { load(); }
  }
  const orderUrl = (id: string) => `${origin}/order/${id}`;

  async function toggleOutlet(o: any) {
    setOutlets((p) => p.map((x) => (x.id === o.id ? { ...x, active: !x.active } : x)));
    try {
      await fetch("/api/partner/outlets", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, active: !o.active }),
      });
    } catch { load(); }
  }
  async function removeOutlet(id: string) {
    if (!confirm("Remove this outlet and its QR? Existing QR codes will stop working.")) return;
    try {
      await fetch(`/api/partner/outlets?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      setOutlets((p) => p.filter((x) => x.id !== id));
    } catch { load(); }
  }

  function printQR(o: any) {
    const url = orderUrl(o.id);
    const qr = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=600x600&margin=12`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR — ${o.name}</title>
      <style>body{font-family:Inter,Arial,sans-serif;text-align:center;padding:48px 24px;color:#241a0c}
      h1{font-family:'Cormorant Garamond',serif;font-size:30px;margin:0}
      .t{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#8198ae;font-weight:700}
      img{width:340px;height:340px;margin:22px 0;border:1px solid #eee;border-radius:14px}
      .s{font-size:18px;font-weight:700}.m{color:#8a795a;font-size:13px}</style></head><body>
      <p class="t">${OUTLET_TYPE[o.type]?.label || "Menu"}</p>
      <h1>${esc(hotelName)}</h1>
      <img src="${qr}" alt="QR"/>
      <p class="s">📷 Scan to see the menu &amp; order</p>
      <p class="m">${esc(o.name)} · Powered by StayBid</p>
      <script>window.onload=function(){window.print()}</script></body></html>`;
    const w = window.open("", "_blank", "width=520,height=720");
    if (w) { w.document.write(html); w.document.close(); }
    else alert("The print window was blocked — please allow pop-ups.");
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">F&amp;B Ordering &amp; QR</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">Create outlets, generate QR codes — guests scan to order.</p>
        </div>
        <button onClick={() => setEditor({ mode: "create" })} className="btn-gold inline-flex items-center gap-1.5">
          <Plus size={14} strokeWidth={2.4} aria-hidden />Add Outlet
        </button>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200">
          <p className="text-[0.74rem] text-amber-700 font-semibold inline-flex items-center gap-1.5">
            <TriangleAlert size={13} strokeWidth={2.4} aria-hidden />Ordering storage isn&apos;t set up yet
          </p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            <span className="font-mono">migrations/2026-05-21-fnb-ordering.sql</span> needs to be applied.
          </p>
        </div>
      )}

      {/* ── incoming orders ── */}
      <OrdersSection orders={orders} onVerify={(o: any) => setVerifyOrder(o)} onReject={rejectOrder} />

      <p className="text-[0.78rem] font-bold text-luxury-900 mt-4 mb-2">Outlets &amp; QR codes</p>

      {loading ? (
        <div className="card-p text-center py-10 text-luxury-400 text-sm">Loading…</div>
      ) : outlets.length === 0 ? (
        <div className="card-p text-center py-10">
          <QrCode className="mx-auto mb-2 text-luxury-300" size={30} strokeWidth={1.7} aria-hidden />
          <p className="text-luxury-600 font-semibold text-sm">No ordering outlets yet</p>
          <p className="text-luxury-400 text-xs mt-0.5 mb-3">Create a &quot;Room Service&quot; outlet — put its QR in every room.</p>
          <button onClick={() => setEditor({ mode: "create" })} className="btn-gold inline-flex items-center gap-1.5">
            <Plus size={14} strokeWidth={2.4} aria-hidden />Add Outlet
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {outlets.map((o) => {
            const meta = OUTLET_TYPE[o.type] || OUTLET_TYPE.other;
            const url = orderUrl(o.id);
            return (
              <div key={o.id} className={`card-p card-tight ${o.active ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <div className="bg-white rounded-xl p-1.5 border border-luxury-100 shrink-0">
                    <QRImg url={url} size={92} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[0.84rem] font-bold text-luxury-900 truncate">{o.name}</p>
                      {!o.active && <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full bg-luxury-100 text-luxury-500">OFF</span>}
                    </div>
                    <p className="text-[0.63rem] text-luxury-500 inline-flex items-center gap-1"><meta.Ic size={11} strokeWidth={2.3} aria-hidden />{meta.label}</p>
                    <code className="block mt-1.5 text-[0.63rem] bg-luxury-50 rounded-md px-1.5 py-1 text-luxury-500 truncate">{url}</code>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <button onClick={() => printQR(o)} className="btn-gold px-2.5! py-1! text-[0.7rem] inline-flex items-center gap-1"><Printer size={12} strokeWidth={2.3} aria-hidden />Print QR</button>
                  <button onClick={() => { navigator.clipboard?.writeText(url); showToast("Link copied ✓"); }}
                    className="btn-ghost px-2.5! py-1! text-[0.7rem]">Copy link</button>
                  <a href={url} target="_blank" rel="noreferrer" className="btn-ghost px-2.5! py-1! text-[0.7rem] no-underline">Preview</a>
                  <button onClick={() => setEditor({ mode: "edit", outlet: o })} aria-label="Edit outlet" className="btn-ghost px-2.5! py-1! text-[0.7rem] flex items-center"><Pencil size={12} strokeWidth={2.3} aria-hidden /></button>
                  <button onClick={() => toggleOutlet(o)} aria-label={o.active ? "Pause outlet" : "Activate outlet"} className="btn-ghost px-2.5! py-1! text-[0.7rem] flex items-center">{o.active ? <Pause size={12} strokeWidth={2.3} aria-hidden /> : <Play size={12} strokeWidth={2.3} aria-hidden />}</button>
                  <button onClick={() => removeOutlet(o.id)} aria-label="Remove outlet" className="btn-ghost px-2.5! py-1! text-[0.7rem] text-red-600! hover:border-red-300! flex items-center"><Trash2 size={12} strokeWidth={2.3} aria-hidden /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card-p card-tight mt-3 bg-luxury-50">
        <p className="text-[0.7rem] text-luxury-600 leading-relaxed flex items-start gap-1.5">
          <Lightbulb size={13} strokeWidth={2.3} aria-hidden className="mt-0.5 shrink-0 text-gold-600" />
          <span><b>Print QR</b> → stick it in every room / on every table. A guest scans it → your hotel&apos;s digital menu opens → they order. The order arrives here to verify (Phase 3) and gets added to the billing folio.</span>
        </p>
      </div>

      {editor && (
        <OutletEditor mode={editor.mode} outlet={editor.outlet} hotelId={hotelId}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />
      )}
      {verifyOrder && (
        <VerifyModal order={verifyOrder} folios={folios}
          onClose={() => setVerifyOrder(null)}
          onDone={(msg: string) => { setVerifyOrder(null); showToast(msg); load(); }} />
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-lg z-50"
          style={{ bottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function OutletEditor({ mode, outlet, hotelId, onClose, onSaved }: any) {
  const [name, setName] = useState(outlet?.name || "");
  const [type, setType] = useState(outlet?.type || "room_service");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) { setErr("Enter the outlet name."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/partner/outlets", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(mode === "create"
          ? { hotelId, name: name.trim(), type }
          : { id: outlet.id, name: name.trim(), type }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Save failed");
      onSaved();
    } catch (e: any) { setErr(e?.message || "Save failed"); setSaving(false); }
  }

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {mode === "create" ? "New Outlet" : "Edit Outlet"}
          </p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 flex items-center justify-center">
            <X size={16} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Outlet name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="e.g. Room Service · Rooftop Restaurant" className="inp-p" />
          </div>
          <div>
            <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Type</label>
            <div className="space-y-1.5">
              {Object.entries(OUTLET_TYPE).map(([k, m]) => {
                const on = type === k;
                return (
                  <button key={k} type="button" onClick={() => setType(k)}
                    className={`w-full text-left rounded-xl p-2.5 transition-all border ${on ? "bg-luxury-50 border-transparent" : "bg-white border-luxury-200"}`}
                    style={on ? { boxShadow: "0 0 0 1.5px #8198ae" } : undefined}>
                    <p className="text-[0.78rem] font-bold text-luxury-900 inline-flex items-center gap-1.5">
                      {on ? <CircleDot size={13} strokeWidth={2.4} aria-hidden /> : <Circle size={13} strokeWidth={2.2} aria-hidden />}
                      <m.Ic size={13} strokeWidth={2.3} aria-hidden />{m.label}
                    </p>
                    <p className="text-[0.63rem] text-luxury-500 mt-0.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">{saving ? "Saving…" : "Save Outlet"}</button>
        </div>
      </div>
    </div>
  );
}

// ── incoming orders ────────────────────────────────────────────────────────
function OrdersSection({ orders, onVerify, onReject }: any) {
  const pending = (orders || []).filter((o: any) => o.status === "pending");
  const recent  = (orders || []).filter((o: any) => o.status !== "pending").slice(0, 12);
  const [showRecent, setShowRecent] = useState(false);

  return (
    <div className="card-p">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[0.78rem] font-bold text-luxury-900">Incoming Food Orders</p>
        {pending.length > 0 && (
          <span className="text-[0.63rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">
            {pending.length} pending
          </span>
        )}
      </div>
      {pending.length === 0 ? (
        <p className="text-xs text-luxury-400 py-2">No new orders — they&apos;ll appear here as guests order via QR.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((o: any) => (
            <OrderCard key={o.id} o={o} pending onVerify={onVerify} onReject={onReject} />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <>
          <button onClick={() => setShowRecent((s) => !s)} className="text-[0.68rem] font-bold text-gold-600 mt-2 inline-flex items-center gap-1">
            {showRecent ? <ChevronDown size={13} strokeWidth={2.4} aria-hidden /> : <ChevronRight size={13} strokeWidth={2.4} aria-hidden />}
            {showRecent ? "Hide" : "Show"} recent orders ({recent.length})
          </button>
          {showRecent && (
            <div className="space-y-1.5 mt-1.5">
              {recent.map((o: any) => <OrderCard key={o.id} o={o} onVerify={onVerify} onReject={onReject} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OrderCard({ o, pending, onVerify, onReject }: any) {
  const items: any[] = Array.isArray(o.items) ? o.items : [];
  const st = o.status === "added_to_folio" ? { label: "Billed", cls: "bg-emerald-100 text-emerald-700" }
    : o.status === "rejected" ? { label: "Rejected", cls: "bg-red-100 text-red-700" }
    : { label: "Pending", cls: "bg-amber-50 text-amber-700" };
  return (
    <div className="rounded-xl border border-luxury-100 p-2.5 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[0.82rem] font-bold text-luxury-900 inline-flex items-center gap-1"><MapPin size={12} strokeWidth={2.4} aria-hidden />{o.location || "—"}</p>
            <span className={`text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <p className="text-[0.63rem] text-luxury-500">
            {o.outlet_name || "Menu"} · {fmtTime(o.created_at)}{o.guest_name ? ` · ${o.guest_name}` : ""}{o.guest_phone ? ` · ${o.guest_phone}` : ""}
          </p>
        </div>
        <p className="text-[0.84rem] font-bold text-luxury-900 shrink-0">{fmtCur(o.items_total)}</p>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {items.map((it: any) => (
          <p key={it.id} className="text-[0.68rem] text-luxury-600">
            {it.qty}× {it.item_name}{it.portion ? ` (${it.portion})` : ""} <span className="text-luxury-400">— {fmtCur(it.amount)}</span>
          </p>
        ))}
      </div>
      {o.note && <p className="text-[0.63rem] text-blue-600 italic mt-1 inline-flex items-start gap-1"><StickyNote size={11} strokeWidth={2.3} aria-hidden className="mt-0.5 shrink-0" />{o.note}</p>}
      {pending && (
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => onVerify(o)} className="btn-gold px-3! py-1.5! text-[0.72rem] flex-1 inline-flex items-center justify-center gap-1"><Check size={13} strokeWidth={2.6} aria-hidden />Verify &amp; Bill</button>
          <button onClick={() => onReject(o.id)}
            className="btn-ghost px-3! py-1.5! text-[0.72rem] text-red-600! hover:border-red-300!">Reject</button>
        </div>
      )}
    </div>
  );
}

// ── verify → pick the billing folio ────────────────────────────────────────
function VerifyModal({ order, folios, onClose, onDone }: any) {
  const loc = String(order.location || "").toLowerCase().trim();
  const sorted = useMemo(() => {
    const txt = (f: any) => `${f.room_label || ""} ${f.guest_name || ""} ${f.guest_phone || ""}`.toLowerCase();
    return [...(folios || [])].sort((a, b) => {
      const am = loc && txt(a).includes(loc) ? 0 : 1;
      const bm = loc && txt(b).includes(loc) ? 0 : 1;
      return am - bm;
    });
  }, [folios, loc]);
  const [target, setTarget] = useState<string>("");   // "" = new folio
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const items: any[] = Array.isArray(order.items) ? order.items : [];

  async function go() {
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/partner/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, action: "verify", ...(target ? { folioId: target } : { createFolio: true }) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Verify failed");
      onDone(`✓ ${d.charges || 0} item${d.charges === 1 ? "" : "s"} added to the folio`);
    } catch (e: any) { setErr(e?.message || "Verify failed"); setSaving(false); }
  }

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>Verify &amp; Bill</p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 flex items-center justify-center">
            <X size={16} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {/* order recap */}
          <div className="rounded-xl bg-luxury-50 p-2.5">
            <p className="text-[0.74rem] font-bold text-luxury-900 inline-flex items-center gap-1"><MapPin size={12} strokeWidth={2.4} aria-hidden />{order.location || "—"} · {fmtCur(order.items_total)}</p>
            {items.map((it: any) => (
              <p key={it.id} className="text-[0.66rem] text-luxury-600">{it.qty}× {it.item_name}{it.portion ? ` (${it.portion})` : ""}</p>
            ))}
          </div>

          <p className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest">Bill in folio</p>
          <div className="space-y-1.5">
            {/* new folio option */}
            <button type="button" onClick={() => setTarget("")}
              className={`w-full text-left rounded-xl p-2.5 transition-all border ${target === "" ? "bg-luxury-50 border-transparent" : "bg-white border-luxury-200"}`}
              style={target === "" ? { boxShadow: "0 0 0 1.5px #8198ae" } : undefined}>
              <p className="text-[0.78rem] font-bold text-luxury-900 inline-flex items-center gap-1.5">
                {target === "" ? <CircleDot size={13} strokeWidth={2.4} aria-hidden /> : <Circle size={13} strokeWidth={2.2} aria-hidden />}
                <FilePlus size={13} strokeWidth={2.3} aria-hidden />New folio
              </p>
              <p className="text-[0.63rem] text-luxury-500 mt-0.5">
                A new bill opens for {order.guest_name || `Room ${order.location || "—"}`}
              </p>
            </button>
            {sorted.map((f: any) => {
              const on = target === f.id;
              const suggested = loc && `${f.room_label || ""} ${f.guest_name || ""}`.toLowerCase().includes(loc);
              return (
                <button key={f.id} type="button" onClick={() => setTarget(f.id)}
                  className={`w-full text-left rounded-xl p-2.5 transition-all border ${on ? "bg-luxury-50 border-transparent" : "bg-white border-luxury-200"}`}
                  style={on ? { boxShadow: "0 0 0 1.5px #8198ae" } : undefined}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[0.78rem] font-bold text-luxury-900 inline-flex items-center gap-1.5">
                      {on ? <CircleDot size={13} strokeWidth={2.4} aria-hidden /> : <Circle size={13} strokeWidth={2.2} aria-hidden />}
                      {f.guest_name || "Guest"}
                    </p>
                    {suggested && <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">MATCH</span>}
                  </div>
                  <p className="text-[0.63rem] text-luxury-500 mt-0.5">{f.room_label || "—"}{f.guest_phone ? ` · ${f.guest_phone}` : ""}</p>
                </button>
              );
            })}
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={go} disabled={saving} className="btn-gold flex-1 inline-flex items-center justify-center gap-1">
            {saving ? "Billing…" : <><Check size={14} strokeWidth={2.6} aria-hidden />Verify &amp; Add to Folio</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function esc(s: any) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m] as string));
}
