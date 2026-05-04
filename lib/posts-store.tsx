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
  caption: string;
  tags: string[];
  audio: { name: string; url: string } | null;
  createdAt: number;
};

const LS_KEY = "sb_user_posts";

type PostsCtx = {
  posts: UserPost[];
  addPost: (p: UserPost) => void;
  removePost: (id: string) => void;
};

const Ctx = createContext<PostsCtx>({
  posts: [],
  addPost: () => {},
  removePost: () => {},
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
      const next = [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 100);
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

  return (
    <Ctx.Provider value={{ posts, addPost, removePost }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePosts = () => useContext(Ctx);
