"use client";

// v285 — Real location picker for the Host listing flow.
// Type a city / locality / address → real suggestions (Google when a key is
// configured, else OpenStreetMap). Pick one → lat/lng + a live map preview +
// an "Open in Google Maps" link (real Google, needs no key).

import { useEffect, useRef, useState } from "react";

export interface HostLocationValue {
  city: string;
  locality: string;
  state: string;
  formatted: string;
  lat: number | null;
  lng: number | null;
  pincode?: string;
}

interface Suggestion {
  label: string; formatted: string; city: string; locality: string;
  state: string; country: string; pincode: string; lat: number; lng: number;
}

const GOOGLE_EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

function mapEmbedSrc(lat: number, lng: number): string {
  if (GOOGLE_EMBED_KEY) {
    return `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_EMBED_KEY}&q=${lat},${lng}&zoom=15`;
  }
  const d = 0.008;
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}
const googleMapsLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export default function HostLocationPicker({
  value, onChange, nameHint,
}: {
  value: HostLocationValue;
  onChange: (v: HostLocationValue) => void;
  /** Property name/title — enables a one-tap "Find by name" that resolves the
   *  real pin from Google/OSM if the property is listed there. */
  nameHint?: string;
}) {
  const [q, setQ] = useState(value.formatted || "");
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const timer = useRef<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function runSearch(term: string) {
    if (timer.current) clearTimeout(timer.current);
    if (term.trim().length < 2) { setSugs([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/host/geo?q=${encodeURIComponent(term)}`);
        const d = await r.json();
        setSugs(Array.isArray(d.places) ? d.places : []);
        setOpen(true);
      } catch { setSugs([]); }
      finally { setLoading(false); }
    }, 350);
  }

  function pick(s: Suggestion) {
    onChange({
      city: s.city, locality: s.locality, state: s.state,
      formatted: s.formatted, lat: s.lat, lng: s.lng, pincode: s.pincode,
    });
    setQ(s.formatted);
    setOpen(false);
    setSugs([]);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const r = await fetch(`/api/host/geo?lat=${latitude}&lng=${longitude}`);
        const d = await r.json();
        const p = d.place;
        if (p) {
          onChange({ city: p.city, locality: p.locality, state: p.state, formatted: p.formatted, lat: p.lat, lng: p.lng, pincode: p.pincode });
          setQ(p.formatted);
        }
      } catch { /* ignore */ }
      finally { setLocating(false); }
    }, () => setLocating(false), { enableHighAccuracy: true, timeout: 10000 });
  }

  const hasCoords = value.lat != null && value.lng != null;
  const hint = (nameHint || "").trim();

  function findByName() {
    if (hint.length < 2) return;
    setQ(hint);
    setOpen(true);
    runSearch(hint);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); runSearch(e.target.value); }}
            onFocus={() => sugs.length && setOpen(true)}
            placeholder="Property name, address or area…"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-muted)" }}>…</span>
          )}
        </div>
        <button type="button" onClick={useMyLocation} disabled={locating}
          className="shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium sb-card-lift"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          {locating ? "…" : "📍 Me"}
        </button>
      </div>
      {hint.length >= 2 && (
        <button type="button" onClick={findByName}
          className="mt-2 text-xs font-semibold px-2.5 py-1 rounded-full sb-card-lift"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          🔎 Find "{hint.length > 32 ? hint.slice(0, 32) + "…" : hint}" on the map
        </button>
      )}

      {open && sugs.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl overflow-hidden shadow-lg"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
          {sugs.map((s, i) => (
            <button key={i} type="button" onClick={() => pick(s)}
              className="w-full text-left px-3 py-2.5 text-sm hover:opacity-80"
              style={{ color: "var(--text-base)", borderBottom: i < sugs.length - 1 ? "1px solid var(--border-soft)" : "none" }}>
              <div className="font-medium">📍 {s.label || s.city}</div>
              <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{s.formatted}</div>
            </button>
          ))}
        </div>
      )}

      {hasCoords && (
        <div className="mt-3 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-soft)" }}>
          <iframe
            title="Property location"
            src={mapEmbedSrc(value.lat as number, value.lng as number)}
            className="w-full block"
            style={{ height: 190, border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: "var(--bg-card)" }}>
            <div className="text-xs truncate" style={{ color: "var(--text-soft)" }}>
              {value.formatted || `${value.lat?.toFixed(5)}, ${value.lng?.toFixed(5)}`}
            </div>
            <a href={googleMapsLink(value.lat as number, value.lng as number)} target="_blank" rel="noopener noreferrer"
              className="shrink-0 text-xs font-semibold whitespace-nowrap" style={{ color: "var(--accent)" }}>
              Open in Google Maps ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
