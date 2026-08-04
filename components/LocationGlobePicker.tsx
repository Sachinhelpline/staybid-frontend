"use client";
/* ──────────────────────────────────────────────────────────────────────
   LocationGlobePicker — premium animated globe + city wheel modal.

   Single source of truth for the app's "where am I shopping" filter:
     • Writes  `sb_city` to localStorage on pick
     • Fires   `sb:city-change` window event
     • Reads   geolocation via Nominatim reverse-geocode

   v519 upgrade (high-tech, real data only — no external map):
     • GPS "Use my live location" now SORTS every city by real distance
       (haversine over city coords) and floats the nearest into a
       "📍 Nearby you" group — the actual point of a location picker.
     • The flat wall is grouped: Nearby → Trending this month (demand
       cycle) → All destinations. Real region/state meta + real city icon
       replace the fake "live deals available" line.
     • Per-city REAL supply ("24 stays · from ₹1,200") from /api/cities/stats.
     • Recent cities remembered (last 3) as one-tap chips.
     • Search matches city / state / region / hub, not just the name.

   Used by:
     • <LocationChip /> in components/Navbar.tsx (top-nav globe pill)
     • <FilterSheet /> in components/discover/InstagramHotelFeed.tsx (reels)

   The modal portals to `document.body` so it escapes any parent that has
   `backdrop-filter` or `transform` (those create a containing block that
   traps `position: fixed` children — was the original "modal trapped in
   navbar" bug).
   ────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
// v392 — single canonical city list (hill-stations + 12-month demand-cycle hubs).
import { CITY_DISPLAY_ORDER, CITY_ICON, cityMeta } from "@/lib/cities";
import { currentMonthDemand } from "@/lib/circle/demand-cycle";

export const LOCATION_CITIES = CITY_DISPLAY_ORDER;

// Pure haversine (km) — inlined so the modal pulls no heavy deps.
function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type CityStat = { count: number; from: number };

export function LocationGlobeModal({ activeCity, onClose }: {
  activeCity: string;
  onClose: () => void;
}) {
  const [search, setSearch]     = useState("");
  const [detected, setDetected] = useState<{ city?: string; area?: string; lat?: number; lng?: number } | null>(null);
  const [coords, setCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus]     = useState<"idle" | "locating" | "denied" | "located">("idle");
  const [loading, setLoading]   = useState(false);
  const [mounted, setMounted]   = useState(false);
  const [stats, setStats]       = useState<Record<string, CityStat>>({});
  const [recent, setRecent]     = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("sb-modal-open");
    // Recent cities (last 3 picked).
    try {
      const raw = localStorage.getItem("sb_city_recent");
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setRecent(arr.filter((x) => typeof x === "string" && x).slice(0, 3));
    } catch {}
    // Real per-city supply (count + from-price). Best-effort — a failure just
    // falls back to region/state meta.
    let alive = true;
    fetch("/api/cities/stats")
      .then((r) => r.json())
      .then((d) => { if (alive && d?.stats) setStats(d.stats); })
      .catch(() => {});
    return () => {
      alive = false;
      document.body.style.overflow = old;
      document.body.classList.remove("sb-modal-open");
    };
  }, []);

  const setAndBroadcast = (c: string) => {
    try { localStorage.setItem("sb_city", c); } catch {}
    window.dispatchEvent(new Event("sb:city-change"));
  };

  const pushRecent = (c: string) => {
    if (!c) return; // "Show me all" (empty) is never a "recent city"
    try {
      const raw = localStorage.getItem("sb_city_recent");
      const arr: string[] = raw ? JSON.parse(raw) : [];
      const next = [c, ...arr.filter((x) => x !== c)].slice(0, 3);
      localStorage.setItem("sb_city_recent", JSON.stringify(next));
    } catch {}
  };

  const detect = () => {
    if (!navigator.geolocation) { setStatus("denied"); return; }
    setStatus("locating"); setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Store coords first — nearby-sort works even if reverse-geocode fails.
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&zoom=10`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = await res.json();
          const detCity =
            data.address?.city || data.address?.town || data.address?.village ||
            data.address?.county || data.address?.state_district || data.address?.state || "";
          const detArea =
            data.address?.suburb || data.address?.neighbourhood || data.address?.county || "";
          setDetected({ city: detCity, area: detArea, lat: pos.coords.latitude, lng: pos.coords.longitude });
          const match = LOCATION_CITIES.find(c => detCity.toLowerCase().includes(c.toLowerCase()));
          if (match) { setAndBroadcast(match); pushRecent(match); setStatus("idle"); onClose(); }
          else { setStatus("located"); } // stay open — the Nearby group is now sorted for them
        } catch { setStatus("located"); }
        finally { setLoading(false); }
      },
      () => { setStatus("denied"); setLoading(false); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  const trimmed = search.trim().toLowerCase();

  // Smarter search — city / state / region / hub label.
  const matchCity = (k: string) => {
    if (!trimmed) return true;
    const m = cityMeta(k);
    return (
      k.toLowerCase().includes(trimmed) ||
      (m?.name || "").toLowerCase().includes(trimmed) ||
      (m?.state || "").toLowerCase().includes(trimmed) ||
      (m?.region || "").toLowerCase().includes(trimmed) ||
      (m?.hubLabel || "").toLowerCase().includes(trimmed)
    );
  };

  const dist = (k: string): number | null => {
    const m = cityMeta(k);
    if (!coords || !m) return null;
    return distKm(coords.lat, coords.lng, m.lat, m.lng);
  };

  // Grouped view (no active search).
  const { nearby, trending, rest } = useMemo(() => {
    if (trimmed) return { nearby: [] as string[], trending: [] as string[], rest: [] as string[] };
    const all = CITY_DISPLAY_ORDER.filter((k) => cityMeta(k));
    const near = coords
      ? [...all].sort((a, b) => (dist(a) ?? 9e9) - (dist(b) ?? 9e9)).slice(0, 5)
      : [];
    const nearSet = new Set(near);
    let trend: string[] = [];
    try {
      const d = currentMonthDemand();
      trend = [...(d.primary || []), ...(d.secondary || [])]
        .filter((k) => all.includes(k) && !nearSet.has(k));
      trend = Array.from(new Set(trend)).slice(0, 6);
    } catch { trend = []; }
    const used = new Set([...near, ...trend]);
    const others = all.filter((k) => !used.has(k));
    return { nearby: near, trending: trend, rest: others };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, coords, stats]);

  const results = trimmed ? CITY_DISPLAY_ORDER.filter(matchCity) : [];
  const customMatch = trimmed && !results.some((c) => c.toLowerCase() === trimmed);

  const pick = (c: string) => { setAndBroadcast(c); pushRecent(c); onClose(); };

  // Row meta — REAL supply if we have it, else geography. No fake copy.
  const metaLine = (k: string): string => {
    const s = stats[k.toLowerCase()];
    const parts: string[] = [];
    if (s?.count) parts.push(`${s.count} stay${s.count === 1 ? "" : "s"}`);
    if (s?.from) parts.push(`from ${inr(s.from)}`);
    if (parts.length === 0) {
      const m = cityMeta(k);
      const geo = [m?.state, m?.region].filter(Boolean).join(" · ");
      if (geo) parts.push(geo);
    }
    return parts.join(" · ") || "Explore stays";
  };

  const cityIcon = (k: string) => CITY_ICON[k] || "📍";

  const Row = (k: string) => {
    const d = dist(k);
    return (
      <button
        key={k}
        className={`loc-row ${activeCity === k ? "active" : ""}`}
        onClick={() => pick(k)}
      >
        <span className="loc-row-emoji">{cityIcon(k)}</span>
        <div className="loc-row-text">
          <div className="loc-row-name">{cityMeta(k)?.name || k}</div>
          <div className="loc-row-meta">{metaLine(k)}</div>
        </div>
        {d != null && (
          <span className="loc-dist-badge">{d < 1 ? "<1" : Math.round(d)} km</span>
        )}
        <span className="loc-row-arrow">›</span>
      </button>
    );
  };

  if (!mounted) return null;

  const demandMonth = (() => { try { return currentMonthDemand().long; } catch { return ""; } })();

  return createPortal(
    <>
      <style>{`
        @keyframes locModalIn {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes locFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes locGlobeSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes locGlobeWobble { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-3px) rotate(2deg); } }
        @keyframes locOrbit { 0% { transform: rotate(0deg) translateX(46px) rotate(0deg); } 100% { transform: rotate(360deg) translateX(46px) rotate(-360deg); } }
        @keyframes locOrbit2 { 0% { transform: rotate(180deg) translateX(58px) rotate(-180deg); } 100% { transform: rotate(-180deg) translateX(58px) rotate(180deg); } }
        @keyframes locShine { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes locPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(140, 160, 182,0.5); } 50% { box-shadow: 0 0 0 16px rgba(140, 160, 182,0); } }
        @keyframes locDot { 0% { box-shadow: 0 0 0 0 rgba(46,204,113,0.5); } 70% { box-shadow: 0 0 0 10px rgba(46,204,113,0); } 100% { box-shadow: 0 0 0 0 rgba(46,204,113,0); } }
        @keyframes locShimmer { 0% { background-position: 250% 0; } 100% { background-position: -250% 0; } }

        .loc-bg {
          position: fixed; inset: 0; z-index: 9999;
          background: rgba(5,4,12,0.78);
          backdrop-filter: blur(10px);
          display: flex; align-items: flex-start; justify-content: center;
          padding: 30px 16px;
          animation: locFadeIn 0.25s ease both;
          overflow-y: auto;
        }
        @media (max-width: 540px) { .loc-bg { align-items: flex-end; padding: 0; } }
        .loc-card {
          position: relative;
          width: 100%; max-width: 460px;
          background: radial-gradient(circle at 50% -20%, rgba(140, 160, 182,0.16), transparent 55%), var(--bg-card);
          border: 1px solid var(--border-soft);
          border-radius: 24px;
          overflow: hidden;
          box-shadow: var(--shadow-card, 0 30px 80px rgba(0,0,0,0.4)), inset 0 1px 0 rgba(255,255,255,0.05);
          animation: locModalIn 0.4s cubic-bezier(.2,.7,.2,1) both;
          color: var(--text-base);
        }
        @media (max-width: 540px) { .loc-card { max-width: none; border-radius: 24px 24px 0 0; margin-top: auto; } }
        .loc-x {
          position: absolute; top: 14px; right: 14px; z-index: 4;
          width: 32px; height: 32px; border-radius: 50%;
          background: var(--bg-pill);
          border: 1px solid var(--border-soft);
          color: var(--text-base); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.25s ease;
        }
        .loc-x:hover { background: var(--bg-input); transform: rotate(90deg); }

        .loc-globe-stage {
          position: relative;
          height: 180px;
          display: flex; align-items: center; justify-content: center;
          background: radial-gradient(ellipse at center, rgba(140, 160, 182,0.06), transparent 60%);
        }
        .loc-globe-rings {
          position: absolute; inset: 0;
          background-image:
            radial-gradient(circle at 50% 50%, rgba(140, 160, 182,0.18) 0, transparent 1px),
            radial-gradient(circle at 50% 50%, rgba(140, 160, 182,0.12) 0, transparent 1px);
          background-size: 22px 22px, 44px 44px;
          mask-image: radial-gradient(circle at center, black 0%, transparent 70%);
          -webkit-mask-image: radial-gradient(circle at center, black 0%, transparent 70%);
          opacity: 0.5;
        }
        .loc-globe-wrap { position: relative; width: 130px; height: 130px; animation: locGlobeWobble 5.5s ease-in-out infinite; }
        .loc-globe {
          width: 100%; height: 100%;
          border-radius: 50%;
          background:
            radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 38%),
            conic-gradient(from 0deg, #1c3a5c 0deg, #2a5a8a 30deg, #1c3a5c 60deg, #2c4a72 90deg, #1c3a5c 120deg, #244268 160deg, #1c3a5c 200deg, #2a5a8a 240deg, #1c3a5c 280deg, #2c4a72 320deg, #1c3a5c 360deg);
          box-shadow: inset -8px -8px 24px rgba(0,0,0,0.5), inset 6px 6px 16px rgba(140, 160, 182,0.15), 0 0 40px rgba(140, 160, 182,0.25), 0 8px 30px rgba(0,0,0,0.6);
          position: relative;
          overflow: hidden;
          animation: locGlobeSpin 20s linear infinite;
        }
        .loc-globe::after {
          content: "";
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse 30% 14% at 30% 35%, rgba(46,204,113,0.55), transparent 70%),
            radial-gradient(ellipse 18% 22% at 65% 55%, rgba(46,204,113,0.45), transparent 70%),
            radial-gradient(ellipse 22% 12% at 50% 78%, rgba(46,204,113,0.4), transparent 70%),
            radial-gradient(ellipse 10% 14% at 78% 30%, rgba(46,204,113,0.4), transparent 70%);
        }
        .loc-globe-shine {
          position: absolute; inset: 0;
          background: linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.16) 50%, transparent 60%);
          background-size: 250% 100%;
          animation: locShimmer 4s linear infinite;
          border-radius: 50%; pointer-events: none;
        }
        .loc-orbit-dot {
          position: absolute; top: 50%; left: 50%;
          width: 10px; height: 10px;
          margin: -5px 0 0 -5px;
          background: linear-gradient(135deg, #c6d0da, #a9b9c8);
          border-radius: 50%;
          box-shadow: 0 0 12px #a9b9c8;
          animation: locOrbit 6s linear infinite;
        }
        .loc-orbit-dot.two { background: linear-gradient(135deg, #ff7088, #ff3859); box-shadow: 0 0 12px #ff3859; animation: locOrbit2 9s linear infinite; width: 8px; height: 8px; }
        .loc-globe-label {
          position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
          padding: 4px 12px;
          background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
          border: 1px solid rgba(140, 160, 182,0.35);
          border-radius: 999px;
          font-size: 0.63rem; font-weight: 700;
          letter-spacing: 0.16em; text-transform: uppercase;
          color: #cdd6df;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .loc-globe-label .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #2ecc71; animation: locDot 1.6s infinite; }

        .loc-hero { position: relative; padding: 0 22px 14px; text-align: center; }
        .loc-eyebrow { color: var(--text-soft); font-size: 0.63rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 6px; }
        .loc-active {
          font-family: 'Cormorant Garamond', 'Syne', serif;
          font-weight: 500; font-style: italic; font-size: 1.5rem;
          color: var(--text-base);
          margin: 0;
        }
        .loc-active-sub { color: var(--text-soft); font-size: 0.72rem; margin: 2px 0 0; }

        .loc-detect {
          margin: 4px 22px 16px;
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px;
          background: linear-gradient(135deg, rgba(46,204,113,0.14), rgba(46,204,113,0.04));
          border: 1px solid rgba(46,204,113,0.3);
          border-radius: 16px;
          color: #fff; text-align: left;
          cursor: pointer;
          transition: all 0.22s ease;
          width: calc(100% - 44px);
        }
        .loc-detect:hover { transform: translateY(-1px); border-color: rgba(46,204,113,0.55); }
        .loc-detect.locating { border-color: rgba(140, 160, 182,0.5); animation: locPulse 1.6s infinite; }
        .loc-detect.located { border-color: rgba(140, 160, 182,0.5); background: linear-gradient(135deg, rgba(140, 160, 182,0.16), rgba(140, 160, 182,0.04)); }
        .loc-detect-icon {
          width: 38px; height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2ecc71, #20a05a);
          display: flex; align-items: center; justify-content: center;
          color: #051a0e; font-size: 1.1rem; font-weight: 800;
          flex-shrink: 0;
          box-shadow: 0 6px 18px rgba(46,204,113,0.35);
        }
        .loc-detect.locating .loc-detect-icon,
        .loc-detect.located .loc-detect-icon { background: linear-gradient(135deg, #c6d0da, #a9b9c8); color: #0a0814; box-shadow: 0 6px 18px rgba(140, 160, 182,0.35); }
        .loc-detect-text { flex: 1; min-width: 0; }
        .loc-detect-title { font-size: 0.86rem; font-weight: 700; line-height: 1.2; color: var(--text-base); }
        .loc-detect-sub { font-size: 0.7rem; color: var(--text-soft); margin-top: 2px; }

        .loc-search-wrap { margin: 0 22px 14px; position: relative; }
        .loc-search {
          width: 100%;
          padding: 12px 14px 12px 38px;
          background: var(--bg-input);
          border: 1px solid var(--border-strong);
          border-radius: 14px;
          color: var(--text-base); font-size: 0.86rem;
          outline: none;
          transition: all 0.22s ease;
        }
        .loc-search:focus { border-color: var(--accent); background: var(--bg-card); }
        .loc-search::placeholder { color: var(--text-muted); }
        .loc-search-icon { position: absolute; top: 50%; left: 14px; transform: translateY(-50%); color: var(--text-muted); }

        /* Recent cities — quick one-tap re-pick */
        .loc-recent-wrap { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 22px 12px; }
        .loc-recent-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 11px;
          background: var(--bg-pill);
          border: 1px solid var(--border-soft);
          border-radius: 999px;
          color: var(--text-base); font-size: 0.75rem; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
        }
        .loc-recent-chip:hover { background: rgba(140, 160, 182,0.18); border-color: rgba(140, 160, 182,0.5); transform: translateY(-1px); }

        .loc-wheel-title { padding: 0 22px; font-size: 0.63rem; font-weight: 700; color: var(--text-soft); letter-spacing: 0.18em; text-transform: uppercase; margin: 10px 0 8px; display: flex; align-items: center; gap: 6px; }
        .loc-wheel-title:first-child { margin-top: 0; }
        .loc-wheel-wrap {
          position: relative;
          margin: 0 16px;
          padding: 4px 0;
          max-height: 300px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(140, 160, 182,0.4) transparent;
        }
        .loc-wheel-wrap::-webkit-scrollbar { width: 4px; }
        .loc-wheel-wrap::-webkit-scrollbar-thumb { background: rgba(140, 160, 182,0.4); border-radius: 2px; }

        .loc-row {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          margin-bottom: 4px;
          background: var(--bg-pill);
          border: 1px solid var(--border-soft);
          border-radius: 14px;
          cursor: pointer; text-align: left;
          transition: all 0.22s ease;
          color: var(--text-base);
          width: 100%;
        }
        .loc-row:hover { transform: translateX(2px); border-color: var(--accent); }
        .loc-row.active { background: color-mix(in srgb, var(--accent) 16%, var(--bg-card)); border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
        .loc-row-emoji { font-size: 1.1rem; line-height: 1; }
        .loc-row-text { flex: 1; min-width: 0; }
        .loc-row-name { font-size: 0.92rem; font-weight: 600; color: var(--text-base); }
        .loc-row-meta { font-size: 0.68rem; color: var(--text-soft); margin-top: 1px; }
        .loc-dist-badge {
          flex-shrink: 0;
          font-size: 0.64rem; font-weight: 800;
          color: var(--accent);
          background: color-mix(in srgb, var(--accent) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
          border-radius: 999px;
          padding: 2px 8px;
          font-variant-numeric: tabular-nums;
        }
        .loc-row-arrow { color: var(--text-muted); font-size: 0.9rem; }

        .loc-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.78rem; }

        .loc-bottom-bar { padding: 8px 16px 16px; display: flex; gap: 8px; }
        .loc-anywhere {
          flex: 1;
          padding: 11px 12px;
          background: var(--bg-input);
          border: 1px solid var(--border-soft);
          border-radius: 12px;
          color: var(--text-soft);
          font-weight: 600; font-size: 0.78rem;
          cursor: pointer;
          transition: all 0.22s ease;
        }
        .loc-anywhere.active { background: color-mix(in srgb, var(--accent) 16%, var(--bg-card)); border-color: var(--accent); color: var(--text-base); }
        .loc-anywhere:hover { border-color: var(--accent); }
      `}</style>

      <div className="loc-bg" onClick={onClose}>
        <div className="loc-card" onClick={(e) => e.stopPropagation()}>
          <button className="loc-x" onClick={onClose} aria-label="Close">✕</button>

          <div className="loc-globe-stage">
            <div className="loc-globe-rings" aria-hidden />
            <div className="loc-globe-wrap">
              <div className="loc-globe" />
              <div className="loc-globe-shine" />
              <span className="loc-orbit-dot" />
              <span className="loc-orbit-dot two" />
              <div className="loc-globe-label">
                <span className="live-dot" />
                <span>Live</span>
              </div>
            </div>
          </div>

          <div className="loc-hero">
            <div className="loc-eyebrow">Showing stays in</div>
            <h2 className="loc-active">{activeCity || "Anywhere in India"}</h2>
            <p className="loc-active-sub">
              {activeCity
                ? "Hotels · Flash deals · Reels are all filtered by this location."
                : "Pick a city below or detect your device location."}
            </p>
          </div>

          <button
            className={`loc-detect ${status === "locating" ? "locating" : status === "located" ? "located" : ""}`}
            onClick={detect}
            disabled={loading}
          >
            <div className="loc-detect-icon">
              {status === "locating" ? "⏳" : status === "located" ? "📍" : "🛰"}
            </div>
            <div className="loc-detect-text">
              <div className="loc-detect-title">
                {status === "locating" ? "Pinging satellites…" :
                 status === "denied"   ? "Permission denied · pick below" :
                 status === "located"  ? (detected?.city ? `📍 Near ${detected.city}` : "Located — nearest first") :
                                         "Use my live location"}
              </div>
              <div className="loc-detect-sub">
                {status === "locating" ? "Reverse-geocoding your coordinates" :
                 status === "denied"   ? "Allow location in browser settings" :
                 status === "located"  ? "Cities below are sorted by distance" :
                                         "GPS · sorts cities by how close you are"}
              </div>
            </div>
          </button>

          <div className="loc-search-wrap">
            <span className="loc-search-icon"><Search size={15} strokeWidth={2.2} aria-hidden /></span>
            {/* No autoFocus — opening the modal must NOT pop up the mobile
                keyboard. The user explicitly taps this input when they want
                to search; otherwise the wheel below is the primary affordance. */}
            <input
              className="loc-search"
              placeholder="Search city, state or region — Goa, Rajasthan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputMode="search"
              enterKeyHint="search"
            />
          </div>

          {/* Recent picks (only when not actively searching) */}
          {!trimmed && recent.length > 0 && (
            <div className="loc-recent-wrap">
              {recent.map((c) => (
                <button key={c} className="loc-recent-chip" onClick={() => pick(c)}>
                  <span>{cityIcon(c)}</span>
                  <span>{cityMeta(c)?.name || c}</span>
                </button>
              ))}
            </div>
          )}

          <div className="loc-wheel-wrap">
            {trimmed ? (
              <>
                <div className="loc-wheel-title">Matching cities</div>
                {results.map((c) => Row(c))}
                {customMatch && (
                  <button className="loc-row" onClick={() => pick(search.trim())}>
                    <span className="loc-row-emoji">✨</span>
                    <div className="loc-row-text">
                      <div className="loc-row-name">Use “{search.trim()}”</div>
                      <div className="loc-row-meta">Search hotels anywhere — we’ll match what we have</div>
                    </div>
                    <span className="loc-row-arrow">›</span>
                  </button>
                )}
                {results.length === 0 && !customMatch && (
                  <div className="loc-empty">No matches. Try a different name.</div>
                )}
              </>
            ) : (
              <>
                {nearby.length > 0 && (
                  <>
                    <div className="loc-wheel-title">📍 Nearby you</div>
                    {nearby.map((c) => Row(c))}
                  </>
                )}
                {trending.length > 0 && (
                  <>
                    <div className="loc-wheel-title">🔥 Trending{demandMonth ? ` in ${demandMonth}` : ""}</div>
                    {trending.map((c) => Row(c))}
                  </>
                )}
                <div className="loc-wheel-title">🌏 All destinations</div>
                {rest.map((c) => Row(c))}
              </>
            )}
          </div>

          <div className="loc-bottom-bar">
            <button
              className={`loc-anywhere ${!activeCity ? "active" : ""}`}
              onClick={() => pick("")}
            >
              🌐 Show me all
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
