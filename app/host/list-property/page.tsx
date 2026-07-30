"use client";

// ============================================================================
// v307 — List My Property for lease/rent (HOSPITALITY redesign, Phase 2).
//
// A property OWNER offers their hospitality property TO StayBid to be
// leased / rented / managed. Professional hotel-grade onboarding depth,
// driven off lib/catalog.ts (the same enums the /onboard hotel wizard uses):
//   • Hospitality property types (hotel / resort / villa / cottage / camp …)
//   • Per-category ROOM BUILDER — each category's unit count, price, capacity,
//     its own room-level amenities, and room photos.
//   • PROPERTY-level amenities (pool, restaurant, parking…) kept SEPARATE
//     from room-level amenities (AC, TV, geyser…).
//   • Meal plans, add-on services, check-in/out, house rules, star rating.
//   • Real Google/OSM location — resolves the pin from the property NAME.
//
// Submissions land in discovery_properties status='pending_review' and only
// appear in the public /host/properties feed after admin approval. Contact
// details are NEVER shown publicly — buyers reach the owner via StayBid.
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import HostLocationPicker, { HostLocationValue } from "@/components/host/HostLocationPicker";
import { resizeImageBeforeUpload } from "@/lib/image-resize";
import {
  PROPERTY_TYPES, ROOM_CATEGORIES, ROOM_CATEGORY_MAP, ROOM_CATEGORY_CAPACITY,
  MEAL_PLANS, ADDON_SERVICES, AMENITIES,
} from "@/lib/catalog";

interface Submission {
  id: string; title: string; city?: string; property_type?: string;
  rent_monthly?: number; status: string; created_at: string;
}

interface RoomDraft {
  id: string;
  category: string;    // catalog id
  customName: string;  // used when category === "custom"
  count: string;
  price: string;
  capacity: string;
  amenities: string[]; // room-level amenity ids
  images: string[];    // room photo urls
}

