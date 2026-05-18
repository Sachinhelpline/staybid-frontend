"use client";
// ═══════════════════════════════════════════════════════════════════════════
// /u/[username] — Instagram-style profile page for any user (v110).
//
// Reached by tapping a row in the Following / Followers list sheet on /me,
// or any creator-handle chip elsewhere in the app. Mirrors /me's layout so
// the UX is recognisably "this is X's profile" — avatar + stats + bio +
// posts grid + tappable Followers / Following.
//
// Data sources, in order of preference:
//   1) /api/social/profiles/[username]  — real user with a social_profiles row
//      → Renders real avatar, real follower count, real posts via
//        /api/social/feed?author=<profile.id>.
//   2) Synthesized fallback for handles that don't yet map to a profile row
//      (the mocked CREATOR_POOL users the user can already follow from the
//      reel feed). Uses follow-store's deterministic synthesis so the
//      numbers + follower list match what the user already sees in the
//      feed-side CreatorProfileSheet.
//
// Posts grid taps route to /u/[username]/posts?start=<id> — same IG-style
// scroll feed pattern as /me/posts, just scoped to this profile.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useFollow } from "@/lib/follow-store";
import { sanitizeText } from "@/lib/sanitize-text";

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

type Tab = "posts" | "reels" | "tagged";

