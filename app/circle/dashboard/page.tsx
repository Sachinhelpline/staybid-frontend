"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — Dashboard  (v293)
//
// The Airbnb-style account hub for the /circle vertical. Replaces the old
// "StayBid ↩" dock slot. Gives the investor: profile, a mode-switch (Travelling
// ⇄ StayCircle host/investor, + Hotel Partner + Hosts), a complete dashboard
// (portfolio · bundle · properties · calendar · city · listings) and account
// controls — everything in one perfect place, like Airbnb's menu.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  computeBundle, fmtINR,
  DEFAULT_CIRCLE_REVENUE, type BundleItem, type CircleRevenueConfig,
} from "@/lib/circle/engine";

type CircleProperty = {
  id: string;
  title: string;
  city: string;
  state?: string;
  locationLabel?: string;
  images: string[];
  monthlyRate: number;
  roiMin: number;
  roiMax: number;
  status: string;
  roomTypes: { id: string; monthlyRate: number }[];
};

const LOCKS_KEY = "sb_circle_locks_v1";
// v297.5 — same room-selection key + reader as /circle home + /circle/build, so
// the dashboard "Committed / month" strip reads the SAME source through the SAME
// engine (no more LOCKS-only cheapest-room drift vs the wizard).
const ROOM_SEL_KEY = "sb_circle_room_sel_v1";

function readSet(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

function readRoomSel(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ROOM_SEL_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, number> = {};
    Object.entries(obj).forEach(([k, v]) => {
      const n = Math.min(10, Math.floor(Number(v) || 0));
      if (n > 0) out[k] = n;
    });
    return out;
  } catch { return {}; }
}

