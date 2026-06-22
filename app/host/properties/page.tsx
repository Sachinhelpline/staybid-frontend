"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Prop {
  id: string; title: string; city?: string; locality?: string; state?: string;
  property_type?: string; bhk?: string; area_sqft?: number; furnishing?: string;
  rent_monthly?: number; deposit?: number; score?: number;
  images?: string[]; amenities?: string[]; source?: string; featured?: boolean;
}

const inr = (n?: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const SRC_LABEL: Record<string, string> = { owner: "Direct owner", broker: "Broker", agent: "Agent", platform: "StayBid verified" };

export default function HostProperties() {
  const [props, setProps] = useState<Prop[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [city, setCity] = useState("all");
  const [maxRent, setMaxRent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [shortlist, setShortlist] = useState<Record<string, boolean>>({});
  const [enquire, setEnquire] = useState<Prop | null>(null);

  useEffect(() => {
    fetch("/api/host/properties")
      .then((r) => r.json())
      .then((d) => { setProps(d.properties || []); setCities(d.cities || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const rentBands = [
    { label: "Any budget", v: 0 },
    { label: "≤ ₹30k", v: 30000 },
    { label: "≤ ₹50k", v: 50000 },
    { label: "≤ ₹1L", v: 100000 },
  ];

  const shown = useMemo(() => props.filter((p) =>
    (city === "all" || p.city === city) &&
    (maxRent === 0 || (p.rent_monthly || 0) <= maxRent),
  ), [props, city, maxRent]);

  const shortlistCount = Object.values(shortlist).filter(Boolean).length;

  return (
    <div className="hostos-discovery">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-5 sb-fade-in">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mt-3 mb-3"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🔍 Smart Property Discovery</span>
        <h1 className="font-display leading-tight" style={{ fontSize: "clamp(1.9rem,5vw,3rem)", color: "var(--text-base)" }}>
          Find the perfect BnB property. <span style={{ color: "var(--accent)" }}>Compare. Shortlist. Rent.</span>
        </h1>
        <p className="mt-3 max-w-2xl" style={{ color: "var(--text-soft)" }}>
          Hand-picked, scored properties across metros — direct from owners, no brokerage.
          We help you lock the best one at the best price.
        </p>
      </section>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3 sticky top-0 z-20" style={{ background: "var(--bg-page)" }}>
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
          <Chip active={city === "all"} onClick={() => setCity("all")}>📍 All cities</Chip>
          {cities.map((c) => <Chip key={c} active={city === c} onClick={() => setCity(c)}>{c}</Chip>)}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {rentBands.map((b) => <Chip key={b.v} active={maxRent === b.v} onClick={() => setMaxRent(b.v)}>{b.label}</Chip>)}
        </div>
      </div>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-28">
        {loading ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>Finding properties…</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>No properties match these filters.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sb-stagger">
            {shown.map((p) => (
              <PropertyCard key={p.id} p={p}
                shortlisted={!!shortlist[p.id]}
                onShortlist={() => setShortlist((s) => ({ ...s, [p.id]: !s[p.id] }))}
                onEnquire={() => setEnquire(p)} />
            ))}
          </div>
        )}
      </section>

      {shortlistCount > 0 && !enquire && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 sb-fade-in">
          <div className="px-5 py-2.5 rounded-full font-semibold text-sm shadow-lg flex items-center gap-2"
            style={{ background: "var(--bg-card)", color: "var(--text-base)", border: "1px solid var(--accent)" }}>
            ❤️ {shortlistCount} shortlisted
          </div>
        </div>
      )}

      {enquire && <InquirySheet prop={enquire} onClose={() => setEnquire(null)} />}

      <style jsx global>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}`}</style>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="whitespace-nowrap text-sm font-medium px-4 py-2 rounded-full sb-card-lift"
      style={active
        ? { background: "var(--accent)", color: "#fff" }
        : { background: "var(--bg-card)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
      {children}
    </button>
  );
}

function PropertyCard({ p, shortlisted, onShortlist, onEnquire }: {
  p: Prop; shortlisted: boolean; onShortlist: () => void; onEnquire: () => void;
}) {
  const img = p.images?.[0];
  return (
    <div className="sb-card-lift h-full rounded-2xl overflow-hidden flex flex-col"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="relative aspect-[16/10]" style={{ background: "var(--bg-input)" }}>
        {img && <img src={img} alt={p.title} loading="lazy" className="w-full h-full object-cover" />}
        {p.score != null && (
          <span className="absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full text-white"
            style={{ background: "rgba(31,26,15,0.78)" }}>⭐ {p.score}/100</span>
        )}
        <button onClick={onShortlist}
          className="absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center text-lg"
          style={{ background: "rgba(255,255,255,0.92)" }} aria-label="Shortlist">
          {shortlisted ? "❤️" : "🤍"}
        </button>
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold leading-snug" style={{ color: "var(--text-base)" }}>{p.title}</div>
        </div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          📍 {p.locality ? `${p.locality}, ` : ""}{p.city}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {p.bhk && <Tag>{p.bhk}</Tag>}
          {p.area_sqft != null && <Tag>{p.area_sqft} sqft</Tag>}
          {p.furnishing && <Tag>{p.furnishing}</Tag>}
          {p.property_type && <Tag>{p.property_type}</Tag>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {(p.amenities || []).slice(0, 4).map((a) => (
            <span key={a} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{a}</span>
          ))}
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="font-display text-xl" style={{ color: "var(--accent)" }}>{inr(p.rent_monthly)}<span className="text-xs" style={{ color: "var(--text-muted)" }}>/mo</span></div>
            {p.deposit != null && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Deposit {inr(p.deposit)}</div>}
          </div>
          {p.source && (
            <span className="text-[10px] font-medium px-2 py-1 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-soft)" }}>
              {SRC_LABEL[p.source] || p.source}
            </span>
          )}
        </div>
        <button onClick={onEnquire}
          className="mt-3 w-full px-4 py-2.5 rounded-full text-white font-semibold text-sm"
          style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>Enquire / Schedule visit</button>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-soft)" }}>{children}</span>;
}

function InquirySheet({ prop, onClose }: { prop: Prop; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 8) { setErr("Enter a valid name & phone."); setState("error"); return; }
    setState("sending"); setErr("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/properties/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ propertyId: prop.id, name, phone, message: msg }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Could not send.");
      setState("done");
    } catch (e: any) { setErr(e?.message || "Something went wrong."); setState("error"); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 sm:p-6"
        style={{ background: "var(--bg-card)", color: "var(--text-base)", boxShadow: "var(--shadow-card)" }}
        onClick={(e) => e.stopPropagation()}>
        {state === "done" ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-display text-2xl">Inquiry sent!</div>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              Our team will reach out to schedule a visit for <b>{prop.title}</b>.
            </p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-full text-white font-semibold"
              style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <div className="font-display text-xl">Enquire about this property</div>
              <button onClick={onClose} className="text-xl px-2" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
            <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
              {prop.title} · {prop.locality ? `${prop.locality}, ` : ""}{prop.city} · {inr(prop.rent_monthly)}/mo
            </div>
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="When would you like to visit? (optional)" rows={2} className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
            </div>
            {state === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>{err}</div>}
            <button onClick={submit} disabled={state === "sending"}
              className="w-full mt-4 px-6 py-3 rounded-full text-white font-semibold disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>
              {state === "sending" ? "Sending…" : "Send inquiry"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-base)",
};
