"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadOnboardSession, onbFetch, clearOnboardSession } from "@/lib/onboard/client";

// ============================================================================
// Types
// ============================================================================
type Hotel = {
  id: string; name: string; city: string; state?: string; country?: string;
  starRating?: number; description?: string; address?: string;
  formatted_address?: string; lat?: number; lng?: number; place_id?: string;
  contact_phone?: string; contact_email?: string; contact_website?: string;
  amenities?: string[]; status: string; preview_viewed?: boolean; public_id?: string;
};
// Wizard uses `basePrice` in the form; existing schema column is `mrp`.
// API maps basePrice → mrp on save; on load we read whichever exists.
type Room = { id: string; hotelId: string; type: string; name?: string; capacity: number; basePrice?: number; mrp?: number; floorPrice: number; amenities: string[]; description?: string; quantity?: number; size_sqft?: number; bedrooms?: number; bathrooms?: number };
type ImageRow = { id: string; url: string; storage_path?: string; sort_order?: number; kind?: string };
type Listing = {
  hotel: Hotel | null; rooms: Room[]; hotelImages: ImageRow[]; roomImages: ImageRow[];
  kyc: any; bank: any; agreement: any;
  checklist: Record<string, boolean>; readyToPublish: boolean;
};
type SectionId = "basics" | "images" | "rooms" | "kyc" | "bank" | "legal" | "preview" | "publish";

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "basics",  label: "Property",      icon: "🏨" },
  { id: "images",  label: "Photos",        icon: "📸" },
  { id: "rooms",   label: "Rooms",         icon: "🛏️" },
  { id: "kyc",     label: "KYC",           icon: "🪪" },
  { id: "bank",    label: "Bank",          icon: "🏦" },
  { id: "legal",   label: "Agreement",     icon: "📄" },
  { id: "preview", label: "Preview",       icon: "👀" },
  { id: "publish", label: "Publish",       icon: "🚀" },
];

