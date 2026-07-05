"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — "Hello, Investor" Home  (v293)
//
// The traditional, welcoming entry point for the /circle vertical — shown
// BEFORE the immersive reel feed so anyone who doesn't grok reel-navigation
// can browse the classic way. Mirrors the reference "Hello Investor" design:
// greeting + portfolio snapshot + Quick Actions + the 3-step journey + a full
// property grid (traditional Select-Your-Property) + Build-Bundle CTA.
//
// The reel feed moved to /circle/discover (Step 1 · immersive). Tapping any
// property card here → /circle/[id] (the full tour + room-select), so the
// traditional path is: Home → property → rooms → build.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { fmtINR, computeBundle, type BundleItem } from "@/lib/circle/engine";

type RoomType = { id: string; name: string; monthlyRate: number; availableUnits: number };
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
const LOCKS_KEY = "sb_circle_locks_v1";

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

const MODEL_LABEL: Record<string, string> = {
  managed: "Fully Managed",
  revenue_share: "Revenue Share",
  lease: "Lease",
  franchise: "Franchise",
};

export default function CircleHomePage() {
  const router = useRouter();
  const { user } = useAuth();

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("all");
  const [likes, setLikes] = useState<string[]>([]);
  const [locks, setLocks] = useState<string[]>([]);

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

  // Hydrate server locks for signed-in users.
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem("sb_token");
    if (!token) return;
    fetch("/api/circle/locks", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const ids = (Array.isArray(d?.locks) ? d.locks : []).map((l: any) => String(l.property_id));
        if (ids.length) setLocks((prev) => Array.from(new Set([...prev, ...ids])));
      })
      .catch(() => {});
  }, [user]);

  const filtered = useMemo(
    () => props.filter((p) => city === "all" || String(p.city).toLowerCase() === city.toLowerCase()),
    [props, city],
  );

  // Portfolio snapshot — routed through the SAME computeBundle engine that
  // /circle/build uses, so the ROI band + diversification bonus + income can
  // NEVER drift between the two pages (v294.10). Home = "potential across your
  // N LOCKED properties (cheapest room each)"; build = "the bundle you're
  // actually configuring". Same math, different scope — labelled as such.
  const lockedProps = useMemo(() => props.filter((p) => locks.includes(p.id)), [props, locks]);
  const snapshot = useMemo(() => {
    if (!lockedProps.length) return null;
    // Cheapest available room per locked property → one bundle item each.
    const items: BundleItem[] = lockedProps.map((p) => {
      const rooms = (p.roomTypes || []).filter((r) => r.monthlyRate > 0);
      const cheapest = rooms.length
        ? rooms.reduce((a, b) => (b.monthlyRate < a.monthlyRate ? b : a))
        : null;
      return {
        propertyId: p.id,
        propertyTitle: p.title,
        city: p.city,
        roomTypeId: cheapest?.id || `${p.id}-base`,
        roomTypeName: cheapest?.name || "Room",
        monthlyRate: cheapest?.monthlyRate || p.monthlyRate,
        rooms: 1,
        roiMin: p.roiMin || 0,
        roiMax: p.roiMax || 0,
      };
    });
    const b = computeBundle(items, "monthly");
    if (!b.ok) return null;
    return {
      committed: b.monthlyTotal,
      rMin: b.expectedRoiMin,
      rMax: b.expectedRoiMax,
      monthlyIncome: b.expectedMonthlyIncome,
      count: b.propertyCount,
      bonus: b.diversificationBonusPct,
    };
  }, [lockedProps]);

  const displayName = (user?.name || "").trim().split(" ")[0] || "Investor";

  const toggleLike = (id: string) => {
    setLikes((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeSet(LIKES_KEY, next);
      return next;
    });
  };

  return (
    <div className="sbc-home">
      {/* ───────── greeting header ───────── */}
      <header className="sbc-home-head">
        <div>
          <div className="sbc-home-hi">Hello, {displayName} <span className="sbc-home-wave">👋</span></div>
          <div className="sbc-home-sub">Ready to grow your wealth?</div>
        </div>
        <Link href="/circle/dashboard" className="sbc-home-bell" aria-label="Dashboard">
          <span>☰</span>
        </Link>
      </header>

      {/* ───────── hero: portfolio + quick actions (2-col on desktop) ───────── */}
      <div className="sbc-home-hero">
      {/* ───────── portfolio snapshot ───────── */}
      <section className="sbc-home-portfolio">
        <div className="sbc-hp-glow" aria-hidden />
        {snapshot ? (
          <>
            <div className="sbc-hp-label">
              Portfolio potential
              <span className="sbc-hp-scope">across {snapshot.count} locked {snapshot.count === 1 ? "property" : "properties"}</span>
            </div>
            <div className="sbc-hp-value">{fmtINR(snapshot.committed)}<span>/mo to invest</span></div>
            <div className="sbc-hp-grid">
              <div>
                <span className="sbc-hp-k">Projected income</span>
                <b className="sbc-hp-v sage">{fmtINR(snapshot.monthlyIncome)}/mo</b>
              </div>
              <div>
                <span className="sbc-hp-k">Expected returns / yr</span>
                <b className="sbc-hp-v gold">{snapshot.rMin}% – {snapshot.rMax}%</b>
              </div>
            </div>
            {snapshot.bonus > 0 && (
              <div className="sbc-hp-note">
                ✨ Includes a <b>+{snapshot.bonus}%</b> diversification bonus for spreading across {snapshot.count} properties.
              </div>
            )}
            <Link href="/circle/build" className="sbc-hp-cta">
              Build &amp; confirm your plan →
            </Link>
          </>
        ) : (
          <>
            <div className="sbc-hp-label">Your Portfolio</div>
            <div className="sbc-hp-value">Start earning<span>from ₹20,000/mo</span></div>
            <p className="sbc-hp-empty">Lock handpicked, verified properties and earn <b>15%–32%</b> annual returns — fully managed by StayBid.</p>
            <Link href="/circle/discover" className="sbc-hp-cta">🔒 Lock your first property →</Link>
          </>
        )}
      </section>

      {/* ───────── quick actions ───────── */}
      <section className="sbc-home-sec sbc-qa-sec">
        <div className="sbc-home-sec-h">Quick Actions</div>
        <div className="sbc-qa">
          <Link href="/circle/discover" className="sbc-qa-item">
            <span className="sbc-qa-ic">🔍</span><span>Discover<br />Properties</span>
          </Link>
          <Link href="/circle/build" className="sbc-qa-item">
            <span className="sbc-qa-ic">💎</span><span>Build<br />Bundle</span>
          </Link>
          <Link href="/circle/me" className="sbc-qa-item">
            <span className="sbc-qa-ic">📊</span><span>My<br />Portfolio</span>
          </Link>
          <a href="#how" className="sbc-qa-item">
            <span className="sbc-qa-ic">❓</span><span>How It<br />Works</span>
          </a>
        </div>
      </section>
      </div>{/* /sbc-home-hero */}

      {/* ───────── the 3-step journey (traditional explainer) ───────── */}
      <section className="sbc-home-sec" id="how">
        <div className="sbc-home-sec-h">Your journey — 3 simple steps</div>
        <div className="sbc-journey">
          <Link href="/circle/discover" className="sbc-jstep">
            <div className="sbc-jnum">1</div>
            <div className="sbc-jbody">
              <b>Choose &amp; Lock Property</b>
              <span>Browse verified properties — as a reel feed or classic list — and lock the ones you love.</span>
            </div>
            <span className="sbc-jgo">→</span>
          </Link>
          <div className="sbc-jline" aria-hidden />
          <Link href="/circle/discover?rooms=1" className="sbc-jstep">
            <div className="sbc-jnum">2</div>
            <div className="sbc-jbody">
              <b>Choose &amp; Lock Rooms</b>
              <span>Tour each room — video, amenities, view — and pick how many rooms to invest in.</span>
            </div>
            <span className="sbc-jgo">→</span>
          </Link>
          <div className="sbc-jline" aria-hidden />
          <Link href="/circle/build" className="sbc-jstep">
            <div className="sbc-jnum">3</div>
            <div className="sbc-jbody">
              <b>Build Your Plan</b>
              <span>Combine properties, pick a payment plan, see projected returns and go live.</span>
            </div>
            <span className="sbc-jgo">→</span>
          </Link>
        </div>
      </section>

      {/* ───────── traditional "Select Your Property" grid ───────── */}
      <section className="sbc-home-sec">
        <div className="sbc-home-sec-h between">
          <span>Handpicked Properties</span>
          <Link href="/circle/discover" className="sbc-home-reels">▶ Watch reels</Link>
        </div>

        {/* location filter chips */}
        <div className="sbc-home-chips">
          <button className={`sbc-home-chip ${city === "all" ? "on" : ""}`} onClick={() => setCity("all")}>🌐 All India</button>
          {cities.map((c) => (
            <button key={c} className={`sbc-home-chip ${city === c ? "on" : ""}`} onClick={() => setCity(c)}>{c}</button>
          ))}
        </div>

        {loading ? (
          <div className="sbc-home-grid">
            <div className="sbc-pcard skel" /><div className="sbc-pcard skel" />
            <div className="sbc-pcard skel" /><div className="sbc-pcard skel" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="sbc-home-empty">
            <div style={{ fontSize: 40 }}>🏔️</div>
            <p>Is city me abhi koi property nahi — All India dekhein.</p>
            <button className="sbc-hp-cta" onClick={() => setCity("all")}>Show all properties</button>
          </div>
        ) : (
          <div className="sbc-home-grid">
            {filtered.map((p) => {
              const roomsFrom = (p.roomTypes || []).map((r) => r.monthlyRate).filter((n) => n > 0);
              const from = roomsFrom.length ? Math.min(...roomsFrom) : p.monthlyRate;
              const soldOut = p.status === "sold_out" || (p.roomTypes || []).every((r) => r.availableUnits <= 0);
              const locked = locks.includes(p.id);
              return (
                <button key={p.id} className="sbc-pcard" onClick={() => router.push(`/circle/${p.id}`)}>
                  <div className="sbc-pcard-media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.images?.[0] ? <img src={p.images[0]} alt={p.title} loading="lazy" /> : <div className="sbc-pcard-noimg">◎</div>}
                    {p.badges?.[0] && <span className="sbc-pcard-badge">🔥 {p.badges[0]}</span>}
                    <button
                      className={`sbc-pcard-like ${likes.includes(p.id) ? "on" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleLike(p.id); }}
                      aria-label="Save"
                    >{likes.includes(p.id) ? "♥" : "♡"}</button>
                    {locked && <span className="sbc-pcard-lock">✓ Locked</span>}
                  </div>
                  <div className="sbc-pcard-body">
                    <div className="sbc-pcard-title">{p.title}</div>
                    <div className="sbc-pcard-loc">📍 {p.locationLabel || `${p.city}${p.state ? `, ${p.state}` : ""}`}</div>
                    <div className="sbc-pcard-rate"><b>{fmtINR(from)}</b><span>/ room / month</span></div>
                    <div className="sbc-pcard-stats">
                      <div><b className="sage">{p.roiMax || p.roiMin}%</b><span>Exp. ROI</span></div>
                      <div><b>{p.occupancyLabel || "High"}</b><span>Occupancy</span></div>
                      <div><b className="gold">{soldOut ? "Sold" : "Open"}</b><span>Demand</span></div>
                    </div>
                    <span className="sbc-pcard-cta">{soldOut && !locked ? "Sold out" : "View & invest →"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ───────── build-bundle CTA ───────── */}
      <section className="sbc-home-sec">
        <Link href="/circle/build" className="sbc-home-bundle">
          <span className="sbc-home-bundle-ic">💎</span>
          <div className="sbc-home-bundle-body">
            <span className="sbc-home-bundle-eyebrow">Final step · Review &amp; pay</span>
            <b>Build Your Investment Bundle</b>
            <span>Combine your locked properties, pick a payment plan &amp; go live.</span>
          </div>
          <span className="sbc-home-bundle-go" aria-hidden>→</span>
        </Link>
      </section>

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
