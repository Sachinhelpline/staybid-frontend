"use client";
// ═══════════════════════════════════════════════════════════════════════════
// /me — Instagram-style "You" tab profile.
//
// What this page is for: when a user taps the "You" item in the bottom dock
// they expect the same profile experience as scrolling through someone
// else's reels (avatar, stats, highlights, posts grid) — NOT the legacy
// /profile account-settings page. /profile still exists and is reachable
// from the hamburger drawer here as "Account settings".
//
// Layout mirrors Instagram's profile screen:
//   ┌───────────────────────────────────────┐
//   │  @handle              ↗  ☰            │  ← top bar
//   ├───────────────────────────────────────┤
//   │  ◯avatar    275      14.2K    1.4K    │
//   │             Posts    Followers Follow │
//   │  Display name                          │
//   │  Bio …                                 │
//   │  [Edit profile] [Share]                │
//   │  ⚪⚪⚪⚪⚪⚪  ← highlights              │
//   │  ▦  ▶  🏷  ⚙                           │  ← tabs
//   │  ┌───┬───┬───┐                         │
//   │  │   │   │   │  ← post grid            │
//   └───────────────────────────────────────┘
// Hamburger top-right opens a slide-in drawer with every secondary nav
// item the user wants quick access to: Deals, My Bids, Bookings, Saved,
// Wallet, Points, Verify, Creator, Hotel Partner, Account settings, Log out.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFollow, BUILTIN_HIGHLIGHTS } from "@/lib/follow-store";
import { usePosts } from "@/lib/posts-store";
import { useAuth } from "@/lib/auth";
import { sanitizeText } from "@/lib/sanitize-text";

