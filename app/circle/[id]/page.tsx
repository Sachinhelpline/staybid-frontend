"use client";

// StayCircle™ — Full Property Tour (/circle/[id]) — v289.
// A hotel-page replica for investment: hero gallery + reel video, all room
// types with live availability + lock, ROI/details, "how it works", and a
// sticky invest panel. Lock adds to the bundle (same contract as Discover).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import { fmtINR } from "@/lib/circle/engine";

type RoomType = { id: string; name: string; monthlyRate: number; totalUnits: number; lockedUnits: number; availableUnits: number };
type CircleProperty = {
  id: string; title: string; city: string; state?: string; locationLabel?: string;
  tagline?: string; description?: string; images: string[]; videoUrl?: string | null;
  roomsLabel?: string; viewLabel?: string; monthlyRate: number; roiMin: number; roiMax: number;
  occupancyLabel?: string; badges: string[]; operationModel: string; status: string; roomTypes: RoomType[];
};

const LOCKS_KEY = "sb_circle_locks_v1";
function readSet(key: string): string[] {
  try { const raw = localStorage.getItem(key); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
function writeSet(key: string, arr: string[]) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* full */ } }

const MODEL_LABEL: Record<string, string> = {
  managed: "Fully Managed by StayBid", revenue_share: "Revenue Share", lease: "Lease", franchise: "Franchise",
};

