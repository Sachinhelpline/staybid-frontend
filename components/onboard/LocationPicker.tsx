"use client";

import { useEffect, useRef, useState } from "react";
import { onbFetch } from "@/lib/onboard/client";

// Real geotag location selector for the onboarding wizard.
//
// Replaces the old free-text "City" field. The owner picks their property's
// location two real ways — both return verified coordinates:
//   1. 📍 "Use my current location" → device GPS → reverse-geocoded place
//   2. 🔍 type a locality → forward-geocoded real matches → tap one
//
// On a pick it emits a full PickedLocation { city, state, country, lat, lng,
// area, label } so the wizard fills city + state + lat/lng in ONE step (no
// separate manual lat/lng entry), and the Express AI search can location-filter
// on the real coordinates. Honest by design: if Nominatim is unreachable it
// shows a "type your city" fallback and never fabricates a place.

export type PickedLocation = {
  label: string;
  city: string;
  area: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
};

export default function LocationPicker({
  value,
  onPick,
  onClear,
  disabled,
}: {
  value: PickedLocation | null;
  onPick: (loc: PickedLocation) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedLocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState<"idle" | "locating" | "denied" | "error">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const debRef = useRef<any>(null);

  // Forward geocode (debounced) as the owner types a locality.
  useEffect(() => {
    clearTimeout(debRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    debRef.current = setTimeout(async () => {
      setBusy(true);
      try {
        const j = await onbFetch<any>(`/api/onboard/geocode?q=${encodeURIComponent(q)}`);
        setResults(Array.isArray(j.results) ? j.results : []);
        setHint(j.available === false ? "Place lookup unavailable — type your city name, then continue." : null);
      } catch {
        setResults([]);
        setHint("Place lookup unavailable — type your city name, then continue.");
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => clearTimeout(debRef.current);
  }, [query]);

  // Real device geotag → reverse geocode.
  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) { setGeo("error"); setHint("This device can't share location — search your city instead."); return; }
    setGeo("locating"); setHint(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          const j = await onbFetch<any>(`/api/onboard/geocode?lat=${lat}&lng=${lng}`);
          if (j?.place && (j.place.city || j.place.area)) {
            setGeo("idle"); setQuery(""); setResults([]);
            onPick(j.place as PickedLocation);
          } else {
            // We still have real coordinates — capture them even if the name
            // lookup came back thin (better than losing the geotag).
            setGeo("idle"); setQuery(""); setResults([]);
            onPick({ label: `My location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, city: "", area: "", state: "", country: "India", lat, lng });
            setHint("Captured your coordinates — add the city/state name below if needed.");
          }
        } catch {
          setGeo("error"); setHint("Couldn't read that location — search your city instead.");
        }
      },
      (err) => {
        setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        setHint(err.code === err.PERMISSION_DENIED
          ? "Location permission denied — search your city below instead."
          : "Couldn't get your location — search your city below instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  // Confirmed state — show the captured geotag with a "change" affordance.
  if (value) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none mt-0.5">📍</span>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-widest text-emerald-700 font-medium">Location confirmed</div>
            <div className="font-medium text-luxury-900 truncate">
              {[value.area, value.city].filter(Boolean).join(", ") || value.label}
            </div>
            <div className="text-xs text-luxury-500">
              {value.state ? `${value.state} · ` : ""}{value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </div>
          </div>
          {!disabled && (
            <button type="button" onClick={() => onClear?.()}
              className="text-xs px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-800 hover:bg-emerald-100 whitespace-nowrap">
              Change
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className="input-luxury flex-1"
          placeholder="Property location — type a city / locality"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={disabled || geo === "locating"}
          title="Use my current location"
          className="shrink-0 px-3 rounded-xl border border-gold-300 bg-white text-gold-800 hover:bg-gold-50 disabled:opacity-50 text-sm font-medium whitespace-nowrap"
        >
          {geo === "locating" ? "Locating…" : "📍 Use my location"}
        </button>
      </div>

      {results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white rounded-2xl shadow-xl border border-luxury-100 overflow-hidden">
          {results.map((p, i) => (
            <button
              key={`${p.lat},${p.lng},${i}`}
              type="button"
              onClick={() => { setQuery(""); setResults([]); onPick(p); }}
              className="w-full text-left px-4 py-2.5 hover:bg-gold-50 transition border-b border-luxury-50 last:border-0"
            >
              <div className="font-medium text-luxury-900">
                {[p.area, p.city].filter(Boolean).join(", ") || p.label}
              </div>
              <div className="text-xs text-luxury-500 truncate">{p.label}</div>
            </button>
          ))}
        </div>
      )}

      {busy && <div className="text-xs text-luxury-500 mt-1.5">Finding locations…</div>}
      {hint && !busy && <div className="text-xs text-luxury-500 mt-1.5">{hint}</div>}
    </div>
  );
}
