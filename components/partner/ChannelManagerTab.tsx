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
import { RotateCw, TriangleAlert, Trash2, CircleCheck, Check, ArrowDown, ArrowUp, X, Lightbulb, MapPin } from "lucide-react";
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
  other:    { label: "Other OTA",   icon: "🔗", hint: "Your OTA's extranet → API / Connectivity section" },
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
  const [reservations, setReservations] = useState<any[]>([]);
  const [resByChannel, setResByChannel] = useState<any[]>([]);
  const [resTotals, setResTotals] = useState<{ count: number; upcoming: number; nights: number }>({ count: 0, upcoming: 0, nights: 0 });
  const [overbook, setOverbook] = useState<any[]>([]);
  const [showAllRes, setShowAllRes] = useState(false);
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

  const loadReservations = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/channel-reservations?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setReservations(Array.isArray(d.reservations) ? d.reservations : []);
      setResByChannel(Array.isArray(d.byChannel) ? d.byChannel : []);
      setResTotals(d.totals || { count: 0, upcoming: 0, nights: 0 });
    } catch { /* keep */ }
  }, [hotelId]);

  const loadOverbooking = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/overbooking-check?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setOverbook(Array.isArray(d.conflicts) ? d.conflicts : []);
    } catch { /* keep */ }
  }, [hotelId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadChannels(), loadFeeds(), loadLogs(), loadReservations(), loadOverbooking()]);
    setLoading(false);
  }, [loadChannels, loadFeeds, loadLogs, loadReservations, loadOverbooking]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(""), 2200); }
  function copy(text: string, label: string) {
    try { navigator.clipboard.writeText(text); showToast(`${label} copied ✓`); }
    catch { showToast("Copy failed — please select it manually"); }
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
    if (fs.length) return { label: "Awaiting first sync", color: "#b45309", dot: "#a4b5c5" };
    if (conn && conn.mode === "api") return { label: "Configured · awaiting connector", color: "#7c3aed", dot: "#a855f7" };
    if (conn) return { label: "Configured", color: "#6b7280", dot: "#9ca3af" };
    return { label: "Not connected", color: "#768fa7", dot: "#d4d4d4" };
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
      { ok: rooms.length > 0, label: "Room categories defined", hint: "Add at least one category in the Rooms tab" },
      { ok: rooms.length > 0 && withPrice === rooms.length, label: "Pricing set on every room", hint: `${withPrice}/${rooms.length} rooms priced` },
      { ok: roomUnits.length > 0, label: "Room numbers / inventory added", hint: "Add room numbers in the Rooms tab" },
      { ok: rooms.length > 0 && withImg === rooms.length, label: "Photos on every room", hint: `${withImg}/${rooms.length} rooms with photos` },
      { ok: feeds.length > 0, label: "At least one OTA feed connected", hint: "Add your OTA's iCal link below" },
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
            Connect your OTAs (Booking.com, MMT, Airbnb…) to StayBid — sync availability from one place.
          </p>
        </div>
        <button onClick={refreshAll} aria-label="Refresh" className="btn-ghost px-2.5! py-1! text-[0.7rem] shrink-0 inline-flex items-center" title="Refresh"><RotateCw size={13} strokeWidth={2.3} aria-hidden /></button>
      </div>

      {/* ── health rollup ── */}
      <div className="card-p card-tight mb-3.5">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat n={health.activeOtas} label="Channels" cls="text-luxury-900" />
          <Stat n={health.ok} label="Synced" cls="text-emerald-600" />
          <Stat n={health.error} label="Errors" cls={health.error ? "text-red-600" : "text-luxury-400"} />
          <Stat n={health.paused} label="Paused" cls={health.paused ? "text-amber-600" : "text-luxury-400"} />
        </div>
      </div>

      {/* ── overbooking alerts (urgent — sits high) ── */}
      {overbook.length > 0 && (
        <div className="card-p card-tight mb-3.5 bg-red-50 border-red-200">
          <p className="text-[0.78rem] font-bold text-red-700 mb-1.5 inline-flex items-center gap-1.5">
            <TriangleAlert size={13} strokeWidth={2.3} aria-hidden /> Overbooking risk — {overbook.length} conflict{overbook.length > 1 ? "s" : ""}
          </p>
          <p className="text-[0.64rem] text-red-500 mb-2">
            On these dates an OTA booking pushed a room over its capacity. Check now and cancel one side.
          </p>
          <div className="space-y-1.5">
            {overbook.slice(0, 6).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[0.68rem] bg-white/70 rounded-lg px-2 py-1.5">
                <span className="font-bold text-red-700 shrink-0 uppercase">{c.provider}</span>
                <span className="font-semibold text-luxury-800 truncate flex-1">{c.roomName}</span>
                <span className="text-luxury-500 shrink-0">{c.fromDate} → {c.toDate}</span>
                <span className="font-bold text-red-600 shrink-0">{c.occupied}/{c.capacity}</span>
              </div>
            ))}
            {overbook.length > 6 && (
              <p className="text-[0.66rem] text-red-400">…and {overbook.length - 6} more</p>
            )}
          </div>
        </div>
      )}

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
                  <p className="text-[0.66rem] font-semibold inline-flex items-center gap-1" style={{ color: st.color }}>
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
                    <button onClick={() => removeConnection(conn.id)} aria-label="Remove connection"
                      className="btn-ghost px-2! py-1! text-[0.7rem] text-red-600! hover:border-red-300! inline-flex items-center"><Trash2 size={12} strokeWidth={2.2} aria-hidden /></button>
                  )}
                </div>
              </div>
              {instrOpen && <Instructions ota={ota} />}
            </div>
          );
        })}
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3.5 bg-amber-50 border-amber-200">
          <p className="text-[0.7rem] text-amber-700 inline-flex items-start gap-1.5">
            <TriangleAlert size={12} strokeWidth={2.3} aria-hidden className="mt-0.5 shrink-0" /> <span>API-credential storage isn't set up yet — apply <span className="font-mono">migrations/2026-07-11-v315-channel-manager-phase1.sql</span>. (iCal import + export below still works.)</span>
          </p>
        </div>
      )}

      {/* ── room mapping + channel rates ── */}
      <RoomMappingSection
        hotelId={hotelId} rooms={rooms} connections={connections}
        onToast={showToast}
      />

      {/* ── OTA import feeds (shared component) ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">OTA → StayBid · import bookings</p>
      <p className="text-[0.66rem] text-luxury-500 mb-2.5">
        Copy each OTA's <b>Export calendar</b> (.ics) link and add it here — as soon as a booking happens on that OTA, those dates block on StayBid (and release automatically on cancel).
      </p>
      <div className="card-p mb-4">
        <OtaFeedManager hotelId={hotelId} rooms={rooms} onChanged={refreshAll} />
      </div>

      {/* ── OTA reservations inbox ── */}
      {resTotals.count > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[0.78rem] font-bold text-luxury-900">OTA reservations</p>
            <span className="text-[0.66rem] font-semibold text-luxury-400">
              {resTotals.upcoming} upcoming · {resTotals.count} total
            </span>
          </div>
          <p className="text-[0.66rem] text-luxury-500 mb-2.5">
            Bookings imported from your connected OTAs. They disappear automatically when cancelled.
          </p>
          <div className="card-p card-tight mb-4">
            {/* per-channel production chips */}
            {resByChannel.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {resByChannel.map((c) => (
                  <span key={c.provider} className="text-[0.66rem] font-semibold rounded-full px-2 py-0.5 bg-luxury-50 text-luxury-700 inline-flex items-center gap-1">
                    <span>{OTA_META[c.provider]?.icon || "🔗"}</span>
                    {OTA_META[c.provider]?.label || c.provider}
                    <b className="text-luxury-900">{c.count}</b>
                    <span className="text-luxury-400">· {c.nights}n</span>
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              {(showAllRes ? reservations : reservations.slice(0, 10)).map((r) => {
                const st =
                  r.status === "in_house" ? { t: "In-house", c: "#15803d" }
                  : r.status === "upcoming" ? { t: "Upcoming", c: "#b45309" }
                  : { t: "Checked out", c: "#9ca3af" };
                return (
                  <div key={r.id} className="flex items-center gap-2 text-[0.68rem] py-1 border-b border-luxury-100 last:border-0">
                    <span className="shrink-0">{OTA_META[r.provider]?.icon || "🔗"}</span>
                    <span className="font-semibold text-luxury-800 truncate min-w-0" style={{ flex: "1 1 40%" }}>
                      {r.guestName || "OTA guest"}
                      <span className="text-luxury-400 font-normal"> · {r.roomName}</span>
                    </span>
                    <span className="text-luxury-500 shrink-0">{r.fromDate} → {r.toDate}</span>
                    <span className="text-luxury-300 shrink-0">{r.nights}n</span>
                    <span className="font-semibold shrink-0 w-16 text-right" style={{ color: st.c }}>{st.t}</span>
                  </div>
                );
              })}
            </div>
            {reservations.length > 10 && (
              <button onClick={() => setShowAllRes((v) => !v)}
                className="btn-ghost w-full mt-2 py-1! text-[0.68rem]">
                {showAllRes ? "Show less" : `Show all ${reservations.length}`}
              </button>
            )}
          </div>
        </>
      )}

      {/* ── iCal export ── */}
      <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">StayBid → OTA · export availability</p>
      <p className="text-[0.66rem] text-luxury-500 mb-2.5">
        Paste this link into your OTA extranet's <b>Import calendar</b> — a StayBid booking will then block those dates on that OTA too.
      </p>
      {loading ? (
        <div className="card-p text-center py-6 text-luxury-400 text-sm">Loading…</div>
      ) : icalExports.length === 0 ? (
        <div className="card-p text-center py-6 text-luxury-400 text-sm">First add a room category in the Rooms tab.</div>
      ) : (
        <div className="space-y-2 mb-4">
          {icalExports.map((x) => (
            <div key={x.roomId} className="card-p card-tight">
              <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">{x.name}</p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 min-w-0 truncate text-[0.66rem] bg-luxury-50 rounded-lg px-2 py-1.5 text-luxury-600">{x.url}</code>
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
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: bad ? "#ef4444" : l.status === "empty" ? "#a4b5c5" : "#22c55e" }} />
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
          <span className={`text-[0.66rem] font-bold px-2 py-0.5 rounded-full ${ready === checks.length ? "bg-emerald-100 text-emerald-700" : "bg-luxury-100 text-amber-700"}`}>
            {ready}/{checks.length} ready
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2">
              <span className="leading-none mt-0.5">{c.ok ? <CircleCheck size={14} strokeWidth={2.2} aria-hidden className="text-emerald-600" /> : <TriangleAlert size={14} strokeWidth={2.2} aria-hidden className="text-amber-600" />}</span>
              <div className="min-w-0">
                <p className="text-[0.74rem] font-semibold text-luxury-800 leading-tight">{c.label}</p>
                {!c.ok && c.hint && <p className="text-[0.63rem] text-amber-600 leading-tight">{c.hint}</p>}
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

// ── Room mapping + channel rates ───────────────────────────────────────────
// Map each StayBid room to an OTA room/rate-plan ref + a per-channel markup%.
// The channel price previews live: spine live_price × (1 + markup%). Mappings
// need a connection (auto-created when you add an iCal feed, or via Connect API).
function RoomMappingSection({
  hotelId, rooms, connections, onToast,
}: {
  hotelId: string; rooms: any[]; connections: any[]; onToast: (m: string) => void;
}) {
  const [selConn, setSelConn] = useState("");
  const [roomPrices, setRoomPrices] = useState<Record<string, { livePrice: number; source: string }>>({});
  const [mapByRoom, setMapByRoom] = useState<Record<string, any>>({});
  const [drafts, setDrafts] = useState<Record<string, { ref: string; markup: string }>>({});
  const [savingRoom, setSavingRoom] = useState("");
  const [loading, setLoading] = useState(false);

  // keep a valid selected connection
  useEffect(() => {
    if (connections.length === 0) { setSelConn(""); return; }
    setSelConn((prev) => (connections.some((c) => c.id === prev) ? prev : connections[0].id));
  }, [connections]);

  const loadPreview = useCallback(async () => {
    if (!hotelId || !selConn) { setRoomPrices({}); setMapByRoom({}); return; }
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await fetch(
        `/api/partner/channel-rate-preview?hotelId=${encodeURIComponent(hotelId)}&date=${today}`,
        { headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store" },
      );
      const d = await r.json().catch(() => ({}));
      setRoomPrices(d.roomPrices || {});
      const byRoom: Record<string, any> = {};
      (Array.isArray(d.previews) ? d.previews : [])
        .filter((p: any) => p.connectionId === selConn)
        .forEach((p: any) => { byRoom[p.roomId] = p; });
      setMapByRoom(byRoom);
      // seed drafts from existing mappings
      setDrafts(() => {
        const next: Record<string, { ref: string; markup: string }> = {};
        rooms.forEach((rm) => {
          const ex = byRoom[rm.id];
          next[rm.id] = { ref: ex?.otaRoomRef || "", markup: ex ? String(ex.markupPct ?? 0) : "0" };
        });
        return next;
      });
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId, selConn, rooms]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const setDraft = (roomId: string, k: "ref" | "markup", v: string) =>
    setDrafts((p) => ({ ...p, [roomId]: { ...(p[roomId] || { ref: "", markup: "0" }), [k]: v } }));

  async function saveRoom(roomId: string) {
    if (!selConn) return;
    const d = drafts[roomId] || { ref: "", markup: "0" };
    setSavingRoom(roomId);
    try {
      const r = await fetch("/api/partner/channel-mappings", {
        method: "POST",
        headers: { Authorization: `Bearer ${partnerToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId, connectionId: selConn, roomId,
          otaRoomRef: d.ref.trim(), markupPct: Number(d.markup) || 0,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Save failed");
      onToast("Room mapping saved ✓");
      loadPreview();
    } catch (e: any) { onToast(e?.message || "Save failed"); }
    finally { setSavingRoom(""); }
  }

  async function clearRoom(roomId: string) {
    const ex = mapByRoom[roomId];
    if (!ex) { setDraft(roomId, "ref", ""); setDraft(roomId, "markup", "0"); return; }
    setSavingRoom(roomId);
    try {
      await fetch(`/api/partner/channel-mappings?id=${encodeURIComponent(ex.id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${partnerToken()}` },
      });
      onToast("Mapping removed");
      loadPreview();
    } catch { onToast("Remove failed"); }
    finally { setSavingRoom(""); }
  }

  if (connections.length === 0) {
    return (
      <div className="mb-4">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-1">Room mapping &amp; channel rates</p>
        <div className="card-p card-tight text-[0.7rem] text-luxury-500">
          First connect an OTA channel — add your iCal feed below (the connection is created automatically) or add credentials via “API” above. After that you can map each room to its OTA room and set a channel-wise markup.
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[0.78rem] font-bold text-luxury-900">Room mapping &amp; channel rates</p>
        <select
          value={selConn} onChange={(e) => setSelConn(e.target.value)}
          className="text-[0.7rem] rounded-lg border border-luxury-200 bg-white px-2 py-1 text-luxury-700 max-w-[55%] truncate">
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {(OTA_META[c.ota]?.label || c.ota)}{c.label ? ` · ${c.label}` : ""}{c.mode === "ical" ? " (iCal)" : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[0.66rem] text-luxury-500 mb-2.5">
        Set each room's OTA room ID + markup%. Channel rate = StayBid live price × (1 + markup%). The preview updates live.
      </p>
      <div className="card-p card-tight">
        {rooms.length === 0 ? (
          <p className="text-[0.7rem] text-luxury-400 text-center py-3">First add a room category in the Rooms tab.</p>
        ) : loading ? (
          <p className="text-[0.7rem] text-luxury-400 text-center py-3">Loading rates…</p>
        ) : (
          <div className="space-y-2">
            {rooms.map((rm) => {
              const d = drafts[rm.id] || { ref: "", markup: "0" };
              const live = roomPrices[rm.id]?.livePrice || 0;
              const markupN = Number(d.markup) || 0;
              const channel = live > 0 ? Math.round(live * (1 + markupN / 100)) : 0;
              const mapped = Boolean(mapByRoom[rm.id]);
              const dirty = mapped
                ? (d.ref !== (mapByRoom[rm.id]?.otaRoomRef || "") || markupN !== Number(mapByRoom[rm.id]?.markupPct || 0))
                : (d.ref.trim() !== "" || markupN !== 0);
              return (
                <div key={rm.id} className="rounded-xl border border-luxury-100 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[0.76rem] font-bold text-luxury-900 truncate">
                      {rm.name || rm.type || rm.id}
                      {mapped && <span className="ml-1.5 text-[0.63rem] font-semibold text-emerald-600 inline-flex items-center gap-0.5"><Check size={10} strokeWidth={2.6} aria-hidden /> mapped</span>}
                    </p>
                    <p className="text-[0.66rem] text-luxury-500 shrink-0">
                      StayBid <b className="text-luxury-800">{live > 0 ? `₹${live.toLocaleString("en-IN")}` : "—"}</b>
                      <span className="mx-1 text-luxury-300">→</span>
                      OTA <b style={{ color: "#0f766e" }}>{channel > 0 ? `₹${channel.toLocaleString("en-IN")}` : "—"}</b>
                    </p>
                  </div>
                  <div className="flex items-end gap-1.5">
                    <div className="flex-1 min-w-0">
                      <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-0.5">OTA room ID</label>
                      <input
                        value={d.ref} onChange={(e) => setDraft(rm.id, "ref", e.target.value)}
                        placeholder="OTA room / listing ref"
                        className="w-full text-[0.72rem] rounded-lg border border-luxury-200 bg-white px-2 py-1.5 text-luxury-700" />
                    </div>
                    <div className="w-20 shrink-0">
                      <label className="text-[0.63rem] font-bold text-luxury-400 uppercase tracking-widest block mb-0.5">Markup %</label>
                      <input
                        value={d.markup} onChange={(e) => setDraft(rm.id, "markup", e.target.value)}
                        type="number" step="0.5" inputMode="decimal"
                        className="w-full text-[0.72rem] rounded-lg border border-luxury-200 bg-white px-2 py-1.5 text-luxury-700 text-center" />
                    </div>
                    <button
                      onClick={() => saveRoom(rm.id)} disabled={savingRoom === rm.id || !dirty}
                      className="btn-gold px-2.5! py-1.5! text-[0.68rem] shrink-0 disabled:opacity-40">
                      {savingRoom === rm.id ? "…" : "Save"}
                    </button>
                    {mapped && (
                      <button
                        onClick={() => clearRoom(rm.id)} disabled={savingRoom === rm.id} aria-label="Remove mapping"
                        className="btn-ghost px-2! py-1.5! text-[0.68rem] text-red-600! shrink-0 inline-flex items-center" title="Remove mapping"><Trash2 size={12} strokeWidth={2.2} aria-hidden /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div>
      <p className={`text-lg font-bold leading-none ${cls}`}>{n}</p>
      <p className="text-[0.63rem] font-semibold text-luxury-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function Instructions({ ota }: { ota: string }) {
  const info = OTA_INSTRUCTIONS[ota] || OTA_INSTRUCTIONS.other;
  return (
    <div className="mt-2.5 pt-2.5 border-t border-luxury-100 grid sm:grid-cols-2 gap-2.5">
      <div>
        <p className="text-[0.63rem] font-bold text-luxury-400 uppercase mb-1 inline-flex items-center gap-1">Import their bookings <ArrowDown size={10} strokeWidth={2.6} aria-hidden /></p>
        <ol className="list-decimal list-inside space-y-0.5">
          {info.export.map((s, i) => <li key={i} className="text-[0.66rem] text-luxury-600 leading-snug">{s}</li>)}
        </ol>
      </div>
      <div>
        <p className="text-[0.63rem] font-bold text-luxury-400 uppercase mb-1 inline-flex items-center gap-1">Send them StayBid dates <ArrowUp size={10} strokeWidth={2.6} aria-hidden /></p>
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
  const lbl = "text-[0.66rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  async function save() {
    if (!f.propertyId.trim() && !f.apiKey.trim() && !f.endpointUrl.trim()) {
      setErr("Enter at least a Property ID, API key or URL."); return;
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
          <p className="font-display text-lg text-luxury-900 inline-flex items-center gap-1.5" style={{ fontWeight: 500 }}><span aria-hidden>{m.icon}</span> Connect {m.label} (API)</p>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 flex items-center justify-center"><X size={16} strokeWidth={2.2} aria-hidden /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div className="rounded-xl p-2.5 bg-purple-50">
            <p className="text-[0.66rem] text-purple-800 inline-flex items-start gap-1.5">
              <Lightbulb size={13} strokeWidth={2.2} aria-hidden className="mt-0.5 shrink-0" /> <span>Simplest option: use an iCal feed (in the list below) — no API key needed, works instantly. You only need API credentials once this OTA's certified live connector is active.</span>
            </p>
          </div>
          <div className="rounded-xl p-2.5 bg-luxury-50">
            <p className="text-[0.66rem] text-luxury-600 inline-flex items-start gap-1.5"><MapPin size={12} strokeWidth={2.2} aria-hidden className="mt-0.5 shrink-0" /> <span>Where to find these details: <b>{m.hint}</b></span></p>
          </div>
          <div><label className={lbl}>Property / Hotel ID</label>
            <input value={f.propertyId} onChange={(e) => set("propertyId", e.target.value)} placeholder="Your property's ID on the OTA" className="inp-p" autoFocus /></div>
          <div><label className={lbl}>API Key</label>
            <input value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder="API key / username" className="inp-p" /></div>
          <div><label className={lbl}>API Secret / Password</label>
            <input value={f.apiSecret} onChange={(e) => set("apiSecret", e.target.value)} type="password" placeholder="API secret" className="inp-p" /></div>
          <div><label className={lbl}>Endpoint / Connection URL</label>
            <input value={f.endpointUrl} onChange={(e) => set("endpointUrl", e.target.value)} placeholder="https://… (OTA connectivity URL)" className="inp-p" /></div>
          <div><label className={lbl}>Label / note (optional)</label>
            <input value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. main property account" className="inp-p" /></div>
          <p className="text-[0.66rem] text-luxury-400 leading-relaxed">
            Credentials are saved securely. As soon as this OTA's live connector is activated, these same details are used — you won't have to do anything again.
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
