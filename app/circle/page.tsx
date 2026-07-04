"use client";

// StayCircle™ — Discover Properties (Step 1)
// Cinematic hero (GSAP entrance + drifting-mist CSS) → glass filter bar →
// reel-feed of 3D-tilt property cards (video autoplay on view) → lock flow.
// Locked properties feed /circle/build (Step 2).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import { fmtINR } from "@/lib/circle/engine";

type RoomType = {
  id: string;
  name: string;
  monthlyRate: number;
  totalUnits: number;
  lockedUnits: number;
  availableUnits: number;
};

type CircleProperty = {
  id: string;
  title: string;
  city: string;
  state?: string;
  locationLabel?: string;
  tagline?: string;
  images: string[];
  videoUrl?: string | null;
  roomsLabel?: string;
  viewLabel?: string;
  monthlyRate: number;
  roiMin: number;
  roiMax: number;
  occupancyLabel?: string;
  badges: string[];
  operationModel: string;
  status: string;
  roomTypes: RoomType[];
};

const LIKES_KEY = "sb_circle_likes_v1";
const LOCKS_KEY = "sb_circle_locks_v1"; // local mirror of server locks

function readSet(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}
function writeSet(key: string, arr: string[]) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* full */ }
}

const MODELS = [
  { key: "all", label: "All Models" },
  { key: "managed", label: "Fully Managed" },
  { key: "revenue_share", label: "Revenue Share" },
  { key: "lease", label: "Lease" },
];

