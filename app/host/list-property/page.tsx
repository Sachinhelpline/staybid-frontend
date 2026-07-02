"use client";

// ============================================================================
// List My Property for lease/rent (sourcing side — Concept A).
// A property OWNER offers their property TO StayBid to be leased/rented/managed.
// Distinct from /onboard (Concept B — a hotel partner runs their OWN property
// live on StayBid). Submissions land in discovery_properties status='pending_review'
// and appear in the public /host/properties feed only after admin approval.
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";

interface Submission {
  id: string; title: string; city?: string; property_type?: string;
  rent_monthly?: number; status: string; created_at: string;
}

const PROPERTY_TYPES = ["Apartment", "Villa", "Independent House", "Builder Floor", "Studio", "Farmhouse", "Cottage", "Bungalow", "Other"];
const BHK = ["1RK", "1BHK", "2BHK", "3BHK", "4BHK", "5BHK+"];
const FURNISHING = ["Unfurnished", "Semi-furnished", "Fully furnished"];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_review: { label: "Under review", color: "#8a6d1a", bg: "rgba(201,145,26,0.14)" },
  available: { label: "Live · listed", color: "#2f7a3f", bg: "rgba(47,122,63,0.14)" },
  shortlisted: { label: "Shortlisted", color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  rented: { label: "Rented", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
  rejected: { label: "Not accepted", color: "#b04242", bg: "rgba(176,66,66,0.12)" },
  inactive: { label: "Inactive", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
};

const inr = (n?: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

export default function ListPropertyPage() {
  const [f, setF] = useState({
    title: "", propertyType: "Apartment", bhk: "2BHK", city: "", locality: "", state: "",
    areaSqft: "", furnishing: "Semi-furnished", rentMonthly: "", deposit: "",
    amenities: "", name: "", phone: "", email: "", message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<Submission[]>([]);

  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));

  const loadMine = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    if (!token) return;
    fetch("/api/host/list-property", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setMine(d.submissions || []))
      .catch(() => {});
  };
  useEffect(loadMine, [done]);

  async function submit() {
    setErr(null);
    if (!f.title.trim() || !f.city.trim() || !f.name.trim() || f.phone.replace(/\D/g, "").length < 8) {
      setErr("Property title, city, your name and a valid phone are required.");
      return;
    }
    setSubmitting(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/list-property", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          ...f,
          areaSqft: Number(f.areaSqft) || undefined,
          rentMonthly: Number(f.rentMonthly) || undefined,
          deposit: Number(f.deposit) || undefined,
          amenities: f.amenities.split(",").map((x) => x.trim()).filter(Boolean),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setErr(d.error || "Could not submit. Try again."); return; }
      setDone(d.id);
      setF((s) => ({ ...s, title: "", locality: "", areaSqft: "", rentMonthly: "", deposit: "", amenities: "", message: "" }));
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
          Have a property you want leased or rented out? Submit the details — our team reviews it,
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
              Our team will review your listing and reach out on your phone. You'll see it go live in the
              discovery feed once approved.
            </p>
            <div className="mt-5 flex gap-3 justify-center flex-wrap">
              <button onClick={() => setDone(null)} className="sb-card-lift px-5 py-2.5 rounded-full font-semibold"
                style={{ background: "var(--accent)", color: "#fff" }}>List another property</button>
              <Link href="/host/properties" className="sb-card-lift px-5 py-2.5 rounded-full font-semibold"
                style={{ background: "var(--bg-input)", color: "var(--text-base)", border: "1px solid var(--border-soft)" }}>
                Browse the discovery feed →
              </Link>
            </div>
          </div>
          {mine.length > 0 && <MySubmissions rows={mine} />}
        </section>
      ) : (
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-28">
          <div className="rounded-2xl p-5 sm:p-7 sb-fade-in"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
            <Group label="Property details">
              <Field label="Property title *" full>
                <Input value={f.title} onChange={set("title")} placeholder="e.g. Sunlit 2BHK near MG Road" />
              </Field>
              <Field label="Property type">
                <Select value={f.propertyType} onChange={set("propertyType")} options={PROPERTY_TYPES} />
              </Field>
              <Field label="Configuration">
                <Select value={f.bhk} onChange={set("bhk")} options={BHK} />
              </Field>
              <Field label="City *"><Input value={f.city} onChange={set("city")} placeholder="e.g. Bengaluru" /></Field>
              <Field label="Locality"><Input value={f.locality} onChange={set("locality")} placeholder="e.g. Indiranagar" /></Field>
              <Field label="State"><Input value={f.state} onChange={set("state")} placeholder="e.g. Karnataka" /></Field>
              <Field label="Area (sq ft)"><Input value={f.areaSqft} onChange={set("areaSqft")} type="number" placeholder="e.g. 1100" /></Field>
              <Field label="Furnishing"><Select value={f.furnishing} onChange={set("furnishing")} options={FURNISHING} /></Field>
            </Group>

            <Group label="Pricing (optional — helps us match faster)">
              <Field label="Expected rent / month (₹)"><Input value={f.rentMonthly} onChange={set("rentMonthly")} type="number" placeholder="e.g. 45000" /></Field>
              <Field label="Deposit (₹)"><Input value={f.deposit} onChange={set("deposit")} type="number" placeholder="e.g. 150000" /></Field>
              <Field label="Amenities (comma separated)" full>
                <Input value={f.amenities} onChange={set("amenities")} placeholder="Parking, Lift, Power backup, Balcony" />
              </Field>
            </Group>

            <Group label="Your contact">
              <Field label="Your name *"><Input value={f.name} onChange={set("name")} placeholder="Full name" /></Field>
              <Field label="Phone *"><Input value={f.phone} onChange={set("phone")} placeholder="10-digit mobile" /></Field>
              <Field label="Email"><Input value={f.email} onChange={set("email")} type="email" placeholder="you@email.com" /></Field>
              <Field label="Anything else?" full>
                <textarea value={f.message} onChange={set("message")} rows={3}
                  placeholder="Availability, preferred lease term, special notes…"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
              </Field>
            </Group>

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
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                style={{ color: m.color, background: m.bg }}>{m.label}</span>
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

function Select({ value, onChange, options }: { value: string; onChange: any; options: string[] }) {
  return (
    <select value={value} onChange={onChange}
      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
      style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