const STAR_OPTIONS = ["", "1", "2", "3", "4", "5"];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_review: { label: "Under review", color: "#8a6d1a", bg: "rgba(106, 133, 160,0.14)" },
  available: { label: "Live · listed", color: "#2f7a3f", bg: "rgba(47,122,63,0.14)" },
  shortlisted: { label: "Shortlisted", color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  rented: { label: "Rented", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
  rejected: { label: "Not accepted", color: "#b04242", bg: "rgba(176,66,66,0.12)" },
  inactive: { label: "Inactive", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
};

const inr = (n?: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const emptyLoc: HostLocationValue = { city: "", locality: "", state: "", formatted: "", lat: null, lng: null };
const rid = () => `r_${Math.random().toString(36).slice(2, 9)}`;
const newRoom = (): RoomDraft => ({
  id: rid(), category: "deluxe", customName: "", count: "1", price: "", capacity: "", amenities: [], images: [],
});

// Shared server-side upload (service-role route, resize-first, real errors).
async function uploadPhotosToServer(files: File[], remaining: number): Promise<{ urls: string[]; failed: string[] }> {
  const picked = files.slice(0, Math.max(0, remaining));
  const urls: string[] = [];
  const failed: string[] = [];
  for (const file of picked) {
    try {
      const resized = await resizeImageBeforeUpload(file).catch(() => file);
      const fd = new FormData();
      fd.append("file", resized, resized.name || file.name || "photo.jpg");
      const res = await fetch("/api/host/list-property/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) throw new Error(data?.error || `Upload failed (${res.status})`);
      urls.push(data.url as string);
    } catch (e: any) {
      failed.push(e?.message || "unknown error");
    }
  }
  return { urls, failed };
}

export default function ListPropertyPage() {
  const [f, setF] = useState({
    title: "", propertyType: "hotel", starRating: "", description: "",
    checkIn: "13:00", checkOut: "11:00", houseRules: "", landmarks: "",
    name: "", phone: "", email: "", message: "",
  });
  const [loc, setLoc] = useState<HostLocationValue>(emptyLoc);
  const [propAmen, setPropAmen] = useState<string[]>([]);
  const [mealPlans, setMealPlans] = useState<string[]>([]);
  const [addons, setAddons] = useState<string[]>([]);
  const [rooms, setRooms] = useState<RoomDraft[]>([newRoom()]);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<Submission[]>([]);

  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (arr: string[], setArr: (v: string[]) => void, id: string) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  // Room helpers
  const patchRoom = (id: string, patch: Partial<RoomDraft>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRoom = (id: string) => setRooms((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const addRoom = () => setRooms((rs) => (rs.length < 12 ? [...rs, newRoom()] : rs));

  const loadMine = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    if (!token) return;
    fetch("/api/host/list-property", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setMine(d.submissions || []))
      .catch(() => {});
  };
  useEffect(loadMine, [done]);

  async function addPhotos(files: FileList | null) {
    if (!files || !files.length) return;
    const remaining = Math.max(0, 12 - images.length);
    if (remaining <= 0) {
      setPhotoNote({ text: "You've reached the 12-photo limit. Remove one to add more.", kind: "err" });
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    setUploading(true);
    setPhotoNote({ text: `Uploading ${picked.length} photo${picked.length === 1 ? "" : "s"}…`, kind: "ok" });
    const { urls, failed } = await uploadPhotosToServer(picked, remaining);
    if (urls.length) setImages((s) => [...s, ...urls].slice(0, 12));
    if (failed.length && urls.length) {
      setPhotoNote({ text: `Added ${urls.length}. ${failed.length} failed — tap 📷 to retry.`, kind: "err" });
    } else if (failed.length) {
      setPhotoNote({ text: `Couldn't upload: ${failed[0]}. Tap 📷 to retry.`, kind: "err" });
    } else {
      setPhotoNote({ text: `✓ ${urls.length} photo${urls.length === 1 ? "" : "s"} added.`, kind: "ok" });
    }
    setUploading(false);
  }

  async function submit() {
    setErr(null);
    if (!f.title.trim() || !loc.city.trim() || !f.name.trim() || f.phone.replace(/\D/g, "").length < 8) {
      setErr("Property name, a location, your name and a valid phone are required.");
      return;
    }
    const cleanRooms = rooms
      .map((r) => ({
        category: r.category,
        name: r.category === "custom" ? (r.customName.trim() || "Custom Room") : (ROOM_CATEGORY_MAP[r.category]?.label || "Room"),
        count: Math.max(1, Number(r.count) || 1),
        price: Number(r.price) > 0 ? Number(r.price) : null,
        capacity: Number(r.capacity) > 0 ? Number(r.capacity) : (ROOM_CATEGORY_CAPACITY[r.category] || 2),
        amenities: r.amenities,
        images: r.images,
      }));
    if (cleanRooms.length === 0) {
      setErr("Add at least one room category so guests know what you offer.");
      return;
    }
    setSubmitting(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const details = {
        description: f.description.trim() || undefined,
        starRating: Number(f.starRating) || undefined,
        checkIn: f.checkIn || undefined,
        checkOut: f.checkOut || undefined,
        houseRules: f.houseRules.trim() || undefined,
        landmarks: f.landmarks.trim() || undefined,
        mealPlans,
        addonServices: addons,
      };
      const r = await fetch("/api/host/list-property", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          title: f.title,
          propertyType: f.propertyType,
          city: loc.city, locality: loc.locality, state: loc.state,
          lat: loc.lat, lng: loc.lng, formattedAddress: loc.formatted,
          amenities: propAmen,          // property-level amenities
          rooms: cleanRooms,            // per-category room builder
          images,                       // property photos
          details,
          name: f.name, phone: f.phone, email: f.email, message: f.message,
        }),
      });
      const dj = await r.json();
      if (!r.ok || !dj.ok) { setErr(dj.error || "Could not submit. Try again."); return; }
      setDone(dj.id);
      // Reset the listing fields (keep contact for a quick second listing).
      setF((s) => ({ ...s, title: "", description: "", starRating: "", houseRules: "", landmarks: "", message: "" }));
      setLoc(emptyLoc); setPropAmen([]); setMealPlans([]); setAddons([]); setRooms([newRoom()]); setImages([]);
      setPhotoNote(null);
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hostos-listprop min-h-screen" style={{ background: "var(--bg-page)" }}>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-4 sb-fade-in">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mt-3 mb-3"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🏡 List for lease / rent</span>
        <h1 className="font-display leading-tight" style={{ fontSize: "clamp(1.8rem,5vw,2.7rem)", color: "var(--text-base)" }}>
          List your property. <span style={{ color: "var(--accent)" }}>StayBid handles the rest.</span>
        </h1>
        <p className="mt-3" style={{ color: "var(--text-soft)" }}>
          Add your hotel, resort, villa or homestay once — real location, rooms, amenities & photos.
          Our team reviews it, lists it, and helps you lock the best deal. No brokerage.
        </p>
        <div className="mt-4 rounded-xl p-3 text-sm sb-card-lift"
          style={{ background: "var(--bg-card)", border: "1px dashed var(--border-soft)", color: "var(--text-soft)" }}>
          🏨 <strong style={{ color: "var(--text-base)" }}>Already run your own property?</strong> If you want to go live on
          StayBid + OTAs yourself, use <Link href="/onboard" style={{ color: "var(--accent)", fontWeight: 600 }}>Hotel Onboarding →</Link> instead.
        </div>
      </section>

      {done ? (
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-28">
          <div className="rounded-2xl p-8 text-center sb-fade-in"
            style={{ background: "var(--bg-card)", border: "1px solid var(--accent)" }}>
            <div className="text-5xl mb-3">✅</div>
            <h2 className="font-display text-2xl" style={{ color: "var(--text-base)" }}>Property submitted!</h2>
            <p className="mt-2" style={{ color: "var(--text-soft)" }}>
              Our team reviews your listing and reaches out on your phone. Meanwhile you can already
              add reels & photos to it below — they show up on the listing once it goes live.
            </p>
            <div className="mt-5 flex gap-3 justify-center flex-wrap">
              <Link href={`/host/property/${done}`} className="sb-card-lift px-5 py-2.5 rounded-full font-semibold text-white"
                style={{ background: "var(--accent)" }}>🎬 Add reels & photos →</Link>
              <button onClick={() => setDone(null)} className="sb-card-lift px-5 py-2.5 rounded-full font-semibold"
                style={{ background: "var(--bg-input)", color: "var(--text-base)", border: "1px solid var(--border-soft)" }}>List another</button>
              <Link href="/host/properties" className="sb-card-lift px-5 py-2.5 rounded-full font-semibold"
                style={{ background: "var(--bg-input)", color: "var(--text-base)", border: "1px solid var(--border-soft)" }}>
                Browse the feed →
              </Link>
            </div>
          </div>
          {mine.length > 0 && <MySubmissions rows={mine} />}
        </section>
      ) : (
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-28">
          <div className="rounded-2xl p-5 sm:p-7 sb-fade-in"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>

            {/* ── Property basics ─────────────────────────────────────── */}
            <Group label="Property basics">
              <Field label="Property name *" full>
                <Input value={f.title} onChange={set("title")} placeholder="e.g. The Mountain Grand, Mussoorie" />
              </Field>
            </Group>
            <SectionLabel>Property type</SectionLabel>
            <ChipGrid options={PROPERTY_TYPES} value={f.propertyType}
              onPick={(id) => setF((s) => ({ ...s, propertyType: id }))} />
            <div className="grid sm:grid-cols-2 gap-3 mt-3 mb-5">
              <Field label="Star rating (optional)">
                <select value={f.starRating} onChange={set("starRating")}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}>
                  {STAR_OPTIONS.map((o) => <option key={o} value={o}>{o ? `${o} ★` : "Not rated"}</option>)}
                </select>
              </Field>
              <Field label="Short description" full>
                <textarea value={f.description} onChange={set("description")} rows={2}
                  placeholder="A line or two about what makes your property special…"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
              </Field>
            </div>

            {/* ── Location (name-resolve) ─────────────────────────────── */}
            <Group label="Location">
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>
                  Search real location * — tip: type your property name and we'll find it on the map.
                </span>
                <HostLocationPicker value={loc} onChange={setLoc} nameHint={f.title} />
                {loc.city && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {loc.locality && <LocChip>📍 {loc.locality}</LocChip>}
                    <LocChip>🏙️ {loc.city}</LocChip>
                    {loc.state && <LocChip>{loc.state}</LocChip>}
                    {loc.pincode && <LocChip>{loc.pincode}</LocChip>}
                  </div>
                )}
              </div>
              <Field label="Nearby landmarks" full>
                <Input value={f.landmarks} onChange={set("landmarks")} placeholder="e.g. 500m from Mall Road, next to the lake" />
              </Field>
            </Group>

            {/* ── Rooms builder ───────────────────────────────────────── */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Rooms & categories
                </div>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{rooms.length} categor{rooms.length === 1 ? "y" : "ies"}</span>
              </div>
              <div className="space-y-3">
                {rooms.map((room, i) => (
                  <RoomCard key={room.id} room={room} index={i} canRemove={rooms.length > 1}
                    onChange={(patch) => patchRoom(room.id, patch)} onRemove={() => removeRoom(room.id)} />
                ))}
              </div>
              {rooms.length < 12 && (
                <button type="button" onClick={addRoom}
                  className="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold sb-card-lift"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px dashed var(--accent)" }}>
                  + Add another room category
                </button>
              )}
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                e.g. 8 Deluxe Rooms · 4 Cottages · 2 Suites — each with its own count, price & amenities.
              </p>
            </div>

            {/* ── Property amenities ──────────────────────────────────── */}
            <SectionLabel>Property amenities</SectionLabel>
            <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>Facilities the whole property offers (pool, restaurant, parking…).</p>
            <ChipMulti options={AMENITIES} selected={propAmen} onToggle={(id) => toggle(propAmen, setPropAmen, id)} />

            {/* ── Meal plans ──────────────────────────────────────────── */}
            <SectionLabel className="mt-5">Meal plans offered</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {MEAL_PLANS.map((m) => {
                const on = mealPlans.includes(m.id);
                return (
                  <button key={m.id} type="button" onClick={() => toggle(mealPlans, setMealPlans, m.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold sb-card-lift"
                    style={on
                      ? { background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)" }
                      : { background: "var(--bg-input)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
                    {m.label}{m.perGuestNight ? ` · ~₹${m.perGuestNight}/guest` : ""}
                  </button>
                );
              })}
            </div>

            {/* ── Add-on services ─────────────────────────────────────── */}
            <SectionLabel className="mt-5">Add-on services</SectionLabel>
            <ChipMulti options={ADDON_SERVICES} selected={addons} onToggle={(id) => toggle(addons, setAddons, id)} />

            {/* ── Policies ────────────────────────────────────────────── */}
            <Group label="Check-in / check-out & rules">
              <Field label="Check-in time">
                <input type="time" value={f.checkIn} onChange={set("checkIn")}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
              </Field>
              <Field label="Check-out time">
                <input type="time" value={f.checkOut} onChange={set("checkOut")}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
              </Field>
              <Field label="House rules / policies (optional)" full>
                <textarea value={f.houseRules} onChange={set("houseRules")} rows={2}
                  placeholder="e.g. No smoking indoors · ID required at check-in · pets on request"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
              </Field>
            </Group>

            {/* ── Property photos ─────────────────────────────────────── */}
            <div className="mb-5">
              <div className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--text-muted)" }}>Property photos</div>
              <div className="flex flex-wrap gap-2">
                {images.map((u, i) => (
                  <div key={u} className="relative w-20 h-20 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-soft)" }}>
                    <img src={u} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setImages((s) => s.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full text-xs flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>✕</button>
                  </div>
                ))}
                {images.length < 12 && (
                  <label className="w-20 h-20 rounded-lg flex flex-col items-center justify-center cursor-pointer text-xs"
                    style={{ border: "1px dashed var(--border-soft)", color: "var(--text-muted)" }}>
                    {uploading ? "…" : <>📷<span>Add</span></>}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                  </label>
                )}
              </div>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>Exterior, lobby, views & common areas. Up to 12. Room photos go on each room above.</p>
              {photoNote && (
                <p className="text-xs mt-1 font-medium" style={{ color: photoNote.kind === "err" ? "#b04242" : "var(--accent)" }}>
                  {photoNote.text}
                </p>
              )}
            </div>

            {/* ── Contact ─────────────────────────────────────────────── */}
            <Group label="Your contact (private)">
              <Field label="Your name *"><Input value={f.name} onChange={set("name")} placeholder="Full name" /></Field>
              <Field label="Phone *"><Input value={f.phone} onChange={set("phone")} placeholder="10-digit mobile" inputMode="tel" /></Field>
              <Field label="Email"><Input value={f.email} onChange={set("email")} type="email" placeholder="you@email.com" /></Field>
              <Field label="Anything else?" full>
                <textarea value={f.message} onChange={set("message")} rows={2}
                  placeholder="Availability, preferred lease term, special notes…"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
              </Field>
            </Group>
            <p className="text-xs -mt-2 mb-1" style={{ color: "var(--text-muted)" }}>
              🔒 Your contact stays private — it is never shown on the public listing. Interested guests reach you only through StayBid.
            </p>

            {err && <p className="mt-2 text-sm" style={{ color: "#b04242" }}>{err}</p>}

            <button onClick={submit} disabled={submitting}
              className="mt-5 w-full sb-card-lift px-6 py-3.5 rounded-full font-semibold text-white shadow"
              style={{ background: "var(--accent)", opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Submitting…" : "Submit property for review →"}
            </button>
            <p className="mt-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No brokerage. Our team reviews every listing before it goes live.
            </p>
          </div>

          {mine.length > 0 && <MySubmissions rows={mine} />}
        </section>
      )}
    </div>
  );
}

// ── Per-room editor card ──────────────────────────────────────────────────
function RoomCard({
  room, index, canRemove, onChange, onRemove,
}: {
  room: RoomDraft; index: number; canRemove: boolean;
  onChange: (patch: Partial<RoomDraft>) => void; onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cap = ROOM_CATEGORY_CAPACITY[room.category] || 2;

  async function addRoomPhotos(files: FileList | null) {
    if (!files || !files.length) return;
    const remaining = Math.max(0, 6 - room.images.length);
    if (remaining <= 0) { setNote("Max 6 photos per room."); return; }
    setBusy(true); setNote(`Uploading ${Math.min(files.length, remaining)}…`);
    const { urls, failed } = await uploadPhotosToServer(Array.from(files), remaining);
    if (urls.length) onChange({ images: [...room.images, ...urls].slice(0, 6) });
    setNote(failed.length ? `${urls.length} added · ${failed.length} failed — retry` : `✓ ${urls.length} added`);
    setBusy(false);
  }

  const toggleAmen = (id: string) =>
    onChange({ amenities: room.amenities.includes(id) ? room.amenities.filter((x) => x !== id) : [...room.amenities, id] });

  return (
    <div className="rounded-xl p-3.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)" }}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-bold" style={{ color: "var(--text-soft)" }}>Room category {index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} className="text-xs font-semibold" style={{ color: "#b04242" }}>Remove</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="col-span-2">
          <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>Category</span>
          <select value={room.category} onChange={(e) => onChange({ category: e.target.value })}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}>
            {ROOM_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {room.category === "custom" && (
          <label className="col-span-2">
            <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>Room name</span>
            <input value={room.customName} onChange={(e) => onChange({ customName: e.target.value })}
              placeholder="e.g. Lakeview Kutir"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
          </label>
        )}
        <label>
          <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>How many</span>
          <input value={room.count} onChange={(e) => onChange({ count: e.target.value })} type="number" min={1} placeholder="8"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
        </label>
        <label>
          <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>Price / night (₹)</span>
          <input value={room.price} onChange={(e) => onChange({ price: e.target.value })} type="number" min={0} placeholder="optional"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
        </label>
        <label className="col-span-2">
          <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>Max guests / room</span>
          <input value={room.capacity} onChange={(e) => onChange({ capacity: e.target.value })} type="number" min={1}
            placeholder={`default ${cap}`}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
        </label>
      </div>

      {/* Room-level amenities */}
      <div className="mt-3">
        <span className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-soft)" }}>In-room amenities</span>
        <div className="flex flex-wrap gap-1.5">
          {AMENITIES.map((a) => {
            const on = room.amenities.includes(a.id);
            return (
              <button key={a.id} type="button" onClick={() => toggleAmen(a.id)}
                className="px-2 py-1 rounded-full text-[11px] font-medium"
                style={on
                  ? { background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)" }
                  : { background: "var(--bg-card)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
                {a.emoji} {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Room photos */}
      <div className="mt-3">
        <span className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-soft)" }}>Room photos (up to 6)</span>
        <div className="flex flex-wrap gap-2">
          {room.images.map((u, j) => (
            <div key={u} className="relative w-14 h-14 rounded-md overflow-hidden" style={{ border: "1px solid var(--border-soft)" }}>
              <img src={u} alt="" className="w-full h-full object-cover" />
              <button type="button" onClick={() => onChange({ images: room.images.filter((_, k) => k !== j) })}
                className="absolute top-0 right-0 w-4 h-4 rounded-bl-md text-[10px] flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>✕</button>
            </div>
          ))}
          {room.images.length < 6 && (
            <label className="w-14 h-14 rounded-md flex items-center justify-center cursor-pointer text-xs"
              style={{ border: "1px dashed var(--border-soft)", color: "var(--text-muted)" }}>
              {busy ? "…" : "📷"}
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addRoomPhotos(e.target.files)} />
            </label>
          )}
        </div>
        {note && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{note}</p>}
      </div>
    </div>
  );
}

function MySubmissions({ rows }: { rows: Submission[] }) {
  return (
    <div className="mt-6 sb-fade-in">
      <h3 className="font-display text-lg mb-2" style={{ color: "var(--text-base)" }}>Your submissions</h3>
      <div className="space-y-2">
        {rows.map((s) => {
          const m = STATUS_META[s.status] || STATUS_META.pending_review;
          return (
            <div key={s.id} className="rounded-xl p-3 flex items-center justify-between gap-3 sb-card-lift"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="min-w-0">
                <div className="font-semibold truncate" style={{ color: "var(--text-base)" }}>{s.title}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {[s.city, s.property_type, s.rent_monthly ? inr(s.rent_monthly) + "/mo" : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ color: m.color, background: m.bg }}>{m.label}</span>
                <Link href={`/host/property/${s.id}`} className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🎬 Content</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Small shared UI ────────────────────────────────────────────────────────
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${className || ""}`} style={{ color: "var(--text-muted)" }}>{children}</div>;
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={full ? "sm:col-span-2" : ""}>
      <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

function Input(props: any) {
  return (
    <input {...props}
      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
      style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
  );
}

// Single-select chip grid (property type).
function ChipGrid({ options, value, onPick }: { options: { id: string; label: string; emoji: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-1">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onPick(o.id)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold sb-card-lift"
            style={on
              ? { background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)" }
              : { background: "var(--bg-input)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
            {o.emoji} {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Multi-select chip list (amenities, add-ons).
function ChipMulti({ options, selected, onToggle }: { options: { id: string; label: string; emoji: string }[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onToggle(o.id)}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={on
              ? { background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)" }
              : { background: "var(--bg-input)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
            {o.emoji} {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LocChip({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-soft)" }}>{children}</span>;
}