export default function CircleTourPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const id = String(params?.id || "");

  const [p, setP] = useState<CircleProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [imgIdx, setImgIdx] = useState(0);
  const [showVideo, setShowVideo] = useState(false);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!id) return;
    setLocked(readSet(LOCKS_KEY).includes(id));
    fetch(`/api/circle/properties/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(String(d.error)); else setP(d.property || null); })
      .catch(() => setErr("Couldn't load this property."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (showVideo) { try { v.load(); } catch { /* noop */ } v.play().catch(() => {}); }
    else v.pause();
  }, [showVideo]);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 2400); }, []);

  const toggleLock = useCallback(async () => {
    if (!p) return;
    if (!user) { redirectToSignIn(router, { route: `/circle/${id}`, action: "circle_lock" }); return; }
    const token = localStorage.getItem("sb_token") || "";
    const cur = readSet(LOCKS_KEY);
    if (locked) {
      writeSet(LOCKS_KEY, cur.filter((x) => x !== id));
      setLocked(false);
      fetch(`/api/circle/locks?propertyId=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      flash(`🔓 ${p.title} released`);
      return;
    }
    writeSet(LOCKS_KEY, Array.from(new Set([...cur, id])));
    setLocked(true);
    fetch("/api/circle/locks", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propertyId: id }),
    }).catch(() => {});
    flash(`🔒 ${p.title} locked — bundle me add ho gaya`);
  }, [p, user, id, locked, router, flash]);

  const goInvest = useCallback(() => {
    if (!user) { redirectToSignIn(router, { route: `/circle/${id}`, action: "circle_invest" }); return; }
    // ensure locked so the bundle builder picks it up
    const cur = readSet(LOCKS_KEY);
    if (!cur.includes(id)) { writeSet(LOCKS_KEY, Array.from(new Set([...cur, id]))); setLocked(true); }
    router.push("/circle/build");
  }, [user, id, router]);

  const availRooms = useMemo(() => (p ? p.roomTypes.reduce((s, rt) => s + rt.availableUnits, 0) : 0), [p]);
  const cheapest = useMemo(() => {
    if (!p || !p.roomTypes.length) return p?.monthlyRate || 0;
    return Math.min(...p.roomTypes.map((rt) => rt.monthlyRate || p.monthlyRate));
  }, [p]);
  const projMonthly = useMemo(() => (p ? Math.round((cheapest * (p.roiMin + p.roiMax)) / 2 / 100) : 0), [p, cheapest]);

  if (loading) {
    return (
      <div className="sbc-tour">
        <div style={{ height: 320, borderRadius: 26, marginTop: 18, background: "linear-gradient(120deg,#241B10,#3A2C18,#241B10)", backgroundSize: "200% 100%", animation: "sbcShimmerBg 1.4s linear infinite" }} />
        <style>{`@keyframes sbcShimmerBg { to { background-position: -200% 0; } }`}</style>
      </div>
    );
  }
  if (err || !p) {
    return (
      <div className="sbc-tour" style={{ textAlign: "center", paddingTop: 60 }}>
        <div style={{ fontSize: 40 }}>🏔️</div>
        <h2 style={{ fontFamily: "var(--font-display, serif)", fontSize: "1.5rem", color: "var(--sbc-coffee)", marginTop: 10 }}>Property not found</h2>
        <p style={{ color: "rgba(74,56,32,.65)", marginTop: 4 }}>{err || "This StayCircle property may have been unlisted."}</p>
        <Link href="/circle" className="sbc-btn-gold" style={{ display: "inline-flex", marginTop: 18 }}>← Back to Discover</Link>
      </div>
    );
  }

  const soldOut = p.status === "sold_out" || availRooms <= 0;
  const heroImg = p.images[imgIdx] || p.images[0];

  return (
    <div className="sbc-tour">
      <Link href="/circle" className="sbc-tour-back">← Back to reels</Link>

      {/* hero */}
      <div className="sbc-tour-hero">
        {showVideo && p.videoUrl ? (
          <video ref={videoRef} src={p.videoUrl} controls playsInline loop poster={heroImg} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          heroImg ? <img src={heroImg} alt={p.title} /> : null
        )}
        <div className="sbc-tour-hero-shade" />
        {p.videoUrl && (
          <button className="sbc-tour-vidtoggle" onClick={() => setShowVideo((v) => !v)}>
            {showVideo ? "🖼 Photos" : "▶ Play reel"}
          </button>
        )}
        <div className="sbc-tour-hero-cap">
          <h1>{p.title}</h1>
          <div className="loc">📍 {p.locationLabel || p.city}{p.state ? `, ${p.state}` : ""}</div>
        </div>
      </div>

      {/* thumbnails */}
      {p.images.length > 1 && !showVideo && (
        <div className="sbc-tour-thumbs">
          {p.images.map((src, i) => (
            <button key={i} className={`sbc-tour-thumb ${i === imgIdx ? "on" : ""}`} onClick={() => setImgIdx(i)} aria-label={`Photo ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div className="sbc-tour-grid">
        {/* left — details */}
        <div>
          <div className="sbc-tour-badges" style={{ marginTop: 18 }}>
            <span className="sbc-tour-badge roi">📈 {p.roiMin}–{p.roiMax}% expected ROI</span>
            {p.occupancyLabel && <span className="sbc-tour-badge">🔥 {p.occupancyLabel}</span>}
            <span className="sbc-tour-badge">🛎 {MODEL_LABEL[p.operationModel] || p.operationModel}</span>
            {p.badges?.map((b) => <span key={b} className="sbc-tour-badge">{b}</span>)}
          </div>

          {p.tagline && <p className="sbc-tour-desc" style={{ fontStyle: "italic" }}>{p.tagline}</p>}

          <div className="sbc-tour-metrics" style={{ marginTop: 16 }}>
            <div className="sbc-tour-metric"><b><CountUp value={p.monthlyRate} prefix="₹" /></b><span>Per room / month</span></div>
            <div className="sbc-tour-metric"><b><CountUp value={p.roiMax} suffix="%" /></b><span>Peak ROI</span></div>
            <div className="sbc-tour-metric"><b><CountUp value={availRooms} /></b><span>Rooms available</span></div>
            <div className="sbc-tour-metric"><b><CountUp value={projMonthly} prefix="₹" /></b><span>Est. monthly return</span></div>
          </div>

          {p.description && (
            <>
              <h2 className="sbc-tour-h2">About this property</h2>
              <p className="sbc-tour-desc">{p.description}</p>
            </>
          )}

          <h2 className="sbc-tour-h2">Room types &amp; availability</h2>
          {p.roomTypes.length === 0 ? (
            <p className="sbc-tour-desc">Room types are being finalised — lock this property to reserve your spot.</p>
          ) : p.roomTypes.map((rt) => (
            <div key={rt.id} className="sbc-tour-room">
              <div>
                <div className="sbc-tour-room-name">{rt.name}</div>
                <div className="sbc-tour-room-avail" style={{ color: rt.availableUnits > 0 ? "var(--sbc-sage)" : "var(--sbc-rose)" }}>
                  {rt.availableUnits > 0 ? `${rt.availableUnits} of ${rt.totalUnits} unit${rt.totalUnits > 1 ? "s" : ""} available` : "Fully subscribed"}
                </div>
              </div>
              <div className="sbc-tour-room-rate">
                <b>{fmtINR(rt.monthlyRate)}</b><span> /mo</span>
              </div>
            </div>
          ))}

          <h2 className="sbc-tour-h2">How StayCircle works</h2>
          <div className="sbc-tour-how">
            {[
              ["Lock your rooms", "Reserve the room types you want across one or more properties — no payment yet."],
              ["Build your bundle", "Mix cities, pick a payment plan and watch your projected returns update live."],
              ["StayBid runs everything", "Our hospitality team handles pricing, guests, housekeeping and upkeep."],
              ["Earn every month", "Returns are credited monthly with a transparent statement — no lock-in for years."],
            ].map(([t, d], i) => (
              <div key={t} className="sbc-tour-step">
                <div className="n">{i + 1}</div>
                <div><b>{t}</b><p>{d}</p></div>
              </div>
            ))}
          </div>
        </div>

        {/* right — sticky invest panel */}
        <aside>
          <div className="sbc-tour-invest">
            <h3>Invest in {p.title.split(" ").slice(0, 3).join(" ")}</h3>
            <div className="rate">{fmtINR(cheapest)} <span>/ room / month</span></div>
            <div style={{ marginTop: 14 }}>
              <div className="row"><span>Expected ROI</span><b>{p.roiMin}–{p.roiMax}%</b></div>
              <div className="row"><span>Est. monthly return</span><b>{fmtINR(projMonthly)}</b></div>
              <div className="row"><span>Rooms available</span><b>{availRooms}</b></div>
              <div className="row"><span>Operations</span><b>{p.operationModel === "managed" ? "Managed" : MODEL_LABEL[p.operationModel] || p.operationModel}</b></div>
            </div>
            <button className={`sbc-tour-invest-cta ${locked ? "locked" : ""}`} onClick={goInvest} disabled={soldOut && !locked}>
              {soldOut && !locked ? "Join waitlist" : "💎 Start Investing →"}
            </button>
            <button className={`sbc-tour-invest-lock ${locked ? "locked" : ""}`} onClick={toggleLock} disabled={soldOut && !locked}>
              {locked ? "✓ Locked in your bundle — tap to release" : "🔒 Lock this property"}
            </button>
            <p style={{ fontSize: ".72rem", color: "rgba(231,207,160,.6)", marginTop: 12, textAlign: "center" }}>
              Locking is free &amp; non-binding. Payment happens only in the bundle builder.
            </p>
          </div>
        </aside>
      </div>

      {toast && (
        <div style={{
          position: "fixed", left: "50%", transform: "translateX(-50%)",
          bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", zIndex: 90,
          background: "rgba(36,27,16,.94)", color: "#F3E3BF", padding: "10px 18px",
          borderRadius: 999, fontSize: ".85rem", boxShadow: "0 12px 32px -10px rgba(0,0,0,.5)",
        }}>{toast}</div>
      )}
    </div>
  );
}
