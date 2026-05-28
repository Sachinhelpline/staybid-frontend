"use client";
//
// v170 — Room Category create / edit modal for the partner dashboard.
//
// One modal, two modes:
//   • "create" → POST /api/partner/rooms   (new room category)
//   • "edit"   → PATCH /api/partner/rooms  (full edit, not just price)
//
// A "room" = a category/type (Deluxe, Suite). Physical numbered rooms
// (101, 102) are managed separately as units in the Rooms tab.
//
import { useState } from "react";
import { ImageUpload } from "@/components/ImageUpload";
import { modalPortal } from "@/lib/partner/modal-portal";

const AMENITY_OPTIONS = [
  "Wi-Fi", "Air Conditioning", "TV", "Hot Water / Geyser", "Room Service",
  "Balcony", "Mountain View", "Mini Fridge", "Tea / Coffee Maker", "Work Desk",
  "Wardrobe", "Power Backup", "Bathtub", "Electric Kettle", "Room Heater",
  "Iron & Board", "Breakfast Included", "Parking",
];

type Mode = "create" | "edit";
type Props = {
  mode: Mode;
  room?: any;
  hotelId: string;
  token: string;
  onClose: () => void;
  onSaved: (room: any, mode: Mode) => void;
};

export default function RoomEditorModal({ mode, room, hotelId, token, onClose, onSaved }: Props) {
  const [f, setF] = useState({
    name:            room?.name ?? "",
    type:            room?.type ?? "",
    description:     room?.description ?? "",
    mrp:             room?.mrp != null ? String(room.mrp) : "",
    floorPrice:      room?.floorPrice != null ? String(room.floorPrice) : "",
    flashFloorPrice: room?.flashFloorPrice != null ? String(room.flashFloorPrice) : "",
    capacity:        room?.capacity != null ? String(room.capacity) : "2",
    bedrooms:        room?.bedrooms != null ? String(room.bedrooms) : "1",
    bathrooms:       room?.bathrooms != null ? String(room.bathrooms) : "1",
    quantity:        room?.quantity != null ? String(room.quantity) : "1",
    size_sqft:       room?.size_sqft != null ? String(room.size_sqft) : "",
  });
  const [amenities, setAmenities] = useState<string[]>(Array.isArray(room?.amenities) ? room.amenities : []);
  const [images, setImages]       = useState<string[]>(Array.isArray(room?.images) ? room.images : []);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState("");

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const toggleAmenity = (a: string) =>
    setAmenities((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  async function save() {
    if (!f.name.trim()) { setErr("Room category ka naam likhna zaroori hai."); return; }
    setSaving(true); setErr("");
    try {
      const payload: any = {
        hotelId,
        name: f.name.trim(),
        type: (f.type || f.name).trim(),
        description: f.description.trim(),
        mrp:             f.mrp ? Number(f.mrp) : undefined,
        floorPrice:      f.floorPrice ? Number(f.floorPrice) : undefined,
        flashFloorPrice: f.flashFloorPrice ? Number(f.flashFloorPrice) : undefined,
        capacity:  Number(f.capacity)  || 2,
        bedrooms:  Number(f.bedrooms)  || 1,
        bathrooms: Number(f.bathrooms) || 1,
        quantity:  Number(f.quantity)  || 1,
        size_sqft: f.size_sqft ? Number(f.size_sqft) : undefined,
        amenities,
        images,
      };
      if (mode === "edit") payload.id = room.id;
      const res = await fetch("/api/partner/rooms", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Save failed");
      onSaved(d.room || { ...room, ...payload }, mode);
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const numField = (label: string, key: keyof typeof f, opts?: { prefix?: string; placeholder?: string }) => (
    <div>
      <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">{label}</label>
      <div className="relative">
        {opts?.prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm">{opts.prefix}</span>
        )}
        <input
          type="number" inputMode="numeric"
          value={f[key]}
          onChange={(e) => set(key, e.target.value)}
          placeholder={opts?.placeholder || ""}
          className={`inp-p ${opts?.prefix ? "pl-7" : ""}`}
        />
      </div>
    </div>
  );

  return modalPortal(
    <div className="fixed inset-0 z-150 flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }}
      onClick={onClose}>
      <div
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }}
        onClick={(e) => e.stopPropagation()}>

        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <div>
            <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
              {mode === "create" ? "New Room Category" : "Edit Room Category"}
            </p>
            <p className="text-[0.66rem] text-luxury-400">
              {mode === "create" ? "Naye type ka kamra add karo (Deluxe, Suite…)" : f.name}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center transition">
            ×
          </button>
        </div>

        {/* body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {/* Basics */}
          <div className="space-y-2.5">
            <div>
              <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Category name *</label>
              <input value={f.name} onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Deluxe Mountain View" className="inp-p" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Room type</label>
                <input value={f.type} onChange={(e) => set("type", e.target.value)}
                  placeholder="Deluxe / Suite / Cottage" className="inp-p" />
              </div>
              {numField("Size (sq.ft)", "size_sqft", { placeholder: "optional" })}
            </div>
            <div>
              <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Description</label>
              <textarea value={f.description} onChange={(e) => set("description", e.target.value)}
                rows={2} placeholder="Short description guests will see"
                className="inp-p resize-none" />
            </div>
          </div>

          {/* Pricing */}
          <div>
            <p className="text-[0.62rem] font-bold text-gold-600 uppercase tracking-widest mb-1.5">Pricing</p>
            <div className="grid grid-cols-3 gap-2.5">
              {numField("Rack rate (MRP)", "mrp", { prefix: "₹", placeholder: "4999" })}
              {numField("Bid floor", "floorPrice", { prefix: "₹", placeholder: "auto" })}
              {numField("Flash floor", "flashFloorPrice", { prefix: "₹", placeholder: "optional" })}
            </div>
            <p className="text-[0.6rem] text-luxury-400 mt-1">Bid floor khali chhodo to MRP ka ~78% auto set ho jayega.</p>
          </div>

          {/* Capacity */}
          <div>
            <p className="text-[0.62rem] font-bold text-gold-600 uppercase tracking-widest mb-1.5">Capacity &amp; inventory</p>
            <div className="grid grid-cols-4 gap-2.5">
              {numField("Max guests", "capacity")}
              {numField("Bedrooms", "bedrooms")}
              {numField("Bathrooms", "bathrooms")}
              {numField("No. of rooms", "quantity")}
            </div>
          </div>

          {/* Amenities */}
          <div>
            <p className="text-[0.62rem] font-bold text-gold-600 uppercase tracking-widest mb-1.5">Amenities</p>
            <div className="flex flex-wrap gap-1.5">
              {AMENITY_OPTIONS.map((a) => {
                const on = amenities.includes(a);
                return (
                  <button key={a} type="button" onClick={() => toggleAmenity(a)}
                    className={`text-[0.68rem] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                      on ? "bg-gold-500 text-white border-gold-500"
                         : "bg-white text-luxury-500 border-luxury-200 hover:border-gold-300"
                    }`}>
                    {on ? "✓ " : ""}{a}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Photos */}
          <div>
            <p className="text-[0.62rem] font-bold text-gold-600 uppercase tracking-widest mb-1.5">Photos</p>
            {images.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                {images.map((url, i) => (
                  <div key={i} className="relative rounded-lg overflow-hidden aspect-square border border-luxury-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setImages((p) => p.filter((_, x) => x !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none">×</button>
                  </div>
                ))}
              </div>
            )}
            <ImageUpload folder="rooms" onUpload={(url) => setImages((p) => [...p, url])} />
          </div>

          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
          )}
        </div>

        {/* footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">
            {saving ? "Saving…" : mode === "create" ? "Create Room Category" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
