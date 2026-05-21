"use client";
//
// v170 — Channel Manager (partner panel, Phase 3).
//
// Three sections:
//   A. Connect OTAs — owner pastes credentials from their own OTA
//      partner account; the connection is provisioned + stored.
//   B. Calendar export — per-room iCal URLs to paste into OTA extranets
//      (genuine 2-way calendar sync, fully self-serve, no partnership).
//   C. Integration readiness — checklist of what OTAs expect.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

const OTA_META: Record<string, { label: string; icon: string; hint: string }> = {
  booking:  { label: "Booking.com", icon: "🅱️", hint: "Booking.com Extranet → Account → Connectivity / Calendar" },
  mmt:      { label: "MakeMyTrip",  icon: "✈️", hint: "MMT Connect / Ingommt extranet → Channel settings" },
  airbnb:   { label: "Airbnb",      icon: "🏠", hint: "Airbnb → Listing → Availability → Sync calendars" },
  agoda:    { label: "Agoda",       icon: "🏨", hint: "Agoda YCS → Property → Connectivity" },
  goibibo:  { label: "Goibibo",     icon: "🧳", hint: "Goibibo / Ingommt extranet → Channel settings" },
  expedia:  { label: "Expedia",     icon: "🌐", hint: "Expedia Partner Central → Connectivity settings" },
  other:    { label: "Other OTA",   icon: "🔗", hint: "Apne OTA ke extranet → API / Connectivity section" },
};
const OTA_KEYS = ["booking", "mmt", "airbnb", "agoda", "goibibo", "expedia", "other"];

