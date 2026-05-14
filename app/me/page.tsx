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
import { ThemeToggle } from "@/components/ThemeToggle";
// v109 — shared TierProvider context. Same drawer auto-flips when
// upgrade happens in any tab (storage event) or same-tab via the
// sb:tier-refresh custom event.
import { useTier } from "@/lib/tier-store";
// v112.3 — shared client-side auth id reader. Keeps the same
// "fb_<uid>" / "firebase_<uid>" prefix normalisation the server uses,
// so /me's /api/social/feed query lines up with the canonical
// social_profiles row even when the local sb_token was issued under
// the legacy auth path.
import { getClientUserId } from "@/lib/client-auth";
// v111 — open the IG-style ProfilePhotoEditor when the user taps their
// avatar or Edit profile button. Previously Edit profile routed to the
// legacy /profile account-settings page, which made highlights
// inaccessible (the editor was the only entry point to add custom
// highlights) AND meant the avatar wasn't tappable. ProfilePhotoEditor
// has avatar / name / bio / location / website / highlights all in one.
import { ProfilePhotoEditor } from "@/components/discover/CreateFlow";

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
    followingCount, follows, searchFollowers,
    setMyAvatarUrl, setMyDisplayName, setMyBio,
  } = useFollow();
  const { posts } = usePosts();
  // v109 — Creator Hub + Hotel Partner items in the drawer flip on
  // automatically the moment the matching role activates (creator app
  // submitted, partner login completed — even in another tab).
  // v112.2 — also render small Creator (✦) / Hotel (🏨) badges next to
  // the display name so the user can see at a glance what tier their
  // account is. Same source-of-truth as the drawer.
  const { isCreator, isHotelOwner } = useTier();

  const [tab, setTab] = useState<Tab>("posts");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // v110 — Followers / Following bottom-sheet. Opens when the user taps
  // either stat. `kind` controls which list renders inside.
  const [followSheet, setFollowSheet] = useState<null | "followers" | "following">(null);
  // v111 — IG-style profile editor (avatar / name / bio / location /
  // website / custom highlights). Opens on avatar tap OR Edit profile.
  const [editorOpen, setEditorOpen] = useState(false);
  // v112.1 — selected highlight key. When set, the posts grid filters
  // to only posts tagged with that highlight bucket. Cleared by tapping
  // the "All" chip or the highlight tile again.
  const [activeHighlight, setActiveHighlight] = useState<string>("");
  // Remote posts from Supabase social_posts table — user-uploaded reels
  // live there too (the in-memory PostsStore is just for instant-after-
  // upload preview). v83 fetches the user's own posts so /me actually
  // reflects what they've shared.
  const [remotePosts, setRemotePosts] = useState<any[]>([]);

  // v112.3 — central client helper. Normalises legacy "fb_" / "firebase_"
  // prefixed Firebase uids to the canonical form so /api/social/feed's
  // resolver finds the merged social_profiles row.
  const myUserId = useMemo(() => getClientUserId(), []);
  // Server-resolved profile (set by the hydrate effect below). Used as
  // the most reliable source for handle + display name + avatar
  // when local state is empty / wrong (e.g. fresh device, just-
  // logged-in, phone field was accidentally set to the email).
  const [serverProfile, setServerProfile] = useState<any>(null);

  // v110 — server-side hydration of profile photo + display name + bio.
  // Without this, the avatar lives only in localStorage and disappears
  // after re-login or device-switch. We fetch /api/social/profiles/me
  // once per mount; if the server has values the local store doesn't,
  // we adopt them (server is the source of truth across devices).
  useEffect(() => {
    if (!myUserId) return;
    const tok = typeof window !== "undefined" ? (localStorage.getItem("sb_token") || "") : "";
    if (!tok) return;
    fetch("/api/social/profiles/me", {
      headers: { Authorization: `Bearer ${tok}` },
      cache:   "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        const p = d?.profile;
        if (!p) return;
        // v112.3 — capture the full server profile for handle / username
        // fallback (the legacy phone field sometimes carries the email).
        setServerProfile(p);
        // Server "wins" when local is empty / placeholder. Do NOT clobber
        // a non-empty local value with a null server value — the user may
        // have just set something that hasn't synced yet.
        if (p.avatar_url && !myAvatarUrl)               setMyAvatarUrl(String(p.avatar_url));
        if (p.display_name && (!myDisplayName || myDisplayName === "You")) {
          setMyDisplayName(String(p.display_name));
        }
        if (p.bio && !myBio)                            setMyBio(String(p.bio));
      });
    // Run only when the user id changes (i.e. after login). Setters from
    // the FollowStore are stable references already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId]);

  useEffect(() => {
    if (!myUserId) return;
    // Pull from BOTH places the user could have uploaded a reel:
    //   • social_posts (Composer / + button flow) — has author_id
    //   • hotel_videos (legacy /influencer/upload flow) — has uploaded_by
    // Merge so /me reflects every post regardless of which path created it.
    const tok = typeof window !== "undefined" ? (localStorage.getItem("sb_token") || "") : "";
    Promise.all([
      // v110 — pass authorUser (the JWT user id). /api/social/feed resolves
      // it to the matching social_profiles.id internally. Previously we
      // were passing user id where the route expected a profile id, so
      // this fetch always returned [].
      fetch(`/api/social/feed?authorUser=${encodeURIComponent(myUserId)}&limit=60`, { cache: "no-store" })
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
        // v112.1 — surface the highlight bucket from social_posts so the
        // grid filter can match remote posts the same way it matches
        // local PostsStore entries.
        highlight: rp.highlight_key ? { key: String(rp.highlight_key), label: "", emoji: "" } : null,
        mediaUrl:   rp.media_url || "",
        mediaMime:  "",
        posterUrl:  rp.thumbnail_url || "",
        caption:    rp.caption || "",
        tags:       [],
        // v114 — surface custom audio so the feed can mute video's original
        // audio and play this in sync when the user opens their own post.
        audio:      rp.sound_url ? { name: rp.sound_track || "Custom audio", url: rp.sound_url } : null,
        // v114 — preserve the chosen IG-style filter so the feed renders
        // with the same look the creator picked at upload time.
        filter:     rp.filter || null,
        createdAt:  new Date(rp.created_at || Date.now()).getTime(),
        keepAsPost: kind !== "story",
      });
      seen.add(id);
    });
    return merged;
  }, [posts, remotePosts]);

  // Filter all posts by current tab
  // v112.1 — also apply the active highlight filter when one is set.
  // A post matches if its `highlight.key` equals `activeHighlight`.
  const visiblePosts = useMemo(() => {
    let base: any[] = [];
    if (tab === "posts") base = allPosts.filter((p) => p.kind !== "story" || p.keepAsPost);
    else if (tab === "reels") base = allPosts.filter((p) => p.kind === "reel");
    else return [];
    if (!activeHighlight) return base;
    return base.filter((p) => p.highlight?.key === activeHighlight);
  }, [allPosts, tab, activeHighlight]);

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
  // v112.3 — handle priority:
  //   1. server profile's username (e.g. "sachin_tomer") — most reliable
  //   2. real phone digits (rejects email-looking values, which Firebase
  //      logins sometimes plant in the phone field as a fallback)
  //   3. literal "@you"
  // This kills the awkward "@sachinhelpline@gmail.com" handle that
  // showed up after the v112.2 profile merge.
  const phoneCandidate = String((user as any)?.phone || "");
  const looksLikePhone = /^\+?\d[\d\s-]{4,15}$/.test(phoneCandidate.replace(/\+91/, ""));
  const handle =
    serverProfile?.username
      ? `@${serverProfile.username}`
      : (looksLikePhone
          ? `@${phoneCandidate.replace(/^\+91/, "")}`
          : "@you");

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
        {/* v111 — avatar is now a button that opens the IG-style profile
            editor. Was an inert div, which the user (correctly) flagged
            as missing the obvious affordance. */}
        <button
          type="button"
          className="me-avatar-wrap me-avatar-btn"
          aria-label="Edit profile photo + details"
          onClick={() => setEditorOpen(true)}
        >
          {myAvatarUrl ? (
            <img src={myAvatarUrl} alt={myDisplayName} className="me-avatar-img" />
          ) : (
            <span className="me-avatar-fallback">{initials}</span>
          )}
          {/* Small camera badge bottom-right of the avatar — same hint
              Instagram uses to signal "tap to change photo". */}
          <span className="me-avatar-cam" aria-hidden>📷</span>
        </button>
        <div className="me-stats">
          <Stat label="Posts" value={fmtCount(allPosts.length)} />
          {/* v110 — Followers / Following are now real buttons that open a
              searchable list sheet. Previously they were inert divs which
              the user (correctly) flagged as broken affordances. */}
          <Stat
            label="Followers"
            value={fmtCount(followersN)}
            onClick={() => setFollowSheet("followers")}
          />
          <Stat
            label="Following"
            value={fmtCount(followingN)}
            onClick={() => setFollowSheet("following")}
          />
        </div>
      </section>

      {/* Display name + bio + meta */}
      <section className="me-bio-wrap">
        <p className="me-display-name">
          {myDisplayName || "You"}
          {/* v112.2 — Creator (✦) / Hotel (🏨) tier badges. Public sees
              the SAME badges next to the same display name (no second
              identity) — only difference is they don't see the private
              stats panel (Active Creator EARNED/BOOKINGS), which stays
              self-only via SelfTierBanner. */}
          {isCreator    && <span className="me-tier-badge me-tier-badge-creator" title="Creator">✦</span>}
          {isHotelOwner && <span className="me-tier-badge me-tier-badge-hotel"   title="Hotel partner">🏨</span>}
        </p>
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
        {/* v111 — Edit profile now opens the IG-style ProfilePhotoEditor
            instead of the legacy /profile account-settings route. This
            is where the user can edit avatar / name / bio / location /
            website AND manage highlights — all in one place. The legacy
            page is still reachable from the hamburger drawer as
            "Account settings". */}
        <button
          type="button"
          className="me-action-btn me-action-primary"
          onClick={() => setEditorOpen(true)}
        >Edit profile</button>
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

      {/* Highlights row — v112.1: tappable. Each tile filters the posts
          grid below to only posts tagged with that highlight bucket.
          Tapping the active tile (or the "All" chip) clears the filter.
          Mirrors what the InstagramHotelFeed CreatorProfileSheet has
          been doing for its profile view since v45 — just wasn't on /me. */}
      {highlights.length > 0 && (
        <section className="me-highlights">
          {/* "All" clear chip — only shown while a highlight is active. */}
          {activeHighlight && (
            <button
              type="button"
              className="me-highlight me-highlight-btn"
              onClick={() => setActiveHighlight("")}
              aria-label="Clear highlight filter — show all posts"
            >
              <span className="me-highlight-ring me-highlight-ring-all">
                <span className="me-highlight-emoji">↺</span>
              </span>
              <span className="me-highlight-label">All</span>
            </button>
          )}
          {highlights.map((h) => {
            const active = activeHighlight === h.key;
            return (
              <button
                key={h.key}
                type="button"
                className={`me-highlight me-highlight-btn${active ? " is-active" : ""}`}
                onClick={() => setActiveHighlight(active ? "" : h.key)}
                aria-label={`${active ? "Clear" : "Filter posts by"} ${h.label}`}
                aria-pressed={active}
              >
                <span className="me-highlight-ring">
                  <span className="me-highlight-emoji">{h.emoji}</span>
                </span>
                <span className="me-highlight-label">{h.label}</span>
              </button>
            );
          })}
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
            <span className="me-empty-icon">{activeHighlight ? "✨" : "📷"}</span>
            <p className="me-empty-title">
              {activeHighlight
                ? `No posts in this highlight yet`
                : tab === "posts" ? "Share your first post"
                : tab === "reels" ? "No reels yet"
                : "Posts you're tagged in show up here"}
            </p>
            <p className="me-empty-sub">
              {activeHighlight
                ? "Tag a post with this highlight from the + Create flow, or pick another filter above."
                : tab === "posts" ? "Use the + button on the reel feed to upload"
                : tab === "reels" ? "Tap + on the reel feed to share one"
                : "Photos you're tagged in will appear here"}
            </p>
          </div>
        ) : (
          visiblePosts.map((p) => (
            <button
              key={p.id}
              type="button"
              className="me-grid-tile"
              onClick={() => router.push(`/me/posts?start=${encodeURIComponent(String(p.id))}`)}
              aria-label={`Open ${p.kind}`}
            >
              {p.posterUrl || p.mediaUrl ? (
                <img src={p.posterUrl || p.mediaUrl} alt="" loading="lazy" />
              ) : (
                <span className="me-grid-fallback">{(p.caption || "•").slice(0, 1)}</span>
              )}
              {p.kind === "reel" && <span className="me-grid-icon">▶</span>}
            </button>
          ))
        )}
      </section>

      {/* Hamburger drawer */}
      <MoreDrawer
        open={drawerOpen}
        isCreator={isCreator}
        isHotelOwner={isHotelOwner}
        onClose={() => setDrawerOpen(false)}
        onLogout={() => { logout(); router.push("/"); }}
      />

      {/* v110 — Followers / Following list sheet. Same source-of-truth as
          the creator profile sheet in InstagramHotelFeed: synthesized
          deterministic list (~80–600 fans seeded off the handle) + the
          user themselves pinned at the top when relevant. Searchable. */}
      <FollowListSheet
        kind={followSheet}
        myDisplayName={myDisplayName}
        myHandle={handle}
        myAvatarUrl={myAvatarUrl}
        follows={follows}
        searchFollowers={searchFollowers}
        onClose={() => setFollowSheet(null)}
      />

      {/* v111 — Profile editor (avatar / name / bio / location / website
          / highlights). Mounted unconditionally; renders nothing when
          editorOpen is false. */}
      <ProfilePhotoEditor open={editorOpen} onClose={() => setEditorOpen(false)} />

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
        /* v111 — avatar is now a button. Reset native chrome but keep
           the conic-gradient ring + identical shape. */
        .me-avatar-btn {
          position: relative;
          border: none;
          cursor: pointer;
          padding: 2.5px;
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-avatar-btn:active { transform: scale(0.96); }
        .me-avatar-cam {
          position: absolute;
          right: -2px; bottom: -2px;
          width: 26px; height: 26px;
          border-radius: 999px;
          background: linear-gradient(135deg, #f0d060, #c9911a);
          border: 2px solid #fff9ec;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.78rem;
          box-shadow: 0 2px 6px rgba(184, 134, 11, 0.35);
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
        .me-tier-badge {
          margin-left: 6px;
          font-weight: 800;
          font-size: 0.92rem;
        }
        .me-tier-badge-creator { color: #c9911a; }
        .me-tier-badge-hotel   { font-size: 0.86rem; }
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
        /* v112.1 — highlight tiles are now buttons. Reset chrome but
           keep the original layout. Active state lights up the ring
           in champagne so the user sees which filter is applied. */
        .me-highlight-btn {
          background: transparent;
          border: none;
          padding: 0;
          font: inherit;
          cursor: pointer;
          color: inherit;
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-highlight-btn:active { transform: scale(0.94); }
        .me-highlight-btn.is-active .me-highlight-ring {
          background: linear-gradient(135deg, #ffd76b, #f0b429);
          border-color: rgba(184, 134, 11, 0.62);
          box-shadow: 0 0 0 2px rgba(255, 215, 107, 0.45);
        }
        .me-highlight-btn.is-active .me-highlight-label {
          color: #2c1d04;
          font-weight: 700;
        }
        .me-highlight-ring {
          width: 64px; height: 64px;
          border-radius: 999px;
          background: #fff9ec;
          border: 1.5px solid rgba(184, 134, 11, 0.30);
          display: flex; align-items: center; justify-content: center;
          font-size: 1.5rem;
          transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .me-highlight-ring-all {
          background: linear-gradient(135deg, #fff9ec, #f0d060);
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
          /* Button reset — was a div in v79; now navigates to /me/posts
             on tap (IG-style scrollable Posts view, v86). */
          border: none;
          padding: 0;
          cursor: pointer;
          width: 100%;
          display: block;
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-grid-tile:active { transform: scale(0.97); }
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

function Stat({
  label, value, onClick,
}: { label: string; value: string; onClick?: () => void }) {
  // v110 — render as a button when an onClick is provided so the
  // affordance is real (focusable, keyboard-activatable, distinct active
  // state). Falls back to the inert div for stats with no destination
  // (currently "Posts" which scrolls the page automatically).
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="me-stat me-stat-btn"
        aria-label={`${label} — open list`}
      >
        <span className="me-stat-value">{value}</span>
        <span className="me-stat-label">{label}</span>
      </button>
    );
  }
  return (
    <div className="me-stat">
      <span className="me-stat-value">{value}</span>
      <span className="me-stat-label">{label}</span>
    </div>
  );
}

// ─── Hamburger drawer ──────────────────────────────────────────────────
type DrawerLink = { href: string; label: string; sub?: string; icon: string; external?: boolean };

// v105 — drawer cleanup:
//   - Removed "Flash Deals" — already in bottom nav as DEALS tab; duplicate.
//   - Removed "StayPoints" — Wallet card now shows points + tap opens /points history.
//   - Added "Complaints & Help" — was reachable only via booking deep-link; now top-level.
// v108 — Creator Hub + Hotel Partner items are gated by `tier` (built below
// in MoreDrawer): Public users don't see them at all. Path to upgrade
// stays available via the ↑ icon on the top bar.
const DRAWER_LINKS_BASE: DrawerLink[] = [
  { href: "/my-bids",      label: "My Bids",          sub: "Your active offers",            icon: "📋" },
  { href: "/bookings",     label: "Bookings",         sub: "Past + upcoming stays",         icon: "🎫" },
  { href: "/saved",        label: "Saved",            sub: "Wishlist hotels & reels",       icon: "🔖" },
  { href: "/wallet",       label: "Wallet",           sub: "Balance + StayPoints",          icon: "💰" },
  { href: "/complaints",   label: "Complaints & Help",sub: "Raise an issue · ~24 hr reply", icon: "🚩" },
  { href: "/verification", label: "Verify Stay",      sub: "Hotel verification",            icon: "✅" },
];

const CREATOR_LINK: DrawerLink = {
  href: "/influencer",
  label: "Creator Hub",
  sub:   "Earnings + referrals",
  icon:  "✨",
};

// v108 — actual hotel partner panel is /partner inside this app (separate
// auth via sb_partner_token). Was an external link to an abandoned Vercel
// deployment; the user explicitly asked us to repoint it.
const HOTEL_LINK: DrawerLink = {
  href: "/partner",
  label: "Hotel Partner",
  sub:   "Open partner dashboard",
  icon:  "🏢",
};

const ACCOUNT_LINK: DrawerLink = {
  href: "/profile",
  label: "Account settings",
  sub:   "Email, phone, security",
  icon:  "⚙",
};

function MoreDrawer({
  open, isCreator, isHotelOwner, onClose, onLogout,
}: {
  open:         boolean;
  isCreator:    boolean;
  isHotelOwner: boolean;
  onClose:      () => void;
  onLogout:     () => void;
}) {
  if (!open) return null;

  // v109 — independent flags from the shared TierProvider so a user
  // who's BOTH an active creator AND a hotel partner sees BOTH entries.
  // Pending creators are included in isCreator so they can track app
  // status from the drawer.
  const links: DrawerLink[] = [
    ...DRAWER_LINKS_BASE,
    ...(isCreator    ? [CREATOR_LINK] : []),
    ...(isHotelOwner ? [HOTEL_LINK]   : []),
    ACCOUNT_LINK,
  ];
  return (
    <div className="me-drawer-root" onClick={onClose}>
      <div className="me-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="me-drawer-head">
          <span className="me-drawer-title">Menu</span>
          <button type="button" onClick={onClose} className="me-drawer-close" aria-label="Close menu">✕</button>
        </div>
        <ul className="me-drawer-list">
          {links.map((it) => (
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
          {/* v90 — Appearance toggle (single button, flips whole UI). */}
          <li className="me-drawer-theme">
            <ThemeToggle variant="lg" />
          </li>
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

// ─── Followers / Following sheet ───────────────────────────────────────
// Bottom-sheet list rendered when the user taps Followers or Following
// on /me. Matches the same source-of-truth used elsewhere for creator
// profile views (synthesized deterministic list + the user themselves
// pinned at the top when relevant). Searchable via the existing
// followStore.searchFollowers helper for the Followers tab; the Following
// tab reads from the live follows[] array.
// v110 — rows are now real <button>s that route to /u/[handle] so the
// user can dig into any follower / followed profile.
function FollowListSheet({
  kind, myDisplayName, myHandle, myAvatarUrl, follows, searchFollowers, onClose,
}: {
  kind:        null | "followers" | "following";
  myDisplayName: string;
  myHandle:    string;
  myAvatarUrl: string;
  follows:     string[];
  searchFollowers: (handle: string, q: string) => string[];
  onClose:     () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // Close on Esc
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [kind, onClose]);

  // Reset query when sheet opens / kind changes
  useEffect(() => { if (kind) setQuery(""); }, [kind]);

  const list = useMemo(() => {
    if (!kind) return [];
    if (kind === "followers") {
      // The "Followers" list synthesizes a deterministic crowd off the
      // user's own handle (so the count + list stay consistent for
      // everyone — including users with zero real follower history).
      // searchFollowers already filters when query is non-empty.
      return searchFollowers(myHandle, query.trim());
    }
    // Following: real list of handles the user has followed across the
    // app. Render as "@handle" rows; we don't store display names for
    // followed accounts, just the handle.
    const q = query.trim().toLowerCase();
    const entries = follows.map((h) => `${h.replace(/^@/, "")}|${h}`);
    return q ? entries.filter((e) => e.toLowerCase().includes(q)) : entries;
  }, [kind, myHandle, query, follows, searchFollowers]);

  if (!kind) return null;

  const title = kind === "followers" ? "Followers" : "Following";
  const empty = kind === "followers"
    ? (query ? "No followers match that search." : "No followers yet.")
    : (query ? "No following match that search."
             : "You're not following anyone yet — tap Follow on any creator.");

  return (
    <div className="me-follow-root" onClick={onClose}>
      <div
        className="me-follow-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} list`}
      >
        <div className="me-follow-head">
          <span className="me-follow-handle">@{myHandle.replace(/^@/, "")}</span>
          <span className="me-follow-title">{title}</span>
          <button
            type="button"
            className="me-follow-close"
            aria-label="Close"
            onClick={onClose}
          >✕</button>
        </div>

        <div className="me-follow-search-wrap">
          <input
            type="text"
            inputMode="search"
            placeholder={`Search ${title.toLowerCase()}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="me-follow-search"
          />
        </div>

        <ul className="me-follow-list" role="list">
          {list.length === 0 ? (
            <li className="me-follow-empty">{empty}</li>
          ) : (
            list.map((entry, i) => {
              const [name, handleStr] = entry.includes("|")
                ? entry.split("|")
                : [entry, entry];
              const isYou = handleStr === "@you (you)";
              const goToProfile = () => {
                if (isYou) {
                  onClose();
                  router.push("/me");
                  return;
                }
                const h = handleStr.replace(/^@/, "").trim();
                if (!h) return;
                onClose();
                router.push(`/u/${encodeURIComponent(h)}`);
              };
              return (
                <li key={`${handleStr}-${i}`}>
                  <button
                    type="button"
                    className="me-follow-row me-follow-row-btn"
                    onClick={goToProfile}
                    aria-label={`Open ${name}'s profile`}
                  >
                    <span
                      className="me-follow-avatar"
                      style={isYou && myAvatarUrl ? { backgroundImage: `url(${myAvatarUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    >
                      {!(isYou && myAvatarUrl) && (name || "?").trim().slice(0, 1).toUpperCase()}
                    </span>
                    <div className="me-follow-text">
                      <p className="me-follow-name">
                        {isYou ? myDisplayName || "You" : name}
                        {isYou && <span className="me-follow-you"> · you</span>}
                      </p>
                      <p className="me-follow-handletext">{handleStr}</p>
                    </div>
                    <span className="me-follow-chev" aria-hidden>›</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <style jsx global>{`
        @keyframes meFollowFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes meFollowSlide { from { transform: translateY(10%); } to { transform: translateY(0); } }
        .me-follow-root {
          position: fixed;
          inset: 0;
          z-index: 85;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: meFollowFade 0.22s ease both;
        }
        .me-follow-panel {
          width: 100%;
          max-width: 520px;
          max-height: 78dvh;
          background: linear-gradient(180deg, #fff9ec 0%, #f9efd6 100%);
          border-top-left-radius: 18px;
          border-top-right-radius: 18px;
          box-shadow: 0 -16px 40px rgba(0, 0, 0, 0.32);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: meFollowSlide 0.26s cubic-bezier(.32,1.2,.36,1) both;
        }
        .me-follow-head {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 8px;
          padding: 14px 16px 10px;
          border-bottom: 1px solid rgba(184, 134, 11, 0.18);
          background: rgba(255, 249, 236, 0.92);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .me-follow-handle {
          font-size: 0.78rem;
          font-weight: 600;
          color: rgba(74, 50, 8, 0.70);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .me-follow-title {
          font-size: 1rem;
          font-weight: 800;
          color: #2c1d04;
          text-align: center;
        }
        .me-follow-close {
          justify-self: end;
          width: 30px; height: 30px;
          border-radius: 999px;
          background: rgba(184, 134, 11, 0.10);
          border: 1px solid rgba(184, 134, 11, 0.22);
          color: #6e4a08;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
        }
        .me-follow-search-wrap {
          padding: 10px 14px 6px;
        }
        .me-follow-search {
          width: 100%;
          padding: 9px 12px;
          font-size: 0.86rem;
          font-family: inherit;
          color: #2c1d04;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(184, 134, 11, 0.30);
          border-radius: 10px;
          outline: none;
          transition: border-color 0.18s ease, background 0.18s ease;
        }
        .me-follow-search::placeholder { color: rgba(74, 50, 8, 0.50); }
        .me-follow-search:focus {
          border-color: rgba(184, 134, 11, 0.55);
          background: rgba(255, 255, 255, 0.9);
        }
        .me-follow-list {
          list-style: none;
          margin: 0;
          padding: 4px 6px 18px;
          overflow-y: auto;
          flex: 1;
        }
        .me-follow-empty {
          padding: 36px 18px;
          text-align: center;
          color: rgba(74, 50, 8, 0.72);
          font-size: 0.86rem;
        }
        .me-follow-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 9px 12px;
          border-radius: 10px;
          transition: background 0.16s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-follow-row:hover {
          background: rgba(184, 134, 11, 0.06);
        }
        /* v110 — row is now a button so taps route to /u/[handle]. Reset
           button chrome but keep the row layout. */
        .me-follow-row-btn {
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          cursor: pointer;
          font: inherit;
          color: inherit;
        }
        .me-follow-row-btn:active { transform: scale(0.98); }
        .me-follow-chev {
          color: rgba(74, 50, 8, 0.45);
          font-size: 0.95rem;
          font-weight: 700;
          flex-shrink: 0;
        }
        .me-follow-avatar {
          flex-shrink: 0;
          width: 42px; height: 42px;
          border-radius: 999px;
          background: linear-gradient(135deg, #f0d060, #c9911a);
          color: #2c1d04;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          border: 2px solid #fff9ec;
        }
        .me-follow-text {
          min-width: 0;
          flex: 1;
        }
        .me-follow-name {
          font-size: 0.9rem;
          font-weight: 700;
          color: #2c1d04;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .me-follow-you {
          font-size: 0.72rem;
          color: rgba(74, 50, 8, 0.62);
          font-weight: 500;
        }
        .me-follow-handletext {
          font-size: 0.74rem;
          color: rgba(74, 50, 8, 0.68);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Stat button styling (Followers / Following) — separate from
           the inert div used for Posts. */
        .me-stat-btn {
          background: transparent;
          border: none;
          padding: 4px 6px;
          margin: 0;
          cursor: pointer;
          border-radius: 8px;
          transition: background 0.16s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .me-stat-btn:hover { background: rgba(184, 134, 11, 0.06); }
        .me-stat-btn:active { transform: scale(0.96); }
        .me-stat-btn:focus-visible {
          outline: 2px solid rgba(184, 134, 11, 0.55);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