type Tab = "posts" | "reels" | "tagged";

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export default function MePage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const {
    myDisplayName, myAvatarUrl, myBio, myLocation, myWebsite, myCustomHighlights,
    followingCount,
  } = useFollow();
  const { posts } = usePosts();

  const [tab, setTab] = useState<Tab>("posts");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Remote posts from Supabase social_posts table — user-uploaded reels
  // live there too (the in-memory PostsStore is just for instant-after-
  // upload preview). v83 fetches the user's own posts so /me actually
  // reflects what they've shared.
  const [remotePosts, setRemotePosts] = useState<any[]>([]);

  // Decode current user id from the JWT
  const myUserId = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const t = localStorage.getItem("sb_token") || "";
      if (!t) return "";
      const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p.id || p.user_id || p.sub || "";
    } catch { return ""; }
  }, []);

  useEffect(() => {
    if (!myUserId) return;
    // Pull from BOTH places the user could have uploaded a reel:
    //   • social_posts (Composer / + button flow) — has author_id
    //   • hotel_videos (legacy /influencer/upload flow) — has uploaded_by
    // Merge so /me reflects every post regardless of which path created it.
    const tok = typeof window !== "undefined" ? (localStorage.getItem("sb_token") || "") : "";
    Promise.all([
      fetch(`/api/social/feed?author=${encodeURIComponent(myUserId)}&limit=60`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      tok
        ? fetch("/api/influencer/my-videos", {
            headers: { Authorization: `Bearer ${tok}` },
            cache: "no-store",
          })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
        : Promise.resolve(null),
    ]).then(([social, videos]) => {
      const out: any[] = [];
      if (social?.posts) out.push(...social.posts);
      if (videos?.videos) {
        // hotel_videos rows → mapped into the same shape social_posts uses
        // so /me's merge logic treats them uniformly.
        videos.videos.forEach((v: any) => {
          out.push({
            id: v.id,
            media_type: "REEL",
            media_url: v.s3_url || v.url || "",
            thumbnail_url: v.thumbnail_url || "",
            caption: v.title || v.caption || "",
            created_at: v.created_at,
          });
        });
      }
      setRemotePosts(out);
    });
  }, [myUserId]);

  // Merge local (PostsStore) + remote (Supabase). Deduplicate by id so
  // a freshly-uploaded post that's in both shows up only once.
  const allPosts = useMemo(() => {
    const merged: any[] = [];
    const seen = new Set<string>();
    // Local first (just-posted feel) — kind: reel/photo/story
    posts.forEach((p) => {
      const id = String(p.id);
      if (!seen.has(id)) { seen.add(id); merged.push(p); }
    });
    // Remote second — normalize media_type to local kinds
    remotePosts.forEach((rp) => {
      const id = String(rp.id);
      if (seen.has(id)) return;
      const kind = String(rp.media_type || "").toLowerCase() === "reel" ? "reel"
                 : String(rp.media_type || "").toLowerCase() === "story" ? "story"
                 : "photo";
      merged.push({
        id,
        kind,
        mediaUrl:   rp.media_url || "",
        mediaMime:  "",
        posterUrl:  rp.thumbnail_url || "",
        caption:    rp.caption || "",
        tags:       [],
        audio:      null,
        createdAt:  new Date(rp.created_at || Date.now()).getTime(),
        keepAsPost: kind !== "story",
      });
      seen.add(id);
    });
    return merged;
  }, [posts, remotePosts]);

  // Filter all posts by current tab
  const visiblePosts = useMemo(() => {
    if (tab === "posts") return allPosts.filter((p) => p.kind !== "story" || p.keepAsPost);
    if (tab === "reels") return allPosts.filter((p) => p.kind === "reel");
    return [];
  }, [allPosts, tab]);

  // Pseudo "followers" count based on user identity — keeps the chip from
  // looking like a fresh-zero account on day one.
  const followersN = useMemo(() => {
    const seed = myDisplayName || (user as any)?.phone || "you";
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const v = Math.abs(h) % 6000;
    return 800 + v;
  }, [myDisplayName, user]);
  const followingN = followingCount();

  const initials = (myDisplayName || "You").trim().slice(0, 1).toUpperCase();
  const handle = (user as any)?.phone
    ? `@${String((user as any).phone).replace(/^\+91/, "")}`
    : "@you";

  const sanitizedBio = sanitizeText(myBio || "").clean;

  const highlights = useMemo(() => {
    return [...myCustomHighlights, ...BUILTIN_HIGHLIGHTS.slice(0, 4)];
  }, [myCustomHighlights]);

  // Close drawer with Esc
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="me-root">
      {/* Top bar */}
      <header className="me-top">
        <span className="me-top-handle">{handle}</span>
        <div className="me-top-actions">
          <Link href="/upgrade" className="me-top-icon" aria-label="Upgrade your account">↑</Link>
          <button
            type="button"
            className="me-top-icon"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >☰</button>
        </div>
      </header>

      {/* Profile header */}
      <section className="me-header">
        <div className="me-avatar-wrap">
          {myAvatarUrl ? (
            <img src={myAvatarUrl} alt={myDisplayName} className="me-avatar-img" />
          ) : (
            <span className="me-avatar-fallback">{initials}</span>
          )}
        </div>
        <div className="me-stats">
          <Stat label="Posts" value={fmtCount(allPosts.length)} />
          <Stat label="Followers" value={fmtCount(followersN)} />
          <Stat label="Following" value={fmtCount(followingN)} />
        </div>
      </section>

      {/* Display name + bio + meta */}
      <section className="me-bio-wrap">
        <p className="me-display-name">{myDisplayName || "You"}</p>
        {sanitizedBio && <p className="me-bio">{sanitizedBio}</p>}
        {myLocation && <p className="me-meta">📍 {myLocation}</p>}
        {myWebsite && (
          <a href={myWebsite} target="_blank" rel="noopener noreferrer" className="me-website">
            🔗 {myWebsite.replace(/^https?:\/\//, "")}
          </a>
        )}
      </section>

      {/* Action buttons */}
      <section className="me-actions">
        <Link href="/profile" className="me-action-btn me-action-primary">Edit profile</Link>
        <button
          type="button"
          className="me-action-btn"
          onClick={() => {
            const url = `${window.location.origin}/me`;
            if (navigator.share) navigator.share({ title: myDisplayName, url }).catch(() => {});
            else navigator.clipboard?.writeText(url).catch(() => {});
          }}
        >Share profile</button>
        <Link href="/upgrade" className="me-action-btn me-action-icon" aria-label="Upgrade">↑</Link>
      </section>

      {/* Highlights row */}
      {highlights.length > 0 && (
        <section className="me-highlights">
          {highlights.map((h) => (
            <div key={h.key} className="me-highlight">
              <span className="me-highlight-ring">
                <span className="me-highlight-emoji">{h.emoji}</span>
              </span>
              <span className="me-highlight-label">{h.label}</span>
            </div>
          ))}
        </section>
      )}

      {/* Tab switcher */}
      <nav className="me-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "posts"}
          className={`me-tab${tab === "posts" ? " is-active" : ""}`}
          onClick={() => setTab("posts")}
        >▦</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reels"}
          className={`me-tab${tab === "reels" ? " is-active" : ""}`}
          onClick={() => setTab("reels")}
        >▶</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tagged"}
          className={`me-tab${tab === "tagged" ? " is-active" : ""}`}
          onClick={() => setTab("tagged")}
        >🏷</button>
      </nav>

      {/* Grid */}
      <section className="me-grid">
        {visiblePosts.length === 0 ? (
          <div className="me-empty">
            <span className="me-empty-icon">📷</span>
            <p className="me-empty-title">{tab === "posts" ? "Share your first post" : tab === "reels" ? "No reels yet" : "Posts you're tagged in show up here"}</p>
            <p className="me-empty-sub">{tab === "posts" ? "Use the + button on the reel feed to upload" : tab === "reels" ? "Tap + on the reel feed to share one" : "Photos you're tagged in will appear here"}</p>
          </div>
        ) : (
          visiblePosts.map((p) => (
            <div key={p.id} className="me-grid-tile">
              {p.posterUrl || p.mediaUrl ? (
                <img src={p.posterUrl || p.mediaUrl} alt="" loading="lazy" />
              ) : (
                <span className="me-grid-fallback">{(p.caption || "•").slice(0, 1)}</span>
              )}
              {p.kind === "reel" && <span className="me-grid-icon">▶</span>}
            </div>
          ))
        )}
      </section>

      {/* Hamburger drawer */}
      <MoreDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={() => { logout(); router.push("/"); }}
      />

      <style jsx global>{`
        .me-root {
          min-height: 100dvh;
          background: linear-gradient(180deg, #fff9ec 0%, #fdf3df 60%, #faecc7 100%);
          color: #2c1d04;
          padding-bottom: 84px;  /* clear the bottom dock */
          font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
        }
        .me-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px 10px;
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(255, 249, 236, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(184, 134, 11, 0.10);
        }
        .me-top-handle {
          font-weight: 700;
          font-size: 1.02rem;
          letter-spacing: -0.01em;
          color: #2c1d04;
        }
        .me-top-actions { display: inline-flex; gap: 8px; }
        .me-top-icon {
          width: 34px; height: 34px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 999px;
          background: transparent;
          border: 1px solid rgba(184, 134, 11, 0.18);
          color: #6e4a08;
          font-size: 1.05rem;
          font-weight: 700;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-top-icon:active { transform: scale(0.92); }
        .me-top-icon:hover { background: rgba(184, 134, 11, 0.08); }

        .me-header {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 16px 16px 6px;
        }
        .me-avatar-wrap {
          width: 88px; height: 88px;
          border-radius: 999px;
          padding: 2.5px;
          background: conic-gradient(from 0deg, #c9911a, #f0d060, #fff4cc, #f0d060, #c9911a);
          flex-shrink: 0;
        }
        .me-avatar-img {
          width: 100%; height: 100%;
          border-radius: 999px;
          object-fit: cover;
          border: 3px solid #fff9ec;
          display: block;
        }
        .me-avatar-fallback {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%;
          border-radius: 999px;
          background: #fff9ec;
          border: 3px solid #fff9ec;
          font-size: 2.2rem;
          font-weight: 800;
          color: #6e4a08;
        }
        .me-stats {
          display: flex;
          flex: 1;
          align-items: center;
          justify-content: space-around;
          gap: 4px;
        }
        .me-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
        }
        .me-stat-value { font-size: 1.05rem; font-weight: 800; color: #2c1d04; }
        .me-stat-label { font-size: 0.72rem; font-weight: 500; color: #6e4a08; }

        .me-bio-wrap { padding: 4px 18px 10px; }
        .me-display-name {
          font-size: 0.92rem;
          font-weight: 800;
          color: #2c1d04;
          margin: 0 0 2px;
        }
        .me-bio {
          font-size: 0.84rem;
          color: #4a3208;
          line-height: 1.35;
          white-space: pre-line;
          margin: 0 0 4px;
        }
        .me-meta {
          font-size: 0.78rem;
          color: rgba(74, 50, 8, 0.78);
          margin: 0 0 2px;
        }
        .me-website {
          font-size: 0.78rem;
          color: #6e4a08;
          text-decoration: none;
          font-weight: 600;
        }

        .me-actions {
          display: flex;
          gap: 6px;
          padding: 6px 14px 14px;
        }
        .me-action-btn {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid rgba(184, 134, 11, 0.30);
          background: rgba(255, 255, 255, 0.6);
          color: #2c1d04;
          font-size: 0.84rem;
          font-weight: 700;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-action-btn:active { transform: scale(0.97); }
        .me-action-btn:hover { background: rgba(255, 255, 255, 0.85); }
        .me-action-primary {
          background: linear-gradient(135deg, #f0d060, #ffd76b);
          border-color: rgba(184, 134, 11, 0.45);
          color: #2c1d04;
        }
        .me-action-icon { flex: 0 0 auto; padding: 8px 14px; }

        .me-highlights {
          display: flex;
          gap: 14px;
          overflow-x: auto;
          padding: 6px 16px 14px;
          scrollbar-width: none;
        }
        .me-highlights::-webkit-scrollbar { display: none; }
        .me-highlight {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
          width: 72px;
        }
        .me-highlight-ring {
          width: 64px; height: 64px;
          border-radius: 999px;
          background: #fff9ec;
          border: 1.5px solid rgba(184, 134, 11, 0.30);
          display: flex; align-items: center; justify-content: center;
          font-size: 1.5rem;
        }
        .me-highlight-label {
          font-size: 0.7rem;
          font-weight: 500;
          color: rgba(74, 50, 8, 0.85);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 72px;
        }

        .me-tabs {
          display: flex;
          align-items: center;
          justify-content: space-around;
          border-top: 1px solid rgba(184, 134, 11, 0.18);
          border-bottom: 1px solid rgba(184, 134, 11, 0.18);
          background: rgba(255, 255, 255, 0.45);
        }
        .me-tab {
          flex: 1;
          padding: 12px 0;
          background: none;
          border: none;
          color: rgba(74, 50, 8, 0.55);
          font-size: 1.15rem;
          font-weight: 700;
          cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        .me-tab.is-active {
          color: #2c1d04;
          border-bottom-color: #6e4a08;
        }

        .me-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px;
          padding: 2px;
        }
        .me-grid-tile {
          position: relative;
          aspect-ratio: 1 / 1;
          background: rgba(184, 134, 11, 0.08);
          overflow: hidden;
        }
        .me-grid-tile img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .me-grid-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-size: 1.8rem;
          font-weight: 700;
          color: rgba(184, 134, 11, 0.5);
        }
        .me-grid-icon {
          position: absolute;
          top: 6px;
          right: 6px;
          color: rgba(255, 255, 255, 0.95);
          font-size: 0.8rem;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        }
        .me-empty {
          grid-column: 1 / -1;
          text-align: center;
          padding: 48px 24px;
          color: rgba(74, 50, 8, 0.7);
        }
        .me-empty-icon { font-size: 2.5rem; display: block; margin-bottom: 8px; }
        .me-empty-title { font-size: 0.92rem; font-weight: 700; color: #2c1d04; margin: 0 0 4px; }
        .me-empty-sub { font-size: 0.78rem; }
      `}</style>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="me-stat">
      <span className="me-stat-value">{value}</span>
      <span className="me-stat-label">{label}</span>
    </div>
  );
}

// ─── Hamburger drawer ──────────────────────────────────────────────────
type DrawerLink = { href: string; label: string; sub?: string; icon: string; external?: boolean };

const DRAWER_LINKS: DrawerLink[] = [
  { href: "/flash-deals",  label: "Flash Deals",      sub: "Live discounts today",          icon: "⚡" },
  { href: "/my-bids",      label: "My Bids",          sub: "Your active offers",            icon: "📋" },
  { href: "/bookings",     label: "Bookings",         sub: "Past + upcoming stays",         icon: "🎫" },
  { href: "/saved",        label: "Saved",            sub: "Wishlist hotels & reels",       icon: "🔖" },
  { href: "/wallet",       label: "Wallet",           sub: "Balance & transactions",        icon: "💰" },
  { href: "/points",       label: "StayPoints",       sub: "Loyalty rewards",               icon: "⭐" },
  { href: "/verification", label: "Verify Stay",      sub: "Hotel verification",            icon: "✅" },
  { href: "/influencer",   label: "Creator Hub",      sub: "Earnings + referrals",          icon: "✨" },
  { href: "https://staybid-hotel-panel.vercel.app", label: "Hotel Partner", sub: "Open partner dashboard", icon: "🏢", external: true },
  { href: "/profile",      label: "Account settings", sub: "Email, phone, security",        icon: "⚙" },
];

function MoreDrawer({
  open, onClose, onLogout,
}: {
  open:     boolean;
  onClose:  () => void;
  onLogout: () => void;
}) {
  if (!open) return null;
  return (
    <div className="me-drawer-root" onClick={onClose}>
      <div className="me-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="me-drawer-head">
          <span className="me-drawer-title">Menu</span>
          <button type="button" onClick={onClose} className="me-drawer-close" aria-label="Close menu">✕</button>
        </div>
        <ul className="me-drawer-list">
          {DRAWER_LINKS.map((it) => (
            <li key={it.href}>
              {it.external ? (
                <a href={it.href} target="_blank" rel="noopener noreferrer" className="me-drawer-link" onClick={onClose}>
                  <DrawerRow icon={it.icon} label={it.label} sub={it.sub} external />
                </a>
              ) : (
                <Link href={it.href} className="me-drawer-link" onClick={onClose}>
                  <DrawerRow icon={it.icon} label={it.label} sub={it.sub} />
                </Link>
              )}
            </li>
          ))}
          <li>
            <button type="button" className="me-drawer-link me-drawer-logout" onClick={onLogout}>
              <DrawerRow icon="↶" label="Log out" sub="Sign out of this device" />
            </button>
          </li>
        </ul>
      </div>

      <style jsx global>{`
        @keyframes meDrawerFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes meDrawerSlide { from { transform: translateX(8%); } to { transform: translateX(0); } }

        .me-drawer-root {
          position: fixed;
          inset: 0;
          z-index: 80;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          display: flex;
          justify-content: flex-end;
          animation: meDrawerFade 0.22s ease both;
        }
        .me-drawer-panel {
          width: min(360px, 86vw);
          height: 100%;
          background: linear-gradient(180deg, #fff9ec 0%, #f9efd6 100%);
          box-shadow: -12px 0 32px rgba(0, 0, 0, 0.32);
          overflow-y: auto;
          animation: meDrawerSlide 0.28s cubic-bezier(.32,1.2,.36,1) both;
        }
        .me-drawer-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 18px;
          border-bottom: 1px solid rgba(184, 134, 11, 0.18);
          position: sticky;
          top: 0;
          background: rgba(255, 249, 236, 0.92);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 2;
        }
        .me-drawer-title {
          font-family: "Cormorant Garamond", "Georgia", serif;
          font-style: italic;
          font-weight: 600;
          font-size: 1.2rem;
          color: #2c1d04;
        }
        .me-drawer-close {
          width: 34px; height: 34px;
          border-radius: 999px;
          background: rgba(184, 134, 11, 0.10);
          border: 1px solid rgba(184, 134, 11, 0.22);
          color: #6e4a08;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
        }
        .me-drawer-list {
          list-style: none;
          margin: 0;
          padding: 8px 8px 32px;
        }
        .me-drawer-link {
          display: block;
          width: 100%;
          text-align: left;
          padding: 12px 14px;
          border-radius: 12px;
          color: #2c1d04;
          text-decoration: none;
          background: transparent;
          border: none;
          cursor: pointer;
          font: inherit;
          transition: background 0.18s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-drawer-link:active { transform: scale(0.98); }
        .me-drawer-link:hover { background: rgba(184, 134, 11, 0.08); }
        .me-drawer-logout {
          margin-top: 10px;
          border-top: 1px solid rgba(184, 134, 11, 0.18);
          padding-top: 18px;
          color: #b22222;
        }
        .me-drawer-row {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .me-drawer-icon {
          flex-shrink: 0;
          width: 38px; height: 38px;
          border-radius: 10px;
          background: rgba(184, 134, 11, 0.10);
          display: flex; align-items: center; justify-content: center;
          font-size: 1.15rem;
        }
        .me-drawer-text { flex: 1; min-width: 0; }
        .me-drawer-label {
          font-size: 0.92rem;
          font-weight: 700;
          color: #2c1d04;
          line-height: 1.15;
        }
        .me-drawer-sub {
          font-size: 0.72rem;
          color: rgba(74, 50, 8, 0.72);
          font-weight: 500;
        }
        .me-drawer-chev {
          color: rgba(74, 50, 8, 0.45);
          font-size: 0.95rem;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}

function DrawerRow({ icon, label, sub, external }: { icon: string; label: string; sub?: string; external?: boolean }) {
  return (
    <div className="me-drawer-row">
      <span className="me-drawer-icon">{icon}</span>
      <div className="me-drawer-text">
        <p className="me-drawer-label">{label}</p>
        {sub && <p className="me-drawer-sub">{sub}</p>}
      </div>
      <span className="me-drawer-chev">{external ? "↗" : "›"}</span>
    </div>
  );
}