export default function CircleDiscoverPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("all");
  const [model, setModel] = useState("all");
  const [budget, setBudget] = useState(100000); // ₹/room/month ceiling
  const [likes, setLikes] = useState<string[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  const [detail, setDetail] = useState<CircleProperty | null>(null);
  const [toast, setToast] = useState("");
  const heroRef = useRef<HTMLDivElement>(null);

  // ------- data -------
  useEffect(() => {
    setLikes(readSet(LIKES_KEY));
    setLocks(readSet(LOCKS_KEY));
    fetch("/api/circle/properties")
      .then((r) => r.json())
      .then((d) => {
        setProps(Array.isArray(d?.properties) ? d.properties : []);
        setCities(Array.isArray(d?.cities) ? d.cities : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Hydrate server locks for signed-in users (server is the source of truth).
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem("sb_token");
    if (!token) return;
    fetch("/api/circle/locks", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const ids = (Array.isArray(d?.locks) ? d.locks : []).map((l: any) => String(l.property_id));
        if (ids.length) {
          setLocks((prev) => {
            const merged = Array.from(new Set([...prev, ...ids]));
            writeSet(LOCKS_KEY, merged);
            return merged;
          });
        }
      })
      .catch(() => {});
  }, [user]);

  // ------- GSAP cinematic hero entrance -------
  useEffect(() => {
    let ctx: any;
    (async () => {
      try {
        const { gsap } = await import("gsap");
        if (!heroRef.current) return;
        ctx = gsap.context(() => {
          gsap.from(".sbc-hero-eyebrow", { y: 18, opacity: 0, duration: 0.7, ease: "power3.out" });
          gsap.from(".sbc-hero-title", { y: 34, opacity: 0, duration: 0.9, delay: 0.12, ease: "power3.out" });
          gsap.from(".sbc-hero-sub, .sbc-hero-steps", { y: 24, opacity: 0, duration: 0.8, delay: 0.28, stagger: 0.08, ease: "power3.out" });
          gsap.from(".sbc-hero-ctas", { y: 20, opacity: 0, duration: 0.7, delay: 0.42, ease: "power3.out" });
          gsap.from(".sbc-hero-stat", { y: 26, opacity: 0, duration: 0.7, delay: 0.55, stagger: 0.09, ease: "power3.out" });
        }, heroRef);
      } catch { /* GSAP optional — CSS handles the rest */ }
    })();
    return () => { try { ctx?.revert(); } catch { /* noop */ } };
  }, []);

  // ------- scroll reveals -------
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("is-in")),
      { threshold: 0.12 },
    );
    document.querySelectorAll(".sbc-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [loading, props.length]);

  // ------- filters -------
  const filtered = useMemo(() => {
    return props.filter((p) => {
      if (city !== "all" && p.city !== city) return false;
      if (model !== "all" && p.operationModel !== model) return false;
      if (budget < 100000 && p.monthlyRate > budget) return false;
      return true;
    });
  }, [props, city, model, budget]);

  const stats = useMemo(() => {
    const totalRooms = props.reduce(
      (s, p) => s + p.roomTypes.reduce((x, rt) => x + rt.availableUnits, 0), 0);
    const avgRoi = props.length
      ? Math.round(props.reduce((s, p) => s + (p.roiMin + p.roiMax) / 2, 0) / props.length)
      : 0;
    const cityCount = new Set(props.map((p) => p.city)).size;
    return { properties: props.length, totalRooms, avgRoi, cityCount };
  }, [props]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }, []);

  const toggleLike = useCallback((id: string) => {
    setLikes((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeSet(LIKES_KEY, next);
      return next;
    });
  }, []);

  const lockProperty = useCallback(async (p: CircleProperty) => {
    if (!user) {
      redirectToSignIn(router, { route: "/circle", action: "circle_lock" });
      return;
    }
    const already = locks.includes(p.id);
    const token = localStorage.getItem("sb_token") || "";
    if (already) {
      setLocks((prev) => { const n = prev.filter((x) => x !== p.id); writeSet(LOCKS_KEY, n); return n; });
      fetch(`/api/circle/locks?propertyId=${encodeURIComponent(p.id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      flash(`🔓 ${p.title} released`);
      return;
    }
    setLocks((prev) => { const n = [...prev, p.id]; writeSet(LOCKS_KEY, n); return n; });
    fetch("/api/circle/locks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propertyId: p.id }),
    }).catch(() => {});
    flash(`🔒 ${p.title} locked — bundle me add ho gaya`);
  }, [user, locks, router, flash]);

  return (
    <div>
      {/* ============ CINEMATIC HERO ============ */}
      <section className="sbc-hero" ref={heroRef}>
        <div className="sbc-hero-inner">
          <span className="sbc-hero-eyebrow"><span className="dot" /> India&apos;s Most Trusted Hospitality Investment Circle</span>
          <h1 className="sbc-hero-title">
            Build Wealth<br />with <span className="gold">Hospitality</span>
          </h1>
          <p className="sbc-hero-sub">
            Handpicked hill-station properties. Lock rooms, build your investment
            bundle and earn monthly returns — StayBid runs everything for you.
          </p>
          <div className="sbc-hero-steps">
            <span>① Discover</span><span>② Lock</span><span>③ Invest</span><span>④ Earn</span>
          </div>
          <div className="sbc-hero-ctas">
            <a href="#discover" className="sbc-btn-gold">Explore Properties ↓</a>
            <Link href="/circle/build" className="sbc-btn-ghost">Build Your Bundle →</Link>
          </div>
          <div className="sbc-hero-stats">
            <div className="sbc-hero-stat"><b><CountUp value={stats.properties} /></b><span>Curated Properties</span></div>
            <div className="sbc-hero-stat"><b><CountUp value={stats.totalRooms} /></b><span>Rooms Open to Lock</span></div>
            <div className="sbc-hero-stat"><b><CountUp value={stats.avgRoi} suffix="%" /></b><span>Avg. Expected ROI</span></div>
            <div className="sbc-hero-stat"><b><CountUp value={stats.cityCount} /></b><span>Hill Destinations</span></div>
          </div>
        </div>
      </section>

      {/* ============ STEP 1 · DISCOVER ============ */}
      <section className="sbc-section" id="discover">
        <h2 className="sbc-h2 sbc-reveal"><span className="step-pill">STEP 1</span>Discover Properties</h2>
        <p className="sbc-sub sbc-reveal">Explore handpicked hospitality properties across top destinations. Short reels, real numbers, big opportunities.</p>

        <div className="sbc-filterbar sbc-reveal">
          <div className="sbc-filter-field">
            <label>📍 City</label>
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="all">All Cities</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sbc-filter-field">
            <label>⚙ Operation Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div className="sbc-filter-field" style={{ minWidth: 200 }}>
            <label>₹ Budget / Month — <span className="sbc-budget-val">{budget >= 100000 ? "Any Budget" : fmtINR(budget)}</span></label>
            <input
              type="range" min={20000} max={100000} step={5000} value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </div>
        </div>

        {loading ? (
          <div className="sbc-grid">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="sbc-card" style={{ aspectRatio: "4/6.2", background: "linear-gradient(120deg,#F2E8D5,#FAF3E6,#F2E8D5)", backgroundSize: "200% 100%", animation: "sbcShimmerBg 1.4s linear infinite" }} />
            ))}
            <style>{`@keyframes sbcShimmerBg { to { background-position: -200% 0; } }`}</style>
          </div>
        ) : filtered.length === 0 ? (
          <div className="sbc-panel sbc-reveal is-in" style={{ textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 34 }}>🏔️</div>
            <p style={{ marginTop: 8, color: "rgba(74,56,32,.7)" }}>Is filter me abhi koi property nahi — budget ya city change karke dekhein.</p>
          </div>
        ) : (
          <div className="sbc-grid">
            {filtered.map((p) => (
              <PropertyCard
                key={p.id}
                p={p}
                liked={likes.includes(p.id)}
                locked={locks.includes(p.id)}
                onLike={() => toggleLike(p.id)}
                onLock={() => lockProperty(p)}
                onDetail={() => setDetail(p)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ============ STEP 2 teaser ============ */}
      <section className="sbc-section" style={{ paddingTop: 0 }}>
        <div className="sbc-panel-walnut sbc-reveal">
          <h2 className="sbc-h2" style={{ color: "#F3E3BF" }}>
            <span className="step-pill" style={{ background: "linear-gradient(135deg,#F3E3BF,#C9A66B)", color: "#241B10" }}>STEP 2</span>
            Build Your Investment Bundle
          </h2>
          <p style={{ color: "rgba(247,239,223,.72)", maxWidth: 620 }}>
            From locked properties to your perfect income plan — choose room types,
            mix cities, pick a payment plan and watch your returns update live.
          </p>
          <div className="sbc-kpi-row" style={{ marginTop: 18 }}>
            <div className="sbc-kpi"><b>🔒 Lock</b><span>Pick your properties</span></div>
            <div className="sbc-kpi"><b>🛏 Rooms</b><span>Choose type &amp; count</span></div>
            <div className="sbc-kpi"><b>📊 Bundle</b><span>Mix across cities</span></div>
            <div className="sbc-kpi"><b>₹ Returns</b><span>Live ROI + payback</span></div>
          </div>
          <div style={{ marginTop: 22 }}>
            <Link href="/circle/build" className="sbc-btn-gold">Open Bundle Builder →</Link>
          </div>
        </div>
      </section>

      {/* ============ WHY INVEST ============ */}
      <section className="sbc-section" style={{ paddingTop: 0 }}>
        <h2 className="sbc-h2 sbc-reveal">Why invest with Stay<em style={{ color: "var(--sbc-gold-deep)" }}>Circle</em>?</h2>
        <div className="sbc-grid sbc-reveal" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {[
            ["💰", "High Monthly Cash Flow", "Returns credited every month, not locked for years."],
            ["🛎", "Professional Operations", "StayBid's hospitality team runs pricing, guests & housekeeping."],
            ["📜", "Verified & Legal", "Every property passes quality + legal checks before listing."],
            ["📈", "High-Occupancy Destinations", "Only proven hill circuits with year-round demand."],
            ["🔍", "Transparent & Hassle-Free", "Live dashboard, monthly statements, zero hidden charges."],
            ["🤝", "Community Partner Model", "You grow with the platform — diversify across properties."],
          ].map(([icon, t, d]) => (
            <div key={t as string} className="sbc-panel" style={{ padding: 18 }}>
              <div style={{ fontSize: 26 }}>{icon}</div>
              <div style={{ fontWeight: 700, color: "var(--sbc-coffee)", marginTop: 8 }}>{t}</div>
              <div style={{ fontSize: ".82rem", color: "rgba(74,56,32,.65)", marginTop: 4 }}>{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* floating bundle FAB */}
      {locks.length > 0 && (
        <Link href="/circle/build" className="sbc-fab">
          🧺 My Bundle <span className="count">{locks.length}</span>
        </Link>
      )}

      {/* details bottom-sheet */}
      {detail && (
        <div className="sbc-sheet-backdrop" onClick={() => setDetail(null)}>
          <div className="sbc-sheet" onClick={(e) => e.stopPropagation()}>
            <DetailSheet
              p={detail}
              locked={locks.includes(detail.id)}
              onLock={() => { lockProperty(detail); }}
              onClose={() => setDetail(null)}
            />
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div style={{
          position: "fixed", left: "50%", transform: "translateX(-50%)",
          bottom: "calc(86px + env(safe-area-inset-bottom, 0px))", zIndex: 90,
          background: "rgba(36,27,16,.94)", color: "#F3E3BF", padding: "10px 18px",
          borderRadius: 999, fontSize: ".85rem", boxShadow: "0 12px 32px -10px rgba(0,0,0,.5)",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PropertyCard({
  p, liked, locked, onLike, onLock, onDetail,
}: {
  p: CircleProperty;
  liked: boolean;
  locked: boolean;
  onLike: () => void;
  onLock: () => void;
  onDetail: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // Reel behaviour — autoplay muted when the card is mostly visible.
  useEffect(() => {
    if (!wrapRef.current) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setInView(e.isIntersecting && e.intersectionRatio > 0.55)),
      { threshold: [0, 0.55, 1] },
    );
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (inView) {
      // preload="none" needs an explicit load() on mobile Safari (v132.11 rule)
      try { v.load(); } catch { /* noop */ }
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [inView]);

  const soldOut = p.status === "sold_out" ||
    p.roomTypes.every((rt) => rt.availableUnits <= 0);

  return (
    <div className="sbc-card sbc-reveal" ref={wrapRef}>
      <div className="sbc-card-media">
        {p.videoUrl && inView ? (
          <video
            ref={videoRef}
            src={p.videoUrl}
            muted playsInline loop preload="none"
            poster={p.images[0]}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.images[0]} alt={p.title} loading="lazy" />
        )}
        <span className="sbc-chip-city">📍 {p.city}</span>
        <button className={`sbc-like ${liked ? "liked" : ""}`} onClick={onLike} aria-label="Like">
          {liked ? "♥" : "♡"}
        </button>
        <span className="sbc-live-pill"><span className="dot" /> {soldOut ? "WAITLIST" : "LIVE"}</span>
      </div>
      <div className="sbc-card-body">
        <div className="sbc-card-title">{p.title}</div>
        <div className="sbc-card-meta">{p.roomsLabel || p.viewLabel}</div>
        <div className="sbc-card-rate">
          <b>{fmtINR(p.monthlyRate)}</b><span>/ Room / Month</span>
        </div>
        <div className="sbc-badges">
          <span className="sbc-badge-roi">📈 {p.roiMax}% ROI</span>
          {p.occupancyLabel && <span className="sbc-badge-occ">🔥 {p.occupancyLabel}</span>}
        </div>
        <div className="sbc-card-actions">
          <button className="sbc-btn-detail" onClick={onDetail}>Details</button>
          <button className={`sbc-btn-lock ${locked ? "locked" : ""}`} onClick={onLock} disabled={soldOut && !locked}>
            {locked ? "✓ Locked" : soldOut ? "Sold Out" : "🔒 Lock Property"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DetailSheet({
  p, locked, onLock, onClose,
}: {
  p: CircleProperty;
  locked: boolean;
  onLock: () => void;
  onClose: () => void;
}) {
  const [imgIdx, setImgIdx] = useState(0);
  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", borderRadius: "26px 26px 0 0" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.images[imgIdx] || p.images[0]} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 12, right: 12, width: 34, height: 34, borderRadius: 999,
            background: "rgba(20,14,6,.55)", color: "#F3E3BF", border: "1px solid rgba(231,207,160,.3)",
            backdropFilter: "blur(8px)", cursor: "pointer",
          }}
        >✕</button>
        {p.images.length > 1 && (
          <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
            {p.images.map((_, i) => (
              <button key={i} onClick={() => setImgIdx(i)} aria-label={`Photo ${i + 1}`} style={{
                width: i === imgIdx ? 20 : 8, height: 8, borderRadius: 999, border: "none", cursor: "pointer",
                background: i === imgIdx ? "#F3E3BF" : "rgba(255,255,255,.5)", transition: "width .25s ease",
              }} />
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
          <div>
            <div className="sbc-card-title" style={{ fontSize: "1.45rem" }}>{p.title}</div>
            <div className="sbc-card-meta">📍 {p.locationLabel || p.city}{p.state ? `, ${p.state}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <b style={{ fontSize: "1.2rem", color: "var(--sbc-ink)" }}>{fmtINR(p.monthlyRate)}</b>
            <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.6)" }}>/ Room / Month</div>
          </div>
        </div>
        {p.tagline && <p style={{ marginTop: 10, fontSize: ".88rem", color: "rgba(74,56,32,.75)" }}>{p.tagline}</p>}
        <div className="sbc-badges" style={{ marginTop: 12 }}>
          <span className="sbc-badge-roi">📈 {p.roiMin}–{p.roiMax}% expected ROI</span>
          {p.occupancyLabel && <span className="sbc-badge-occ">🔥 {p.occupancyLabel}</span>}
          <span className="sbc-badge-occ">🛎 {p.operationModel === "managed" ? "Fully Managed by StayBid" : p.operationModel}</span>
        </div>

        <div style={{ marginTop: 16, fontWeight: 700, color: "var(--sbc-coffee)", fontSize: ".9rem" }}>Room types &amp; availability</div>
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {p.roomTypes.map((rt) => (
            <div key={rt.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", borderRadius: 14, background: "rgba(201,166,107,.08)",
              border: "1px solid rgba(139,105,20,.15)",
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: ".88rem", color: "var(--sbc-coffee)" }}>{rt.name}</div>
                <div style={{ fontSize: ".72rem", color: rt.availableUnits > 0 ? "#3F5233" : "#a85b4e" }}>
                  {rt.availableUnits > 0 ? `${rt.availableUnits} unit${rt.availableUnits > 1 ? "s" : ""} available` : "Sold out"}
                </div>
              </div>
              <b style={{ fontVariantNumeric: "tabular-nums", color: "var(--sbc-ink)" }}>{fmtINR(rt.monthlyRate)}<span style={{ fontSize: ".68rem", fontWeight: 400, color: "rgba(74,56,32,.55)" }}> /mo</span></b>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button className={`sbc-btn-lock ${locked ? "locked" : ""}`} style={{ flex: 1, padding: "13px 0" }} onClick={onLock}>
            {locked ? "✓ Locked — in your bundle" : "🔒 Lock Property"}
          </button>
          <Link href="/circle/build" className="sbc-btn-detail" style={{ flex: .8, display: "grid", placeItems: "center", textDecoration: "none" }}>
            Build Bundle →
          </Link>
        </div>
      </div>
    </div>
  );
}