// ============================================================================
// Page
// ============================================================================
export default function WizardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [section, setSection] = useState<SectionId>("basics");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const j = await onbFetch<Listing>("/api/onboard/listing");
      setListing(j);
    } catch (e: any) { setErr(e?.message || "Failed to load"); }
  };

  useEffect(() => {
    const { token, user } = loadOnboardSession();
    if (!token) { router.replace("/onboard/signin"); return; }
    setUser(user);
    refresh().finally(() => setLoading(false));
  }, [router]);

  if (!user || loading) return <div className="max-w-6xl mx-auto p-12 text-center text-luxury-500">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-luxury-900">List your property</h1>
          <p className="text-sm text-luxury-500">Logged in as <span className="font-medium">{user.email || user.phone}</span></p>
        </div>
        <button onClick={() => { clearOnboardSession(); router.push("/onboard"); }}
                className="text-sm text-luxury-500 hover:text-gold-700">Sign out</button>
      </div>

      {err && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      <div className="grid md:grid-cols-[280px_1fr] gap-6">
        <Sidebar listing={listing} active={section} setActive={setSection} />
        <div className="card-luxury p-6 md:p-8">
          {section === "basics"  && <BasicsSection listing={listing} onChange={refresh} />}
          {section === "images"  && <ImagesSection listing={listing} onChange={refresh} />}
          {section === "rooms"   && <RoomsSection listing={listing} onChange={refresh} />}
          {section === "kyc"     && <KycSection listing={listing} onChange={refresh} />}
          {section === "bank"    && <BankSection listing={listing} onChange={refresh} />}
          {section === "legal"   && <LegalSection listing={listing} onChange={refresh} />}
          {section === "preview" && <PreviewSection listing={listing} onChange={refresh} />}
          {section === "publish" && <PublishSection listing={listing} onChange={refresh} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sidebar
// ============================================================================
function Sidebar({ listing, active, setActive }: { listing: Listing | null; active: SectionId; setActive: (s: SectionId) => void }) {
  const ck = listing?.checklist || {};
  const map: Record<SectionId, boolean> = {
    basics: !!ck.basics, images: !!ck.images, rooms: !!ck.rooms, kyc: !!ck.kyc,
    bank: !!ck.bank, legal: !!ck.agreement, preview: !!ck.previewViewed, publish: !!listing?.readyToPublish,
  };
  return (
    <aside className="card-luxury p-3 h-fit sticky top-24">
      <div className="text-xs uppercase tracking-widest text-luxury-500 font-bold px-3 pb-3 pt-1">Sections</div>
      <nav className="space-y-1">
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => setActive(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                    active === s.id ? "bg-gradient-to-r from-gold-500 to-gold-600 text-white shadow-gold"
                                    : "hover:bg-luxury-50 text-luxury-800"
                  }`}>
            <span className="text-lg">{s.icon}</span>
            <span className="flex-1 font-medium">{s.label}</span>
            {map[s.id]
              ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓</span>
              : <span className="text-xs px-1.5 py-0.5 rounded-full bg-luxury-100 text-luxury-500">·</span>}
          </button>
        ))}
      </nav>
      {listing?.hotel?.public_id && (
        <div className="mt-4 mx-3 mb-2 p-3 rounded-xl bg-gold-50 border border-gold-200 text-xs">
          <div className="uppercase tracking-widest text-gold-700 font-bold">Hotel ID</div>
          <div className="font-mono font-bold text-gold-900">{listing.hotel.public_id}</div>
        </div>
      )}
    </aside>
  );
}

// ============================================================================
// SECTION 1: Basics  — Google Places autocomplete + auto-fill
// ============================================================================
function BasicsSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const [hotel, setHotel] = useState<Partial<Hotel>>(listing?.hotel || { country: "India", starRating: 4 });
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const debRef = useRef<any>(null);

  useEffect(() => {
    if (listing?.hotel) setHotel(listing.hotel);
  }, [listing?.hotel?.id]);

  useEffect(() => {
    clearTimeout(debRef.current);
    if (query.trim().length < 2) { setSuggestions([]); return; }
    debRef.current = setTimeout(async () => {
      try {
        const j = await onbFetch<any>(`/api/onboard/places/search?q=${encodeURIComponent(query)}`);
        setSuggestions(j.results || []);
      } catch {}
    }, 300);
    return () => clearTimeout(debRef.current);
  }, [query]);

  const pick = async (s: any) => {
    setBusy(true); setSuggestions([]); setQuery(s.primary);
    try {
      const j = await onbFetch<any>("/api/onboard/places/details", { method: "POST", body: JSON.stringify({ placeId: s.placeId }) });
      const p = j.place;
      setHotel((h) => ({
        ...h,
        name: p.name, city: p.city, state: p.state, country: p.country || "India",
        formatted_address: p.formattedAddress, place_id: p.placeId,
        lat: p.lat, lng: p.lng,
        contact_phone: p.phone || h.contact_phone,
        contact_website: p.website || h.contact_website,
      }));
      setMsg("✓ Auto-filled from Google. Edit anything below.");
    } catch (e: any) { setMsg(e?.message || "Could not fetch place details"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await onbFetch("/api/onboard/listing", { method: "POST", body: JSON.stringify({ id: hotel.id, ...hotel }) });
      setMsg("✓ Saved");
      onChange();
    } catch (e: any) { setMsg(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <SectionHead title="Property basics" subtitle="Search your hotel on Google to auto-fill location & contact, then refine." />

      <div className="relative">
        <Field label="Search your property on Google">
          <input className="input-luxury" placeholder="Start typing — e.g. The Mountain Grand Mussoorie"
                 value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        {suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white rounded-2xl shadow-xl border border-luxury-100 overflow-hidden">
            {suggestions.map((s) => (
              <button key={s.placeId} onClick={() => pick(s)} className="w-full text-left px-4 py-2.5 hover:bg-gold-50 transition border-b border-luxury-50 last:border-0">
                <div className="font-medium text-luxury-900">{s.primary}</div>
                <div className="text-xs text-luxury-500">{s.secondary}</div>
              </button>
            ))}
          </div>
        )}
        {busy && <div className="text-sm text-luxury-500 mt-2">Loading from Google…</div>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Hotel name *"><input className="input-luxury" value={hotel.name || ""} onChange={(e) => setHotel({ ...hotel, name: e.target.value })} /></Field>
        <Field label="Star rating">
          <select className="input-luxury" value={hotel.starRating || 4} onChange={(e) => setHotel({ ...hotel, starRating: +e.target.value })}>
            {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} stars</option>)}
          </select>
        </Field>
        <Field label="City *"><input className="input-luxury" value={hotel.city || ""} onChange={(e) => setHotel({ ...hotel, city: e.target.value })} /></Field>
        <Field label="State"><input className="input-luxury" value={hotel.state || ""} onChange={(e) => setHotel({ ...hotel, state: e.target.value })} /></Field>
        <Field label="Full address" full><input className="input-luxury" value={hotel.formatted_address || ""} onChange={(e) => setHotel({ ...hotel, formatted_address: e.target.value })} /></Field>
        <Field label="Latitude"><input type="number" step="any" className="input-luxury" value={hotel.lat ?? ""} onChange={(e) => setHotel({ ...hotel, lat: e.target.value === "" ? undefined : +e.target.value })} /></Field>
        <Field label="Longitude"><input type="number" step="any" className="input-luxury" value={hotel.lng ?? ""} onChange={(e) => setHotel({ ...hotel, lng: e.target.value === "" ? undefined : +e.target.value })} /></Field>
        <Field label="Contact phone"><input className="input-luxury" value={hotel.contact_phone || ""} onChange={(e) => setHotel({ ...hotel, contact_phone: e.target.value })} /></Field>
        <Field label="Contact email"><input className="input-luxury" value={hotel.contact_email || ""} onChange={(e) => setHotel({ ...hotel, contact_email: e.target.value })} /></Field>
        <Field label="Website" full><input className="input-luxury" value={hotel.contact_website || ""} onChange={(e) => setHotel({ ...hotel, contact_website: e.target.value })} /></Field>
        <Field label="Description" full>
          <textarea rows={4} className="input-luxury" value={hotel.description || ""} onChange={(e) => setHotel({ ...hotel, description: e.target.value })} />
        </Field>
      </div>

      {msg && <div className="text-sm text-luxury-700 bg-gold-50 border border-gold-200 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving || !hotel.name || !hotel.city} className="btn-luxury disabled:opacity-50">
          {saving ? "Saving…" : "Save & continue"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 2: Images — direct upload to Supabase Storage with previews
// ============================================================================
function ImagesSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const hotelId = listing?.hotel?.id;
  const [images, setImages] = useState<ImageRow[]>(listing?.hotelImages || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setImages(listing?.hotelImages || []); }, [listing?.hotelImages]);

  if (!hotelId) return <NotReady prompt="Save your property basics first." />;

  const handleFiles = async (files: FileList) => {
    setBusy(true); setErr(null);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f); fd.append("kind", "hotel-images"); fd.append("pathPrefix", `${hotelId}/gallery`);
        const { token } = loadOnboardSession();
        const up = await fetch("/api/onboard/upload", { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
        const upJ = await up.json();
        if (!up.ok) throw new Error(upJ.error || "Upload failed");
        await onbFetch("/api/onboard/images", {
          method: "POST",
          body: JSON.stringify({ scope: "hotel", hotel_id: hotelId, url: upJ.url, storage_path: upJ.storagePath, kind: "gallery", sort_order: images.length }),
        });
      }
      onChange();
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this photo?")) return;
    await onbFetch(`/api/onboard/images?scope=hotel&id=${id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-6">
      <SectionHead title="Hotel photos" subtitle="Upload at least 3 photos. JPEG/PNG/WebP, up to 8 MB each." />

      <label className="block border-2 border-dashed border-gold-300 rounded-2xl p-8 text-center cursor-pointer hover:bg-gold-50 transition">
        <input type="file" multiple accept="image/*" hidden onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        <div className="text-3xl">📸</div>
        <div className="font-display text-xl text-luxury-900 mt-2">Drop photos here or click to upload</div>
        <div className="text-xs text-luxury-500 mt-1">High-res preferred · multiple files allowed</div>
      </label>

      {busy && <div className="text-sm text-luxury-500">Uploading…</div>}
      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {images.map((img) => (
          <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border border-luxury-100">
            <img src={img.url} alt="" className="w-full h-full object-cover" />
            <button onClick={() => remove(img.id)} className="absolute top-1.5 right-1.5 bg-red-500 text-white text-xs rounded-full px-2 py-1 opacity-0 group-hover:opacity-100 transition">Remove</button>
          </div>
        ))}
      </div>
      <div className="text-xs text-luxury-500">{images.length} / 3 minimum {images.length >= 3 ? <span className="text-emerald-700">✓</span> : null}</div>
    </div>
  );
}

// ============================================================================
// SECTION 3: Rooms — add/edit/delete + per-room images
// ============================================================================
function RoomsSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const hotelId = listing?.hotel?.id;
  const [rooms, setRooms] = useState<Room[]>(listing?.rooms || []);
  const [editing, setEditing] = useState<Partial<Room> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setRooms(listing?.rooms || []); }, [listing?.rooms]);

  if (!hotelId) return <NotReady prompt="Save property basics first." />;

  const save = async () => {
    if (!editing) return;
    setBusy(true); setErr(null);
    try {
      await onbFetch("/api/onboard/rooms", {
        method: "POST",
        body: JSON.stringify({ ...editing, hotelId, basePrice: editing.basePrice || 4999, floorPrice: editing.floorPrice || Math.round(((editing.basePrice as number) || 4999) * 0.78) }),
      });
      setEditing(null);
      onChange();
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this room type?")) return;
    await onbFetch(`/api/onboard/rooms?id=${id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-6">
      <SectionHead title="Rooms & pricing" subtitle="Add at least one room type. Each can have its own photos." />

      <div className="space-y-3">
        {rooms.map((r) => (
          <RoomCard key={r.id} room={r} hotelId={hotelId} listing={listing} onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} onChange={onChange} />
        ))}
      </div>

      {!editing && (
        <button onClick={() => setEditing({ type: "Deluxe Room", capacity: 2, basePrice: 4999, floorPrice: 3899, amenities: ["WiFi", "AC", "TV"], quantity: 1 })}
                className="btn-luxury">+ Add room type</button>
      )}

      {editing && (
        <div className="card-luxury p-4 border-gold-300 bg-gold-50/40">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Type *"><input className="input-luxury" value={editing.type || ""} onChange={(e) => setEditing({ ...editing, type: e.target.value })} /></Field>
            <Field label="Capacity"><input type="number" className="input-luxury" value={editing.capacity || 2} onChange={(e) => setEditing({ ...editing, capacity: +e.target.value })} /></Field>
            <Field label="Base price (₹/night) *"><input type="number" className="input-luxury" value={editing.basePrice || 0} onChange={(e) => setEditing({ ...editing, basePrice: +e.target.value })} /></Field>
            <Field label="Floor price (₹/night) *"><input type="number" className="input-luxury" value={editing.floorPrice || 0} onChange={(e) => setEditing({ ...editing, floorPrice: +e.target.value })} /></Field>
            <Field label="Bedrooms"><input type="number" className="input-luxury" value={editing.bedrooms || 1} onChange={(e) => setEditing({ ...editing, bedrooms: +e.target.value })} /></Field>
            <Field label="Bathrooms"><input type="number" className="input-luxury" value={editing.bathrooms || 1} onChange={(e) => setEditing({ ...editing, bathrooms: +e.target.value })} /></Field>
            <Field label="Size (sq ft)"><input type="number" className="input-luxury" value={editing.size_sqft || 0} onChange={(e) => setEditing({ ...editing, size_sqft: +e.target.value })} /></Field>
            <Field label="Quantity"><input type="number" className="input-luxury" value={editing.quantity || 1} onChange={(e) => setEditing({ ...editing, quantity: +e.target.value })} /></Field>
            <Field label="Description" full><textarea rows={2} className="input-luxury" value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Amenities (comma separated)" full>
              <input className="input-luxury" value={(editing.amenities || []).join(", ")} onChange={(e) => setEditing({ ...editing, amenities: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) })} />
            </Field>
          </div>
          {err && <div className="mt-3 text-sm text-red-700">{err}</div>}
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setEditing(null)} className="px-5 py-2 rounded-full bg-luxury-100">Cancel</button>
            <button onClick={save} disabled={busy} className="btn-luxury disabled:opacity-50">{busy ? "Saving…" : "Save room"}</button>
          </div>
        </div>
      )}

      <div className="text-xs text-luxury-500">{rooms.length} / 1 minimum {rooms.length >= 1 ? <span className="text-emerald-700">✓</span> : null}</div>
    </div>
  );
}

function RoomCard({ room, hotelId, listing, onEdit, onDelete, onChange }: any) {
  const imgs = (listing?.roomImages || []).filter((i: any) => i.room_id === room.id);
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f as Blob); fd.append("kind", "room-images"); fd.append("pathPrefix", `${hotelId}/rooms/${room.id}`);
        const { token } = loadOnboardSession();
        const up = await fetch("/api/onboard/upload", { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
        const upJ = await up.json();
        if (!up.ok) throw new Error(upJ.error || "Upload failed");
        await onbFetch("/api/onboard/images", {
          method: "POST",
          body: JSON.stringify({ scope: "room", hotel_id: hotelId, room_id: room.id, url: upJ.url, storage_path: upJ.storagePath, sort_order: imgs.length }),
        });
      }
      onChange();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card-luxury p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-luxury-900">{room.type}</div>
          <div className="text-xs text-luxury-500">Sleeps {room.capacity} · ₹{(room.basePrice ?? room.mrp ?? 0).toLocaleString("en-IN")} / night · floor ₹{room.floorPrice?.toLocaleString("en-IN")}</div>
          {room.amenities?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {room.amenities.map((a: string) => <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-gold-50 border border-gold-200 text-gold-800">{a}</span>)}
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={onEdit} className="text-xs px-3 py-1 rounded-full bg-luxury-100 text-luxury-800">Edit</button>
          <button onClick={onDelete} className="text-xs px-3 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">Delete</button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {imgs.map((i: any) => (
          <div key={i.id} className="w-16 h-16 rounded-lg bg-cover bg-center border border-luxury-100" style={{ backgroundImage: `url(${i.url})` }} />
        ))}
        <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gold-300 flex items-center justify-center text-gold-700 cursor-pointer hover:bg-gold-50">
          <input type="file" multiple accept="image/*" hidden onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          {busy ? "…" : "+"}
        </label>
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 4: KYC
// ============================================================================
function KycSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const hotelId = listing?.hotel?.id;
  const [data, setData] = useState<any>(listing?.kyc || {
    consent_listing: false, consent_price_compare: false, consent_image_rights: false, consent_legal: false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (listing?.kyc) setData(listing.kyc); }, [listing?.kyc]);

  if (!hotelId) return <NotReady prompt="Save property basics first." />;

  const upload = async (field: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("kind", "kyc-documents"); fd.append("pathPrefix", `${hotelId}/${field}`);
    const { token } = loadOnboardSession();
    const r = await fetch("/api/onboard/upload", { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    setData((d: any) => ({ ...d, [field]: j.url }));
  };

  const submit = async () => {
    setSaving(true); setMsg(null);
    try {
      await onbFetch("/api/onboard/kyc", { method: "POST", body: JSON.stringify({ ...data, hotel_id: hotelId }) });
      setMsg("✓ KYC saved");
      onChange();
    } catch (e: any) { setMsg(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const allConsents = data.consent_listing && data.consent_price_compare && data.consent_image_rights && data.consent_legal;

  return (
    <div className="space-y-6">
      <SectionHead title="KYC verification" subtitle="Required by law. We never share your documents externally." />

      <Group title="Owner details">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Full name *"><input className="input-luxury" value={data.owner_full_name || ""} onChange={(e) => setData({ ...data, owner_full_name: e.target.value })} /></Field>
          <Field label="Date of birth"><input type="date" className="input-luxury" value={data.owner_dob || ""} onChange={(e) => setData({ ...data, owner_dob: e.target.value })} /></Field>
          <Field label="PAN number"><input className="input-luxury" value={data.owner_pan || ""} onChange={(e) => setData({ ...data, owner_pan: e.target.value.toUpperCase() })} /></Field>
          <Field label="Aadhaar (last 4 digits)"><input maxLength={4} className="input-luxury" value={data.owner_aadhaar_last4 || ""} onChange={(e) => setData({ ...data, owner_aadhaar_last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></Field>
          <Field label="Owner address" full><textarea rows={2} className="input-luxury" value={data.owner_address || ""} onChange={(e) => setData({ ...data, owner_address: e.target.value })} /></Field>
        </div>
      </Group>

      <Group title="Business details">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Legal business name *"><input className="input-luxury" value={data.business_legal_name || ""} onChange={(e) => setData({ ...data, business_legal_name: e.target.value })} /></Field>
          <Field label="Business type">
            <select className="input-luxury" value={data.business_type || ""} onChange={(e) => setData({ ...data, business_type: e.target.value })}>
              <option value="">Select…</option>
              <option value="proprietorship">Proprietorship</option>
              <option value="partnership">Partnership</option>
              <option value="llp">LLP</option>
              <option value="pvt-ltd">Private Limited</option>
              <option value="trust">Trust</option>
            </select>
          </Field>
          <Field label="GSTIN"><input className="input-luxury" value={data.business_gstin || ""} onChange={(e) => setData({ ...data, business_gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Business PAN"><input className="input-luxury" value={data.business_pan || ""} onChange={(e) => setData({ ...data, business_pan: e.target.value.toUpperCase() })} /></Field>
          <Field label="Business address" full><textarea rows={2} className="input-luxury" value={data.business_address || ""} onChange={(e) => setData({ ...data, business_address: e.target.value })} /></Field>
          <Field label="State"><input className="input-luxury" value={data.business_state || ""} onChange={(e) => setData({ ...data, business_state: e.target.value })} /></Field>
          <Field label="Pincode"><input className="input-luxury" value={data.business_pincode || ""} onChange={(e) => setData({ ...data, business_pincode: e.target.value })} /></Field>
        </div>
      </Group>

      <Group title="Documents">
        <div className="grid md:grid-cols-2 gap-3">
          <DocUpload label="Owner ID proof (Aadhaar/Passport/DL)" url={data.doc_owner_id_url} onUpload={(f) => upload("doc_owner_id_url", f)} />
          <DocUpload label="Property ownership proof" url={data.doc_property_proof_url} onUpload={(f) => upload("doc_property_proof_url", f)} />
          <DocUpload label="Business PAN card" url={data.doc_business_pan_url} onUpload={(f) => upload("doc_business_pan_url", f)} />
          <DocUpload label="GST certificate (if applicable)" url={data.doc_gst_url} onUpload={(f) => upload("doc_gst_url", f)} />
        </div>
      </Group>

      <Group title="Mandatory consents *">
        <div className="space-y-2.5">
          <Consent v={data.consent_listing} on={(b) => setData({ ...data, consent_listing: b })} text="I authorise StayBid to list this property and accept bookings on my behalf." />
          <Consent v={data.consent_price_compare} on={(b) => setData({ ...data, consent_price_compare: b })} text="I permit StayBid to display my rates alongside competitor OTAs for price comparison." />
          <Consent v={data.consent_image_rights} on={(b) => setData({ ...data, consent_image_rights: b })} text="I confirm I have the rights to all images uploaded and grant StayBid a non-exclusive licence to display them." />
          <Consent v={data.consent_legal} on={(b) => setData({ ...data, consent_legal: b })} text="I accept the terms set out in the StayBid Host Agreement (next step)." />
        </div>
      </Group>

      {msg && <div className="text-sm text-luxury-700 bg-gold-50 border border-gold-200 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={saving || !data.owner_full_name || !data.business_legal_name || !allConsents} className="btn-luxury disabled:opacity-50">
          {saving ? "Saving…" : "Save KYC"}
        </button>
      </div>
    </div>
  );
}

function Consent({ v, on, text }: { v: boolean; on: (b: boolean) => void; text: string }) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-xl bg-luxury-50 hover:bg-gold-50 cursor-pointer border border-luxury-100">
      <input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} className="mt-0.5 w-5 h-5 accent-gold-600" />
      <div className="text-sm text-luxury-800">{text}</div>
    </label>
  );
}

function DocUpload({ label, url, onUpload }: { label: string; url?: string; onUpload: (f: File) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-luxury-500 mb-1.5">{label}</div>
      {url ? (
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-emerald-800 truncate">✓ Uploaded</a>
          <label className="text-xs text-gold-700 cursor-pointer hover:underline">Replace
            <input type="file" hidden accept="image/*,application/pdf" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { await onUpload(f); } finally { setBusy(false); }
            }} />
          </label>
        </div>
      ) : (
        <label className="block border-2 border-dashed border-gold-300 rounded-xl p-3 text-center cursor-pointer hover:bg-gold-50 text-sm text-luxury-700">
          <input type="file" hidden accept="image/*,application/pdf" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { await onUpload(f); } finally { setBusy(false); }
          }} />
          {busy ? "Uploading…" : "Click to upload (image / PDF)"}
        </label>
      )}
    </div>
  );
}

// ============================================================================
// SECTION 5: Bank
// ============================================================================
function BankSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const hotelId = listing?.hotel?.id;
  const existing = listing?.bank;
  const [data, setData] = useState<any>({ account_type: "savings" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!hotelId) return <NotReady prompt="Save property basics first." />;

  const submit = async () => {
    setSaving(true); setMsg(null);
    try {
      await onbFetch("/api/onboard/bank", { method: "POST", body: JSON.stringify({ ...data, hotel_id: hotelId }) });
      setMsg("✓ Bank details saved (encrypted)"); setData({ account_type: "savings" });
      onChange();
    } catch (e: any) { setMsg(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <SectionHead title="Payout bank account" subtitle="Where StayBid pays your earnings. Account number is encrypted at rest." />

      {existing && (
        <div className="card-luxury p-4 bg-gold-50/50 border-gold-200">
          <div className="text-xs uppercase tracking-widest text-gold-700 font-bold">Active payout account</div>
          <div className="mt-1 text-luxury-900 font-semibold">{existing.account_holder}</div>
          <div className="text-sm text-luxury-600">A/c ••••{existing.account_last4} · {existing.ifsc} {existing.bank_name ? `· ${existing.bank_name}` : ""}</div>
          <div className="text-xs mt-2">{existing.verified ? "✓ Verified" : "Awaiting verification"}</div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Account holder name *"><input className="input-luxury" value={data.account_holder || ""} onChange={(e) => setData({ ...data, account_holder: e.target.value })} /></Field>
        <Field label="Account type">
          <select className="input-luxury" value={data.account_type} onChange={(e) => setData({ ...data, account_type: e.target.value })}>
            <option value="savings">Savings</option>
            <option value="current">Current</option>
          </select>
        </Field>
        <Field label="Account number *"><input className="input-luxury" value={data.account_number || ""} onChange={(e) => setData({ ...data, account_number: e.target.value })} /></Field>
        <Field label="IFSC *"><input className="input-luxury" value={data.ifsc || ""} onChange={(e) => setData({ ...data, ifsc: e.target.value.toUpperCase() })} /></Field>
        <Field label="Bank name"><input className="input-luxury" value={data.bank_name || ""} onChange={(e) => setData({ ...data, bank_name: e.target.value })} /></Field>
        <Field label="Branch"><input className="input-luxury" value={data.branch || ""} onChange={(e) => setData({ ...data, branch: e.target.value })} /></Field>
        <Field label="UPI VPA (optional)" full><input className="input-luxury" placeholder="hotel@upi" value={data.upi_vpa || ""} onChange={(e) => setData({ ...data, upi_vpa: e.target.value })} /></Field>
      </div>

      {msg && <div className="text-sm text-luxury-700 bg-gold-50 border border-gold-200 rounded-lg px-3 py-2">{msg}</div>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={saving} className="btn-luxury disabled:opacity-50">{saving ? "Saving…" : existing ? "Update bank account" : "Save bank account"}</button>
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 6: Legal — host agreement
// ============================================================================
function LegalSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const hotelId = listing?.hotel?.id;
  const [agr, setAgr] = useState<any>(null);
  const [signed, setSigned] = useState<any>(listing?.agreement || null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    fetch("/api/onboard/agreement").then((r) => r.json()).then(setAgr);
  }, []);

  if (!hotelId) return <NotReady prompt="Save property basics first." />;

  const sign = async () => {
    setBusy(true); setMsg(null);
    try {
      const j = await onbFetch<any>("/api/onboard/agreement", { method: "POST", body: JSON.stringify({ hotel_id: hotelId }) });
      setSigned(j.agreement);
      setMsg("✓ Agreement signed");
      onChange();
    } catch (e: any) { setMsg(e?.message || "Failed to sign"); }
    finally { setBusy(false); }
  };

  if (!agr) return <div className="text-luxury-500">Loading agreement…</div>;

  return (
    <div className="space-y-5">
      <SectionHead title="Host agreement" subtitle={`Version ${agr.version} · ${agr.commissionPercent}% commission`} />

      {signed && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
          ✓ Signed on {new Date(signed.signed_at).toLocaleString("en-IN")} (version {signed.version})
        </div>
      )}

      <Block title="1. Commission">
        <p>StayBid charges a flat commission of <strong>{agr.commissionPercent}%</strong> on the gross booking value (net of taxes) for every confirmed booking sourced through the platform. Commission is deducted automatically before payout.</p>
      </Block>
      <Block title="2. Cancellation policy"><pre className="whitespace-pre-wrap font-sans">{agr.cancellation}</pre></Block>
      <Block title="3. Liability"><pre className="whitespace-pre-wrap font-sans">{agr.liability}</pre></Block>
      <Block title="4. Dispute handling"><pre className="whitespace-pre-wrap font-sans">{agr.dispute}</pre></Block>

      {!signed && (
        <>
          <label className="flex items-start gap-3 p-3 rounded-xl bg-gold-50 border border-gold-200 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 w-5 h-5 accent-gold-600" />
            <div className="text-sm text-luxury-800">I have read and accept the terms of the StayBid Host Agreement in full.</div>
          </label>
          {msg && <div className="text-sm text-luxury-700">{msg}</div>}
          <div className="flex justify-end">
            <button onClick={sign} disabled={busy || !accepted} className="btn-luxury disabled:opacity-50">{busy ? "Signing…" : "Sign agreement"}</button>
          </div>
        </>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-luxury-50 border border-luxury-100 p-4">
      <div className="font-display text-lg text-luxury-900 mb-1">{title}</div>
      <div className="text-sm text-luxury-700 leading-relaxed">{children}</div>
    </div>
  );
}

// ============================================================================
// SECTION 7: Preview — must view before publish is enabled
// ============================================================================
function PreviewSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const h = listing?.hotel;
  const rooms = listing?.rooms || [];
  const imgs = listing?.hotelImages || [];

  if (!h) return <NotReady prompt="Save property basics first." />;

  const markViewed = async () => {
    try {
      await onbFetch("/api/onboard/listing", { method: "PATCH", body: JSON.stringify({ hotelId: h.id }) });
      onChange();
    } catch {}
  };

  return (
    <div className="space-y-5">
      <SectionHead title="Preview your listing" subtitle="This is exactly how guests will see your property. Verify everything is correct." />

      <div className="rounded-3xl overflow-hidden border border-luxury-100 shadow-lg bg-white">
        <div className="aspect-[16/8] bg-cover bg-center bg-luxury-100" style={{ backgroundImage: imgs[0]?.url ? `url(${imgs[0].url})` : undefined }}>
          <div className="h-full bg-gradient-to-t from-black/50 to-transparent flex items-end p-6">
            <div className="text-white">
              <div className="text-xs uppercase tracking-widest opacity-90">{h.formatted_address || `${h.city}, ${h.state || ""}`}</div>
              <div className="font-display text-4xl">{h.name}</div>
              <div className="opacity-90">{"★".repeat(h.starRating || 4)}</div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-luxury-700 leading-relaxed">{h.description || "—"}</p>

          {(h.amenities || []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(h.amenities || []).map((a: string) => <span key={a} className="px-3 py-1 rounded-full bg-gold-50 border border-gold-200 text-xs text-gold-800">{a}</span>)}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {imgs.slice(1, 5).map((i) => <div key={i.id} className="aspect-square rounded-xl bg-cover bg-center" style={{ backgroundImage: `url(${i.url})` }} />)}
          </div>

          <div>
            <div className="font-display text-2xl text-luxury-900 mb-3">Rooms</div>
            <div className="grid md:grid-cols-2 gap-3">
              {rooms.map((r) => (
                <div key={r.id} className="card-luxury p-4">
                  <div className="font-semibold text-luxury-900">{r.type}</div>
                  <div className="text-xs text-luxury-500">Sleeps {r.capacity} · ₹{(r.basePrice ?? r.mrp ?? 0).toLocaleString("en-IN")} / night</div>
                  {r.description && <div className="text-sm text-luxury-700 mt-1">{r.description}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-luxury-500">
            Contact · {h.contact_phone || "—"} · {h.contact_email || "—"} · {h.contact_website || "—"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-gold-50 border border-gold-200">
        <div className="text-sm text-luxury-700">
          {listing?.checklist?.previewViewed ? "✓ Preview verified — you can publish now." : "Confirm the listing looks good to enable publishing."}
        </div>
        {!listing?.checklist?.previewViewed && (
          <button onClick={markViewed} className="btn-luxury">Looks good ✓</button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SECTION 8: Publish — gated final action
// ============================================================================
function PublishSection({ listing, onChange }: { listing: Listing | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ck = listing?.checklist || {};
  const ready = listing?.readyToPublish;
  const isPublished = listing?.hotel?.status === "published";

  const submit = async () => {
    if (!listing?.hotel?.id) return;
    setBusy(true); setErr(null);
    try {
      await onbFetch("/api/onboard/publish", { method: "POST", body: JSON.stringify({ hotel_id: listing.hotel.id }) });
      onChange();
    } catch (e: any) { setErr(e?.message || "Publish failed"); }
    finally { setBusy(false); }
  };

  if (isPublished) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white text-4xl items-center justify-center mb-5">✓</div>
        <div className="font-display text-3xl text-luxury-900">Your hotel is live!</div>
        <div className="mt-2 text-luxury-500">Hotel ID <span className="font-mono font-bold text-gold-800">{listing?.hotel?.public_id || listing?.hotel?.id}</span></div>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <Link href={`/hotels/${listing?.hotel?.id}`} className="btn-luxury">View public listing →</Link>
          <Link href="/partner/dashboard" className="px-6 py-3 rounded-full bg-luxury-100 text-luxury-800">Open partner dashboard</Link>
        </div>
      </div>
    );
  }

  const items: { k: keyof typeof ck; label: string }[] = [
    { k: "basics", label: "Property basics (name + city + location)" },
    { k: "images", label: "At least 3 hotel photos uploaded" },
    { k: "rooms", label: "At least 1 room type added" },
    { k: "kyc", label: "KYC submitted with all 4 consents" },
    { k: "bank", label: "Payout bank account added" },
    { k: "agreement", label: "Host agreement signed" },
    { k: "previewViewed", label: "Listing preview verified" },
  ];

  return (
    <div className="space-y-5">
      <SectionHead title="Publish hotel" subtitle="All requirements below must be ticked." />
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.k} className={`flex items-center gap-3 p-3 rounded-xl border ${
            ck[it.k] ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-luxury-50 border-luxury-200 text-luxury-700"
          }`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${ck[it.k] ? "bg-emerald-500 text-white" : "bg-luxury-200 text-luxury-500"}`}>
              {ck[it.k] ? "✓" : "·"}
            </span>
            <span className="flex-1 font-medium">{it.label}</span>
          </div>
        ))}
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={!ready || busy} className="btn-luxury disabled:opacity-50">
          {busy ? "Publishing…" : ready ? "Publish hotel 🚀" : "Complete all steps first"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Atoms
// ============================================================================
function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-display text-2xl text-luxury-900">{title}</h2>
      {subtitle && <p className="text-sm text-luxury-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <div className="text-xs uppercase tracking-wider text-luxury-500 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-luxury-50/40 border border-luxury-100 p-4">
      <div className="font-display text-lg text-luxury-900 mb-3">{title}</div>
      {children}
    </div>
  );
}

function NotReady({ prompt }: { prompt: string }) {
  return <div className="text-luxury-500 text-sm bg-luxury-50 rounded-xl p-4 border border-luxury-100">{prompt}</div>;
}
