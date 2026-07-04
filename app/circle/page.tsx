"use client";

// StayCircle™ — Discover Properties (Step 1)
// v289: Airbnb-grade filter pill bar + Instagram-style vertical reel feed.
// Each reel autoplays its property video; tap → full property tour
// (/circle/[id], a hotel-page replica). Lock still adds to the bundle.

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
  { key: "franchise", label: "Franchise" },
];
const MODEL_LABEL: Record<string, string> = Object.fromEntries(MODELS.map((m) => [m.key, m.label]));

const BUDGET_STOPS = [20000, 30000, 40000, 50000, 75000, 100000];

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
      if (city !== "all" && String(p.city).toLowerCase() !== city.toLowerCase()) return false;
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

  const share = useCallback(async (p: CircleProperty) => {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/circle/${p.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: p.title, text: `Invest in ${p.title} on StayCircle`, url }); return; }
      await navigator.clipboard.writeText(url);
      flash("🔗 Link copied");
    } catch { /* cancelled */ }
  }, [flash]);

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
            Handpicked hill-station properties. Watch the reels, lock rooms, build
            your investment bundle and earn monthly returns — StayBid runs everything.
          </p>
          <div className="sbc-hero-steps">
            <span>① Discover</span><span>② Lock</span><span>③ Invest</span><span>④ Earn</span>
          </div>
          <div className="sbc-hero-ctas">
            <a href="#discover" className="sbc-btn-gold">Explore Reels ↓</a>
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

      {/* ============ STEP 1 · DISCOVER (reel feed) ============ */}
      <section className="sbc-section" id="discover">
        <h2 className="sbc-h2 sbc-reveal"><span className="step-pill">STEP 1</span>Discover Properties</h2>
        <p className="sbc-sub sbc-reveal">Swipe through handpicked hospitality reels — real numbers, big opportunities. Tap any reel for the complete property tour.</p>

        <FilterBar
          city={city} setCity={setCity}
          model={model} setModel={setModel}
          budget={budget} setBudget={setBudget}
          cities={cities}
          count={filtered.length}
        />

        {loading ? (
          <div className="sbc-reelfeed">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="sbc-reel" style={{ background: "linear-gradient(120deg,#241B10,#3A2C18,#241B10)", backgroundSize: "200% 100%", animation: "sbcShimmerBg 1.4s linear infinite" }} />
            ))}
            <style>{`@keyframes sbcShimmerBg { to { background-position: -200% 0; } }`}</style>
          </div>
        ) : filtered.length === 0 ? (
          <div className="sbc-panel sbc-reveal is-in" style={{ textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 34 }}>🏔️</div>
            <p style={{ marginTop: 8, color: "rgba(74,56,32,.7)" }}>Is filter me abhi koi property nahi — budget ya city change karke dekhein.</p>
          </div>
        ) : (
          <div className="sbc-reelfeed">
            {filtered.map((p) => (
              <ReelCard
                key={p.id}
                p={p}
                liked={likes.includes(p.id)}
                locked={locks.includes(p.id)}
                onLike={() => toggleLike(p.id)}
                onLock={() => lockProperty(p)}
                onShare={() => share(p)}
                onOpen={() => router.push(`/circle/${p.id}`)}
              />
            ))}
            <div className="sbc-reel-scrollhint">Scroll for more reels ↓</div>
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
// Airbnb-style expandable filter pill bar.
function FilterBar({
  city, setCity, model, setModel, budget, setBudget, cities, count,
}: {
  city: string; setCity: (v: string) => void;
  model: string; setModel: (v: string) => void;
  budget: number; setBudget: (v: number) => void;
  cities: string[]; count: number;
}) {
  const [open, setOpen] = useState<null | "city" | "model" | "budget">(null);
  const budgetLabel = budget >= 100000 ? "Any budget" : `Up to ${fmtINR(budget)}`;

  return (
    <div className="sbc-fbar-wrap sbc-reveal">
      {open && <div className="sbc-fbar-backdrop" onClick={() => setOpen(null)} />}
      <div className="sbc-fbar">
        <button className={`sbc-fbar-seg ${open === "city" ? "active" : ""}`} onClick={() => setOpen(open === "city" ? null : "city")}>
          <span className="sbc-fbar-seg-label">📍 Location</span>
          <span className={`sbc-fbar-seg-val ${city === "all" ? "dim" : ""}`}>{city === "all" ? "Anywhere" : city}</span>
        </button>
        <div className="sbc-fbar-div" />
        <button className={`sbc-fbar-seg ${open === "model" ? "active" : ""}`} onClick={() => setOpen(open === "model" ? null : "model")}>
          <span className="sbc-fbar-seg-label">⚙ Model</span>
          <span className={`sbc-fbar-seg-val ${model === "all" ? "dim" : ""}`}>{MODEL_LABEL[model] || "All models"}</span>
        </button>
        <div className="sbc-fbar-div" />
        <button className={`sbc-fbar-seg ${open === "budget" ? "active" : ""}`} onClick={() => setOpen(open === "budget" ? null : "budget")}>
          <span className="sbc-fbar-seg-label">₹ Budget / mo</span>
          <span className={`sbc-fbar-seg-val ${budget >= 100000 ? "dim" : ""}`}>{budgetLabel}</span>
        </button>
        <button className="sbc-fbar-go" onClick={() => setOpen(null)} aria-label="Apply filters" title={`${count} properties`}>
          {count > 0 ? count : "🔍"}
        </button>
      </div>

      {open === "city" && (
        <div className="sbc-fbar-pop">
          <div className="sbc-fbar-pop-title">Where do you want to invest?</div>
          <div className="sbc-fbar-chips">
            <button className={`sbc-fbar-chip ${city === "all" ? "on" : ""}`} onClick={() => { setCity("all"); setOpen(null); }}>🌐 Anywhere</button>
            {cities.map((c) => (
              <button key={c} className={`sbc-fbar-chip ${city === c ? "on" : ""}`} onClick={() => { setCity(c); setOpen(null); }}>{c}</button>
            ))}
          </div>
        </div>
      )}
      {open === "model" && (
        <div className="sbc-fbar-pop">
          <div className="sbc-fbar-pop-title">Operating model</div>
          <div className="sbc-fbar-chips">
            {MODELS.map((m) => (
              <button key={m.key} className={`sbc-fbar-chip ${model === m.key ? "on" : ""}`} onClick={() => { setModel(m.key); setOpen(null); }}>{m.label}</button>
            ))}
          </div>
        </div>
      )}
      {open === "budget" && (
        <div className="sbc-fbar-pop">
          <div className="sbc-fbar-pop-title">Max monthly investment per room</div>
          <div className="sbc-fbar-budget-val">{budgetLabel}</div>
          <input
            className="sbc-fbar-range"
            type="range" min={20000} max={100000} step={5000} value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
          <div className="sbc-fbar-chips" style={{ marginTop: 10 }}>
            {BUDGET_STOPS.map((b) => (
              <button key={b} className={`sbc-fbar-chip ${budget === b ? "on" : ""}`} onClick={() => setBudget(b)}>
                {b >= 100000 ? "Any" : `≤ ${fmtINR(b)}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instagram-style reel card — autoplay video on view, action rail, tap → tour.
function ReelCard({
  p, liked, locked, onLike, onLock, onShare, onOpen,
}: {
  p: CircleProperty;
  liked: boolean;
  locked: boolean;
  onLike: () => void;
  onLock: () => void;
  onShare: () => void;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [muted, setMuted] = useState(true);

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

  const soldOut = p.status === "sold_out" || p.roomTypes.every((rt) => rt.availableUnits <= 0);
  const poster = p.images[0];

  return (
    <div className="sbc-reel sbc-reveal" ref={wrapRef} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div className="sbc-reel-media">
        {p.videoUrl && inView ? (
          <video
            ref={videoRef}
            src={p.videoUrl}
            muted={muted} playsInline loop preload="none"
            poster={poster}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          poster ? <img src={poster} alt={p.title} loading="lazy" /> : null
        )}
      </div>
      <div className="sbc-reel-shade" />

      <div className="sbc-reel-top">
        <span className="sbc-reel-city">📍 {p.locationLabel || p.city}</span>
        <span className={`sbc-reel-livepill ${soldOut ? "wait" : ""}`}><span className="dot" /> {soldOut ? "WAITLIST" : "LIVE"}</span>
      </div>

      {/* action rail */}
      <div className="sbc-reel-rail" onClick={(e) => e.stopPropagation()}>
        <button className={`sbc-reel-railbtn ${liked ? "on" : ""}`} onClick={onLike} aria-label="Like">{liked ? "♥" : "♡"}</button>
        <button className="sbc-reel-railbtn" onClick={onShare} aria-label="Share">↗</button>
        {p.videoUrl && (
          <button className="sbc-reel-railbtn" onClick={() => setMuted((m) => !m)} aria-label="Mute">{muted ? "🔇" : "🔊"}</button>
        )}
        <button className="sbc-reel-railbtn" onClick={onOpen} aria-label="Details">ⓘ</button>
      </div>

      {/* info */}
      <div className="sbc-reel-info">
        <div className="sbc-reel-badges">
          <span className="sbc-reel-badge roi">📈 up to {p.roiMax}% ROI</span>
          {p.occupancyLabel && <span className="sbc-reel-badge">🔥 {p.occupancyLabel}</span>}
          <span className="sbc-reel-badge">🛎 {p.operationModel === "managed" ? "Fully Managed" : MODEL_LABEL[p.operationModel] || p.operationModel}</span>
        </div>
        <div className="sbc-reel-title">{p.title}</div>
        <div className="sbc-reel-sub">{p.roomsLabel || p.viewLabel || `${p.city}${p.state ? `, ${p.state}` : ""}`}</div>
        <div className="sbc-reel-rate"><b>{fmtINR(p.monthlyRate)}</b><span>/ room / month</span></div>
      </div>

      {/* CTAs */}
      <div className="sbc-reel-cta" onClick={(e) => e.stopPropagation()}>
        <button className="sbc-reel-btn-tour" onClick={onOpen}>▶ View Full Tour</button>
        <button className={`sbc-reel-btn-lock ${locked ? "locked" : ""}`} onClick={onLock} disabled={soldOut && !locked}>
          {locked ? "✓ Locked" : soldOut ? "Sold Out" : "🔒 Lock"}
        </button>
      </div>
    </div>
  );
}
