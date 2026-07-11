"use client";
//
// v316 — Channel Manager Phase 2: the unified console.
//
// ONE home for every OTA channel. Layout:
//   1. Health rollup strip (live feed status + connections)
//   2. Connection cards per OTA — honest status (Active iCal / Configured
//      awaiting connector / Not connected), Connect + Instructions
//   3. Expandable per-OTA connect instructions (import + export steps)
//   4. <OtaFeedManager> — the real iCal import feeds (shared with the free
//      Availability tab so nothing is paywalled away)
//   5. iCal export links (StayBid → OTA)
//   6. Recent sync activity (channel_sync_logs)
//   7. Readiness checklist
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { modalPortal } from "@/lib/partner/modal-portal";
import OtaFeedManager, {
  partnerToken, OTA_INSTRUCTIONS,
} from "@/components/partner/OtaFeedManager";

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

function fmtWhen(iso: any) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return String(iso); }
}

export default function ChannelManagerTab({
  hotelId, rooms, roomUnits,
}: {
  hotelId: string;
  rooms: any[];
  roomUnits: any[];
}) {
  const [connections, setConnections] = useState<any[]>([]);
  const [icalExports, setIcalExports] = useState<any[]>([]);
  const [feeds, setFeeds] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<string | null>(null);
  const [openInstr, setOpenInstr] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const loadChannels = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/channels?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setConnections(d.connections || []);
      setIcalExports(d.icalExports || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
  }, [hotelId]);

  const loadFeeds = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/ota-feeds?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setFeeds(Array.isArray(d.feeds) ? d.feeds : []);
    } catch { /* keep */ }
  }, [hotelId]);

  const loadLogs = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/channel-logs?hotelId=${encodeURIComponent(hotelId)}&limit=15`, {
        headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setLogs(Array.isArray(d.logs) ? d.logs : []);
    } catch { /* keep */ }
  }, [hotelId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadChannels(), loadFeeds(), loadLogs()]);
    setLoading(false);
  }, [loadChannels, loadFeeds, loadLogs]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(""), 2200); }
  function copy(text: string, label: string) {
    try { navigator.clipboard.writeText(text); showToast(`${label} copied ✓`); }
    catch { showToast("Copy failed — manually select karo"); }
  }
  async function removeConnection(id: string) {
    if (!confirm("Yeh OTA connection hata dein? (Import feeds alag se rahenge.)")) return;
    try {
      await fetch(`/api/partner/channels?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${partnerToken()}` },
      });
      setConnections((p) => p.filter((c) => c.id !== id));
    } catch { loadChannels(); }
  }

  const connByOta = useMemo(() => {
    const m: Record<string, any> = {};
    connections.forEach((c) => { m[c.ota] = c; });
    return m;
  }, [connections]);

  const feedsByOta = useMemo(() => {
    const m: Record<string, any[]> = {};
    feeds.forEach((f) => { (m[f.provider] ||= []).push(f); });
    return m;
  }, [feeds]);

  // ── per-OTA live state ────────────────────────────────────────────────────
  function otaState(ota: string): { label: string; color: string; dot: string } {
    const fs = feedsByOta[ota] || [];
    const anyError = fs.some((f) => f.lastSyncStatus === "error" && f.autoSync !== false);
    const anyOk = fs.some((f) => f.lastSyncAt && f.lastSyncStatus !== "error");
    const conn = connByOta[ota];
    if (anyError) return { label: "Sync error", color: "#dc2626", dot: "#ef4444" };
    if (anyOk) return { label: `Active · ${fs.length} feed${fs.length > 1 ? "s" : ""}`, color: "#15803d", dot: "#22c55e" };
    if (fs.length) return { label: "Awaiting first sync", color: "#b45309", dot: "#eab308" };
    if (conn && conn.mode === "api") return { label: "Configured · awaiting connector", color: "#7c3aed", dot: "#a855f7" };
    if (conn) return { label: "Configured", color: "#6b7280", dot: "#9ca3af" };
    return { label: "Not connected", color: "#9a8a6a", dot: "#d4d4d4" };
  }

  // ── health rollup ─────────────────────────────────────────────────────────
  const health = useMemo(() => {
    let ok = 0, error = 0, paused = 0;
    feeds.forEach((f) => {
      if (f.autoSync === false) paused++;
      else if (f.lastSyncStatus === "error") error++;
      else if (f.lastSyncAt) ok++;
    });
    const activeOtas = new Set(feeds.map((f) => f.provider)).size;
    return { ok, error, paused, feeds: feeds.length, activeOtas };
  }, [feeds]);

  // ── readiness checklist ───────────────────────────────────────────────────
  const checks = useMemo(() => {
    const withPrice = rooms.filter((r) => Number(r.floorPrice) > 0).length;
    const withImg = rooms.filter((r) => Array.isArray(r.images) && r.images.length > 0).length;
    return [
      { ok: rooms.length > 0, label: "Room categories defined", hint: "Rooms tab me kam se kam ek category banao" },
      { ok: rooms.length > 0 && withPrice === rooms.length, label: "Pricing set on every room", hint: `${withPrice}/${rooms.length} rooms par price` },
      { ok: roomUnits.length > 0, label: "Room numbers / inventory added", hint: "Rooms tab me room numbers add karo" },
      { ok: rooms.length > 0 && withImg === rooms.length, label: "Photos on every room", hint: `${withImg}/${rooms.length} rooms par photo` },
      { ok: feeds.length > 0, label: "At least one OTA feed connected", hint: "Neeche apne OTA ka iCal link add karo" },
      { ok: true, label: "Live availability calendar", hint: "" },
      { ok: true, label: "Calendar export feed (iCal)", hint: "" },
    ];
  }, [rooms, roomUnits, feeds]);
  const ready = checks.filter((c) => c.ok).length;

  return (
    <div className="fade-up">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="sec-title text-xl">Channel Manager</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">
            Apne OTAs (Booking.com, MMT, Airbnb…) ko StayBid se jodo — ek jagah se availability sync karo.
          </p>
        </div>
        <button onClick={refreshAll} className="btn-ghost px-2.5! py-1! text-[0.7rem] shrink-0" title="Refresh">↻</button>
      </div>

      {/* ── health rollup ── */}
      <div className="card-p card-tight mb-3.5">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat n={health.activeOtas} label="Channels" color="#0f172a" />
          <Stat n={health.ok} label="Synced" color="#15803d" />
          <Stat n={health.error} label="Errors" color={health.error ? "#dc2626" : "#9ca3af"} />
          <Stat n={health.paused} label="Paused" color={health.paused ? "#b45309" : "#9ca3af"} />
        </div>
      </div>

      {/* ── connection cards ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Your OTA channels</p>
      <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
        {OTA_KEYS.map((ota) => {
          const m = OTA_META[ota];
          const st = otaState(ota);
          const conn = connByOta[ota];
          const instrOpen = openInstr === ota;
          return (
            <div key={ota} className="card-p card-tight">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-luxury-50 flex items-center justify-center text-base shrink-0">{m.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.82rem] font-bold text-luxury-900">{m.label}</p>
                  <p className="text-[0.62rem] font-semibold inline-flex items-center gap-1" style={{ color: st.color }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: st.dot }} />
                    {st.label}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => setOpenInstr(instrOpen ? null : ota)}
                    className="btn-ghost px-2! py-1! text-[0.66rem]" title="How to connect">
                    {instrOpen ? "Hide" : "How?"}
                  </button>
                  <button onClick={() => setEditor(ota)} className="btn-ghost px-2.5! py-1! text-[0.7rem]">
                    {conn && conn.mode === "api" ? "Edit" : "API"}
                  </button>
                  {conn && (
                    <button onClick={() => removeConnection(conn.id)}
                      className="btn-ghost px-2! py-1! text-[0.7rem] text-red-600! hover:border-red-300!">🗑</button>
                  )}
                </div>
              </div>
              {instrOpen && <Instructions ota={ota} />}
            </div>
          );
        })}
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3.5 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.7rem] text-amber-700">
            ⚠ API-credential storage abhi setup nahi hua — <span className="font-mono">migrations/2026-07-11-v315-channel-manager-phase1.sql</span> apply karo. (iCal import + export neeche phir bhi chalega.)
          </p>
        </div>
      )}

      {/* ── OTA import feeds (shared component) ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">OTA → StayBid · import bookings</p>
      <p className="text-[0.66rem] text-luxury-500 mb-2.5">
        Har OTA se uska <b>Export calendar</b> (.ics) link copy karke yahan add karo — us OTA par booking hote hi StayBid par woh dates block ho jayengi (aur cancel hone par khud release).
      </p>
      <div className="card-p mb-4">
        <OtaFeedManager hotelId={hotelId} rooms={rooms} onChanged={refreshAll} />
      </div>

      {/* ── iCal export ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">StayBid → OTA · export availability</p>
      <p className="text-[0.66rem] text-luxury-500 mb-2.5">
        Ye link apne OTA extranet ke <b>Import calendar</b> me paste karo — StayBid ki booking us OTA par bhi dates block kar degi.
      </p>
      {loading ? (
        <div className="card-p text-center py-6 text-luxury-400 text-sm">Loading…</div>
      ) : icalExports.length === 0 ? (
        <div className="card-p text-center py-6 text-luxury-400 text-sm">Pehle Rooms tab me room category banao.</div>
      ) : (
        <div className="space-y-2 mb-4">
          {icalExports.map((x) => (
            <div key={x.roomId} className="card-p card-tight">
              <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">{x.name}</p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 min-w-0 truncate text-[0.62rem] bg-luxury-50 rounded-lg px-2 py-1.5 text-luxury-600">{x.url}</code>
                <button onClick={() => copy(x.url, "iCal link")} className="btn-gold px-2.5! py-1.5! text-[0.7rem]">Copy</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── sync activity ── */}
      {logs.length > 0 && (
        <>
          <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Recent sync activity</p>
          <div className="card-p card-tight mb-4">
            <div className="space-y-1.5">
              {logs.map((l) => {
                const bad = l.status === "error";
                return (
                  <div key={l.id} className="flex items-center gap-2 text-[0.68rem] py-0.5 border-b border-luxury-100 last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: bad ? "#ef4444" : l.status === "empty" ? "#eab308" : "#22c55e" }} />
                    <span className="font-semibold text-luxury-700 uppercase w-14 shrink-0">{l.provider || l.direction}</span>
                    <span className="text-luxury-500 shrink-0">
                      {bad ? "failed" : `+${l.blocks_added ?? 0}/−${l.blocks_removed ?? 0} of ${l.events_total ?? 0}`}
                    </span>
                    <span className="text-luxury-400 truncate flex-1">{bad ? l.error : ""}</span>
                    <span className="text-luxury-300 shrink-0">{l.triggered_by === "cron" ? "auto" : "manual"} · {fmtWhen(l.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── readiness ── */}
      <div className="card-p card-tight mb-2">
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

      {editor && (
        <ChannelEditor
          ota={editor} hotelId={hotelId} existing={connByOta[editor]}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); loadChannels(); }}
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

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div>
      <p className="text-lg font-bold leading-none" style={{ color }}>{n}</p>
      <p className="text-[0.58rem] font-semibold text-luxury-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function Instructions({ ota }: { ota: string }) {
  const info = OTA_INSTRUCTIONS[ota] || OTA_INSTRUCTIONS.other;
  return (
    <div className="mt-2.5 pt-2.5 border-t border-luxury-100 grid sm:grid-cols-2 gap-2.5">
      <div>
        <p className="text-[0.6rem] font-bold text-luxury-400 uppercase mb-1">Import their bookings ↓</p>
        <ol className="list-decimal list-inside space-y-0.5">
          {info.export.map((s, i) => <li key={i} className="text-[0.66rem] text-luxury-600 leading-snug">{s}</li>)}
        </ol>
      </div>
      <div>
        <p className="text-[0.6rem] font-bold text-luxury-400 uppercase mb-1">Send them StayBid dates ↑</p>
        <ol className="list-decimal list-inside space-y-0.5">
          {info.import.map((s, i) => <li key={i} className="text-[0.66rem] text-luxury-600 leading-snug">{s}</li>)}
        </ol>
      </div>
    </div>
  );
}

// ── API-credential vault modal (unchanged behaviour, honest copy) ──────────
function ChannelEditor({
  ota, hotelId, existing, onClose, onSaved,
}: {
  ota: string; hotelId: string; existing?: any; onClose: () => void; onSaved: () => void;
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
        headers: { Authorization: `Bearer ${partnerToken()}`, "Content-Type": "application/json" },
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
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>{m.icon} Connect {m.label} (API)</p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div className="rounded-xl p-2.5" style={{ background: "#f0e9ff" }}>
            <p className="text-[0.66rem] text-purple-800">
              💡 Simplest option: iCal feed use karo (neeche list me) — koi API key nahi chahiye, turant chalta hai.
              API credentials tab chahiye jab is OTA ka certified live connector activate ho.
            </p>
          </div>
          <div className="rounded-xl p-2.5" style={{ background: "#f6f1e6" }}>
            <p className="text-[0.66rem] text-luxury-600">📍 Ye details kahan se lein: <b>{m.hint}</b></p>
          </div>
          <div><label className={lbl}>Property / Hotel ID</label>
            <input value={f.propertyId} onChange={(e) => set("propertyId", e.target.value)} placeholder="OTA par aapki property ka ID" className="inp-p" autoFocus /></div>
          <div><label className={lbl}>API Key</label>
            <input value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder="API key / username" className="inp-p" /></div>
          <div><label className={lbl}>API Secret / Password</label>
            <input value={f.apiSecret} onChange={(e) => set("apiSecret", e.target.value)} type="password" placeholder="API secret" className="inp-p" /></div>
          <div><label className={lbl}>Endpoint / Connection URL</label>
            <input value={f.endpointUrl} onChange={(e) => set("endpointUrl", e.target.value)} placeholder="https://… (OTA connectivity URL)" className="inp-p" /></div>
          <div><label className={lbl}>Label / note (optional)</label>
            <input value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. main property account" className="inp-p" /></div>
          <p className="text-[0.62rem] text-luxury-400 leading-relaxed">
            Credentials securely save ho jayenge. Jaise hi is OTA ka live connector activate hoga, aapki yahi details use hongi — dobara kuch nahi karna padega.
          </p>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">{saving ? "Saving…" : "Save Connection"}</button>
        </div>
      </div>
    </div>,
  );
}
