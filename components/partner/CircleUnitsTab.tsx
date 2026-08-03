"use client";

// Phase 3c — circle-operator per-unit management ("My Rooms").
//
// A circle investor owns specific physical rooms on a StayBid-operated hotel.
// Each is its own Airbnb-style customer listing (Phase 3b). This tab lets the
// operator manage that listing: nightly price, MRP, title, view label,
// amenities, photos, and whether it's live at all. Every field falls back to
// the room CATEGORY default when left blank — so a new unit already sells at
// the category price until the owner personalises it.
//
// Reads/writes /api/partner/circle-units (owner-scoped server-side). Only
// surfaces when hotel.isOperator (mounted from the dashboard).

import { useEffect, useMemo, useState } from "react";
import { Home, RotateCw, BedDouble, CircleDot, Circle, Bot } from "lucide-react";
import { AUTOPILOT_MODE_LABEL, AUTOPILOT_MODE_DESC, type AutopilotMode } from "@/lib/autopilot";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}

type Unit = {
  id: string;
  hotelId: string;
  roomId: string;
  roomNumber?: string | null;
  floor?: string | null;
  title?: string | null;
  price_override?: number | null;
  mrp_override?: number | null;
  amenities?: any[] | null;
  photos?: any[] | null;
  view_label?: string | null;
  is_listed?: boolean | null;
  // Phase A — per-unit autopilot. null = inherit the hotel-level mode.
  autopilot_mode?: AutopilotMode | null;
  host_rating?: number | null;
  host_reviews?: number | null;
};

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export default function CircleUnitsTab({
  hotelId,
  categories,
  initialUnits,
  hotelAutopilotMode = "auto",
}: {
  hotelId: string;
  categories: any[];
  initialUnits?: Unit[];
  /** The hotel-level autopilot mode a room INHERITS when it has no override. */
  hotelAutopilotMode?: AutopilotMode;
}) {
  const [units, setUnits] = useState<Unit[]>(initialUnits || []);
  const [loading, setLoading] = useState(!initialUnits?.length);
  const [toast, setToast] = useState<string>("");

  const catById = useMemo(() => {
    const m: Record<string, any> = {};
    (categories || []).forEach((c) => { if (c?.id) m[String(c.id)] = c; });
    return m;
  }, [categories]);

  async function load() {
    const token = getToken();
    if (!token || !hotelId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/partner/circle-units?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d.units)) setUnits(d.units);
    } catch { /* keep initial */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [hotelId]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  async function saveUnit(unitId: string, patch: Record<string, any>) {
    const token = getToken();
    const r = await fetch("/api/partner/circle-units", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ hotelId, unitId, ...patch }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { flash(d?.error || "Save failed"); return false; }
    if (d.unit) setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, ...d.unit } : u)));
    flash("Saved ✓");
    return true;
  }

  if (loading) {
    return <div className="text-sm text-luxury-500 py-8 text-center">Loading your rooms…</div>;
  }

  if (!units.length) {
    return (
      <div className="card-luxury p-6 text-center">
        <Home className="mx-auto mb-2 text-luxury-300" size={34} strokeWidth={1.8} aria-hidden />
        <div className="font-bold text-luxury-800 mb-1">No rooms yet</div>
        <p className="text-sm text-luxury-500">
          Rooms appear here once your StayCircle investment is active and StayBid has
          provisioned your physical units.
        </p>
      </div>
    );
  }

  const listedCount = units.filter((u) => u.is_listed !== false).length;

  return (
    <div className="space-y-4">
      <div className="card-luxury p-4 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-lg font-bold text-luxury-900">My Rooms</div>
          <p className="text-xs text-luxury-500 mt-0.5">
            {units.length} room{units.length === 1 ? "" : "s"} · {listedCount} live · each is its own
            customer listing. Blank fields fall back to the room category default.
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs font-semibold text-gold-600 hover:text-gold-700 px-2 py-1 inline-flex items-center gap-1.5"
        ><RotateCw size={13} strokeWidth={2.3} aria-hidden />Refresh</button>
      </div>

      {units.map((u) => (
        <UnitCard
          key={u.id}
          unit={u}
          cat={catById[String(u.roomId)]}
          hotelAutopilotMode={hotelAutopilotMode}
          onSave={saveUnit}
        />
      ))}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-luxury-900 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

type UnitAutopilot = "inherit" | AutopilotMode;

function UnitCard({
  unit,
  cat,
  hotelAutopilotMode,
  onSave,
}: {
  unit: Unit;
  cat: any;
  hotelAutopilotMode: AutopilotMode;
  onSave: (unitId: string, patch: Record<string, any>) => Promise<boolean>;
}) {
  const [aMode, setAMode] = useState<UnitAutopilot>(unit.autopilot_mode || "inherit");
  const [aSaving, setASaving] = useState(false);
  const [title, setTitle] = useState(unit.title || "");
  const [price, setPrice] = useState(unit.price_override != null ? String(unit.price_override) : "");
  const [mrp, setMrp] = useState(unit.mrp_override != null ? String(unit.mrp_override) : "");
  const [viewLabel, setViewLabel] = useState(unit.view_label || "");
  const [amenities, setAmenities] = useState(
    Array.isArray(unit.amenities) ? unit.amenities.map(String).join(", ") : "",
  );
  const [photos, setPhotos] = useState(
    Array.isArray(unit.photos) ? unit.photos.map(String).join("\n") : "",
  );
  const [listed, setListed] = useState(unit.is_listed !== false);
  const [saving, setSaving] = useState(false);

  const baseFloor = cat?.floorPrice != null ? Number(cat.floorPrice) : null;
  const baseMrp = cat?.mrp != null ? Number(cat.mrp) : null;
  const catName = cat?.name || cat?.type || "Room";

  async function submit() {
    setSaving(true);
    const patch: Record<string, any> = {
      title: title.trim() || null,
      price_override: price.trim() === "" ? null : Number(price),
      mrp_override: mrp.trim() === "" ? null : Number(mrp),
      view_label: viewLabel.trim() || null,
      amenities: amenities.split(",").map((s) => s.trim()).filter(Boolean),
      photos: photos.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      is_listed: listed,
    };
    await onSave(unit.id, patch);
    setSaving(false);
  }

  async function toggleListed() {
    const next = !listed;
    setListed(next);
    await onSave(unit.id, { is_listed: next });
  }

  // Phase A — per-unit autopilot. "inherit" clears the override (null) → the
  // room follows the hotel-level mode. Saves immediately on change.
  async function changeMode(next: UnitAutopilot) {
    if (next === aMode) return;
    const prev = aMode;
    setAMode(next);
    setASaving(true);
    const ok = await onSave(unit.id, { autopilot_mode: next === "inherit" ? null : next });
    if (!ok) setAMode(prev); // revert on failure
    setASaving(false);
  }

  // The mode that actually governs this room's auto-accept right now.
  const effectiveMode: AutopilotMode = aMode === "inherit" ? hotelAutopilotMode : aMode;
  const A_OPTIONS: { key: UnitAutopilot; label: string }[] = [
    { key: "inherit", label: "Hotel default" },
    { key: "auto",    label: "Auto" },
    { key: "hybrid",  label: "Hybrid" },
    { key: "manual",  label: "Manual" },
  ];

  const effPrice = price.trim() !== "" ? Number(price) : baseFloor;
  const firstPhoto = photos.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";

  return (
    <div className="card-luxury p-4">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-3">
        {firstPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstPhoto}
            alt={title || catName}
            className="w-16 h-16 rounded-xl object-cover shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-luxury-100 flex items-center justify-center shrink-0"><BedDouble className="text-luxury-400" size={22} strokeWidth={1.9} aria-hidden /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-bold text-luxury-900 truncate">{title || catName}</div>
          <div className="text-xs text-luxury-500 mt-0.5 flex flex-wrap gap-x-2">
            <span>{catName}</span>
            {unit.roomNumber && <span>· Room {unit.roomNumber}</span>}
            {unit.floor && <span>· Floor {unit.floor}</span>}
            {effPrice != null && <span>· {inr(effPrice)}/night</span>}
          </div>
        </div>
        {/* Listed toggle */}
        <button
          onClick={toggleListed}
          className={`shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg ${
            listed
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-luxury-100 text-luxury-500 border border-luxury-200"
          }`}
          title={listed ? "Live — tap to unlist" : "Hidden — tap to list"}
        ><span className="inline-flex items-center gap-1">{listed ? <CircleDot size={11} strokeWidth={2.5} aria-hidden /> : <Circle size={11} strokeWidth={2.3} aria-hidden />}{listed ? "Live" : "Hidden"}</span></button>
      </div>

      {/* Edit grid */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Listing title" hint={catName}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={catName}
            className="input-luxury w-full text-sm" />
        </Field>
        <Field label="View label" hint="e.g. Valley view">
          <input value={viewLabel} onChange={(e) => setViewLabel(e.target.value)} placeholder="Valley view"
            className="input-luxury w-full text-sm" />
        </Field>
        <Field label="Nightly price ₹" hint={baseFloor != null ? `Base ${inr(baseFloor)}` : "category default"}>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric"
            placeholder={baseFloor != null ? String(baseFloor) : "—"} className="input-luxury w-full text-sm" />
        </Field>
        <Field label="MRP ₹ (strike)" hint={baseMrp != null ? `Base ${inr(baseMrp)}` : "category default"}>
          <input value={mrp} onChange={(e) => setMrp(e.target.value)} inputMode="numeric"
            placeholder={baseMrp != null ? String(baseMrp) : "—"} className="input-luxury w-full text-sm" />
        </Field>
        <Field label="Amenities (comma-separated)" full hint="blank → category amenities">
          <input value={amenities} onChange={(e) => setAmenities(e.target.value)}
            placeholder="Balcony, Heater, Free breakfast" className="input-luxury w-full text-sm" />
        </Field>
        <Field label="Photo URLs (one per line)" full hint="blank → category photos">
          <textarea value={photos} onChange={(e) => setPhotos(e.target.value)} rows={2}
            placeholder="https://…/room-1.jpg&#10;https://…/room-2.jpg"
            className="input-luxury w-full text-sm resize-y" />
        </Field>
      </div>

      {/* Phase A — per-unit auto-confirm mode (StayCircle owner control) */}
      <div className="mt-3 pt-3 border-t border-luxury-100">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="text-[11px] font-semibold text-luxury-600 inline-flex items-center gap-1.5">
            <Bot size={13} strokeWidth={2.3} aria-hidden />Auto-confirm mode for this room
          </label>
          {aSaving && <span className="text-[10px] text-luxury-400">saving…</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {A_OPTIONS.map((o) => {
            const on = aMode === o.key;
            return (
              <button
                key={o.key}
                onClick={() => changeMode(o.key)}
                disabled={aSaving}
                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition disabled:opacity-60 ${
                  on
                    ? "bg-gold-500 text-white border-gold-500"
                    : "bg-white text-luxury-600 border-luxury-200 hover:border-gold-300"
                }`}
              >{o.label}</button>
            );
          })}
        </div>
        <p className="text-[11px] text-luxury-400 mt-1.5 leading-snug">
          {aMode === "inherit"
            ? `Following the hotel default (${AUTOPILOT_MODE_LABEL[hotelAutopilotMode]}). `
            : `Overriding just this room (${AUTOPILOT_MODE_LABEL[effectiveMode]}). `}
          {AUTOPILOT_MODE_DESC[effectiveMode]}
        </p>
      </div>

      <div className="flex justify-end mt-3">
        <button
          onClick={submit}
          disabled={saving}
          className="btn-luxury text-sm px-5 py-2 disabled:opacity-60"
        >{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-[11px] font-semibold text-luxury-600 mb-1">
        {label}
        {hint && <span className="font-normal text-luxury-400"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}
