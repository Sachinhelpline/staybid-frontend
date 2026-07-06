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
  host_rating?: number | null;
  host_reviews?: number | null;
};

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export default function CircleUnitsTab({
  hotelId,
  categories,
  initialUnits,
}: {
  hotelId: string;
  categories: any[];
  initialUnits?: Unit[];
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
        <div className="text-4xl mb-2">🏠</div>
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
          className="text-xs font-semibold text-gold-600 hover:text-gold-700 px-2 py-1"
        >↻ Refresh</button>
      </div>

      {units.map((u) => (
        <UnitCard key={u.id} unit={u} cat={catById[String(u.roomId)]} onSave={saveUnit} />
      ))}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-luxury-900 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function UnitCard({
  unit,
  cat,
  onSave,
}: {
  unit: Unit;
  cat: any;
  onSave: (unitId: string, patch: Record<string, any>) => Promise<boolean>;
}) {
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
          <div className="w-16 h-16 rounded-xl bg-luxury-100 flex items-center justify-center text-2xl shrink-0">🛏️</div>
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
        >{listed ? "● Live" : "○ Hidden"}</button>
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
