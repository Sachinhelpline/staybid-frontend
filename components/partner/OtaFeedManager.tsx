"use client";
//
// v316 — Channel Manager Phase 2: shared OTA iCal feed manager.
//
// Self-contained: loads / adds / syncs / pauses / resumes / renames / deletes
// its own feeds through the hardened v315 API. Mounted BOTH in the free
// Availability tab (zero-regression home for OTA sync) AND inside the premium
// Channel Manager console — one component, one source of truth, no drift.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { Key, RotateCw, Play, Pause, Trash2, BedDouble } from "lucide-react";

export function partnerToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

export const OTA_PROVIDERS = [
  { id: "booking",     label: "Booking.com",  icon: "🅱️" },
  { id: "airbnb",      label: "Airbnb",       icon: "🏠" },
  { id: "mmt",         label: "MakeMyTrip",   icon: "✈️" },
  { id: "goibibo",     label: "Goibibo",      icon: "🧳" },
  { id: "agoda",       label: "Agoda",        icon: "🏨" },
  { id: "expedia",     label: "Expedia",      icon: "🌐" },
  { id: "vrbo",        label: "Vrbo",         icon: "🏡" },
  { id: "tripadvisor", label: "TripAdvisor",  icon: "🦉" },
  { id: "hostelworld", label: "Hostelworld",  icon: "🎒" },
  { id: "other",       label: "Other OTA",    icon: "🔗" },
];
const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  OTA_PROVIDERS.map((p) => [p.id, p.label])
);

function fmtWhen(iso: any): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return String(iso); }
}

export interface FeedRow {
  id: string;
  roomId: string;
  unitId?: string | null;   // v326 — per-unit feed (NULL = hotel-level)
  provider: string;
  icalUrl: string;
  label?: string;
  active?: boolean;
  autoSync?: boolean;
  syncIntervalMin?: number;
  consecutiveFailures?: number;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncError?: string;
  lastEventCount?: number;
  lastImportedCount?: number;
  lastRemovedCount?: number;
}

// v326 — a physical unit the caller can attach a feed to.
interface UnitOpt { id: string; roomId: string; roomNumber?: string }

