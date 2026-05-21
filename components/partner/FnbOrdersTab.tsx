"use client";
//
// v173 — F&B QR Ordering — outlets & QR codes (partner panel, Phase 2).
//
// The hotel creates ordering "outlets" (Room Service, Restaurant…), each
// with a QR code. Guests scan the QR → public /order/<id> menu page.
// Phase 3 adds the incoming-orders verification queue to this tab.
//
import { useCallback, useEffect, useState } from "react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

const OUTLET_TYPE: Record<string, { label: string; icon: string; desc: string }> = {
  room_service: { label: "Room Service", icon: "🛎", desc: "Har room me QR — guest room se order kare" },
  restaurant:   { label: "Restaurant",   icon: "🍴", desc: "Restaurant tables ke liye QR" },
  other:        { label: "Other",        icon: "📋", desc: "Pool bar, lounge — koi bhi outlet" },
};

// qrserver.com — same QR provider used across the app (stable, ~1KB).
function QRImg({ url, size }: { url: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !url) {
    return (
      <div style={{ width: size, height: size, borderRadius: 10, border: "1.5px solid #e6ddc8", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#9a8a6a" }}>
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
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; outlet?: any } | null>(null);
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => { if (typeof window !== "undefined") setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/outlets?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setOutlets(d.outlets || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(""), 2200); }
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
    if (!confirm("Yeh outlet aur uska QR hata dein? Purane QR kaam karna band kar denge.")) return;
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
      .t{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#c9911a;font-weight:700}
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
    else alert("Print window block ho gaya — popup allow karo.");
  }

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">F&amp;B Ordering &amp; QR</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">Outlets banao, QR generate karo — guest scan karke order kare.</p>
        </div>
        <button onClick={() => setEditor({ mode: "create" })} className="btn-gold">➕ Add Outlet</button>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.74rem] text-amber-800 font-semibold">⚠ Ordering storage abhi setup nahi hua</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            <span className="font-mono">migrations/2026-05-21-fnb-ordering.sql</span> apply karni hai.
          </p>
        </div>
      )}

      {loading ? (
        <div className="card-p text-center py-10 text-luxury-400 text-sm">Loading…</div>
      ) : outlets.length === 0 ? (
        <div className="card-p text-center py-10">
          <p className="text-3xl mb-2">📱</p>
          <p className="text-luxury-600 font-semibold text-sm">Abhi koi ordering outlet nahi hai</p>
          <p className="text-luxury-400 text-xs mt-0.5 mb-3">"Room Service" outlet banao — har room me uska QR lagao.</p>
          <button onClick={() => setEditor({ mode: "create" })} className="btn-gold">➕ Add Outlet</button>
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
                      {!o.active && <span className="text-[0.52rem] font-bold px-1.5 py-0.5 rounded-full bg-luxury-100 text-luxury-500">OFF</span>}
                    </div>
                    <p className="text-[0.62rem] text-luxury-500">{meta.icon} {meta.label}</p>
                    <code className="block mt-1.5 text-[0.56rem] bg-luxury-50 rounded-md px-1.5 py-1 text-luxury-500 truncate">{url}</code>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <button onClick={() => printQR(o)} className="btn-gold !px-2.5 !py-1 text-[0.7rem]">🖨 Print QR</button>
                  <button onClick={() => { navigator.clipboard?.writeText(url); showToast("Link copied ✓"); }}
                    className="btn-ghost !px-2.5 !py-1 text-[0.7rem]">Copy link</button>
                  <a href={url} target="_blank" rel="noreferrer" className="btn-ghost !px-2.5 !py-1 text-[0.7rem] no-underline">Preview</a>
                  <button onClick={() => setEditor({ mode: "edit", outlet: o })} className="btn-ghost !px-2.5 !py-1 text-[0.7rem]">✏️</button>
                  <button onClick={() => toggleOutlet(o)} className="btn-ghost !px-2.5 !py-1 text-[0.7rem]">{o.active ? "⏸" : "▶"}</button>
                  <button onClick={() => removeOutlet(o.id)} className="btn-ghost !px-2.5 !py-1 text-[0.7rem] !text-red-600 hover:!border-red-300">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card-p card-tight mt-3" style={{ background: "#f6f1e6" }}>
        <p className="text-[0.7rem] text-luxury-600 leading-relaxed">
          💡 <b>Print QR</b> → har room / table par chipka do. Guest scan karega → aapke hotel ke naam se digital menu khulega → order karega. Order yahan verify ke liye aayega (Phase 3) aur billing folio me add ho jayega.
        </p>
      </div>

      {editor && (
        <OutletEditor mode={editor.mode} outlet={editor.outlet} hotelId={hotelId}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />
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
    if (!name.trim()) { setErr("Outlet ka naam daalo."); return; }
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

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {mode === "create" ? "New Outlet" : "Edit Outlet"}
          </p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Outlet name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="e.g. Room Service · Rooftop Restaurant" className="inp-p" />
          </div>
          <div>
            <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Type</label>
            <div className="space-y-1.5">
              {Object.entries(OUTLET_TYPE).map(([k, m]) => {
                const on = type === k;
                return (
                  <button key={k} type="button" onClick={() => setType(k)}
                    className="w-full text-left rounded-xl p-2.5 transition-all"
                    style={{ background: on ? "#fff8e6" : "#fff", border: `1.5px solid ${on ? "#c9911a" : "#e6ddc8"}` }}>
                    <p className="text-[0.78rem] font-bold text-luxury-900">{on ? "● " : "○ "}{m.icon} {m.label}</p>
                    <p className="text-[0.62rem] text-luxury-500 mt-0.5">{m.desc}</p>
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

function esc(s: any) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m] as string));
}
