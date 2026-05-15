"use client";
// ═══════════════════════════════════════════════════════════════════════════
// PostsScrollFeed — Instagram-style "Posts" / "All Posts" dedicated scroll
// view. Replaces v85's ReelPlayerModal: tapping a tile on /me or a video
// card on /saved now navigates to /me/posts or /saved/posts, which mounts
// this component with the relevant post list. The view scrolls to the
// tapped post and autoplays whatever is most visible (muted by default,
// tap to unmute) — exactly the IG "Posts" pattern from the user's screenshots.
//
// Two visual variants, driven by `mode`:
//   • "owner"  — used by /me/posts. No Follow button, no view-insights /
//                Boost row (those were removed in v87 per user feedback).
//   • "viewer" — used by /saved/posts. Follow button shown on header,
//                bookmark always pre-filled (the user got here from /saved).
//
// All action buttons (♡ like, 💬 comment, ↻ reshare, ▷ share, 🔖 bookmark)
// are FUNCTIONAL — they toggle local state, persist to localStorage, and
// fire native share / open a comments drawer where applicable. No more
// decorative-only buttons (v87).
//
// Viewport safety: every fixed/sticky element uses safe-area-inset for
// notch + home-bar clearance. The page body adds bottom padding for the
// BottomDock so action buttons never sit behind it. Works identically on
// iOS Safari, Android Chrome, Samsung Internet, and installed PWA.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// v121 — share the same IG filter preset table the composer + feed use,
// so PostsScrollFeed cards render with the exact look the creator picked.
import { filterCssFor } from "@/components/discover/CreateFlow";
// v121 — Comments must be sanitized at render so off-platform contact
// info gets scrubbed per the v25 anti-bypass rule. Same helper the
// composer + InstagramHotelFeed use, so the contract stays consistent.
import { sanitizeText } from "@/lib/sanitize-text";
import ModalCloseButton from "@/components/ModalCloseButton";

export type FeedPost = {
  id: string;
  /** "video" auto-plays + has tap-mute toggle. "image" renders <img>. */
  kind: "video" | "image";
  src: string;
  poster?: string;
  caption?: string;
  /** Owner / creator display name shown in the header chip. */
  ownerName: string;
  /** @handle shown under the display name on the header chip. */
  ownerHandle?: string;
  ownerAvatar?: string;
  /** Audio strip line — e.g. "Original audio" or "Acoustic Trips · Shiv Kailash". */
  audioLine?: string;
  /** v121 — full audio URL so the card can mount its own <audio> and
      play the custom soundtrack (overriding the video's source audio
      to match the composer's preview). Without this the audio strip
      label appears but no actual sound plays. */
  audioUrl?: string;
  /** Initial counts — like / comment counts read from the data source. */
  likeCount?: number;
  commentCount?: number;
  /** Optional deep-link to a hotel page, when the post is tagged to one. */
  hotelId?: string;
  /** v121 — human-readable hotel name. Without this the pill renders as
      a generic "View hotel ›" link instead of "At {Hotel Name}" — and
      the Edit sheet showed the raw hotel id instead of the name. */
  hotelName?: string;
  /** Optional location label shown in the header / edit sheet. */
  locationName?: string;
  /** v121 — chosen IG-style CSS filter preset id (e.g. "warm" / "noir").
      Applied as `filter:` on the video/img so what you see on the post
      card matches the look the creator picked at upload time. Was lost
      between PostsStore → /me/posts → card render before v121. */
  filterPreset?: string | null;
  /** v112.2 — IG-style toggles. When true, the like count + comment row
      are hidden on this card. Server stores these on social_posts so
      they survive across devices. Default false. */
  hideLikes?: boolean;
  disableComments?: boolean;
  /** v112.2 — current highlight bucket key (so the edit sheet can show
      the active selection). */
  highlightKey?: string;
};

type Mode = "owner" | "viewer";

// ─── localStorage helpers — keep the same keys the rest of the app uses ──
const LS_LIKES = "sb_post_likes_v1";   // { [postId]: true }
const LS_SAVES = "sb_local_saves";     // shared with /saved + reel feed

function readLikedSet(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(LS_LIKES) || "{}") || {}; }
  catch { return {}; }
}
function writeLikedSet(m: Record<string, true>) {
  try { localStorage.setItem(LS_LIKES, JSON.stringify(m)); } catch {}
}
function readSavedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const arr: any[] = JSON.parse(localStorage.getItem(LS_SAVES) || "[]");
    return new Set(arr.map((s: any) => `${s.target_type}:${s.target_id}`));
  } catch { return new Set(); }
}