export default function OtaFeedManager({
  hotelId,
  rooms,
  onChanged,
  compact = false,
}: {
  hotelId: string;
  rooms: any[];
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [feeds, setFeeds] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>(""); // feedId being acted on
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [unitScoped, setUnitScoped] = useState(false); // v326
  const [units, setUnits] = useState<UnitOpt[]>([]);    // v326 — attachable units
  const [nf, setNf] = useState({ roomId: "", unitId: "", provider: "booking", icalUrl: "", label: "" });

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/ota-feeds?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${partnerToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setFeeds(Array.isArray(d.feeds) ? d.feeds : []);
      setUnitScoped(!!d.unitScoped);
      setUnits(Array.isArray(d.units) ? d.units : []);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  async function addFeed() {
    const picked = unitScoped ? nf.unitId : nf.roomId;
    if (!picked || !nf.icalUrl.trim()) { showToast("Room aur iCal URL dono chahiye"); return; }
    setSaving(true);
    try {
      // v326 — a unit-scoped investor sends unitId (server derives roomId);
      // a full-hotel owner sends roomId (hotel-level feed, unitId stays NULL).
      const payload: Record<string, any> = {
        hotelId, provider: nf.provider, icalUrl: nf.icalUrl.trim(), label: nf.label,
        ...(unitScoped ? { unitId: nf.unitId } : { roomId: nf.roomId }),
      };
      const r = await fetch("/api/partner/ota-feeds", {
        method: "POST",
        headers: { Authorization: `Bearer ${partnerToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Add failed");
      const fs = d.firstSync;
      if (fs?.ok) showToast(`✓ Added · ${fs.imported} blocked, ${fs.removed} released of ${fs.totalEvents}`);
      else if (fs?.error) showToast(`Added, but first sync failed: ${fs.error}`);
      else showToast("✓ Feed added");
      setNf({ roomId: "", unitId: "", provider: "booking", icalUrl: "", label: "" });
      await load();
      onChanged?.();
    } catch (e: any) { showToast("❌ " + (e?.message || "Add failed")); }
    finally { setSaving(false); }
  }

  async function syncNow(id: string) {
    setBusy(id);
    try {
      const r = await fetch("/api/partner/ota-feeds/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${partnerToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ feedId: id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Sync failed");
      showToast(`✓ ${d.imported} new · ${d.removed} released · ${d.skipped} unchanged`);
      await load();
      onChanged?.();
    } catch (e: any) { showToast("❌ " + (e?.message || "Sync failed")); await load(); }
    finally { setBusy(""); }
  }

  async function patchFeed(id: string, patch: Record<string, any>) {
    setBusy(id);
    try {
      const r = await fetch("/api/partner/ota-feeds", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${partnerToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Update failed");
      await load();
      onChanged?.();
    } catch (e: any) { showToast("❌ " + (e?.message || "Update failed")); }
    finally { setBusy(""); }
  }

  async function removeFeed(id: string) {
    if (!confirm("Delete this feed and every date it imported?")) return;
    setBusy(id);
    try {
      await fetch(`/api/partner/ota-feeds?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${partnerToken()}` },
      });
      await load();
      onChanged?.();
    } catch { await load(); }
    finally { setBusy(""); }
  }

  const roomName = (rid: string) => {
    const r = rooms.find((x) => x.id === rid);
    return r?.type || r?.name || rid;
  };

  // v326 — human label for a physical unit (for the picker + feed chip).
  const unitLabel = (u: UnitOpt) => {
    const rn = roomName(u.roomId);
    return u.roomNumber ? `${rn} · #${u.roomNumber}` : rn;
  };
  const unitChip = (uid?: string | null) => {
    if (!uid) return null;
    const u = units.find((x) => x.id === uid);
    return u?.roomNumber ? `#${u.roomNumber}` : "Unit";
  };

  return (
    <div>
      {/* existing feeds */}
      <div className="space-y-2 mb-3.5">
        {loading ? (
          <div className="text-sm text-luxury-400 italic py-2">Loading feeds…</div>
        ) : feeds.length === 0 ? (
          <div className="text-sm text-luxury-400 italic py-2">No import feeds yet — add one below.</div>
        ) : feeds.map((f) => {
          const paused = f.autoSync === false;
          const errored = f.lastSyncStatus === "error";
          const acting = busy === f.id;
          const dot = paused ? "#a1a1aa" : errored ? "#ef4444" : f.lastSyncAt ? "#22c55e" : "#a4b5c5";
          return (
            <div key={f.id} className="p-3 rounded-xl bg-luxury-50 border border-luxury-200">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[0.65rem] font-bold" style={{ color: dot }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
                      {paused ? "PAUSED" : errored ? "ERROR" : f.lastSyncAt ? "SYNCED" : "PENDING"}
                    </span>
                    <span className="text-[0.62rem] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-sm uppercase">
                      {PROVIDER_LABEL[f.provider] || f.provider}
                    </span>
                    {f.unitId && (
                      <span className="text-[0.62rem] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-sm inline-flex items-center gap-1">
                        <Key size={10} strokeWidth={2.4} aria-hidden /> {unitChip(f.unitId)}
                      </span>
                    )}
                    <span className="font-semibold text-luxury-800 text-sm truncate">{f.label || roomName(f.roomId)}</span>
                    <span className="text-xs text-luxury-400">· {roomName(f.roomId)}</span>
                  </div>
                  <div className="text-xs text-luxury-500 truncate mt-1" style={{ maxWidth: 460 }}>{f.icalUrl}</div>
                  <div className="text-[0.65rem] text-luxury-400 mt-0.5">
                    {f.lastSyncAt
                      ? `Last sync ${fmtWhen(f.lastSyncAt)} · ${f.lastEventCount ?? 0} events${(f.lastImportedCount || f.lastRemovedCount) ? ` · +${f.lastImportedCount ?? 0}/−${f.lastRemovedCount ?? 0}` : ""}`
                      : "Never synced"}
                    {typeof f.syncIntervalMin === "number" && !paused && <span> · auto every {f.syncIntervalMin}m</span>}
                  </div>
                  {f.lastSyncError && (
                    <div className="text-[0.65rem] text-red-500 mt-0.5 leading-snug" style={{ maxWidth: 460 }}>{f.lastSyncError}</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => syncNow(f.id)} disabled={acting} className="btn-gold text-xs px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1">
                    {acting ? "…" : <><RotateCw size={12} strokeWidth={2.4} aria-hidden /> Sync</>}
                  </button>
                  <button onClick={() => patchFeed(f.id, { autoSync: paused })} disabled={acting} aria-label={paused ? "Resume auto-sync" : "Pause auto-sync"}
                    className="btn-ghost text-xs px-2.5! py-1.5! disabled:opacity-50 inline-flex items-center" title={paused ? "Resume auto-sync" : "Pause auto-sync"}>
                    {paused ? <Play size={12} strokeWidth={2.4} aria-hidden /> : <Pause size={12} strokeWidth={2.4} aria-hidden />}
                  </button>
                  <button onClick={() => removeFeed(f.id)} disabled={acting} aria-label="Remove feed"
                    className="text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-sm disabled:opacity-50 inline-flex items-center"><Trash2 size={14} strokeWidth={2.2} aria-hidden /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* add new feed */}
      <div className="pt-3.5 border-t border-luxury-100 space-y-3">
        {unitScoped ? (
          // v326 — StayBid Circle investor: pick which OWN physical unit this
          // OTA feed is for. Server derives the roomId from the unit.
          <div>
            <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-2">
              Your room {nf.unitId && <span className="text-luxury-600 normal-case">· {unitLabel(units.find((u) => u.id === nf.unitId)!)}</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {units.length === 0 ? (
                <div className="text-xs text-luxury-400 italic">No rooms you own yet on this property.</div>
              ) : units.map((u) => {
                const active = nf.unitId === u.id;
                return (
                  <button key={u.id} type="button" onClick={() => setNf((p) => ({ ...p, unitId: u.id }))}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                      active ? "bg-linear-to-br from-amber-100 to-amber-200 border-amber-400 shadow-xs"
                             : "bg-luxury-50 border-luxury-200 hover:border-amber-300 hover:bg-amber-50"}`}
                    aria-pressed={active}>
                    <Key size={15} strokeWidth={2.2} aria-hidden className={active ? "text-amber-700" : "text-luxury-500"} />
                    <span className="flex flex-col items-start leading-tight">
                      <span className={`text-xs font-bold ${active ? "text-amber-900" : "text-luxury-800"}`}>{roomName(u.roomId)}</span>
                      {u.roomNumber && <span className="text-[0.6rem] text-luxury-500">Unit #{u.roomNumber}</span>}
                    </span>
                    {active && <span className="ml-1 text-amber-700 text-xs font-bold">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-2">
              Room {nf.roomId && <span className="text-luxury-600 normal-case">· {roomName(nf.roomId)}</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {rooms.length === 0 ? (
                <div className="text-xs text-luxury-400 italic">No rooms — add them in the Rooms tab first.</div>
              ) : rooms.map((r) => {
                const active = nf.roomId === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => setNf((p) => ({ ...p, roomId: r.id }))}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                      active ? "bg-linear-to-br from-amber-100 to-amber-200 border-amber-400 shadow-xs"
                             : "bg-luxury-50 border-luxury-200 hover:border-amber-300 hover:bg-amber-50"}`}
                    aria-pressed={active}>
                    <BedDouble size={15} strokeWidth={2.2} aria-hidden className={active ? "text-amber-700" : "text-luxury-500"} />
                    <span className="flex flex-col items-start leading-tight">
                      <span className={`text-xs font-bold ${active ? "text-amber-900" : "text-luxury-800"}`}>{r.type || r.name || "Room"}</span>
                      {r.capacity != null && <span className="text-[0.6rem] text-luxury-500">cap {r.capacity}</span>}
                    </span>
                    {active && <span className="ml-1 text-amber-700 text-xs font-bold">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-2">Channel</label>
          <div className="flex flex-wrap gap-2">
            {(compact ? OTA_PROVIDERS.slice(0, 6) : OTA_PROVIDERS).map((p) => {
              const active = nf.provider === p.id;
              return (
                <button key={p.id} type="button" onClick={() => setNf((prev) => ({ ...prev, provider: p.id }))}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border transition-all ${
                    active ? "bg-luxury-900 text-amber-100 border-luxury-900 shadow-xs"
                           : "bg-luxury-50 text-luxury-700 border-luxury-200 hover:border-luxury-400"}`}
                  aria-pressed={active}>
                  <span>{p.icon}</span><span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-3">
            <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">
              iCal URL from the OTA extranet
            </label>
            <input className="inp-p" placeholder="https://…/calendar.ics" value={nf.icalUrl}
              onChange={(e) => setNf((p) => ({ ...p, icalUrl: e.target.value }))} />
          </div>
          <button onClick={addFeed} disabled={saving || !(unitScoped ? nf.unitId : nf.roomId) || !nf.icalUrl.trim()}
            className="btn-gold text-xs py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Adding…" : "+ Add & Sync"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-luxury-900 text-amber-100 text-xs font-semibold shadow-lg z-50"
          style={{ bottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/** Rollup health used by the Channels console + availability shortcut. */
export function feedHealth(feeds: FeedRow[]): { ok: number; error: number; paused: number; total: number } {
  let ok = 0, error = 0, paused = 0;
  for (const f of feeds) {
    if (f.autoSync === false) paused++;
    else if (f.lastSyncStatus === "error") error++;
    else if (f.lastSyncAt) ok++;
  }
  return { ok, error, paused, total: feeds.length };
}

export const OTA_INSTRUCTIONS: Record<string, { label: string; icon: string; import: string[]; export: string[] }> = {
  booking: {
    label: "Booking.com", icon: "🅱️",
    import: ["Extranet → Rates & Availability → Calendar → Sync calendars", "Choose 'Import calendar', paste your StayBid room iCal link", "Booking.com will block those dates on its side within a few hours"],
    export: ["Extranet → Rates & Availability → Calendar → Sync calendars", "Click 'Export calendar' and copy the .ics URL", "Add it below as a Booking.com feed so StayBid blocks its bookings"],
  },
  airbnb: {
    label: "Airbnb", icon: "🏠",
    import: ["Listing → Availability → Connect calendars → Connect another website", "Paste your StayBid room iCal link, name it 'StayBid'", "Airbnb polls it roughly every 2 hours"],
    export: ["Listing → Availability → Connect calendars → Export calendar", "Copy the Airbnb .ics link", "Add it below as an Airbnb feed"],
  },
  mmt: {
    label: "MakeMyTrip / Ingommt", icon: "✈️",
    import: ["Ingommt extranet → Property → Calendar / Connectivity", "Add an external calendar and paste your StayBid iCal link"],
    export: ["Ingommt extranet → Calendar sync → Export", "Copy the .ics URL and add it below as an MMT feed"],
  },
  goibibo: {
    label: "Goibibo / Ingommt", icon: "🧳",
    import: ["Ingommt extranet → Property → Calendar / Connectivity", "Add an external calendar and paste your StayBid iCal link"],
    export: ["Ingommt extranet → Calendar sync → Export", "Copy the .ics URL and add it below as a Goibibo feed"],
  },
  agoda: {
    label: "Agoda (YCS / Homes)", icon: "🏨",
    import: ["Agoda YCS → Property → Connectivity → Calendar sync", "Import calendar, paste your StayBid iCal link"],
    export: ["Agoda YCS → Calendar sync → Export", "Copy the .ics URL and add it below as an Agoda feed"],
  },
  expedia: {
    label: "Expedia Partner Central", icon: "🌐",
    import: ["Expedia Partner Central → Reservations → Calendar sync", "Import the StayBid iCal link"],
    export: ["Expedia Partner Central → Calendar sync → Export", "Copy the .ics URL and add it below as an Expedia feed"],
  },
  vrbo: {
    label: "Vrbo", icon: "🏡",
    import: ["Vrbo → Calendar → Import & export → Import calendar", "Paste your StayBid iCal link"],
    export: ["Vrbo → Calendar → Import & export → Export calendar", "Copy the .ics URL and add it below as a Vrbo feed"],
  },
  tripadvisor: {
    label: "TripAdvisor Rentals", icon: "🦉",
    import: ["TripAdvisor rentals dashboard → Calendar → Import", "Paste your StayBid iCal link"],
    export: ["TripAdvisor rentals dashboard → Calendar → Export", "Copy the .ics URL and add it below"],
  },
  hostelworld: {
    label: "Hostelworld", icon: "🎒",
    import: ["Hostelworld inbox → Availability → Calendar sync", "Add the StayBid iCal link"],
    export: ["Hostelworld inbox → Availability → Export calendar", "Copy the .ics URL and add it below"],
  },
  other: {
    label: "Any other OTA", icon: "🔗",
    import: ["Open your OTA's calendar / connectivity settings", "Find 'Import calendar' and paste your StayBid room iCal link"],
    export: ["Find 'Export calendar' in the same settings", "Copy the .ics URL and add it below as an 'Other OTA' feed"],
  },
};
