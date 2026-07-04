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

type RoomType = {
  id: string; name: string; monthlyRate: number; totalUnits: number; lockedUnits: number; availableUnits: number;
  // v291 — real per-room detail for the room tour + comparison
  description?: string; images?: string[]; amenities?: string[];
  sizeSqft?: number; capacity?: number; bedType?: string; viewLabel?: string; roiPct?: number;
};
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
  const [openRoom, setOpenRoom] = useState<string | null>(null); // accordion (single open)
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
          ) : (
            <>
              <p className="sbc-tour-desc" style={{ marginTop: 4 }}>Tap any room for its complete tour — photos, size, amenities and ROI.</p>
              {p.roomTypes.map((rt) => (
                <RoomCard
                  key={rt.id}
                  rt={rt}
                  fallbackRoi={`${p.roiMin}–${p.roiMax}`}
                  open={(openRoom ?? p.roomTypes[0]?.id) === rt.id}
                  onToggle={() => setOpenRoom((cur) => (cur === rt.id ? "" : rt.id))}
                />
              ))}

              {/* auto-comparison across every room type — all real data */}
              {p.roomTypes.length > 1 && (
                <>
                  <h2 className="sbc-tour-h2">Compare all rooms</h2>
                  <div className="sbc-cmp-wrap">
                    <table className="sbc-cmp">
                      <thead>
                        <tr>
                          <th>Room</th>
                          {p.roomTypes.map((rt) => <th key={rt.id}>{rt.name}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const cheapestRate = Math.min(...p.roomTypes.map((r) => r.monthlyRate || Infinity));
                          const topRoi = Math.max(...p.roomTypes.map((r) => Number(r.roiPct) || 0));
                          return (
                            <>
                              <tr>
                                <td>₹ / month</td>
                                {p.roomTypes.map((rt) => (
                                  <td key={rt.id} className={rt.monthlyRate === cheapestRate ? "best" : ""}>
                                    {fmtINR(rt.monthlyRate)}{rt.monthlyRate === cheapestRate && <span className="sbc-cmp-tag">Lowest</span>}
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td>Expected ROI</td>
                                {p.roomTypes.map((rt) => (
                                  <td key={rt.id} className={Number(rt.roiPct) > 0 && Number(rt.roiPct) === topRoi ? "best" : ""}>
                                    {rt.roiPct ? `${rt.roiPct}%` : "—"}{Number(rt.roiPct) > 0 && Number(rt.roiPct) === topRoi && <span className="sbc-cmp-tag">Best</span>}
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td>Room size</td>
                                {p.roomTypes.map((rt) => <td key={rt.id}>{rt.sizeSqft ? `${rt.sizeSqft} sq ft` : "—"}</td>)}
                              </tr>
                              <tr>
                                <td>Sleeps</td>
                                {p.roomTypes.map((rt) => <td key={rt.id}>{rt.capacity ? `${rt.capacity} guest${rt.capacity > 1 ? "s" : ""}` : "—"}</td>)}
                              </tr>
                              <tr>
                                <td>Bed</td>
                                {p.roomTypes.map((rt) => <td key={rt.id}>{rt.bedType || "—"}</td>)}
                              </tr>
                              <tr>
                                <td>View</td>
                                {p.roomTypes.map((rt) => <td key={rt.id}>{rt.viewLabel || "—"}</td>)}
                              </tr>
                              <tr>
                                <td>Available</td>
                                {p.roomTypes.map((rt) => (
                                  <td key={rt.id} style={{ color: rt.availableUnits > 0 ? "var(--sbc-sage)" : "var(--sbc-rose)" }}>
                                    {rt.availableUnits > 0 ? `${rt.availableUnits} / ${rt.totalUnits}` : "Full"}
                                  </td>
                                ))}
                              </tr>
                            </>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

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

// ---------------------------------------------------------------------------
// RoomCard — accordion header (name + rate + availability) that expands into a
// full per-room tour: photo gallery, description, spec grid + amenity chips.
function RoomCard({
  rt, open, onToggle, fallbackRoi,
}: {
  rt: RoomType;
  open: boolean;
  onToggle: () => void;
  fallbackRoi: string;
}) {
  const [gi, setGi] = useState(0);
  const imgs = Array.isArray(rt.images) ? rt.images.filter(Boolean) : [];
  const amen = Array.isArray(rt.amenities) ? rt.amenities.filter(Boolean) : [];
  const avail = rt.availableUnits > 0;

  return (
    <div className={`sbc-rc ${open ? "open" : ""}`}>
      <button className="sbc-rc-head" onClick={onToggle} aria-expanded={open}>
        <div className="sbc-rc-head-l">
          <div className="sbc-rc-name">{rt.name}</div>
          <div className="sbc-rc-avail" style={{ color: avail ? "var(--sbc-sage)" : "var(--sbc-rose)" }}>
            {avail ? `${rt.availableUnits} of ${rt.totalUnits} unit${rt.totalUnits > 1 ? "s" : ""} available` : "Fully subscribed"}
          </div>
        </div>
        <div className="sbc-rc-head-r">
          <div className="sbc-rc-rate"><b>{fmtINR(rt.monthlyRate)}</b><span> /mo</span></div>
          <span className="sbc-rc-chev">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="sbc-rc-body">
          {imgs.length > 0 && (
            <div className="sbc-rc-gallery">
              <div className="sbc-rc-stage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imgs[Math.min(gi, imgs.length - 1)]} alt={rt.name} loading="lazy" />
                {imgs.length > 1 && <span className="sbc-rc-count">{Math.min(gi, imgs.length - 1) + 1} / {imgs.length}</span>}
              </div>
              {imgs.length > 1 && (
                <div className="sbc-rc-thumbs">
                  {imgs.map((src, i) => (
                    <button key={i} className={`sbc-rc-thumb ${i === gi ? "on" : ""}`} onClick={() => setGi(i)} aria-label={`Photo ${i + 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {rt.description && <p className="sbc-rc-desc">{rt.description}</p>}

          <div className="sbc-rc-specs">
            {rt.sizeSqft ? <div className="sbc-rc-spec"><span>Size</span><b>{rt.sizeSqft} sq ft</b></div> : null}
            {rt.capacity ? <div className="sbc-rc-spec"><span>Sleeps</span><b>{rt.capacity} guest{rt.capacity > 1 ? "s" : ""}</b></div> : null}
            {rt.bedType ? <div className="sbc-rc-spec"><span>Bed</span><b>{rt.bedType}</b></div> : null}
            {rt.viewLabel ? <div className="sbc-rc-spec"><span>View</span><b>{rt.viewLabel}</b></div> : null}
            <div className="sbc-rc-spec"><span>Expected ROI</span><b>{rt.roiPct ? `${rt.roiPct}%` : `${fallbackRoi}%`}</b></div>
            <div className="sbc-rc-spec"><span>Availability</span><b style={{ color: avail ? "var(--sbc-sage)" : "var(--sbc-rose)" }}>{avail ? `${rt.availableUnits} / ${rt.totalUnits}` : "Full"}</b></div>
          </div>

          {amen.length > 0 && (
            <div className="sbc-rc-amen">
              {amen.map((a) => <span key={a} className="sbc-rc-amen-chip">{a}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
