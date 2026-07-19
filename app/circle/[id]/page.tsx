"use client";

// StayCircle™ — Full Property Tour (/circle/[id]) — v294.
// A hotel-page replica for investment: hero gallery + reel video, then EVERY
// room type shown with an always-visible SELECT + LOCK stepper (all rooms
// actionable — no more "only 1 room shows"), each expandable into a complete
// tour (photo gallery + all amenities + full details via <RoomTourBody/>).
// Selecting a room locks the property + adds it to the shared bundle; the
// stepper unselects. Same sb_circle_room_sel_v1 key as the Step-2 sheet and
// the Plan builder — one source of truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import RoomTourBody from "@/components/circle/RoomTourBody";
import { fmtINR } from "@/lib/circle/engine";

type RoomType = {
  id: string; name: string; monthlyRate: number; totalUnits: number; lockedUnits: number; availableUnits: number;
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
// Shared with the Step-2 room-selection sheet + the Plan builder.
const ROOM_SEL_KEY = "sb_circle_room_sel_v1";

function readSet(key: string): string[] {
  try { const raw = localStorage.getItem(key); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
function writeSet(key: string, arr: string[]) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* full */ }
  // keep the CircleDock lock badge in sync (same event the discover feed fires)
  try { window.dispatchEvent(new Event("sbc:locks-change")); } catch { /* noop */ }
}
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
  const [roomSel, setRoomSel] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!id) return;
    setLocked(readSet(LOCKS_KEY).includes(id));
    setRoomSel(readRoomSel());
    setHydrated(true);
    fetch(`/api/circle/properties/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(String(d.error)); else setP(d.property || null); })
      .catch(() => setErr("Couldn't load this property."))
      .finally(() => setLoading(false));
  }, [id]);

  // persist room selection (only after hydration so the initial empty state
  // never clobbers what the discover sheet / plan builder saved).
  useEffect(() => { if (!hydrated) return; writeRoomSel(roomSel); }, [roomSel, hydrated]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (showVideo) { try { v.load(); } catch { /* noop */ } v.play().catch(() => {}); }
    else v.pause();
  }, [showVideo]);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); }, []);

  const lockNow = useCallback(() => {
    const cur = readSet(LOCKS_KEY);
    if (!cur.includes(id)) {
      writeSet(LOCKS_KEY, Array.from(new Set([...cur, id])));
      const token = localStorage.getItem("sb_token") || "";
      fetch("/api/circle/locks", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ propertyId: id }),
      }).catch(() => {});
    }
    setLocked(true);
  }, [id]);

  // Per-room select/unselect. Selecting a room (v>0) auto-locks the property so
  // the bundle builder picks it up; the stepper down to 0 unselects.
  const setRoom = useCallback((rtId: string, next: number, max: number) => {
    if (!user) { redirectToSignIn(router, { route: `/circle/${id}`, action: "circle_lock" }); return; }
    const v = Math.max(0, Math.min(Math.min(10, max), next));
    setRoomSel((prev) => {
      const out = { ...prev };
      if (v <= 0) delete out[rtId]; else out[rtId] = v;
      return out;
    });
    if (v > 0 && !readSet(LOCKS_KEY).includes(id)) {
      lockNow();
      flash(`🔒 ${p?.title || "Property"} locked — bundle me add ho gaya`);
    }
  }, [user, id, router, p, lockNow, flash]);

  // Lock / unlock toggle from the sticky invest panel. Unlocking releases the
  // server lock AND clears this property's room selections (drops it from the
  // bundle — the "unselect everything" affordance).
  const toggleLock = useCallback(() => {
    if (!p) return;
    if (!user) { redirectToSignIn(router, { route: `/circle/${id}`, action: "circle_lock" }); return; }
    const token = localStorage.getItem("sb_token") || "";
    const cur = readSet(LOCKS_KEY);
    if (locked) {
      writeSet(LOCKS_KEY, cur.filter((x) => x !== id));
      setLocked(false);
      setRoomSel((prev) => {
        const rtIds = new Set(p.roomTypes.map((rt) => rt.id));
        const out: Record<string, number> = {};
        Object.entries(prev).forEach(([k, v]) => { if (!rtIds.has(k)) out[k] = v; });
        return out;
      });
      fetch(`/api/circle/locks?propertyId=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      flash(`🔓 ${p.title} released — rooms bhi hata diye`);
      return;
    }
    lockNow();
    flash(`🔒 ${p.title} locked — now choose rooms below`);
  }, [p, user, id, locked, router, lockNow, flash]);

  const goInvest = useCallback(() => {
    if (!user) { redirectToSignIn(router, { route: `/circle/${id}`, action: "circle_invest" }); return; }
    // ensure locked so the bundle builder picks it up even if no room was tapped
    if (!readSet(LOCKS_KEY).includes(id)) lockNow();
    router.push("/circle/build");
  }, [user, id, router, lockNow]);

  const availRooms = useMemo(() => (p ? p.roomTypes.reduce((s, rt) => s + rt.availableUnits, 0) : 0), [p]);
  const selectedHere = useMemo(
    () => (p ? p.roomTypes.reduce((s, rt) => s + (roomSel[rt.id] || 0), 0) : 0),
    [p, roomSel],
  );
  const selectedMonthly = useMemo(
    () => (p ? p.roomTypes.reduce((s, rt) => s + (roomSel[rt.id] || 0) * rt.monthlyRate, 0) : 0),
    [p, roomSel],
  );
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

          <h2 className="sbc-tour-h2">Choose your rooms</h2>
          {p.roomTypes.length === 0 ? (
            <p className="sbc-tour-desc">Room types are being finalised — lock this property to reserve your spot.</p>
          ) : (
            <>
              <p className="sbc-tour-desc" style={{ marginTop: 4 }}>
                Each room's price + availability is below — <b>tap ＋ to select</b> (the property locks automatically),
                and tap a room to see its full tour (photos, size, amenities).
              </p>
              {p.roomTypes.map((rt) => (
                <RoomCard
                  key={rt.id}
                  rt={rt}
                  fallbackRoi={`${p.roiMin}–${p.roiMax}`}
                  count={roomSel[rt.id] || 0}
                  onSet={(next, max) => setRoom(rt.id, next, max)}
                  open={openRoom === rt.id}
                  onToggle={() => setOpenRoom((cur) => (cur === rt.id ? null : rt.id))}
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

            {selectedHere > 0 && (
              <div className="sbc-tour-selbox">
                <span>✓ {selectedHere} room{selectedHere > 1 ? "s" : ""} selected</span>
                <b>{fmtINR(selectedMonthly)}<small> /mo</small></b>
              </div>
            )}

            <button className={`sbc-tour-invest-cta ${locked ? "locked" : ""}`} onClick={goInvest} disabled={soldOut && !locked && selectedHere === 0}>
              {soldOut && !locked && selectedHere === 0 ? "Join waitlist" : selectedHere > 0 ? `Continue to Plan → (${selectedHere})` : "💎 Start Investing →"}
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
          maxWidth: "90vw", textAlign: "center",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoomCard — always-visible header (name + rate + availability) + an
// always-visible action row (mini-specs + SELECT stepper, so every room is
// actionable without expanding), that expands into the full <RoomTourBody/>.
function RoomCard({
  rt, count, onSet, open, onToggle, fallbackRoi,
}: {
  rt: RoomType;
  count: number;
  onSet: (next: number, max: number) => void;
  open: boolean;
  onToggle: () => void;
  fallbackRoi: string;
}) {
  const avail = rt.availableUnits > 0;
  const max = Math.min(10, rt.availableUnits);
  const miniSpecs = [
    rt.viewLabel ? `👁 ${rt.viewLabel}` : "",
    rt.capacity ? `👥 ${rt.capacity}` : "",
    rt.sizeSqft ? `📐 ${rt.sizeSqft}ft²` : "",
    rt.bedType ? `🛏 ${rt.bedType}` : "",
  ].filter(Boolean).slice(0, 4);

  return (
    <div className={`sbc-rc ${open ? "open" : ""} ${count > 0 ? "picked" : ""}`}>
      <div className="sbc-rc-head" role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
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
      </div>

      {/* action row — always visible, so all rooms are selectable at a glance */}
      <div className="sbc-rc-actionrow">
        <div className="sbc-rc-minispecs">
          {miniSpecs.map((s) => <span key={s}>{s}</span>)}
          <span className="sbc-rc-roi">📈 {rt.roiPct ? `${rt.roiPct}%` : `${fallbackRoi}%`}</span>
        </div>
        <div className="sbc-rc-pick">
          {count > 0 && <span className="sbc-rc-picked">✓ {count} in bundle</span>}
          <div className="sbc-stepper">
            <button onClick={() => onSet(count - 1, max)} disabled={count <= 0} aria-label="Fewer rooms">−</button>
            <span className="val">{count}</span>
            <button onClick={() => onSet(count + 1, max)} disabled={!avail || count >= max} aria-label="More rooms">＋</button>
          </div>
        </div>
      </div>

      {open && (
        <div className="sbc-rc-tourwrap">
          <RoomTourBody rt={rt} fallbackRoi={fallbackRoi} />
        </div>
      )}
    </div>
  );
}
