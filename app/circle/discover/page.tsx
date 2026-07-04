"use client";

// StayCircle™ — Discover Properties (Step 1)
// v290: full-screen, one-reel-per-screen, swipe-up immersive feed (like the
// StayBid home reel). Topbar + footer hide; the CircleDock owns navigation.
// Each reel autoplays its property video; tap → full property tour
// (/circle/[id], a hotel-page replica). Lock adds to the bundle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { useReelFullscreen } from "@/lib/useReelFullscreen";
import { fmtINR } from "@/lib/circle/engine";

type RoomType = {
  id: string;
  name: string;
  monthlyRate: number;
  totalUnits: number;
  lockedUnits: number;
  availableUnits: number;
  // v292 — per-room detail for the full-screen room-tour reel
  description?: string;
  images?: string[];
  amenities?: string[];
  sizeSqft?: number;
  capacity?: number;
  bedType?: string;
  viewLabel?: string;
  roiPct?: number;
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
  // let the CircleDock badge refresh instantly
  try { window.dispatchEvent(new Event("sbc:locks-change")); } catch { /* noop */ }
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

  // viewport lock (writes --reel-vh, sets body.is-reel-page, hides circle
  // topbar/footer via CSS). immersive:false → NO forced native fullscreen on
  // the property/room screens (Sachin: "full screen forcefully hota hai usko
  // remove karo"). The reel stays full-bleed via --reel-vh; the browser is
  // never pushed into system fullscreen.
  useReelFullscreen({ immersive: false });

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("all");
  const [model, setModel] = useState("all");
  const [budget, setBudget] = useState(100000); // ₹/room/month ceiling
  const [likes, setLikes] = useState<string[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);

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
    // dock "Rooms" from another page navigates here with ?rooms=1
    try {
      if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("rooms") === "1") {
        setRoomsOpen(true);
      }
    } catch { /* noop */ }
  }, []);

  // dock Step-2 "Rooms" opens the room-tour overlay; dock Step-1 "Property"
  // dispatches sbc:rooms-close to shut it (so tapping Property while the room
  // overlay is up never leaves it "stuck" behind the property feed — v293.3).
  useEffect(() => {
    const onRooms = () => setRoomsOpen(true);
    const onRoomsClose = () => setRoomsOpen(false);
    window.addEventListener("sbc:rooms", onRooms);
    window.addEventListener("sbc:rooms-close", onRoomsClose);
    return () => {
      window.removeEventListener("sbc:rooms", onRooms);
      window.removeEventListener("sbc:rooms-close", onRoomsClose);
    };
  }, []);

  // Broadcast the overlay's open/closed state so CircleDock can light up the
  // correct step (Rooms active when open, Property when closed) instead of
  // always showing Property active on /circle/discover (the "stuck" visual).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("sbc:rooms-state", { detail: { open: roomsOpen } }));
  }, [roomsOpen]);
  // Tell the dock the overlay is gone when we navigate away from this route.
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("sbc:rooms-state", { detail: { open: false } }));
    };
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

  // ------- filters -------
  const filtered = useMemo(() => {
    return props.filter((p) => {
      if (city !== "all" && String(p.city).toLowerCase() !== city.toLowerCase()) return false;
      if (model !== "all" && p.operationModel !== model) return false;
      if (budget < 100000 && p.monthlyRate > budget) return false;
      return true;
    });
  }, [props, city, model, budget]);

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

  // "Lock for Investment" from a reel — ensure the property is locked, then jump to the
  // bundle builder. Distinct from Lock (top pill): this drives the customer
  // forward into checkout, it is NOT a duplicate lock toggle.
  const investFromReel = useCallback((p: CircleProperty) => {
    if (!user) {
      redirectToSignIn(router, { route: "/circle/discover", action: "circle_invest" });
      return;
    }
    setLocks((prev) => {
      if (prev.includes(p.id)) return prev;
      const n = [...prev, p.id];
      writeSet(LOCKS_KEY, n);
      const token = localStorage.getItem("sb_token") || "";
      fetch("/api/circle/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ propertyId: p.id }),
      }).catch(() => {});
      return n;
    });
    router.push("/circle/build");
  }, [user, router]);

  // Remove a locked property directly from the room-select sheet.
  const removeLock = useCallback((propertyId: string, title: string) => {
    setLocks((prev) => {
      if (!prev.includes(propertyId)) return prev;
      const n = prev.filter((x) => x !== propertyId);
      writeSet(LOCKS_KEY, n);
      const token = localStorage.getItem("sb_token") || "";
      fetch(`/api/circle/locks?propertyId=${encodeURIComponent(propertyId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      return n;
    });
    flash(`🔓 ${title} released from your bundle`);
  }, [flash]);

  const filterActive = city !== "all" || model !== "all" || budget < 100000;
  const filterLabel = filterActive
    ? [city !== "all" ? `📍 ${city}` : null, model !== "all" ? MODEL_LABEL[model] : null, budget < 100000 ? `≤ ${fmtINR(budget)}` : null]
        .filter(Boolean).join(" · ")
    : "All properties · India";

  return (
    <>
      {/* floating filter chip */}
      {!loading && (
        <button className="sbc-rfilter-chip" onClick={() => setFilterOpen(true)}>
          <span>⚙</span>{filterLabel}<span style={{ opacity: .6 }}>▾</span>
        </button>
      )}

      {/* list-a-property entry — owners submit a property for lease / rent
          (routes to the PUBLIC lease-onboarding panel, NOT the admin editor). */}
      {!loading && (
        <button className="sbc-rlist-chip" onClick={() => router.push("/host/list-property")} aria-label="List a property">
          <span>＋</span> List property
        </button>
      )}

      {/* ============ immersive reel feed ============ */}
      <div className="sbc-rapp">
        {loading ? (
          <>
            <div className="sbc-rfull-skel" />
            <div className="sbc-rfull-skel" />
          </>
        ) : filtered.length === 0 ? (
          <div className="sbc-rfull-empty">
            <div>
              <div style={{ fontSize: 44 }}>🏔️</div>
              <p style={{ marginTop: 10, color: "rgba(251,243,226,.8)", maxWidth: 300 }}>
                Is filter me abhi koi property nahi — budget ya city change karke dekhein.
              </p>
              <button className="sbc-rfull-btn-invest" style={{ marginTop: 16, padding: "0 22px" }}
                onClick={() => { setCity("all"); setModel("all"); setBudget(100000); }}>
                Reset filters
              </button>
            </div>
          </div>
        ) : (
          filtered.map((p, i) => (
            <FullReel
              key={p.id}
              p={p}
              first={i === 0}
              liked={likes.includes(p.id)}
              locked={locks.includes(p.id)}
              onLike={() => toggleLike(p.id)}
              onInvest={() => investFromReel(p)}
              onShare={() => share(p)}
              onOpen={() => router.push(`/circle/${p.id}`)}
            />
          ))
        )}
      </div>

      {/* ============ filter bottom sheet ============ */}
      {filterOpen && (
        <>
          <div className="sbc-sheet-bd" onClick={() => setFilterOpen(false)} />
          <div className="sbc-sheet" role="dialog" aria-label="Filters">
            <div className="sbc-sheet-grab" />
            <div className="sbc-sheet-h">Filter properties</div>
            <div className="sbc-sheet-sub">{filtered.length} {filtered.length === 1 ? "property" : "properties"} match</div>

            <div className="sbc-sheet-grp">
              <div className="sbc-sheet-grp-t">📍 Location</div>
              <div className="sbc-fbar-chips">
                <button className={`sbc-fbar-chip ${city === "all" ? "on" : ""}`} onClick={() => setCity("all")}>🌐 Anywhere</button>
                {cities.map((c) => (
                  <button key={c} className={`sbc-fbar-chip ${city === c ? "on" : ""}`} onClick={() => setCity(c)}>{c}</button>
                ))}
              </div>
            </div>

            <div className="sbc-sheet-grp">
              <div className="sbc-sheet-grp-t">⚙ Operating model</div>
              <div className="sbc-fbar-chips">
                {MODELS.map((m) => (
                  <button key={m.key} className={`sbc-fbar-chip ${model === m.key ? "on" : ""}`} onClick={() => setModel(m.key)}>{m.label}</button>
                ))}
              </div>
            </div>

            <div className="sbc-sheet-grp">
              <div className="sbc-sheet-grp-t">₹ Max monthly investment / room</div>
              <div className="sbc-fbar-budget-val">{budget >= 100000 ? "Any budget" : `Up to ${fmtINR(budget)}`}</div>
              <input className="sbc-fbar-range" type="range" min={20000} max={100000} step={5000} value={budget}
                onChange={(e) => setBudget(Number(e.target.value))} />
              <div className="sbc-fbar-chips" style={{ marginTop: 10 }}>
                {BUDGET_STOPS.map((b) => (
                  <button key={b} className={`sbc-fbar-chip ${budget === b ? "on" : ""}`} onClick={() => setBudget(b)}>
                    {b >= 100000 ? "Any" : `≤ ${fmtINR(b)}`}
                  </button>
                ))}
              </div>
            </div>

            <button className="sbc-sheet-btn" onClick={() => setFilterOpen(false)}>
              Show {filtered.length} {filtered.length === 1 ? "property" : "properties"}
            </button>
          </div>
        </>
      )}

      {/* ============ room-selection sheet (Step 2) ============ */}
      {roomsOpen && (
        <RoomSelectSheet
          props={props}
          locks={locks}
          onClose={() => setRoomsOpen(false)}
          onContinue={() => { setRoomsOpen(false); router.push("/circle/build"); }}
          onRemoveLock={removeLock}
          onOpenProperty={(id) => router.push(`/circle/${id}`)}
        />
      )}

      {/* toast */}
      {toast && (
        <div style={{
          position: "fixed", left: "50%", transform: "translateX(-50%)",
          bottom: "calc(84px + env(safe-area-inset-bottom, 0px))", zIndex: 90,
          background: "rgba(36,27,16,.94)", color: "#F3E3BF", padding: "10px 18px",
          borderRadius: 999, fontSize: ".85rem", boxShadow: "0 12px 32px -10px rgba(0,0,0,.5)",
        }}>{toast}</div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Full-viewport reel — autoplay video on view, action rail, top chip, CTAs.
// v291: media + all overlays live inside a native 9:16 stage (portrait on
// wide screens, full-bleed on phones); info + CTAs share ONE bottom flex
// container so they can never overlap on any device.
function FullReel({
  p, first, liked, locked, onLike, onInvest, onShare, onOpen,
}: {
  p: CircleProperty;
  first: boolean;
  liked: boolean;
  locked: boolean;
  onLike: () => void;
  onInvest: () => void;
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
      (entries) => entries.forEach((e) => setInView(e.isIntersecting && e.intersectionRatio > 0.6)),
      { threshold: [0, 0.6, 1] },
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
  const initials = (p.title || "SC").trim().slice(0, 1).toUpperCase();

  return (
    <div className="sbc-rfull" ref={wrapRef}>
      {/* native 9:16 stage — full-bleed on phones, centered portrait on wide */}
      <div className="sbc-rfull-stage" onClick={onOpen} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
        <div className="sbc-rfull-media">
          {/* persistent poster base layer — guarantees the reel is never
              black even if the video fails to load / autoplay (desktop) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {poster ? <img className="sbc-rfull-poster" src={poster} alt={p.title} loading="lazy" /> : null}
          {/* video overlays the poster once the card is in view */}
          {p.videoUrl && inView ? (
            <video className="sbc-rfull-vid" ref={videoRef} src={p.videoUrl} muted={muted} playsInline loop preload="none" poster={poster} />
          ) : null}
        </div>
        <div className="sbc-rfull-shade" />

        {/* top: property chip only — the single "Lock for Investment" CTA
            below is the sole lock action (v291.2, removed the duplicate
            Bundle pill). A small "✓ Locked" tag shows current state. */}
        <div className="sbc-rfull-top" onClick={(e) => e.stopPropagation()}>
          <div className="sbc-rfull-chip" onClick={onOpen} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
            {poster
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="sbc-rfull-ava" src={poster} alt="" />
              : <span className="sbc-rfull-ava">{initials}</span>}
            <div className="sbc-rfull-hand">
              <b>{p.title}</b>
              <span>📍 {p.locationLabel || `${p.city}${p.state ? `, ${p.state}` : ""}`}</span>
            </div>
          </div>
          {locked && <span className="sbc-rfull-locktag">✓ Locked</span>}
        </div>

        {/* right action rail */}
        <div className="sbc-rfull-rail" onClick={(e) => e.stopPropagation()}>
          <button className={`sbc-rail-btn ${liked ? "on" : ""}`} onClick={onLike} aria-label="Like">
            <span className="sbc-rail-ic">{liked ? "♥" : "♡"}</span>
            <span className="sbc-rail-cap">Save</span>
          </button>
          <button className="sbc-rail-btn" onClick={onShare} aria-label="Share">
            <span className="sbc-rail-ic">↗</span>
            <span className="sbc-rail-cap">Share</span>
          </button>
          {p.videoUrl && (
            <button className="sbc-rail-btn" onClick={() => setMuted((m) => !m)} aria-label="Mute">
              <span className="sbc-rail-ic">{muted ? "🔇" : "🔊"}</span>
              <span className="sbc-rail-cap">{muted ? "Muted" : "Sound"}</span>
            </button>
          )}
          <button className="sbc-rail-btn" onClick={onOpen} aria-label="Details">
            <span className="sbc-rail-ic">ⓘ</span>
            <span className="sbc-rail-cap">Tour</span>
          </button>
        </div>

        {/* bottom block — info + CTAs stacked in ONE flex column (no overlap) */}
        <div className="sbc-rfull-bottom" onClick={(e) => e.stopPropagation()}>
          <div className="sbc-rfull-info">
            <div className="sbc-rfull-badges">
              <span className="sbc-rfull-badge roi">📈 up to {p.roiMax}% ROI</span>
              {p.occupancyLabel && <span className="sbc-rfull-badge">🔥 {p.occupancyLabel}</span>}
              <span className="sbc-rfull-badge">🛎 {p.operationModel === "managed" ? "Fully Managed" : MODEL_LABEL[p.operationModel] || p.operationModel}</span>
            </div>
            <div className="sbc-rfull-title">{p.title}</div>
            <div className="sbc-rfull-sub">{p.roomsLabel || p.viewLabel || `${p.city}${p.state ? `, ${p.state}` : ""}`}</div>
            <div className="sbc-rfull-rate"><b>{fmtINR(p.monthlyRate)}</b><span>/ room / month</span></div>
          </div>

          <div className="sbc-rfull-ctas">
            <button className="sbc-rfull-btn-tour" onClick={onOpen}>▶ View full tour</button>
            <button className={`sbc-rfull-btn-invest ${locked ? "islocked" : ""}`} onClick={onInvest} disabled={soldOut && !locked}>
              {soldOut && !locked ? "Sold out" : locked ? "✓ Locked · View bundle →" : "🔒 Lock for Investment"}
            </button>
          </div>
        </div>

        {first && <div className="sbc-rfull-hint">Swipe up for more ↑</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room-selection sheet (Step 2, v293.4) — replaces the confusing full-screen
// per-room video reel with a clean, scannable "choose your rooms" list.
//
// One section per LOCKED property; every available room is a compact card with
// photo + rate + units-left + ROI + a familiar quantity stepper (the same
// .sbc-stepper used on the Plan step). A live sticky bottom bar totals the
// picks and sends them to Step 3 "Plan". Selections persist to
// sb_circle_room_sel_v1 (roomTypeId → count), which /circle/build reads to
// pre-fill its steppers — one shared source of truth, no lock-contract change.
const ROOM_SEL_KEY = "sb_circle_room_sel_v1";

function readRoomSel(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ROOM_SEL_KEY);
    const o = raw ? JSON.parse(raw) : {};
    if (o && typeof o === "object") {
      const out: Record<string, number> = {};
      Object.entries(o).forEach(([k, v]) => {
        const n = Math.floor(Number(v));
        if (n > 0) out[k] = Math.min(10, n);
      });
      return out;
    }
  } catch { /* noop */ }
  return {};
}
function writeRoomSel(sel: Record<string, number>) {
  try { localStorage.setItem(ROOM_SEL_KEY, JSON.stringify(sel)); } catch { /* full */ }
}

function RoomSelectSheet({
  props, locks, onClose, onContinue, onRemoveLock, onOpenProperty,
}: {
  props: CircleProperty[];
  locks: string[];
  onClose: () => void;
  onContinue: () => void;
  onRemoveLock: (propertyId: string, title: string) => void;
  onOpenProperty: (id: string) => void;
}) {
  const lockedProps = props.filter((p) => locks.includes(p.id));
  const usingLocked = lockedProps.length > 0;

  // per-room-type selected count, seeded from + persisted to localStorage so it
  // flows straight into /circle/build's steppers.
  const [sel, setSel] = useState<Record<string, number>>(() => readRoomSel());
  useEffect(() => { writeRoomSel(sel); }, [sel]);

  const setRoom = useCallback((rtId: string, next: number, max: number) => {
    setSel((prev) => {
      const v = Math.max(0, Math.min(Math.min(10, max), next));
      const out = { ...prev };
      if (v <= 0) delete out[rtId]; else out[rtId] = v;
      return out;
    });
  }, []);

  // "＋ Add all rooms" — one of each available room type in this property.
  const addAll = useCallback((p: CircleProperty) => {
    setSel((prev) => {
      const out = { ...prev };
      p.roomTypes.forEach((rt) => {
        if (rt.availableUnits > 0 && !(out[rt.id] > 0)) out[rt.id] = 1;
      });
      return out;
    });
  }, []);

  // live totals over the locked properties' rooms only.
  const { totalRooms, totalMonthly, propCount } = useMemo(() => {
    let rooms = 0, monthly = 0; const propSet = new Set<string>();
    lockedProps.forEach((p) => {
      p.roomTypes.forEach((rt) => {
        const c = sel[rt.id] || 0;
        if (c > 0) { rooms += c; monthly += rt.monthlyRate * c; propSet.add(p.id); }
      });
    });
    return { totalRooms: rooms, totalMonthly: monthly, propCount: propSet.size };
  }, [lockedProps, sel]);

  return (
    <div className="sbc-rsel-app" role="dialog" aria-label="Choose your rooms">
      {/* header */}
      <div className="sbc-rsel-top">
        <button className="sbc-rsel-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sbc-rsel-title">
          <b>🛏 Choose your rooms</b>
          <span>
            {usingLocked
              ? `${lockedProps.length} locked ${lockedProps.length === 1 ? "property" : "properties"} · pick rooms for your bundle`
              : "Lock a property in Step 1 first"}
          </span>
        </div>
      </div>

      {/* body */}
      <div className="sbc-rsel-scroll">
        {!usingLocked ? (
          <div className="sbc-rsel-empty">
            <div style={{ fontSize: 46 }}>🔒</div>
            <p>Abhi koi property locked nahi. Step 1 me koi property choose karo, fir uske rooms yahan select honge.</p>
            <button className="sbc-btn-gold" style={{ marginTop: 4 }}
              onClick={() => { try { window.dispatchEvent(new Event("sbc:rooms-close")); } catch { /* noop */ } }}>
              ← Choose a property
            </button>
          </div>
        ) : (
          lockedProps.map((p) => {
            const picked = p.roomTypes.reduce((s, rt) => s + (sel[rt.id] || 0), 0);
            const hasAvail = p.roomTypes.some((rt) => rt.availableUnits > 0);
            return (
              <div className="sbc-rsel-prop" key={p.id}>
                {/* property header */}
                <div className="sbc-rsel-phead">
                  <button className="sbc-rsel-pthumb" onClick={() => onOpenProperty(p.id)} aria-label={`Open ${p.title}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.images[0]} alt={p.title} loading="lazy" />
                  </button>
                  <div className="sbc-rsel-pinfo">
                    <b onClick={() => onOpenProperty(p.id)}>{p.title}</b>
                    <span>📍 {p.city}{p.state ? `, ${p.state}` : ""} · 📈 {p.roiMin}–{p.roiMax}% ROI</span>
                    {picked > 0 && <em>✓ {picked} room{picked > 1 ? "s" : ""} selected</em>}
                  </div>
                  <div className="sbc-rsel-pactions">
                    {hasAvail && (
                      <button className="sbc-rsel-all" onClick={() => addAll(p)}>＋ All rooms</button>
                    )}
                    <button className="sbc-rsel-remove" onClick={() => onRemoveLock(p.id, p.title)} aria-label={`Remove ${p.title}`}>
                      ✕ Remove
                    </button>
                  </div>
                </div>

                {/* room rows */}
                <div className="sbc-rsel-rooms">
                  {p.roomTypes.length === 0 && (
                    <div className="sbc-rsel-noroom">Is property ke rooms abhi list nahi hue.</div>
                  )}
                  {p.roomTypes.map((rt) => {
                    const v = sel[rt.id] || 0;
                    const avail = rt.availableUnits > 0;
                    const max = Math.min(10, rt.availableUnits);
                    const img = (Array.isArray(rt.images) && rt.images[0]) || p.images[0];
                    const roi = rt.roiPct && rt.roiPct > 0 ? `${rt.roiPct}%` : `${p.roiMin}–${p.roiMax}%`;
                    const specs = [
                      rt.viewLabel ? `👁 ${rt.viewLabel}` : "",
                      rt.capacity ? `👥 ${rt.capacity}` : "",
                      rt.sizeSqft ? `📐 ${rt.sizeSqft}ft²` : "",
                      rt.bedType ? `🛏 ${rt.bedType}` : "",
                    ].filter(Boolean).slice(0, 3);
                    return (
                      <div key={rt.id} className={`sbc-rsel-room ${v > 0 ? "on" : ""} ${avail ? "" : "gone"}`}>
                        <div className="sbc-rsel-rthumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={rt.name} loading="lazy" />
                          <span className="sbc-rsel-roi">📈 {roi}</span>
                        </div>
                        <div className="sbc-rsel-rinfo">
                          <b>{rt.name}</b>
                          <div className="sbc-rsel-rrate">
                            <strong>{fmtINR(rt.monthlyRate)}</strong><span>/mo</span>
                            <em className={avail ? "" : "sold"}>
                              {avail ? `${rt.availableUnits} of ${rt.totalUnits} available` : "Fully subscribed"}
                            </em>
                          </div>
                          {specs.length > 0 && (
                            <div className="sbc-rsel-rspecs">
                              {specs.map((s) => <span key={s}>{s}</span>)}
                            </div>
                          )}
                        </div>
                        <div className="sbc-rsel-rpick">
                          <div className="sbc-stepper">
                            <button onClick={() => setRoom(rt.id, v - 1, max)} disabled={v <= 0} aria-label="Fewer rooms">−</button>
                            <span className="val">{v}</span>
                            <button onClick={() => setRoom(rt.id, v + 1, max)} disabled={!avail || v >= max} aria-label="More rooms">＋</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* sticky bottom bar */}
      {usingLocked && (
        <div className="sbc-rsel-bar">
          <div className="sbc-rsel-bar-info">
            <b>{fmtINR(totalMonthly)}<small>/mo</small></b>
            <span>{totalRooms} room{totalRooms === 1 ? "" : "s"} · {propCount} propert{propCount === 1 ? "y" : "ies"}</span>
          </div>
          <button className="sbc-rsel-cta" onClick={onContinue}>
            {totalRooms > 0 ? "Continue to Plan →" : "Pick rooms · Plan →"}
          </button>
        </div>
      )}
    </div>
  );
}
