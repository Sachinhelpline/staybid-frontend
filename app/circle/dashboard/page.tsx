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
import { fmtINR } from "@/lib/circle/engine";

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

function readSet(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

const HOST_PANEL = "https://staybid-hotel-panel.vercel.app";

export default function CircleDashboardPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [locks, setLocks] = useState<string[]>([]);
  // Panel-access gating (v294.16). StayCircle is always the active panel and
  // Travelling is open to everyone; Hotel Partner + For Hosts stay 🔒 LOCKED
  // unless the user is actually a partner / host. The dashboard is Circle's
  // own hub — the Switch cards exist only so one app reaches every panel.
  const [hasPartner, setHasPartner] = useState(false);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    setLocks(readSet(LOCKS_KEY));
    // Hotel-partner unlock signal: a partner-panel session token exists.
    try { setHasPartner(!!localStorage.getItem("sb_partner_token")); } catch { /* noop */ }
    fetch("/api/circle/properties")
      .then((r) => r.json())
      .then((d) => setProps(Array.isArray(d?.properties) ? d.properties : []))
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
    // Host unlock signal: any activity across the StayBid-for-Hosts modules
    // (a lead, inquiry, portfolio, order, workforce job, channel request…).
    fetch("/api/host/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setIsHost(Number(d?.summary?.total || 0) > 0))
      .catch(() => {});
  }, [user]);

  const lockedProps = useMemo(() => props.filter((p) => locks.includes(p.id)), [props, locks]);
  const committed = useMemo(
    () => lockedProps.reduce((s, p) => {
      const rates = (p.roomTypes || []).map((r) => r.monthlyRate).filter((n) => n > 0);
      return s + (rates.length ? Math.min(...rates) : p.monthlyRate);
    }, 0),
    [lockedProps],
  );

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

      {/* ───────── mode switch (Airbnb-style) ───────── */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Switch experience</div>
        <div className="sbc-mode-grid">
          <div className="sbc-mode-card active">
            <span className="sbc-mode-ic">◎</span>
            <b>StayCircle</b>
            <span className="sbc-mode-sub">Invest &amp; earn — you&apos;re here</span>
            <span className="sbc-mode-badge">Active</span>
          </div>
          <Link href="/" className="sbc-mode-card">
            <span className="sbc-mode-ic">🧳</span>
            <b>Travelling</b>
            <span className="sbc-mode-sub">Bid &amp; book stays on StayBid</span>
            <span className="sbc-mode-go">Switch →</span>
          </Link>
          {hasPartner ? (
            <a href={HOST_PANEL} target="_blank" rel="noopener noreferrer" className="sbc-mode-card">
              <span className="sbc-mode-ic">🏨</span>
              <b>Hotel Partner</b>
              <span className="sbc-mode-sub">Manage your hotel &amp; bids ↗</span>
              <span className="sbc-mode-go">Open →</span>
            </a>
          ) : (
            <Link href="/onboard" className="sbc-mode-card locked">
              <span className="sbc-mode-ic">🏨</span>
              <b>Hotel Partner</b>
              <span className="sbc-mode-sub">List your hotel to unlock this panel</span>
              <span className="sbc-mode-badge locked">🔒 Locked</span>
              <span className="sbc-mode-go locked">Become a partner →</span>
            </Link>
          )}
          {isHost ? (
            <Link href="/host/me" className="sbc-mode-card">
              <span className="sbc-mode-ic">🏠</span>
              <b>For Hosts</b>
              <span className="sbc-mode-sub">Managed portfolio ownership</span>
              <span className="sbc-mode-go">Open →</span>
            </Link>
          ) : (
            <Link href="/host" className="sbc-mode-card locked">
              <span className="sbc-mode-ic">🏠</span>
              <b>For Hosts</b>
              <span className="sbc-mode-sub">Start a managed portfolio to unlock</span>
              <span className="sbc-mode-badge locked">🔒 Locked</span>
              <span className="sbc-mode-go locked">Explore hosting →</span>
            </Link>
          )}
        </div>
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
          <Link href="/circle/build" className="sbc-dash-tile"><span>🧾</span>Listings</Link>
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
