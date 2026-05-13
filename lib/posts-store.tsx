"use client";
// ═══════════════════════════════════════════════════════════════════════════
// PostsStore — global, reactive store for user-created posts (Reel / Photo /
// Story) so they show up immediately in the main feed and on the user's
// profile.
// ───────────────────────────────────────────────────────────────────────────
// Persistence model
//   • Posts are persisted to localStorage as `sb_user_posts` (an array).
//   • Media URLs are blob URLs from URL.createObjectURL — these survive a
//     page navigation but NOT a hard reload (the underlying File is gone).
//     After a hard reload, the post entry remains but the media URL is dead;
//     the consumer (feed) renders a "media expired" placeholder instead of
//     a broken video tag. Persisting the actual binary needs IndexedDB +
//     backend upload — out of scope for this iteration.
// ═══════════════════════════════════════════════════════════════════════════
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ContentKind = "reel" | "photo" | "story";

export type UserPost = {
  id: string;
  kind: ContentKind;
  mediaUrl: string;
  mediaMime: string;
  /**
   * Poster image (data-URL JPEG, ~30-80 KB) extracted from the first
   * frame of the uploaded video. Used as the profile-grid thumbnail
   * AND as the <video poster=…> on the feed card so the user sees a
   * real preview even if the codec failed or the blob URL died on
   * reload. Empty string when extraction failed (codec unsupported).
   */
  posterUrl?: string;
  caption: string;
  tags: string[];
  audio: { name: string; url: string } | null;
  /** Location attached to this post (optional). */
  location?: { name: string; lat?: number; lng?: number } | null;
  /**
   * Tagged hotel — set when a public user attaches a real StayBid hotel to
   * their post. Lets the feed surface a "🏨 At {Hotel}" pill, route the
   * Book/Bid CTAs to that hotel, and let viewers explore the hotel page
   * straight from the reel.
   */
  taggedHotel?: { id: string; name: string; city?: string; image?: string } | null;
  /**
   * Highlight bucket — built-in (mountains/beaches/foodie/suites/toppicks/solo)
   * or a user-created custom highlight. Posts tagged with a highlight key
   * appear in that highlight's grid on the user's profile sheet, the same
   * way Instagram's story highlights work.
   */
  highlight?: { key: string; label: string; emoji: string } | null;
  /**
   * Story-only — auto-expire timestamp. Stories created at T live for 24h
   * (storyExpiresAt = T + 24h). Past expiry, they're filtered out of the
   * story rail + viewer (but kept in localStorage if `keepAsPost`).
   */
  storyExpiresAt?: number;
  /**
   * Story-only — when true, the story is *also* surfaced in the regular
   * feed (and survives past 24h). Toggled in the Composer at create time.
   */
  keepAsPost?: boolean;
  createdAt: number;
};

const LS_KEY = "sb_user_posts";

type PostsCtx = {
  posts: UserPost[];
  addPost: (p: UserPost) => void;
  removePost: (id: string) => void;
  /**
   * Patch an existing post in-place. Used by the Composer's async upload
   * step to swap a blob: mediaUrl for the durable Supabase Storage public
   * URL once the upload completes, and to replace the temporary `post-<ts>`
   * id with the real social_posts row id so /me's dedup with the remote
   * feed lines up. No-op if the id is unknown.
   */
  updatePost: (id: string, patch: Partial<UserPost>) => void;
};

const Ctx = createContext<PostsCtx>({
  posts: [],
  addPost: () => {},
  removePost: () => {},
  updatePost: () => {},
});

export function PostsProvider({ children }: { children: ReactNode }) {
  const [posts, setPosts] = useState<UserPost[]>([]);

  // Hydrate from localStorage (post-mount, SSR-safe)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setPosts(arr);
      }
    } catch {}
  }, []);

  const persist = useCallback((next: UserPost[]) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next.slice(0, 100))); } catch {}
  }, []);

  const addPost = useCallback((p: UserPost) => {
    setPosts((prev) => {
      // Defensive dedup. We dedupe both by id (the obvious case) AND by a
      // content fingerprint within a 5-second window — that catches the
      // user-reported "reel showed up twice" bug, where Strict Mode re-
      // entry or rapid double-tap on Post would commit two PostsStore
      // entries with different timestamp-based ids but identical content.
      const dupeWindow = 5000;
      const fp = (x: UserPost) =>
        `${x.kind}|${x.mediaMime}|${(x.posterUrl || "").slice(0, 96)}|${x.caption}`;
      const incoming = fp(p);
      const filtered = prev.filter((x) => {
        if (x.id === p.id) return false;
        // If the existing post is recent and matches by content, drop it
        // — the new entry is the most recent.
        if (Math.abs((x.createdAt || 0) - (p.createdAt || 0)) < dupeWindow && fp(x) === incoming) return false;
        return true;
      });
      const next = [p, ...filtered].slice(0, 100);
      persist(next);
      return next;
    });
  }, [persist]);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => {
      const next = prev.filter((x) => x.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  const updatePost = useCallback((id: string, patch: Partial<UserPost>) => {
    setPosts((prev) => {
      let found = false;
      const next = prev.map((x) => {
        if (x.id !== id) return x;
        found = true;
        return { ...x, ...patch };
      });
      if (!found) return prev;
      persist(next);
      return next;
    });
  }, [persist]);

  return (
    <Ctx.Provider value={{ posts, addPost, removePost, updatePost }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePosts = () => useContext(Ctx);