export function PostsScrollFeed({
  posts,
  startId,
  headerTitle,
  mode,
  onPostDeleted,
  onPostEdited,
}: {
  posts: FeedPost[];
  startId?: string;
  headerTitle: string;
  mode: Mode;
  /** v111 — owner-only delete callback. Caller removes the entry from
      its data source (PostsStore / remote refetch) so the card vanishes
      from the feed immediately after the server confirms. */
  onPostDeleted?: (postId: string) => void;
  /** v111 — owner-only edit callback. Caller can update the caption in
      its data source so the card reflects the new value without a
      round-trip refetch. */
  onPostEdited?: (postId: string, patch: { caption?: string }) => void;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Track which post id is most visible — that one autoplays.
  const [activeId, setActiveId] = useState<string>("");
  // Per-card mute state so a tap-to-unmute on one doesn't unmute all.
  const [unmuted, setUnmuted] = useState<Record<string, boolean>>({});
  // Like + bookmark state hydrated from localStorage on mount.
  const [liked, setLiked] = useState<Record<string, true>>({});
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set());
  // Optimistic comment counter — wired even though the comment drawer
  // itself is just an empty placeholder for now (defers the full
  // commenting feature to a follow-up).
  const [commentsOpen, setCommentsOpen] = useState<string>("");
  // v121 — REAL comment input. Comments persist to localStorage keyed by
  // post id so the user sees their own threads come back after a reload.
  // (A backend wire-up to /api/social/posts/<id>/comments is a follow-up;
  // this at least makes the input WORK — taking text, posting it, and
  // showing it back to the user — instead of the v87 placeholder text.)
  const [commentDraft, setCommentDraft] = useState<string>("");
  const [commentLists, setCommentLists] = useState<Record<string, Array<{ id: string; text: string; at: number; author: string }>>>({});
  // Hydrate comment lists from localStorage once on mount.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined"
        ? localStorage.getItem("sb_post_comments_v1") : null;
      if (raw) setCommentLists(JSON.parse(raw) || {});
    } catch {}
  }, []);
  function persistComments(next: typeof commentLists) {
    try { localStorage.setItem("sb_post_comments_v1", JSON.stringify(next)); } catch {}
  }
  function submitComment(postId: string) {
    const text = commentDraft.trim();
    if (!text) return;
    // Read the signed-in display name (falls back to "you") from localStorage.
    let author = "you";
    try {
      const u = JSON.parse(localStorage.getItem("sb_user") || "null");
      if (u?.name) author = String(u.name);
      else if (u?.phone) author = String(u.phone).replace(/^\+91/, "");
    } catch {}
    const entry = { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, at: Date.now(), author };
    setCommentLists((prev) => {
      const list = prev[postId] ? prev[postId].slice() : [];
      list.unshift(entry);
      const next = { ...prev, [postId]: list };
      persistComments(next);
      return next;
    });
    setCommentDraft("");
  }
  // Toast for share / copy fallback.
  const [toast, setToast] = useState<string>("");
  // v111 — kebab menu state. `menuFor` is the postId whose ⋮ menu is open.
  const [menuFor, setMenuFor] = useState<string>("");
  // v111 — "Edit caption" inline sheet. `editFor` is the post being edited.
  // v112.2 — expanded into a full IG-style Edit Post sheet covering
  // caption + location + tagged hotel + highlight + hide-likes +
  // disable-comments. Each field has its own state slot so the user can
  // change one or many before tapping Save.
  const [editFor, setEditFor] = useState<FeedPost | null>(null);
  const [editCaption, setEditCaption] = useState<string>("");
  const [editLocation, setEditLocation] = useState<string>("");
  const [editHotelId, setEditHotelId] = useState<string>("");
  // v121 — searchable hotel picker. The raw "Hotel ID" input was a footgun
  // (users had to know the cuid). Now they search by name and we resolve
  // to id under the hood. `editHotelName` is the visible label that the
  // picker sets when the user picks a result.
  const [editHotelName, setEditHotelName] = useState<string>("");
  const [editHotelQuery, setEditHotelQuery] = useState<string>("");
  const [editHotelResults, setEditHotelResults] = useState<Array<{ id: string; name: string; city?: string }>>([]);
  const hotelSearchAbortRef = useRef<AbortController | null>(null);
  const [editHighlightKey, setEditHighlightKey] = useState<string>("");
  const [editHideLikes, setEditHideLikes] = useState<boolean>(false);
  const [editDisableComments, setEditDisableComments] = useState<boolean>(false);
  const [editing, setEditing] = useState(false);

  // Hydrate like + save state on mount.
  useEffect(() => {
    setLiked(readLikedSet());
    setSavedSet(readSavedSet());
  }, []);

  // Toast helper — auto-dismisses after 2s.
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? "" : t)), 2200);
  }

  // Scroll the starting post into view on first render.
  // v112.2 — the v87 implementation fired ONCE 30ms after mount, before
  // posts had loaded from /api/social/feed (which takes ~700 ms cold).
  // The element didn't exist yet, the scroll silently failed, and the
  // IntersectionObserver then marked the FIRST card active — so every
  // tile tap on /me opened the first post instead of the tapped one.
  // The fix: re-run whenever `posts` changes (so we try again after data
  // arrives), poll for up to ~1.6 s in case render is delayed, and lock
  // a sentinel so we only successfully scroll once per `startId`.
  const scrolledForRef = useRef<string>("");
  useEffect(() => {
    if (!startId) return;
    if (posts.length === 0) return;
    if (scrolledForRef.current === startId) return;

    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(`pf-${startId}`);
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "start" });
        setActiveId(startId);
        scrolledForRef.current = startId;
        return;
      }
      if (attempts++ < 20) setTimeout(tryScroll, 80);
    };
    tryScroll();
    return () => { cancelled = true; };
  }, [startId, posts]);

  // IntersectionObserver-driven autoplay — picks whichever video card is
  // most on-screen as the active one. Pauses the others.
  useEffect(() => {
    const cards = wrapRef.current?.querySelectorAll<HTMLElement>("[data-pf-card]");
    if (!cards || cards.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        let bestId = "";
        let bestRatio = -1;
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const id = (e.target as HTMLElement).dataset.pfId || "";
          if (!id) return;
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestId = id;
          }
        });
        if (bestId) setActiveId(bestId);
      },
      { threshold: [0.25, 0.55, 0.75] }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [posts]);

  // ─── Action handlers — wired (v87) ──────────────────────────────────
  function toggleLike(postId: string) {
    setLiked((m) => {
      const next = { ...m };
      if (next[postId]) delete next[postId];
      else next[postId] = true;
      writeLikedSet(next);
      return next;
    });
  }
  function toggleSave(post: FeedPost) {
    const key = `video:${post.id}`;
    setSavedSet((prev) => {
      const next = new Set(prev);
      let arr: any[] = [];
      try { arr = JSON.parse(localStorage.getItem(LS_SAVES) || "[]"); } catch {}
      if (next.has(key)) {
        next.delete(key);
        arr = arr.filter((s: any) => `${s.target_type}:${s.target_id}` !== key);
        showToast("Removed from Saved");
      } else {
        next.add(key);
        arr.push({
          id: `local-${Date.now()}`,
          target_type: "video",
          target_id: post.id,
          created_at: new Date().toISOString(),
          target: {
            id: post.id,
            s3_url: post.src,
            thumbnail_url: post.poster || "",
            title: post.ownerName || "Reel",
            caption: post.caption || "",
            uploader_name: post.ownerName,
            uploader_handle: post.ownerHandle || "",
            uploader_avatar_url: post.ownerAvatar || "",
            audio_name: post.audioLine || "Original audio",
          },
        });
        showToast("Saved to your collection");
      }
      try { localStorage.setItem(LS_SAVES, JSON.stringify(arr)); } catch {}
      return next;
    });
  }
  async function shareOrCopy(post: FeedPost) {
    const url = typeof window !== "undefined"
      ? `${window.location.origin}/saved/posts?start=${encodeURIComponent(post.id)}`
      : "";
    const title = post.ownerName ? `Post by ${post.ownerName}` : "StayBid Reel";
    const text = post.caption ? post.caption.slice(0, 120) : "Check this out on StayBid";
    try {
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title, text, url });
        return;
      }
    } catch { /* user dismissed — fall through */ }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard");
    } catch {
      showToast("Could not copy link");
    }
  }
  function restartPlayback(postId: string) {
    // Reshare ↻ button — the IG-style "loop" affordance restarts video.
    const el = document.querySelector<HTMLVideoElement>(`#pf-${postId} video`);
    if (el) {
      try {
        el.currentTime = 0;
        const p = el.play();
        if (p && typeof p.then === "function") p.catch(() => {});
        showToast("Replaying ↻");
      } catch {}
    }
  }
  function openCommentsDrawer(postId: string) {
    setCommentsOpen(postId);
  }

  // v111 — owner-only kebab menu handlers.
  // v112.1 — bulletproof delete: post ids on /me/posts can be EITHER
  //   • local PostsStore id (`post-<ts>-<rand>`) — for a post still
  //     uploading / failed to upload (no server row exists), OR
  //   • UUID (server row id from social_posts table)
  // The previous v111 cut hit DELETE /api/social/posts/<local-id> and
  // got 404, surfacing as "Couldn't delete" most of the time. The fix:
  // detect local-only ids and just nuke the local entry, only call
  // the server for UUID ids. Also treats 404 as a success (the row
  // is already gone — same end-state the user wants).
  function removeFromLocalStorage(id: string) {
    try {
      const raw = localStorage.getItem("sb_user_posts");
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const next = arr.filter((x: any) => x?.id !== id);
      localStorage.setItem("sb_user_posts", JSON.stringify(next));
    } catch { /* localStorage write failure is non-fatal */ }
  }

  async function deletePost(post: FeedPost) {
    // Two-step confirm so the user can't tap-trigger this by accident.
    if (typeof window !== "undefined") {
      const ok = window.confirm("Delete this post? This can't be undone.");
      if (!ok) return;
    }
    setMenuFor("");

    // Local-only post (still uploading OR upload failed) — there's no
    // server row to delete. Just remove the local entry and surface
    // success. Without this branch, /me/posts shows "Couldn't delete"
    // every time the user tries to remove a just-posted reel that
    // hasn't finished its async server upload yet.
    const isLocalOnlyId = post.id.startsWith("post-");
    if (isLocalOnlyId) {
      removeFromLocalStorage(post.id);
      try { onPostDeleted?.(post.id); } catch {}
      showToast("Post deleted");
      return;
    }

    try {
      const tok = (typeof window !== "undefined" && localStorage.getItem("sb_token")) || "";
      const r = await fetch(`/api/social/posts/${encodeURIComponent(post.id)}`, {
        method: "DELETE",
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      // 404 = the row is already gone (e.g. deleted on another device
      // since /me/posts loaded). Treat as success so the user sees the
      // UI update they expect. Any other non-OK is a real error.
      if (!r.ok && r.status !== 404) {
        let detail = "";
        try { const j = await r.json(); detail = j?.error || ""; } catch {}
        showToast(detail || "Couldn't delete — try again");
        return;
      }
      // Caller hides the entry from its data source.
      try { onPostDeleted?.(post.id); } catch {}
      // Also remove from PostsStore local entry IF this happens to be a
      // user-created one — the caller will usually handle this, but
      // calling it twice is a safe no-op (PostsStore.removePost just
      // filters by id). We're being defensive across the local + remote
      // dual-source merge that /me/posts does.
      removeFromLocalStorage(post.id);
      showToast("Post deleted");
    } catch {
      showToast("Couldn't delete — check your connection");
    }
  }

  function startEdit(post: FeedPost) {
    setMenuFor("");
    setEditFor(post);
    setEditCaption(post.caption || "");
    setEditLocation(post.locationName || "");
    setEditHotelId(post.hotelId || "");
    // v121 — seed the hotel NAME so the searchable picker shows the
    // human-readable label instead of the raw id. If we only know the id
    // (legacy), the picker falls back to showing the id but still lets
    // the user search to replace.
    setEditHotelName(post.hotelName || "");
    setEditHotelQuery("");
    setEditHotelResults([]);
    setEditHighlightKey(post.highlightKey || "");
    setEditHideLikes(!!post.hideLikes);
    setEditDisableComments(!!post.disableComments);
  }

  // v121 — Debounced hotel search. Hits /api/hotels?search=… and returns
  // the top matches so the edit sheet can show NAMES (not ids). Aborts
  // in-flight requests so a fast typer never races a stale response.
  useEffect(() => {
    if (!editFor) return;
    const q = editHotelQuery.trim();
    if (q.length < 2) { setEditHotelResults([]); return; }
    if (hotelSearchAbortRef.current) {
      try { hotelSearchAbortRef.current.abort(); } catch {}
    }
    const ac = new AbortController();
    hotelSearchAbortRef.current = ac;
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/hotels?search=${encodeURIComponent(q)}&limit=8`, { signal: ac.signal, cache: "no-store" });
        if (!r.ok) return;
        const json = await r.json().catch(() => null);
        const list = Array.isArray(json?.hotels) ? json.hotels : (Array.isArray(json) ? json : []);
        const top = list.slice(0, 8).map((h: any) => ({
          id: String(h.id),
          name: String(h.name || h.title || ""),
          city: h.city || h.location_city || "",
        })).filter((h: { id: string; name: string }) => h.id && h.name);
        if (!ac.signal.aborted) setEditHotelResults(top);
      } catch {}
    }, 220);
    return () => { window.clearTimeout(id); try { ac.abort(); } catch {} };
  }, [editHotelQuery, editFor]);

  async function commitEdit() {
    if (!editFor) return;
    setEditing(true);
    // v112.1 — local-only ids skip the server PATCH (would 404). Just
    // update the local entry in place; the eventual server upload
    // includes the freshest fields.
    const isLocalOnlyId = editFor.id.startsWith("post-");
    // Build the payload — only include fields the user can edit. Empty
    // strings become explicit nulls so the server can clear them.
    const payload: Record<string, any> = {
      caption:          editCaption,
      location_name:    editLocation || "",
      hotel_id:         editHotelId || null,
      highlight_key:    editHighlightKey || null,
      hide_likes:       editHideLikes,
      disable_comments: editDisableComments,
    };
    try {
      if (!isLocalOnlyId) {
        const tok = (typeof window !== "undefined" && localStorage.getItem("sb_token")) || "";
        const r = await fetch(`/api/social/posts/${encodeURIComponent(editFor.id)}`, {
          method:  "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok && r.status !== 404) { showToast("Couldn't save — try again"); return; }
      }
      try { onPostEdited?.(editFor.id, { caption: editCaption }); } catch {}
      // Also mirror to PostsStore's localStorage row when it's a local one.
      try {
        const raw = localStorage.getItem("sb_user_posts");
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const next = arr.map((x: any) =>
              x?.id === editFor.id
                ? {
                    ...x,
                    caption:          editCaption,
                    location:         editLocation ? { name: editLocation } : null,
                    highlight:        editHighlightKey
                      ? { key: editHighlightKey, label: x.highlight?.label || editHighlightKey, emoji: x.highlight?.emoji || "✨" }
                      : null,
                    hideLikes:        editHideLikes,
                    disableComments:  editDisableComments,
                  }
                : x);
            localStorage.setItem("sb_user_posts", JSON.stringify(next));
          }
        }
      } catch {}
      setEditFor(null);
      showToast("Updated ✓");
    } catch {
      showToast("Couldn't save — try again");
    } finally {
      setEditing(false);
    }
  }

  return (
    <div className="pf-root" ref={wrapRef}>
      <header className="pf-top">
        <button
          type="button"
          className="pf-back"
          onClick={() => router.back()}
          aria-label="Back"
        >←</button>
        <span className="pf-title">{headerTitle}</span>
        {/* v88 — premium cozy brand wordmark, restored after v87 removal.
            Lives on the right side of the title bar so the user always
            sees what app they're in without crowding the back arrow. */}
        <span className="pf-brand" aria-label="StayBid">
          stay<span className="pf-brand-dot">·</span>bid
        </span>
      </header>

      <div className="pf-list">
        {posts.length === 0 ? (
          <div className="pf-empty">
            <span className="pf-empty-icon">📭</span>
            <p className="pf-empty-title">Nothing to show yet</p>
          </div>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              mode={mode}
              isActive={activeId === p.id}
              muted={!unmuted[p.id]}
              liked={!!liked[p.id]}
              saved={savedSet.has(`video:${p.id}`)}
              menuOpen={menuFor === p.id}
              onToggleMute={() =>
                setUnmuted((m) => ({ ...m, [p.id]: !m[p.id] }))
              }
              onLike={() => toggleLike(p.id)}
              onComment={() => openCommentsDrawer(p.id)}
              onRestart={() => restartPlayback(p.id)}
              onShare={() => shareOrCopy(p)}
              onSave={() => toggleSave(p)}
              onMenuToggle={() => setMenuFor((cur) => (cur === p.id ? "" : p.id))}
              onMenuClose={() => setMenuFor("")}
              onDelete={() => deletePost(p)}
              onEdit={() => startEdit(p)}
            />
          ))
        )}
      </div>

      {/* v121 — Real comments drawer. Replaces the v87 placeholder.
          - Lists previously-posted comments for THIS post (read from local
            cache so the user sees their own threads come back on reload).
          - Has a real text input + Send button.
          - Sanitises the body before showing to scrub off-platform
            contact info per the v25 anti-bypass rule.
          - Closes on backdrop tap, ✕ tap, or after sending. */}
      {commentsOpen && (
        <div className="pf-drawer-backdrop" onClick={() => { setCommentsOpen(""); setCommentDraft(""); }}>
          <div className="pf-drawer pf-comments-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pf-drawer-handle" />
            <div className="pf-comments-head">
              <p className="pf-drawer-title">Comments</p>
              <ModalCloseButton
                onClose={() => { setCommentsOpen(""); setCommentDraft(""); }}
                tone="light"
                ariaLabel="Close comments"
                className="pf-comments-close"
              />
            </div>
            <div className="pf-comments-list">
              {(commentLists[commentsOpen] && commentLists[commentsOpen].length > 0) ? (
                commentLists[commentsOpen].map((c) => (
                  <div key={c.id} className="pf-comment-row">
                    <span className="pf-comment-av">{(c.author || "?")[0]?.toUpperCase()}</span>
                    <div className="pf-comment-body">
                      <p className="pf-comment-line">
                        <strong>{c.author}</strong> {sanitizeText(c.text).clean}
                      </p>
                      <p className="pf-comment-time">{new Date(c.at).toLocaleString()}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="pf-drawer-empty">No comments yet — be the first to say something nice 💬</p>
              )}
            </div>
            <form
              className="pf-comments-input-row"
              onSubmit={(e) => { e.preventDefault(); submitComment(commentsOpen); }}
            >
              <input
                type="text"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value.slice(0, 500))}
                placeholder="Add a comment…"
                className="pf-comments-input"
                aria-label="Write a comment"
                autoFocus
              />
              <button
                type="submit"
                className="pf-comments-send"
                disabled={!commentDraft.trim()}
                aria-label="Post comment"
              >Send</button>
            </form>
          </div>
        </div>
      )}

      {/* v112.2 — IG-style Edit Post sheet (owner only). Beyond caption
          we now expose location, tagged hotel, highlight bucket, hide-
          like-count, and disable-comments toggles. Media + media-type
          stay immutable so the v111 idempotency contract holds. */}
      {editFor && (
        <div className="pf-drawer-backdrop" onClick={() => !editing && setEditFor(null)}>
          <div className="pf-drawer pf-edit-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pf-drawer-handle" />
            <p className="pf-drawer-title">Edit post</p>

            <label className="pf-edit-label" htmlFor="pf-edit-caption">Caption</label>
            <textarea
              id="pf-edit-caption"
              className="pf-edit-textarea"
              value={editCaption}
              onChange={(e) => setEditCaption(e.target.value)}
              placeholder="Write a caption…"
              maxLength={2200}
              rows={4}
              autoFocus
            />
            <p className="pf-edit-count">{editCaption.length} / 2200</p>

            <label className="pf-edit-label" htmlFor="pf-edit-location">📍 Location</label>
            <input
              id="pf-edit-location"
              type="text"
              className="pf-edit-input"
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              placeholder="Add a location (e.g. Mussoorie, Uttarakhand)"
              maxLength={120}
            />

            <label className="pf-edit-label" htmlFor="pf-edit-hotel">🏨 Tagged hotel</label>
            {/* v121 — Search by NAME, resolve to id under the hood. The
                current pick (if any) shows as a removable pill above the
                input. The raw-id field is gone; users no longer need to
                know an internal cuid to retag their post. */}
            {editHotelId && (
              <div className="pf-edit-hotel-pill">
                <span className="pf-edit-hotel-pill-name">
                  🏨 {editHotelName || `Hotel ${editHotelId}`}
                </span>
                <button
                  type="button"
                  onClick={() => { setEditHotelId(""); setEditHotelName(""); }}
                  aria-label="Untag hotel"
                  className="pf-edit-hotel-pill-x"
                >×</button>
              </div>
            )}
            <input
              id="pf-edit-hotel"
              type="text"
              className="pf-edit-input"
              value={editHotelQuery}
              onChange={(e) => setEditHotelQuery(e.target.value)}
              placeholder={editHotelId ? "Search to change hotel…" : "Search hotels by name…"}
              maxLength={120}
              autoComplete="off"
            />
            {editHotelResults.length > 0 && (
              <div className="pf-edit-hotel-results" role="listbox">
                {editHotelResults.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    role="option"
                    onClick={() => {
                      setEditHotelId(h.id);
                      setEditHotelName(h.name);
                      setEditHotelQuery("");
                      setEditHotelResults([]);
                    }}
                    className="pf-edit-hotel-row"
                  >
                    <span className="pf-edit-hotel-row-name">🏨 {h.name}</span>
                    {h.city && <span className="pf-edit-hotel-row-city">{h.city}</span>}
                  </button>
                ))}
              </div>
            )}

            <label className="pf-edit-label" htmlFor="pf-edit-highlight">✨ Highlight bucket</label>
            <select
              id="pf-edit-highlight"
              className="pf-edit-input"
              value={editHighlightKey}
              onChange={(e) => setEditHighlightKey(e.target.value)}
            >
              <option value="">— None —</option>
              <option value="mountains">🌄 Mountains</option>
              <option value="beaches">🏖 Beaches</option>
              <option value="foodie">🍜 Foodie</option>
              <option value="suites">🛏 Suites</option>
              <option value="toppicks">✨ Top picks</option>
              <option value="solo">🎒 Solo</option>
              {/* Preserve a custom highlight already on the post (so
                  users don't lose a custom bucket by opening Edit). */}
              {editHighlightKey?.startsWith("custom-") && (
                <option value={editHighlightKey}>
                  ✨ {editHighlightKey.replace("custom-", "").replace(/-/g, " ")}
                </option>
              )}
            </select>

            <label className="pf-edit-toggle-row">
              <span className="pf-edit-toggle-text">
                <span className="pf-edit-toggle-label">Hide like count</span>
                <span className="pf-edit-toggle-sub">Only you'll see how many people liked this post</span>
              </span>
              <input
                type="checkbox"
                className="pf-edit-toggle"
                checked={editHideLikes}
                onChange={(e) => setEditHideLikes(e.target.checked)}
              />
            </label>

            <label className="pf-edit-toggle-row">
              <span className="pf-edit-toggle-text">
                <span className="pf-edit-toggle-label">Turn off commenting</span>
                <span className="pf-edit-toggle-sub">No new comments can be posted on this reel</span>
              </span>
              <input
                type="checkbox"
                className="pf-edit-toggle"
                checked={editDisableComments}
                onChange={(e) => setEditDisableComments(e.target.checked)}
              />
            </label>

            <div className="pf-edit-actions">
              <button
                type="button"
                className="pf-edit-cancel"
                onClick={() => setEditFor(null)}
                disabled={editing}
              >Cancel</button>
              <button
                type="button"
                className="pf-edit-save"
                onClick={commitEdit}
                disabled={editing}
              >{editing ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="pf-toast">{toast}</div>}

      <style jsx global>{`
        /* v88 — Premium cozy palette: warm cream surface, cocoa text,
           champagne accents. Replaces the v87 stark white + pure black. */
        .pf-root {
          min-height: 100dvh;
          background: var(--cozy-cream-50, #FFFCF6);
          color: var(--cozy-warm-dark, #1F1A0F);
          padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
          font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
        }
        .pf-top {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px;
          background: rgba(255, 252, 246, 0.94);
          backdrop-filter: blur(12px) saturate(1.15);
          -webkit-backdrop-filter: blur(12px) saturate(1.15);
          border-bottom: 1px solid var(--cozy-taupe, #E8DCC8);
        }
        .pf-back {
          width: 34px;
          height: 34px;
          border: none;
          background: transparent;
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 1.5rem;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          border-radius: 999px;
          transition: background 0.15s ease, transform 0.12s cubic-bezier(.32,1.2,.36,1);
        }
        .pf-back:hover { background: rgba(74, 56, 32, 0.06); }
        .pf-back:active { transform: scale(0.92); opacity: 0.6; }
        .pf-title {
          flex: 1;
          font-size: 1.04rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--cozy-warm-dark, #1F1A0F);
        }
        /* Brand wordmark — Cormorant italic, sits opposite the back arrow.
           Tiny + premium so it doesn't compete with the page title. */
        .pf-brand {
          font-family: "Cormorant Garamond", "Georgia", serif;
          font-style: italic;
          font-weight: 600;
          font-size: 0.92rem;
          line-height: 1;
          color: var(--cozy-cocoa, #4A3820);
          letter-spacing: 0.01em;
          padding-right: 4px;
          user-select: none;
        }
        .pf-brand-dot { color: var(--cozy-champagne, #C9A66B); margin: 0 1px; }
        .pf-spacer { width: 34px; }

        .pf-list { display: block; }
        .pf-empty {
          text-align: center;
          padding: 96px 32px;
          color: rgba(12, 10, 4, 0.55);
        }
        .pf-empty-icon { font-size: 3rem; display: block; margin-bottom: 10px; }
        .pf-empty-title { font-size: 0.95rem; font-weight: 700; }

        /* v88 — Drawer + Toast also follow the cozy palette */
        .pf-drawer-backdrop {
          position: fixed;
          inset: 0;
          z-index: 90;
          background: rgba(31, 26, 15, 0.55);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: pfFadeIn 0.18s ease both;
        }
        @keyframes pfFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pfSlideUp { from { transform: translateY(20%); } to { transform: translateY(0); } }
        .pf-drawer {
          width: 100%;
          max-width: 520px;
          background: var(--cozy-cream-50, #FFFCF6);
          border-radius: 18px 18px 0 0;
          padding: 14px 18px calc(env(safe-area-inset-bottom, 0px) + 18px);
          animation: pfSlideUp 0.28s cubic-bezier(.32,1.2,.36,1) both;
        }
        .pf-drawer-handle {
          width: 40px;
          height: 4px;
          border-radius: 999px;
          background: var(--cozy-taupe, #E8DCC8);
          margin: 0 auto 12px;
        }
        .pf-drawer-title {
          font-size: 0.92rem;
          font-weight: 700;
          color: var(--cozy-warm-dark, #1F1A0F);
          text-align: center;
          margin: 0 0 6px;
        }
        .pf-drawer-empty {
          font-size: 0.82rem;
          color: var(--cozy-cocoa, #4A3820);
          text-align: center;
          padding: 28px 12px;
          margin: 0;
        }
        .pf-drawer-close {
          width: 100%;
          padding: 11px;
          margin-top: 4px;
          border: none;
          border-radius: 12px;
          background: var(--cozy-warm-dark, #1F1A0F);
          color: var(--cozy-cream-50, #FFFCF6);
          font-size: 0.86rem;
          font-weight: 700;
          cursor: pointer;
        }
        /* v121 — Functional comment drawer styles. Header + scrollable
           list + sticky input row at the bottom. Matches the IG comment
           thread pattern. */
        .pf-comments-drawer { max-height: 78dvh; display: flex; flex-direction: column; }
        .pf-comments-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 4px 8px;
          border-bottom: 1px solid var(--cozy-taupe, #E8DCC8);
        }
        .pf-comments-head .pf-drawer-title { margin: 0; flex: 1; text-align: center; }
        .pf-comments-close {
          width: 32px; height: 32px;
          border: none;
          background: transparent;
          color: var(--cozy-cocoa, #4A3820);
          font-size: 1.1rem;
          cursor: pointer;
        }
        .pf-comments-list {
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 8px 4px;
          min-height: 60px;
          max-height: 56dvh;
        }
        .pf-comment-row {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 8px 6px;
          border-radius: 10px;
        }
        .pf-comment-av {
          width: 30px; height: 30px;
          border-radius: 999px;
          background: linear-gradient(135deg, var(--cozy-cream-200, #F2EAD8), var(--cozy-taupe, #E8DCC8));
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.86rem; font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .pf-comment-body { flex: 1; min-width: 0; }
        .pf-comment-line {
          font-size: 0.84rem;
          color: var(--cozy-warm-dark, #1F1A0F);
          margin: 0;
          line-height: 1.35;
          word-break: break-word;
        }
        .pf-comment-line strong { font-weight: 700; margin-right: 4px; }
        .pf-comment-time {
          font-size: 0.66rem;
          color: var(--cozy-cocoa-soft, #6E5430);
          margin: 2px 0 0;
        }
        .pf-comments-input-row {
          display: flex; gap: 8px; align-items: center;
          padding: 10px 4px 4px;
          border-top: 1px solid var(--cozy-taupe, #E8DCC8);
        }
        .pf-comments-input {
          flex: 1 1 auto;
          padding: 10px 14px;
          font-size: 0.86rem;
          border-radius: 999px;
          border: 1px solid var(--cozy-taupe, #E8DCC8);
          background: var(--cozy-cream-50, #FFFCF6);
          color: var(--cozy-warm-dark, #1F1A0F);
          outline: none;
        }
        .pf-comments-input:focus {
          border-color: var(--cozy-champagne, #C9A66B);
          box-shadow: 0 0 0 2px rgba(201, 166, 107, 0.18);
        }
        .pf-comments-send {
          padding: 9px 16px;
          border: none;
          border-radius: 999px;
          background: var(--cozy-champagne, #C9A66B);
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.82rem; font-weight: 800;
          cursor: pointer;
          flex-shrink: 0;
        }
        .pf-comments-send:disabled {
          background: var(--cozy-taupe, #E8DCC8);
          color: var(--cozy-cocoa-soft, #6E5430);
          cursor: not-allowed;
        }
        /* v121 — Searchable hotel picker inside the Edit Post sheet.
           Replaces the raw "Hotel ID" textbox. */
        .pf-edit-hotel-pill {
          display: inline-flex; align-items: center; gap: 8px;
          margin: 4px 0 10px;
          padding: 6px 6px 6px 12px;
          background: rgba(201, 166, 107, 0.16);
          border: 1px solid rgba(201, 166, 107, 0.40);
          border-radius: 999px;
          max-width: 100%;
        }
        .pf-edit-hotel-pill-name {
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.82rem; font-weight: 700;
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1 1 auto;
          min-width: 0;
        }
        .pf-edit-hotel-pill-x {
          width: 22px; height: 22px;
          border-radius: 999px;
          border: none;
          background: rgba(31, 26, 15, 0.10);
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.92rem; font-weight: 800;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
        }
        .pf-edit-hotel-results {
          margin-top: 6px;
          background: var(--cozy-cream-50, #FFFCF6);
          border: 1px solid var(--cozy-taupe, #E8DCC8);
          border-radius: 12px;
          overflow: hidden;
          max-height: 240px;
          overflow-y: auto;
        }
        .pf-edit-hotel-row {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--cozy-taupe, #E8DCC8);
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.82rem;
          text-align: left;
          cursor: pointer;
        }
        .pf-edit-hotel-row:last-child { border-bottom: none; }
        .pf-edit-hotel-row:hover { background: rgba(201, 166, 107, 0.10); }
        .pf-edit-hotel-row-name { font-weight: 700; }
        .pf-edit-hotel-row-city {
          font-size: 0.72rem;
          color: var(--cozy-cocoa-soft, #6E5430);
          margin-left: 8px;
        }

        /* Toast */
        @keyframes pfToastIn {
          0%   { opacity: 0; transform: translate(-50%, 16px); }
          15%  { opacity: 1; transform: translate(-50%, 0); }
          85%  { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -8px); }
        }
        /* v111 — kebab popover. Anchors to .pf-more in the card header. */
        .pf-more-wrap { position: relative; }
        .pf-more-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
        }
        .pf-more-menu {
          position: absolute;
          right: 0;
          top: calc(100% + 4px);
          z-index: 50;
          min-width: 180px;
          background: var(--cozy-cream-50, #FFFCF6);
          border: 1px solid var(--cozy-taupe, #E8DCC8);
          border-radius: 12px;
          box-shadow: 0 12px 28px rgba(31, 26, 15, 0.18);
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          animation: pfMenuIn 0.16s ease both;
        }
        @keyframes pfMenuIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .pf-more-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          font-size: 0.86rem;
          font-weight: 600;
          font-family: inherit;
          background: transparent;
          color: var(--cozy-warm-dark, #1F1A0F);
          border: none;
          border-radius: 8px;
          text-align: left;
          cursor: pointer;
          width: 100%;
          transition: background 0.14s ease;
        }
        .pf-more-item:hover { background: rgba(74, 56, 32, 0.06); }
        .pf-more-item:active { background: rgba(74, 56, 32, 0.10); }
        .pf-more-danger { color: #b2462f; }
        /* v112.2 — Edit Post sheet styling. Now scrollable since the IG-
           style version has 6 sections (caption, location, hotel,
           highlight, hide-likes, disable-comments). */
        .pf-edit-sheet {
          padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
          max-height: 86dvh;
          overflow-y: auto;
        }
        .pf-edit-label {
          display: block;
          margin: 14px 2px 4px;
          font-size: 0.78rem;
          font-weight: 700;
          color: var(--cozy-cocoa, #4A3820);
          letter-spacing: 0.01em;
        }
        .pf-edit-textarea {
          width: 100%;
          min-height: 110px;
          padding: 12px 14px;
          font-family: inherit;
          font-size: 0.92rem;
          line-height: 1.4;
          color: var(--cozy-warm-dark, #1F1A0F);
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid var(--cozy-taupe, #E8DCC8);
          border-radius: 12px;
          outline: none;
          resize: vertical;
          margin-top: 4px;
        }
        .pf-edit-textarea:focus { border-color: var(--cozy-champagne, #C9A66B); }
        .pf-edit-input {
          width: 100%;
          padding: 10px 12px;
          font-family: inherit;
          font-size: 0.92rem;
          color: var(--cozy-warm-dark, #1F1A0F);
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid var(--cozy-taupe, #E8DCC8);
          border-radius: 10px;
          outline: none;
          margin-top: 4px;
        }
        .pf-edit-input:focus { border-color: var(--cozy-champagne, #C9A66B); }
        select.pf-edit-input { cursor: pointer; }
        .pf-edit-count {
          margin: 6px 2px 4px;
          font-size: 0.72rem;
          color: var(--cozy-cocoa-soft, #6E5430);
          text-align: right;
        }
        .pf-edit-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 0 6px;
          margin-top: 8px;
          border-top: 1px solid var(--cozy-taupe, #E8DCC8);
          cursor: pointer;
        }
        .pf-edit-toggle-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .pf-edit-toggle-label {
          font-size: 0.88rem;
          font-weight: 700;
          color: var(--cozy-warm-dark, #1F1A0F);
        }
        .pf-edit-toggle-sub {
          font-size: 0.72rem;
          color: var(--cozy-cocoa-soft, #6E5430);
          line-height: 1.25;
        }
        .pf-edit-toggle {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          cursor: pointer;
          accent-color: var(--cozy-champagne, #C9A66B);
        }
        .pf-edit-actions {
          display: flex;
          gap: 10px;
        }
        .pf-edit-cancel, .pf-edit-save {
          flex: 1;
          padding: 11px 12px;
          border-radius: 10px;
          font-size: 0.9rem;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          border: 1px solid var(--cozy-taupe, #E8DCC8);
          transition: background 0.14s ease, transform 0.12s cubic-bezier(.32,1.2,.36,1);
        }
        .pf-edit-cancel {
          background: rgba(255, 255, 255, 0.7);
          color: var(--cozy-cocoa, #4A3820);
        }
        .pf-edit-save {
          background: linear-gradient(135deg, #f0d060, #ffd76b);
          color: #2c1d04;
          border-color: rgba(184, 134, 11, 0.55);
        }
        .pf-edit-save:disabled, .pf-edit-cancel:disabled { opacity: 0.5; cursor: default; }
        .pf-edit-save:not(:disabled):active,
        .pf-edit-cancel:not(:disabled):active { transform: scale(0.97); }
        .pf-toast {
          position: fixed;
          left: 50%;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 90px);
          z-index: 95;
          padding: 10px 16px;
          border-radius: 999px;
          background: rgba(31, 26, 15, 0.94);
          color: var(--cozy-cream-50, #FFFCF6);
          border: 1px solid rgba(217, 190, 130, 0.20);
          font-size: 0.82rem;
          font-weight: 600;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow: 0 8px 22px rgba(31, 26, 15, 0.35);
          animation: pfToastIn 2.2s ease forwards;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PostCard — one row of the scroll feed. v87 layout (Boost/Insights removed):
//   ┌────────────────────────────────────────────────┐
//   │ ◯avatar  display_name           [Follow]  ⋮    │  header
//   │           🎵 audio line                        │
//   ├────────────────────────────────────────────────┤
//   │                                                │
//   │              (video / image)                   │  media (9:16)
//   │                                                │
//   ├────────────────────────────────────────────────┤
//   │  ♡ N    💬 N    ↻        ▷           🔖        │  actions (all functional)
//   └────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────
function PostCard({
  post, mode, isActive, muted, liked, saved, menuOpen,
  onToggleMute, onLike, onComment, onRestart, onShare, onSave,
  onMenuToggle, onMenuClose, onDelete, onEdit,
}: {
  post: FeedPost;
  mode: Mode;
  isActive: boolean;
  muted: boolean;
  liked: boolean;
  saved: boolean;
  /** v111 — whether the kebab popover is open for THIS card. */
  menuOpen: boolean;
  onToggleMute: () => void;
  onLike: () => void;
  onComment: () => void;
  onRestart: () => void;
  onShare: () => void;
  onSave: () => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // v121 — custom-audio overlay. When the post has a soundtrack attached
  // (`audioUrl`), we mute the video and play this audio in sync with the
  // card's active/paused state. Mirrors the InstagramHotelFeed pattern so
  // both surfaces sound identical for the same post.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Animated heart for double-tap and like-button pop.
  const [heartPulse, setHeartPulse] = useState<number>(0);
  const hasCustomAudio = !!post.audioUrl;

  // Active card plays; inactive pauses.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // v121 — when a custom soundtrack is in play, ALWAYS mute the video so
    // we don't double-up source-video audio + the picked track. Otherwise
    // honour the global mute state from the parent.
    v.muted = hasCustomAudio ? true : muted;
    if (isActive) {
      const p = v.play();
      if (p && typeof p.then === "function") p.catch(() => {});
    } else {
      try { v.pause(); v.currentTime = 0; } catch {}
    }
  }, [isActive, muted, hasCustomAudio]);

  // Reflect external mute state changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = hasCustomAudio ? true : muted;
  }, [muted, hasCustomAudio]);

  // v121 — Drive the optional custom audio in lockstep with the active card
  // + global mute. NEVER route this element through Web Audio (applyGain) —
  // cross-origin MP3s without CORS-clean headers get silenced by the
  // browser the moment they hit a MediaElementSource. Native volume is
  // plenty loud + always audible.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isActive && hasCustomAudio && !muted) {
      try {
        a.muted = false;
        a.volume = 1;
        const p = a.play();
        if (p && typeof p.then === "function") p.catch(() => {});
      } catch {}
    } else {
      try { a.pause(); a.currentTime = 0; } catch {}
    }
    return () => {
      const el = audioRef.current;
      if (el) { try { el.pause(); el.currentTime = 0; } catch {} }
    };
  }, [isActive, hasCustomAudio, muted]);

  // Double-tap-to-like — IG signature interaction.
  const lastTapRef = useRef<number>(0);
  function handleMediaTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      // Double tap detected — like + heart animation
      if (!liked) onLike();
      setHeartPulse((n) => n + 1);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      // Single tap → toggle mute (only on videos)
      setTimeout(() => {
        if (lastTapRef.current === now) onToggleMute();
      }, 280);
    }
  }

  const initials = (post.ownerName || "?").trim().slice(0, 1).toUpperCase();
  const handle = post.ownerHandle ? `@${post.ownerHandle.replace(/^@/, "")}` : "";

  const likeCount = (post.likeCount || 0) + (liked ? 1 : 0);

  return (
    <article id={`pf-${post.id}`} data-pf-card data-pf-id={post.id} className="pf-card">
      {/* Header */}
      <div className="pf-head">
        <span className="pf-avatar">
          {post.ownerAvatar
            ? <img src={post.ownerAvatar} alt="" />
            : <span className="pf-avatar-fallback">{initials}</span>}
        </span>
        <div className="pf-head-text">
          <p className="pf-name">{handle || post.ownerName}</p>
          {post.audioLine && (
            <p className="pf-audio">🎵 {post.audioLine}</p>
          )}
        </div>
        {mode === "viewer" && (
          <button type="button" className="pf-follow" aria-label="Follow creator">
            Follow
          </button>
        )}
        {/* v111 — wired kebab. Owner sees Edit + Delete, viewer sees
            Copy link + Report. Tap outside (or another tap) closes. */}
        <div className="pf-more-wrap">
          <button
            type="button"
            className="pf-more"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
          >⋮</button>
          {menuOpen && (
            <>
              <div className="pf-more-backdrop" onClick={onMenuClose} aria-hidden />
              <div className="pf-more-menu" role="menu">
                {mode === "owner" ? (
                  <>
                    <button type="button" role="menuitem" className="pf-more-item" onClick={onEdit}>
                      ✎ Edit caption
                    </button>
                    <button type="button" role="menuitem" className="pf-more-item pf-more-danger" onClick={onDelete}>
                      🗑 Delete post
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="pf-more-item"
                      onClick={() => {
                        try {
                          navigator.clipboard?.writeText(
                            `${window.location.origin}/saved/posts?start=${encodeURIComponent(post.id)}`
                          );
                        } catch {}
                        onMenuClose();
                      }}
                    >🔗 Copy link</button>
                    <button
                      type="button"
                      role="menuitem"
                      className="pf-more-item pf-more-danger"
                      onClick={onMenuClose}
                    >🚩 Report</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Media — v121 applies the chosen IG filter preset as a CSS filter
          so the on-card render matches the composer preview exactly. */}
      <div className="pf-media">
        {post.kind === "video" && post.src ? (
          <>
            <video
              ref={videoRef}
              src={post.src}
              poster={post.poster || undefined}
              className="pf-video"
              loop
              playsInline
              preload={isActive ? "auto" : "metadata"}
              muted
              onClick={handleMediaTap}
              style={post.filterPreset && post.filterPreset !== "none"
                ? { filter: filterCssFor(post.filterPreset) }
                : undefined}
            />
            <button
              type="button"
              className="pf-mute"
              onClick={onToggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
            >{muted ? "🔇" : "🔊"}</button>
            {/* v121 — Custom soundtrack overlay. Hidden audio element that
                plays in lockstep with the active state + global mute. */}
            {hasCustomAudio && (
              <audio
                ref={audioRef}
                src={post.audioUrl}
                loop
                preload={isActive ? "auto" : "metadata"}
                aria-hidden
              />
            )}
          </>
        ) : post.poster || post.src ? (
          <img
            src={post.poster || post.src}
            alt={post.caption || ""}
            className="pf-image"
            onClick={handleMediaTap}
            style={post.filterPreset && post.filterPreset !== "none"
              ? { filter: filterCssFor(post.filterPreset) }
              : undefined}
          />
        ) : (
          <div className="pf-blank">📷</div>
        )}

        {/* Double-tap heart pulse */}
        {heartPulse > 0 && (
          <span key={heartPulse} className="pf-heart" aria-hidden>❤</span>
        )}
      </div>

      {/* Actions row — every button is functional in v87. v112.2 adds
          respect for `hideLikes` (count is hidden, like still works) and
          `disableComments` (comments button disabled with helper hint). */}
      <div className="pf-actions">
        <button
          type="button"
          className={`pf-act${liked ? " is-liked" : ""}`}
          onClick={onLike}
          aria-label={liked ? "Unlike" : "Like"}
          aria-pressed={liked}
        >
          <span className="pf-act-glyph">{liked ? "❤" : "♡"}</span>
          {likeCount > 0 && !post.hideLikes && (
            <span className="pf-act-count">{fmtViewCount(likeCount)}</span>
          )}
        </button>
        <button
          type="button"
          className="pf-act"
          onClick={post.disableComments ? undefined : onComment}
          disabled={!!post.disableComments}
          aria-label={post.disableComments ? "Comments are off" : "Comments"}
          title={post.disableComments ? "Comments are off for this post" : undefined}
        >
          <span className="pf-act-glyph">{post.disableComments ? "🚫" : "💬"}</span>
          {!post.disableComments && (post.commentCount || 0) > 0 && (
            <span className="pf-act-count">{fmtViewCount(post.commentCount || 0)}</span>
          )}
        </button>
        <button type="button" className="pf-act" onClick={onRestart} aria-label="Replay">
          <span className="pf-act-glyph">↻</span>
        </button>
        <button type="button" className="pf-act" onClick={onShare} aria-label="Share">
          <span className="pf-act-glyph">▷</span>
        </button>
        <span className="pf-actions-spacer" />
        <button
          type="button"
          className={`pf-act pf-act-bookmark${saved ? " is-saved" : ""}`}
          onClick={onSave}
          aria-label={saved ? "Remove from saved" : "Save"}
          aria-pressed={saved}
        >
          <span className="pf-act-glyph">🔖</span>
        </button>
      </div>

      {/* Caption (sanitized at the source) */}
      {post.caption && (
        <p className="pf-caption">
          <strong>{handle || post.ownerName}</strong> {post.caption}
        </p>
      )}

      {/* v121 — Meta row: location + tagged hotel pills. Renders BELOW the
          caption so the user sees the same composer-time metadata they
          attached. Generic "View hotel ›" replaced with "At {Hotel Name} ›"
          when the hotel name is known — falls back to the generic label
          only when the source data didn't include a name. */}
      {(post.locationName || post.hotelId) && (
        <div className="pf-meta-row">
          {post.locationName && (
            <span className="pf-meta-pill pf-meta-loc">
              📍 {post.locationName}
            </span>
          )}
          {post.hotelId && (
            <Link href={`/hotels/${post.hotelId}`} className="pf-meta-pill pf-meta-hotel">
              🏨 {post.hotelName ? `At ${post.hotelName}` : "View hotel"} ›
            </Link>
          )}
        </div>
      )}

      <style jsx global>{`
        /* v88 — Card surfaces in premium cozy palette: cream bg, cocoa
           text, taupe dividers, champagne accents for highlighted state. */
        .pf-card {
          background: var(--cozy-cream-50, #FFFCF6);
          border-bottom: 1px solid var(--cozy-taupe, #E8DCC8);
          padding: 6px 0 10px;
        }
        .pf-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
        }
        .pf-avatar {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          background: var(--cozy-cream-200, #F2EAD8);
          overflow: hidden;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pf-avatar-fallback {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--cozy-cocoa-soft, #6E5430);
        }
        .pf-head-text { flex: 1; min-width: 0; }
        .pf-name {
          font-size: 0.92rem;
          font-weight: 700;
          margin: 0;
          color: var(--cozy-warm-dark, #1F1A0F);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-audio {
          font-size: 0.78rem;
          color: var(--cozy-cocoa, #4A3820);
          margin: 1px 0 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-follow {
          padding: 6px 16px;
          border-radius: 999px;
          border: 1.5px solid var(--cozy-cocoa, #4A3820);
          background: transparent;
          color: var(--cozy-warm-dark, #1F1A0F);
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .pf-follow:hover { background: rgba(74, 56, 32, 0.06); }
        .pf-follow:active { opacity: 0.6; }
        .pf-more {
          background: transparent;
          border: none;
          color: var(--cozy-cocoa, #4A3820);
          font-size: 1.4rem;
          font-weight: 700;
          padding: 4px 6px;
          cursor: pointer;
        }
        .pf-media {
          position: relative;
          width: 100%;
          aspect-ratio: 9 / 16;
          max-height: 78vh;
          /* warmer than stark black — feels luxurious against cream */
          background: var(--cozy-warm-dark, #1F1A0F);
          overflow: hidden;
        }
        .pf-video, .pf-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .pf-image { background: var(--cozy-warm-dark, #1F1A0F); }
        .pf-blank {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: rgba(255, 255, 255, 0.55);
          font-size: 2.6rem;
        }
        .pf-mute {
          position: absolute;
          bottom: 10px;
          right: 10px;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          /* v88 — warm cocoa instead of cool near-black */
          background: rgba(31, 26, 15, 0.55);
          border: 1px solid rgba(217, 190, 130, 0.18);
          color: var(--cozy-cream-50, #FFFCF6);
          font-size: 0.85rem;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        /* Double-tap heart pulse — v88 warm rose instead of harsh red */
        @keyframes pfHeartPulse {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          25%  { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          70%  { transform: translate(-50%, -50%) scale(1.0); opacity: 0.95; }
          100% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
        }
        .pf-heart {
          position: absolute;
          top: 50%;
          left: 50%;
          font-size: 5rem;
          color: var(--cozy-rose, #D49583);
          text-shadow: 0 6px 22px rgba(212, 149, 131, 0.5);
          animation: pfHeartPulse 0.9s ease-out forwards;
          pointer-events: none;
          z-index: 4;
        }
        .pf-actions {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 11px 14px 4px;
        }
        .pf-act {
          background: transparent;
          border: none;
          color: var(--cozy-warm-dark, #1F1A0F);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 0;
          font-family: inherit;
          transition: transform 0.12s cubic-bezier(.32,1.2,.36,1);
        }
        .pf-act:active { transform: scale(0.86); opacity: 0.7; }
        .pf-act-glyph {
          font-size: 1.5rem;
          line-height: 1;
        }
        /* v88 — warm rose for liked, cozy champagne for saved */
        .pf-act.is-liked .pf-act-glyph { color: var(--cozy-rose, #D49583); }
        .pf-act.is-saved .pf-act-glyph {
          color: var(--cozy-champagne, #C9A66B);
          filter: drop-shadow(0 1px 2px rgba(201, 166, 107, 0.35));
        }
        .pf-act-count {
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--cozy-cocoa, #4A3820);
        }
        .pf-actions-spacer { flex: 1; }
        .pf-caption {
          padding: 6px 14px 0;
          font-size: 0.88rem;
          line-height: 1.35;
          color: var(--cozy-warm-dark, #1F1A0F);
        }
        .pf-caption strong { font-weight: 700; margin-right: 4px; }
        /* v121 — Meta pill row (location + hotel). Replaces the legacy
           .pf-hotel-cta. Flex-wrap so on narrow phones the location pill
           drops to its own line cleanly. */
        .pf-meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 8px 14px 0;
        }
        .pf-meta-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 6px 11px;
          border-radius: 999px;
          font-size: 0.74rem;
          font-weight: 700;
          line-height: 1;
          text-decoration: none;
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-meta-loc {
          background: rgba(157, 173, 143, 0.18);
          border: 1px solid rgba(157, 173, 143, 0.40);
          color: var(--cozy-cocoa, #4A3820);
        }
        .pf-meta-hotel {
          background: rgba(201, 166, 107, 0.16);
          border: 1px solid rgba(201, 166, 107, 0.36);
          color: var(--cozy-cocoa, #4A3820);
        }
        .pf-meta-hotel:hover { background: rgba(201, 166, 107, 0.26); }
      `}</style>
    </article>
  );
}

function fmtViewCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