export default function UserProfilePage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const rawHandle = decodeURIComponent(String(params?.username || "")).replace(/^@/, "");
  const handle = rawHandle.trim();

  const {
    isFollowing, toggleFollow, followerCount, follows, searchFollowers,
  } = useFollow();

  const [profile, setProfile]   = useState<any>(null);     // real social_profile if exists
  const [posts, setPosts]       = useState<any[]>([]);     // real posts when profile resolves
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<Tab>("posts");
  const [followSheet, setFollowSheet] = useState<null | "followers" | "following">(null);

  // Fetch real profile (if it exists). 404 → synthesized fallback path.
  useEffect(() => {
    if (!handle) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/social/profiles/${encodeURIComponent(handle)}`, { cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setProfile(null);
          setPosts([]);
          return;
        }
        const d = await r.json().catch(() => null);
        const p = d?.profile;
        if (!p) {
          setProfile(null);
          setPosts([]);
          return;
        }
        setProfile(p);
        // Pull their posts in parallel.
        try {
          const pr = await fetch(
            `/api/social/feed?author=${encodeURIComponent(p.id)}&limit=60`,
            { cache: "no-store" }
          );
          if (pr.ok) {
            const pd = await pr.json().catch(() => null);
            if (!cancelled) setPosts(pd?.posts || []);
          }
        } catch { /* non-fatal */ }
      })
      .catch(() => {
        if (!cancelled) { setProfile(null); setPosts([]); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [handle]);

  // Synthesized values for handles without a real profile row. These match
  // the numbers the user sees in the feed-side CreatorProfileSheet via
  // follow-store, so the experience feels consistent.
  const synthHandle = `@${handle}`;
  const synthFollowers = followerCount(synthHandle);
  const synthFollowing = useMemo(() => {
    // deterministic
    let h = 0; for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) | 0;
    return 80 + (Math.abs(h) % 480);
  }, [handle]);

  // Display fields — prefer the real profile when we have one.
  const displayName = profile?.display_name || prettyName(handle);
  const avatarUrl   = profile?.avatar_url || "";
  const bio         = sanitizeText(profile?.bio || "").clean;
  const followersN  = profile ? Number(profile.follower_count || 0) : synthFollowers;
  const followingN  = profile ? Number(profile.following_count || 0) : synthFollowing;
  const postsN      = profile ? posts.length : 0;
  const isVerified  = !!profile?.is_verified;
  const isCreator   = !!profile?.is_creator;
  const isHotel     = profile?.user_type === "HOTEL";

  const following = isFollowing(synthHandle);

  const handleFollow = () => {
    toggleFollow(synthHandle);
  };

  return (
    <div className="u-root">
      {/* Top bar */}
      <header className="u-top">
        <button type="button" className="u-back" aria-label="Back" onClick={() => router.back()}>←</button>
        <span className="u-top-handle">@{handle}</span>
        <span style={{ width: 30 }} />
      </header>

      {/* Profile header */}
      <section className="u-header sb-fade-in">
        <div className="u-avatar-wrap">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="u-avatar-img" />
          ) : (
            <span className="u-avatar-fallback">{(displayName || "?").trim().slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="u-stats">
          <Stat label="Posts" value={fmtCount(postsN)} />
          <Stat label="Followers" value={fmtCount(followersN)} onClick={() => setFollowSheet("followers")} />
          <Stat label="Following" value={fmtCount(followingN)} onClick={() => setFollowSheet("following")} />
        </div>
      </section>

      <section className="u-bio-wrap">
        <p className="u-display-name">
          {displayName}
          {isVerified && <span className="u-verified" aria-label="Verified"> ✓</span>}
          {isCreator && !isVerified && <span className="u-creator" aria-label="Creator"> ✦</span>}
          {isHotel && <span className="u-hotel" aria-label="Hotel"> 🏨</span>}
        </p>
        {bio && <p className="u-bio">{bio}</p>}
      </section>

      <section className="u-actions sb-fade-in" style={{ animationDelay: "0.1s" }}>
        <button
          type="button"
          className={`u-action-btn sb-card-lift ${following ? "u-action-secondary" : "u-action-primary"}`}
          onClick={handleFollow}
        >
          {following ? <><span className="sb-pulse-dot" style={{ marginRight: 6 }} />Following ✓</> : "Follow"}
        </button>
        <button
          type="button"
          className="u-action-btn sb-card-lift"
          onClick={() => {
            const url = `${window.location.origin}/u/${encodeURIComponent(handle)}`;
            if ((navigator as any).share) (navigator as any).share({ title: displayName, url }).catch(() => {});
            else navigator.clipboard?.writeText(url).catch(() => {});
          }}
        >
          Share
        </button>
      </section>

      <nav className="u-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "posts"}  className={`u-tab${tab === "posts"  ? " is-active" : ""}`} onClick={() => setTab("posts")} >▦</button>
        <button type="button" role="tab" aria-selected={tab === "reels"}  className={`u-tab${tab === "reels"  ? " is-active" : ""}`} onClick={() => setTab("reels")} >▶</button>
        <button type="button" role="tab" aria-selected={tab === "tagged"} className={`u-tab${tab === "tagged" ? " is-active" : ""}`} onClick={() => setTab("tagged")}>🏷</button>
      </nav>

      <section className="u-grid">
        {loading ? (
          <div className="u-empty"><span className="u-empty-icon">⌛</span><p className="u-empty-title">Loading…</p></div>
        ) : posts.length === 0 ? (
          <div className="u-empty">
            <span className="u-empty-icon">📷</span>
            <p className="u-empty-title">
              {profile ? "No posts yet" : "This profile doesn't have any posts here yet"}
            </p>
            <p className="u-empty-sub">
              {profile ? "Check back later" : "They'll show up here once shared"}
            </p>
          </div>
        ) : (
          posts
            .filter((p: any) => tab !== "reels" || String(p.media_type || "").toLowerCase() === "reel")
            .map((p: any) => (
              <button
                key={p.id}
                type="button"
                className="u-grid-tile"
                onClick={() => router.push(`/u/${encodeURIComponent(handle)}/posts?start=${encodeURIComponent(String(p.id))}`)}
                aria-label="Open post"
              >
                {p.thumbnail_url || p.media_url ? (
                  <img src={p.thumbnail_url || p.media_url} alt="" loading="lazy" />
                ) : (
                  <span className="u-grid-fallback">{(p.caption || "•").slice(0, 1)}</span>
                )}
                {String(p.media_type || "").toLowerCase() === "reel" && <span className="u-grid-icon">▶</span>}
              </button>
            ))
        )}
      </section>

      {followSheet && (
        <FollowListSheet
          kind={followSheet}
          targetHandle={synthHandle}
          targetName={displayName}
          searchFollowers={searchFollowers}
          follows={follows}
          onClose={() => setFollowSheet(null)}
        />
      )}

      <style jsx global>{`
        .u-root {
          min-height: 100dvh;
          background: linear-gradient(180deg, #fff9ec 0%, #fdf3df 60%, #faecc7 100%);
          color: #2c1d04;
          padding-bottom: 84px;
          font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
        }
        .u-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px 10px;
          position: sticky; top: 0; z-index: 30;
          background: rgba(255, 249, 236, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(184, 134, 11, 0.10);
        }
        .u-back {
          width: 30px; height: 30px; border-radius: 999px;
          background: rgba(184, 134, 11, 0.10);
          border: 1px solid rgba(184, 134, 11, 0.22);
          color: #6e4a08; font-weight: 700; cursor: pointer;
        }
        .u-top-handle {
          font-weight: 700; font-size: 1rem; letter-spacing: -0.01em; color: #2c1d04;
          flex: 1; text-align: center;
        }

        .u-header {
          display: flex; align-items: center; gap: 18px;
          padding: 16px 16px 6px;
        }
        .u-avatar-wrap {
          width: 88px; height: 88px; border-radius: 999px; padding: 2.5px;
          background: conic-gradient(from 0deg, #c9911a, #f0d060, #fff4cc, #f0d060, #c9911a);
          flex-shrink: 0;
        }
        .u-avatar-img {
          width: 100%; height: 100%; border-radius: 999px; object-fit: cover;
          border: 3px solid #fff9ec; display: block;
        }
        .u-avatar-fallback {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 999px;
          background: #fff9ec; border: 3px solid #fff9ec;
          font-size: 2.2rem; font-weight: 800; color: #6e4a08;
        }
        .u-stats {
          display: flex; flex: 1; align-items: center;
          justify-content: space-around; gap: 4px;
        }
        .u-stat {
          display: flex; flex-direction: column; align-items: center; gap: 1px;
        }
        .u-stat-value { font-size: 1.05rem; font-weight: 800; color: #2c1d04; }
        .u-stat-label { font-size: 0.72rem; font-weight: 500; color: #6e4a08; }
        .u-stat-btn {
          background: transparent; border: none; padding: 4px 6px; margin: 0;
          cursor: pointer; border-radius: 8px;
          transition: background 0.16s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .u-stat-btn:hover { background: rgba(184, 134, 11, 0.06); }
        .u-stat-btn:active { transform: scale(0.96); }

        .u-bio-wrap { padding: 4px 18px 10px; }
        .u-display-name { font-size: 0.92rem; font-weight: 800; color: #2c1d04; margin: 0 0 2px; }
        .u-verified { color: #c9911a; font-weight: 700; }
        .u-creator  { color: #c9911a; }
        .u-hotel    { font-size: 0.9rem; }
        .u-bio {
          font-size: 0.84rem; color: #4a3208;
          line-height: 1.35; white-space: pre-line; margin: 0;
        }

        .u-actions {
          display: flex; gap: 6px;
          padding: 6px 14px 14px;
        }
        .u-action-btn {
          flex: 1;
          display: inline-flex; align-items: center; justify-content: center;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid rgba(184, 134, 11, 0.30);
          background: rgba(255, 255, 255, 0.6);
          color: #2c1d04;
          font-size: 0.84rem; font-weight: 700;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .u-action-btn:active { transform: scale(0.97); }
        .u-action-primary {
          background: linear-gradient(135deg, #f0d060, #ffd76b);
          border-color: rgba(184, 134, 11, 0.45);
          color: #2c1d04;
        }
        .u-action-secondary { background: rgba(255, 255, 255, 0.9); }

        .u-tabs {
          display: flex; align-items: center; justify-content: space-around;
          border-top: 1px solid rgba(184, 134, 11, 0.18);
          border-bottom: 1px solid rgba(184, 134, 11, 0.18);
          background: rgba(255, 255, 255, 0.45);
        }
        .u-tab {
          flex: 1; padding: 12px 0; background: none; border: none;
          color: rgba(74, 50, 8, 0.55); font-size: 1.15rem; font-weight: 700;
          cursor: pointer; border-bottom: 2px solid transparent;
        }
        .u-tab.is-active { color: #2c1d04; border-bottom-color: #6e4a08; }

        .u-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 2px;
        }
        .u-grid-tile {
          position: relative; aspect-ratio: 1 / 1;
          background: rgba(184, 134, 11, 0.08);
          overflow: hidden; border: none; padding: 0; cursor: pointer;
          width: 100%; display: block;
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1);
        }
        .u-grid-tile:active { transform: scale(0.97); }
        .u-grid-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .u-grid-fallback {
          display: flex; align-items: center; justify-content: center;
          height: 100%; font-size: 1.8rem; font-weight: 700;
          color: rgba(184, 134, 11, 0.5);
        }
        .u-grid-icon {
          position: absolute; top: 6px; right: 6px;
          color: rgba(255, 255, 255, 0.95); font-size: 0.8rem;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        }
        .u-empty {
          grid-column: 1 / -1; text-align: center; padding: 48px 24px;
          color: rgba(74, 50, 8, 0.7);
        }
        .u-empty-icon { font-size: 2.5rem; display: block; margin-bottom: 8px; }
        .u-empty-title { font-size: 0.92rem; font-weight: 700; color: #2c1d04; margin: 0 0 4px; }
        .u-empty-sub { font-size: 0.78rem; }
      `}</style>
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="u-stat u-stat-btn" aria-label={`${label} — open list`}>
        <span className="u-stat-value">{value}</span>
        <span className="u-stat-label">{label}</span>
      </button>
    );
  }
  return (
    <div className="u-stat">
      <span className="u-stat-value">{value}</span>
      <span className="u-stat-label">{label}</span>
    </div>
  );
}

function prettyName(handle: string): string {
  // "riya.sharma" → "Riya Sharma"
  return (handle || "")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || handle;
}

// ─── Mini follower / following sheet — same shape as /me's ───
function FollowListSheet({
  kind, targetHandle, targetName, searchFollowers, follows, onClose,
}: {
  kind: "followers" | "following";
  targetHandle: string;
  targetName: string;
  searchFollowers: (handle: string, q: string) => string[];
  follows: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = useMemo(() => {
    if (kind === "followers") return searchFollowers(targetHandle, query.trim());
    // For "following" of someone we don't have a real graph for, fall back
    // to the synthesized followers of that handle as a stand-in (matches
    // the experience the user sees in the feed-side CreatorProfileSheet).
    const q = query.trim().toLowerCase();
    const seed = searchFollowers(targetHandle, "");
    return q ? seed.filter((e) => e.toLowerCase().includes(q)) : seed.slice(0, 200);
  }, [kind, targetHandle, query, searchFollowers]);

  const goToProfile = (rawHandle: string) => {
    const h = rawHandle.replace(/^@/, "").trim();
    if (!h) return;
    onClose();
    router.push(`/u/${encodeURIComponent(h)}`);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 86,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%", maxWidth: 520, maxHeight: "78dvh",
          background: "linear-gradient(180deg, #fff9ec 0%, #f9efd6 100%)",
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          boxShadow: "0 -16px 40px rgba(0, 0, 0, 0.32)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center", gap: 8, padding: "14px 16px 10px",
          borderBottom: "1px solid rgba(184, 134, 11, 0.18)",
          background: "rgba(255, 249, 236, 0.92)",
        }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "rgba(74, 50, 8, 0.70)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {targetHandle}
          </span>
          <span style={{ fontSize: "1rem", fontWeight: 800, color: "#2c1d04", textAlign: "center" }}>
            {kind === "followers" ? "Followers" : "Following"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ justifySelf: "end", width: 30, height: 30, borderRadius: 999, background: "rgba(184, 134, 11, 0.10)", border: "1px solid rgba(184, 134, 11, 0.22)", color: "#6e4a08", fontWeight: 700, cursor: "pointer" }}
          >✕</button>
        </div>
        <div style={{ padding: "10px 14px 6px" }}>
          <input
            type="text"
            inputMode="search"
            placeholder={`Search ${kind}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%", padding: "9px 12px", fontSize: "0.86rem",
              color: "#2c1d04", background: "rgba(255, 255, 255, 0.7)",
              border: "1px solid rgba(184, 134, 11, 0.30)", borderRadius: 10, outline: "none",
            }}
          />
        </div>
        <ul role="list" style={{ listStyle: "none", margin: 0, padding: "4px 6px 18px", overflowY: "auto", flex: 1 }}>
          {list.length === 0 ? (
            <li style={{ padding: "36px 18px", textAlign: "center", color: "rgba(74, 50, 8, 0.72)", fontSize: "0.86rem" }}>
              {query ? `No ${kind} match that search.` : `No ${kind} yet.`}
            </li>
          ) : (
            list.map((entry, i) => {
              const [name, handleStr] = entry.includes("|") ? entry.split("|") : [entry, entry];
              return (
                <li key={`${handleStr}-${i}`}>
                  <button
                    type="button"
                    onClick={() => goToProfile(handleStr)}
                    style={{
                      display: "flex", width: "100%", alignItems: "center", gap: 12,
                      padding: "9px 12px", borderRadius: 10, border: "none",
                      background: "transparent", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{
                      width: 42, height: 42, borderRadius: 999,
                      background: "linear-gradient(135deg, #f0d060, #c9911a)",
                      color: "#2c1d04", fontWeight: 800,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: "1rem", border: "2px solid #fff9ec", flexShrink: 0,
                    }}>{(name || "?").trim().slice(0, 1).toUpperCase()}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#2c1d04", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</p>
                      <p style={{ margin: 0, fontSize: "0.74rem", color: "rgba(74, 50, 8, 0.68)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{handleStr}</p>
                    </div>
                    <span style={{ color: "rgba(74, 50, 8, 0.45)", fontSize: "0.95rem", fontWeight: 700 }}>›</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