export default function ChannelManagerTab({
  hotelId, rooms, roomUnits,
}: {
  hotelId: string;
  rooms: any[];
  roomUnits: any[];
}) {
  const [connections, setConnections] = useState<any[]>([]);
  const [icalExports, setIcalExports] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<string | null>(null); // ota key
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/channels?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setConnections(d.connections || []);
      setIcalExports(d.icalExports || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(""), 2200); }
  function copy(text: string, label: string) {
    try {
      navigator.clipboard.writeText(text);
      showToast(`${label} copied ✓`);
    } catch { showToast("Copy failed — manually select karo"); }
  }

  async function removeConnection(id: string) {
    if (!confirm("Yeh OTA connection hata dein?")) return;
    try {
      await fetch(`/api/partner/channels?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      setConnections((p) => p.filter((c) => c.id !== id));
    } catch { load(); }
  }

  const connByOta = useMemo(() => {
    const m: Record<string, any> = {};
    connections.forEach((c) => { m[c.ota] = c; });
    return m;
  }, [connections]);

  // ── readiness checklist ───────────────────────────────────────────────────
  const checks = useMemo(() => {
    const withPrice = rooms.filter((r) => Number(r.floorPrice) > 0).length;
    const withImg = rooms.filter((r) => Array.isArray(r.images) && r.images.length > 0).length;
    return [
      { ok: rooms.length > 0, label: "Room categories defined", hint: "Rooms tab me kam se kam ek category banao" },
      { ok: rooms.length > 0 && withPrice === rooms.length, label: "Pricing set on every room", hint: `${withPrice}/${rooms.length} rooms par price set hai` },
      { ok: roomUnits.length > 0, label: "Room numbers / inventory added", hint: "Rooms tab me room numbers (101, 102…) add karo" },
      { ok: rooms.length > 0 && withImg === rooms.length, label: "Photos on every room", hint: `${withImg}/${rooms.length} rooms par photo hai` },
      { ok: true, label: "Live availability calendar", hint: "" },
      { ok: true, label: "Instant booking notifications", hint: "" },
      { ok: true, label: "Calendar export feed (iCal)", hint: "" },
    ];
  }, [rooms, roomUnits]);
  const ready = checks.filter((c) => c.ok).length;

  return (
    <div className="fade-up">
      <div className="mb-4">
        <h2 className="sec-title text-xl">Channel Manager</h2>
        <p className="text-[0.7rem] text-luxury-500 mt-0.5">Apne OTAs (Booking.com, MMT, Airbnb…) ko StayBid se jodo — credentials daalo, sync shuru.</p>
      </div>

      {/* ── C. Readiness ── */}
      <div className="card-p mb-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[0.78rem] font-bold text-luxury-900">Integration readiness</p>
          <span className="text-[0.66rem] font-bold px-2 py-0.5 rounded-full"
            style={ready === checks.length ? { background: "#dcfce7", color: "#15803d" } : { background: "#fef3c7", color: "#b45309" }}>
            {ready}/{checks.length} ready
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2">
              <span className="text-sm leading-none mt-0.5">{c.ok ? "✅" : "⚠️"}</span>
              <div className="min-w-0">
                <p className="text-[0.74rem] font-semibold text-luxury-800 leading-tight">{c.label}</p>
                {!c.ok && c.hint && <p className="text-[0.6rem] text-amber-600 leading-tight">{c.hint}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── A. Connect OTAs ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Connect your OTAs</p>
      {!provisioned && (
        <div className="card-p card-tight mb-2.5 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.7rem] text-amber-700">
            ⚠ Connection storage abhi setup nahi hua — <span className="font-mono">migrations/2026-05-21-channel-connections.sql</span> apply karni hai. (Calendar export neeche phir bhi chalega.)
          </p>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
        {OTA_KEYS.map((ota) => {
          const m = OTA_META[ota];
          const conn = connByOta[ota];
          return (
            <div key={ota} className="card-p card-tight flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-luxury-50 flex items-center justify-center text-base shrink-0">{m.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.82rem] font-bold text-luxury-900">{m.label}</p>
                <p className="text-[0.62rem] font-semibold" style={{ color: conn ? "#15803d" : "#9a8a6a" }}>
                  {conn ? "● Configured" : "○ Not connected"}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => setEditor(ota)} className="btn-ghost !px-2.5 !py-1 text-[0.7rem]">
                  {conn ? "Edit" : "Connect"}
                </button>
                {conn && (
                  <button onClick={() => removeConnection(conn.id)}
                    className="btn-ghost !px-2.5 !py-1 text-[0.7rem] !text-red-600 hover:!border-red-300">🗑</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── B. Calendar export ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">StayBid → OTA calendar sync</p>
      <p className="text-[0.66rem] text-luxury-500 mb-2.5">
        Har room ka ye iCal link apne OTA extranet ke <b>"Import calendar / Sync calendar"</b> me paste karo — StayBid par booking hote hi us OTA par bhi dates block ho jayengi.
      </p>
      {loading ? (
        <div className="card-p text-center py-6 text-luxury-400 text-sm">Loading…</div>
      ) : icalExports.length === 0 ? (
        <div className="card-p text-center py-6 text-luxury-400 text-sm">Pehle Rooms tab me room category banao.</div>
      ) : (
        <div className="space-y-2">
          {icalExports.map((x) => (
            <div key={x.roomId} className="card-p card-tight">
              <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">{x.name}</p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 min-w-0 truncate text-[0.62rem] bg-luxury-50 rounded-lg px-2 py-1.5 text-luxury-600">{x.url}</code>
                <button onClick={() => copy(x.url, "iCal link")} className="btn-gold !px-2.5 !py-1.5 text-[0.7rem]">Copy</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <ChannelEditor
          ota={editor}
          hotelId={hotelId}
          existing={connByOta[editor]}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
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

// ── credential modal ──────────────────────────────────────────────────────
function ChannelEditor({
  ota, hotelId, existing, onClose, onSaved,
}: {
  ota: string;
  hotelId: string;
  existing?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const m = OTA_META[ota];
  const [f, setF] = useState({
    label:       existing?.label || "",
    propertyId:  existing?.property_id || "",
    endpointUrl: existing?.endpoint_url || "",
    apiKey:      existing?.api_key || "",
    apiSecret:   existing?.api_secret || "",
    note:        existing?.note || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const lbl = "text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  async function save() {
    if (!f.propertyId.trim() && !f.apiKey.trim() && !f.endpointUrl.trim()) {
      setErr("Kam se kam Property ID ya API key ya URL daalo."); return;
    }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/partner/channels", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId, ota, mode: "api",
          label: f.label.trim(), propertyId: f.propertyId.trim(),
          endpointUrl: f.endpointUrl.trim(), apiKey: f.apiKey.trim(),
          apiSecret: f.apiSecret.trim(), note: f.note.trim(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Save failed");
      onSaved();
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setSaving(false); }
  }

  return modalPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {m.icon} Connect {m.label}
          </p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div className="rounded-xl p-2.5" style={{ background: "#f6f1e6" }}>
            <p className="text-[0.66rem] text-luxury-600">📍 Ye details kahan se lein: <b>{m.hint}</b></p>
          </div>
          <div>
            <label className={lbl}>Property / Hotel ID</label>
            <input value={f.propertyId} onChange={(e) => set("propertyId", e.target.value)}
              placeholder="OTA par aapki property ka ID" className="inp-p" autoFocus />
          </div>
          <div>
            <label className={lbl}>API Key</label>
            <input value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)}
              placeholder="API key / username" className="inp-p" />
          </div>
          <div>
            <label className={lbl}>API Secret / Password</label>
            <input value={f.apiSecret} onChange={(e) => set("apiSecret", e.target.value)}
              type="password" placeholder="API secret" className="inp-p" />
          </div>
          <div>
            <label className={lbl}>Endpoint / Connection URL</label>
            <input value={f.endpointUrl} onChange={(e) => set("endpointUrl", e.target.value)}
              placeholder="https://… (OTA connectivity URL)" className="inp-p" />
          </div>
          <div>
            <label className={lbl}>Label / note (optional)</label>
            <input value={f.note} onChange={(e) => set("note", e.target.value)}
              placeholder="e.g. main property account" className="inp-p" />
          </div>
          <p className="text-[0.62rem] text-luxury-400 leading-relaxed">
            Credentials securely save ho jayenge. Jaise hi is OTA ka live connector activate hoga, aapki yahi details use hongi — dobara kuch nahi karna padega.
          </p>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">
            {saving ? "Saving…" : "Save Connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
