"use client";

// ============================================================================
// v285 — List My Property for lease/rent (comprehensive).
// A property OWNER offers their property TO StayBid to be leased/rented/managed.
// Real Google/OSM location, full listing fields, photo upload, and a per-
// property reel/photo studio (owner + admin only) reachable from each row.
// Submissions land in discovery_properties status='pending_review' and appear
// in the public /host/properties feed only after admin approval.
// Contact details are NEVER shown publicly — buyers reach the owner only
// through StayBid inquiries.
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import HostLocationPicker, { HostLocationValue } from "@/components/host/HostLocationPicker";
import { resizeImageBeforeUpload } from "@/lib/image-resize";

interface Submission {
  id: string; title: string; city?: string; property_type?: string;
  rent_monthly?: number; status: string; created_at: string;
}

const PROPERTY_TYPES = ["Apartment", "Villa", "Independent House", "Builder Floor", "Studio", "Penthouse", "Farmhouse", "Cottage", "Bungalow", "Plot / Land", "Commercial", "Other"];
const BHK = ["1RK", "1BHK", "2BHK", "3BHK", "4BHK", "5BHK+"];
const FURNISHING = ["Unfurnished", "Semi-furnished", "Fully furnished"];
const AREA_UNITS = ["sqft", "sqm", "sqyd", "acre"];
const FACING = ["", "North", "South", "East", "West", "North-East", "North-West", "South-East", "South-West"];
const LEASE_TYPES = ["Long-term (11 months+)", "Short-term", "Either"];
const TENANT_PREF = ["Any", "Family", "Bachelors", "Company / Corporate", "Students"];
const AMENITIES = ["Parking", "Lift", "Power backup", "Security", "Balcony", "Modular kitchen", "Gym", "Swimming pool", "Wi-Fi", "Air conditioning", "24x7 water", "Gas pipeline", "Kids play area", "Club house", "Pet friendly", "Gated community", "CCTV", "Servant room"];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_review: { label: "Under review", color: "#8a6d1a", bg: "rgba(201,145,26,0.14)" },
  available: { label: "Live · listed", color: "#2f7a3f", bg: "rgba(47,122,63,0.14)" },
  shortlisted: { label: "Shortlisted", color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  rented: { label: "Rented", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
  rejected: { label: "Not accepted", color: "#b04242", bg: "rgba(176,66,66,0.12)" },
  inactive: { label: "Inactive", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
};

const inr = (n?: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const emptyLoc: HostLocationValue = { city: "", locality: "", state: "", formatted: "", lat: null, lng: null };

export default function ListPropertyPage() {
  const [f, setF] = useState({
    title: "", propertyType: "Apartment", bhk: "2BHK", furnishing: "Semi-furnished",
    areaSqft: "", carpetArea: "", areaUnit: "sqft",
    floor: "", totalFloors: "", facing: "", ageYears: "", availableFrom: "", leaseType: "Long-term (11 months+)", tenantPref: "Any",
    rentMonthly: "", deposit: "", maintenanceMonthly: "", negotiable: false,
    landmarks: "", name: "", phone: "", email: "", message: "",
  });
  const [loc, setLoc] = useState<HostLocationValue>(emptyLoc);
  const [amen, setAmen] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<Submission[]>([]);

  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggleAmen = (a: string) => setAmen((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

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
    setPhotoNote({ text: `Uploading 0/${picked.length}…`, kind: "ok" });

    const uploaded: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      setPhotoNote({ text: `Uploading ${i + 1}/${picked.length}…`, kind: "ok" });
      try {
        // Resize client-side (typically 5 MB → ~350-500 KB) so the file stays
        // well under Vercel's serverless body limit, then upload via the
        // service-role server route (RLS-proof + surfaces real errors).
        const resized = await resizeImageBeforeUpload(file).catch(() => file);
        const fd = new FormData();
        fd.append("file", resized, resized.name || file.name || "photo.jpg");
        const res = await fetch("/api/host/list-property/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.url) {
          throw new Error(data?.error || `Upload failed (${res.status})`);
        }
        uploaded.push(data.url as string);
      } catch (e: any) {
        failed.push(e?.message || "unknown error");
      }
    }

    if (uploaded.length) setImages((s) => [...s, ...uploaded].slice(0, 12));

    if (failed.length && uploaded.length) {
      setPhotoNote({ text: `Added ${uploaded.length}. ${failed.length} failed — tap 📷 to retry.`, kind: "err" });
    } else if (failed.length) {
      setPhotoNote({ text: `Couldn't upload ${failed.length === 1 ? "that photo" : `those ${failed.length} photos`}: ${failed[0]}. Tap 📷 to retry.`, kind: "err" });
    } else {
      setPhotoNote({ text: `✓ ${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} added.`, kind: "ok" });
    }
    setUploading(false);
  }

  async function submit() {
    setErr(null);
    if (!f.title.trim() || !loc.city.trim() || !f.name.trim() || f.phone.replace(/\D/g, "").length < 8) {
      setErr("Property title, a location, your name and a valid phone are required.");
      return;
    }
    setSubmitting(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const details = {
        floor: f.floor, totalFloors: f.totalFloors, facing: f.facing, ageYears: f.ageYears,
        availableFrom: f.availableFrom, leaseType: f.leaseType, tenantPref: f.tenantPref,
        maintenanceMonthly: f.maintenanceMonthly, landmarks: f.landmarks,
        carpetArea: f.carpetArea, areaUnit: f.areaUnit, negotiable: f.negotiable,
      };
      const r = await fetch("/api/host/list-property", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          title: f.title, propertyType: f.propertyType, bhk: f.bhk, furnishing: f.furnishing,
          city: loc.city, locality: loc.locality, state: loc.state,
          lat: loc.lat, lng: loc.lng, formattedAddress: loc.formatted,
          areaSqft: Number(f.areaSqft) || undefined,
          rentMonthly: Number(f.rentMonthly) || undefined,
          deposit: Number(f.deposit) || undefined,
          amenities: amen, images, details,
          name: f.name, phone: f.phone, email: f.email, message: f.message,
        }),
      });
      const dj = await r.json();
      if (!r.ok || !dj.ok) { setErr(dj.error || "Could not submit. Try again."); return; }
      setDone(dj.id);
      // Reset the listing fields (keep contact for a quick second listing).
      setF((s) => ({ ...s, title: "", areaSqft: "", carpetArea: "", floor: "", totalFloors: "", facing: "", ageYears: "", availableFrom: "", rentMonthly: "", deposit: "", maintenanceMonthly: "", landmarks: "", message: "", negotiable: false }));
      setLoc(emptyLoc); setAmen([]); setImages([]);
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
          Add your property once — real location, photos, and full details. Our team reviews it,
          lists it to interested hosts, and helps you lock the best deal. No brokerage.
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

            <Group label="Property basics">
              <Field label="Property title *" full>
                <Input value={f.title} onChange={set("title")} placeholder="e.g. Sunlit 2BHK near MG Road" />
              </Field>
              <Field label="Property type"><Select value={f.propertyType} onChange={set("propertyType")} options={PROPERTY_TYPES} /></Field>
              <Field label="Configuration"><Select value={f.bhk} onChange={set("bhk")} options={BHK} /></Field>
              <Field label="Furnishing"><Select value={f.furnishing} onChange={set("furnishing")} options={FURNISHING} /></Field>
              <Field label="Built-up area">
                <div className="flex gap-2">
                  <Input value={f.areaSqft} onChange={set("areaSqft")} type="number" placeholder="1100" />
                  <div style={{ width: 96 }}><Select value={f.areaUnit} onChange={set("areaUnit")} options={AREA_UNITS} /></div>
                </div>
              </Field>
              <Field label="Carpet area (optional)"><Input value={f.carpetArea} onChange={set("carpetArea")} type="number" placeholder="e.g. 950" /></Field>
            </Group>

            <Group label="Location">
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium mb-1" style={{ color: "var(--text-soft)" }}>Search real location *</span>
                <HostLocationPicker value={loc} onChange={setLoc} />
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
                <Input value={f.landmarks} onChange={set("landmarks")} placeholder="e.g. 500m from metro, next to City Mall" />
              </Field>
            </Group>

            <Group label="Property details">
              <Field label="Floor (e.g. 3rd of 5)"><Input value={f.floor} onChange={set("floor")} placeholder="3rd" /></Field>
              <Field label="Total floors"><Input value={f.totalFloors} onChange={set("totalFloors")} type="number" placeholder="5" /></Field>
              <Field label="Facing"><Select value={f.facing} onChange={set("facing")} options={FACING} placeholderOption="Any" /></Field>
              <Field label="Age of property (years)"><Input value={f.ageYears} onChange={set("ageYears")} type="number" placeholder="4" /></Field>
              <Field label="Available from"><Input value={f.availableFrom} onChange={set("availableFrom")} type="date" /></Field>
              <Field label="Preferred tenant"><Select value={f.tenantPref} onChange={set("tenantPref")} options={TENANT_PREF} /></Field>
              <Field label="Lease type" full><Select value={f.leaseType} onChange={set("leaseType")} options={LEASE_TYPES} /></Field>
            </Group>

            <Group label="Pricing">
              <Field label="Expected rent / month (₹)"><Input value={f.rentMonthly} onChange={set("rentMonthly")} type="number" placeholder="45000" /></Field>
              <Field label="Deposit (₹)"><Input value={f.deposit} onChange={set("deposit")} type="number" placeholder="150000" /></Field>
              <Field label="Maintenance / month (₹)"><Input value={f.maintenanceMonthly} onChange={set("maintenanceMonthly")} type="number" placeholder="2500" /></Field>
              <Field label="Negotiable?">
                <button type="button" onClick={() => setF((s) => ({ ...s, negotiable: !s.negotiable }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm font-medium text-left"
                  style={{ background: f.negotiable ? "var(--accent-soft)" : "var(--bg-input)", color: f.negotiable ? "var(--accent)" : "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
                  {f.negotiable ? "✓ Price is negotiable" : "Tap if price is negotiable"}
                </button>
              </Field>
            </Group>

            <div className="mb-5">
              <div className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--text-muted)" }}>Amenities</div>
              <div className="flex flex-wrap gap-2">
                {AMENITIES.map((a) => (
                  <button key={a} type="button" onClick={() => toggleAmen(a)}
                    className="text-sm px-3 py-1.5 rounded-full"
                    style={amen.includes(a)
                      ? { background: "var(--accent)", color: "#fff" }
                      : { background: "var(--bg-input)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
                    {amen.includes(a) ? "✓ " : ""}{a}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <div className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--text-muted)" }}>Photos</div>
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
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>Up to 12 photos. You can add reels & videos after submitting.</p>
              {photoNote && (
                <p className="text-xs mt-1 font-medium" style={{ color: photoNote.kind === "err" ? "#b04242" : "var(--accent)" }}>
                  {photoNote.text}
                </p>
              )}
            </div>

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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
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

function Select({ value, onChange, options, placeholderOption }: { value: string; onChange: any; options: string[]; placeholderOption?: string }) {
  return (
    <select value={value} onChange={onChange}
      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
      style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}>
      {options.map((o) => <option key={o} value={o}>{o === "" ? (placeholderOption || "—") : o}</option>)}
    </select>
  );
}

function LocChip({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-soft)" }}>{children}</span>;
}