export default function CircleDashboardPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  const [roomSel, setRoomSel] = useState<Record<string, number>>({});
  const [revConfig, setRevConfig] = useState<CircleRevenueConfig>(DEFAULT_CIRCLE_REVENUE);
  // Panel-access gating (v294.16). StayCircle is always the active panel and
  // Travelling is open to everyone; Hotel Partner + For Hosts stay 🔒 LOCKED
  // unless the user is actually a partner / host. The dashboard is Circle's
  // own hub — the Switch cards exist only so one app reaches every panel.
  const [hasPartner, setHasPartner] = useState(false);
  // Phase 3d — does this investor own any provisioned physical rooms yet?
  // Drives the "Manage your rooms →" handoff into the partner dashboard's
  // operator "My Rooms" tab.
  const [ownsRooms, setOwnsRooms] = useState<{ ownsUnits: boolean; unitCount: number; hotelCount: number }>({ ownsUnits: false, unitCount: 0, hotelCount: 0 });

  useEffect(() => {
    setLocks(readSet(LOCKS_KEY));
    setRoomSel(readRoomSel());
    // Hotel-partner unlock signal: a partner-panel session token exists.
    try { setHasPartner(!!localStorage.getItem("sb_partner_token")); } catch { /* noop */ }
    fetch("/api/circle/properties")
      .then((r) => r.json())
      .then((d) => setProps(Array.isArray(d?.properties) ? d.properties : []))
      .catch(() => {});
    fetch("/api/circle/revenue-config")
      .then((r) => r.json())
      .then((d) => { if (d?.config) setRevConfig(d.config as CircleRevenueConfig); })
      .catch(() => {});
  }, []);

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
    // Owned-rooms signal — same cross-pool id resolver the partner dashboard
    // uses, so the count here matches what the operator sees after signing in.
    fetch("/api/circle/owned-summary", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setOwnsRooms({
        ownsUnits: !!d?.ownsUnits,
        unitCount: Number(d?.unitCount || 0),
        hotelCount: Number(d?.hotelCount || 0),
      }))
      .catch(() => {});
  }, [user]);

  const lockedProps = useMemo(() => props.filter((p) => locks.includes(p.id)), [props, locks]);

  // v297.5 — SINGLE source of truth for the portfolio strip, identical to the
  // /circle home snapshot: PRIMARY = real room selection (sb_circle_room_sel_v1)
  // run through computeBundle(+revConfig); FALLBACK = locked-property cheapest-
  // room preview. Both routes now show the exact same "Committed / month".
  const snapshot = useMemo(() => {
    const selItems: BundleItem[] = [];
    props.forEach((p) => {
      (p.roomTypes || []).forEach((rt) => {
        const rooms = roomSel[rt.id] || 0;
        if (rooms > 0 && Number(rt.monthlyRate) > 0) {
          selItems.push({
            propertyId: p.id,
            propertyTitle: p.title,
            city: p.city,
            roomTypeId: rt.id,
            roomTypeName: "",
            monthlyRate: rt.monthlyRate,
            rooms,
            roiMin: p.roiMin,
            roiMax: p.roiMax,
          });
        }
      });
    });
    if (selItems.length) {
      const b = computeBundle(selItems, "monthly", revConfig);
      if (b.ok) return { committed: b.monthlyTotal, propCount: b.propertyCount };
    }
    // Fallback — locked-property cheapest-room preview.
    const committed = lockedProps.reduce((s, p) => {
      const rates = (p.roomTypes || []).map((r) => r.monthlyRate).filter((n) => n > 0);
      return s + (rates.length ? Math.min(...rates) : p.monthlyRate);
    }, 0);
    return { committed, propCount: lockedProps.length };
  }, [props, roomSel, lockedProps, revConfig]);
  const committed = snapshot.committed;

  const name = (user?.name || "").trim() || "Investor";
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "SC";
  const phone = user?.phone ? String(user.phone).replace(/(\d{2})\d{4,}(\d{2})/, "$1••••$2") : "";

  const doLogout = () => {
    try { logout(); } catch { /* noop */ }
    router.push("/circle");
  };

  return (
    <div className="sbc-dash">
      {/* header */}
      <header className="sbc-dash-head">
        <Link href="/circle" className="sbc-dash-back" aria-label="Home">←</Link>
        <span className="sbc-dash-title">Dashboard</span>
        <span style={{ width: 34 }} />
      </header>

      {/* profile */}
      <section className="sbc-dash-profile">
        <div className="sbc-dash-ava">{initials}</div>
        <div className="sbc-dash-who">
          <b>{name}</b>
          <span>{phone ? `📱 ${phone} · ` : ""}StayCircle Partner</span>
        </div>
        {user ? (
          <Link href="/circle/profile" className="sbc-dash-edit">Edit</Link>
        ) : (
          <Link href="/auth" className="sbc-dash-edit gold">Sign in</Link>
        )}
      </section>

      {/* portfolio strip */}
      <Link href="/circle/me" className="sbc-dash-strip">
        <div>
          <span className="sbc-dash-strip-k">Committed / month</span>
          <b className="sbc-dash-strip-v">{committed > 0 ? fmtINR(committed) : "₹0"}</b>
        </div>
        <div>
          <span className="sbc-dash-strip-k">Properties</span>
          <b className="sbc-dash-strip-v">{lockedProps.length}</b>
        </div>
        <span className="sbc-dash-strip-go">View portfolio →</span>
      </Link>

      {/* ───────── manage your rooms handoff (Phase 3d) ───────── */}
      {ownsRooms.ownsUnits && (
        <Link
          href={hasPartner ? "/partner/dashboard" : "/partner"}
          className="sbc-dash-strip sbc-dash-rooms"
        >
          <div>
            <span className="sbc-dash-strip-k">🛏️ Your rooms are live</span>
            <b className="sbc-dash-strip-v">
              {ownsRooms.unitCount} {ownsRooms.unitCount === 1 ? "room" : "rooms"}
              {ownsRooms.hotelCount > 1 ? ` · ${ownsRooms.hotelCount} properties` : ""}
            </b>
          </div>
          <span className="sbc-dash-strip-go">
            {hasPartner ? "Manage your rooms →" : "Sign in to manage →"}
          </span>
        </Link>
      )}

      {/* ───────── switch experience (v324 — opens the global panel switcher) ─────────
          Upgraded from the old hand-maintained 4-card grid (which drifted —
          missing Kiosk / Worker / Creator / List-a-Property) to the single
          always-complete Airbnb-style switcher shared by every panel. */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Switch experience</div>
        <button
          type="button"
          className="sbc-dash-strip"
          style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" }}
          onClick={() => window.dispatchEvent(new Event("sb:open-switcher"))}
        >
          <div>
            <span className="sbc-dash-strip-k">⇅ All of StayBid · one account</span>
            <b className="sbc-dash-strip-v">Travelling · Partner · Hosts · Creator · Kiosk</b>
          </div>
          <span className="sbc-dash-strip-go">Switch →</span>
        </button>
      </section>

      {/* ───────── dashboard tiles ───────── */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Your dashboard</div>
        <div className="sbc-dash-tiles">
          <Link href="/circle/me" className="sbc-dash-tile"><span>📊</span>Portfolio</Link>
          <Link href="/circle/build" className="sbc-dash-tile"><span>💎</span>My Bundle</Link>
          <Link href="/circle/discover" className="sbc-dash-tile"><span>🏡</span>Properties</Link>
          <Link href="/circle/me" className="sbc-dash-tile"><span>📅</span>Payouts</Link>
          <Link href="/circle/discover" className="sbc-dash-tile"><span>🏙</span>By City</Link>
          <Link href="/circle/model2/browse" className="sbc-dash-tile"><span>🧾</span>Buy inventory</Link>
          <Link href="/circle/model2/selling" className="sbc-dash-tile"><span>🏷️</span>Selling Inventory</Link>
          <Link href="/circle/me?tab=city" className="sbc-dash-tile"><span>🗝️</span>City Access</Link>
        </div>
      </section>

      {/* ───────── my properties · view live ───────── */}
      {lockedProps.length > 0 && (
        <section className="sbc-dash-sec">
          <div className="sbc-dash-sec-h between">
            <span>My properties</span>
            <Link href="/circle/build" className="sbc-dash-seemore">Build →</Link>
          </div>
          <div className="sbc-dash-plist">
            {lockedProps.map((p) => (
              <Link key={p.id} href={`/circle/${p.id}`} className="sbc-dash-prow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.images?.[0] ? <img src={p.images[0]} alt="" loading="lazy" /> : <span className="sbc-dash-pnoimg">◎</span>}
                <div className="sbc-dash-pinfo">
                  <b>{p.title}</b>
                  <span>📍 {p.city}{p.state ? `, ${p.state}` : ""} · {p.roiMax || p.roiMin}% ROI</span>
                </div>
                <span className="sbc-dash-plive">View live ↗</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ───────── account ───────── */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Account</div>
        <div className="sbc-dash-links">
          <Link href="/circle/profile" className="sbc-dash-link"><span>⚙</span>Profile &amp; settings<em>›</em></Link>
          <Link href="/circle/kyc" className="sbc-dash-link"><span>✅</span>KYC &amp; verification<em>›</em></Link>
          <Link href="/circle/earnings" className="sbc-dash-link"><span>💰</span>Earnings &amp; payouts<em>›</em></Link>
          <Link href="/circle/support" className="sbc-dash-link"><span>💬</span>Help &amp; support<em>›</em></Link>
          {user && (
            <button className="sbc-dash-link danger" onClick={doLogout}><span>↩</span>Sign out<em></em></button>
          )}
        </div>
      </section>

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
