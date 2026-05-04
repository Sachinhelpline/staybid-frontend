"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Global FollowStore — real-time follow graph for hotels, creators, and
// public users. Persisted to localStorage so follows survive reloads.
// ───────────────────────────────────────────────────────────────────────────
// Public API:
//   isFollowing(handle): boolean
//   toggleFollow(handle): void                 — flips follow state
//   followerCount(handle): number              — synthetic base + live
//   followingCount(): number                   — total handles you follow
//   followers(handle): string[]                — list of follower display
//                                                names (synth + you)
//   searchFollowers(handle, query): string[]   — filter that list
//
// EVERY component that displays a follower count or list reads through this
// store, so a single tap propagates everywhere instantly.
// ═══════════════════════════════════════════════════════════════════════════
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const LS_FOLLOWS = "sb_follows_v1";
const LS_NAME    = "sb_user_display_name";

// Stable hash so synthesized follower bases are deterministic per handle.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const FIRST_NAMES = [
  "Riya", "Rahul", "Priya", "Amit", "Nikita", "Vikram", "Aisha", "Aditya",
  "Sneha", "Karan", "Tara", "Ishaan", "Ananya", "Rohan", "Meera", "Vivek",
  "Divya", "Arjun", "Pooja", "Siddharth", "Kavya", "Nishant", "Zara", "Yash",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Mehta", "Singh", "Kapoor", "Patel", "Reddy", "Iyer",
  "Bose", "Khanna", "Joshi", "Tiwari", "Rao", "Sen", "Ghosh", "Bhatt",
];
const HANDLE_SUFFIXES = ["", "_traveller", ".in", ".trips", ".weekends", ".bhakt", "_solo", "_explores"];

// Build a deterministic follower list for a handle: ~80–600 synthesized
// fans, plus the user themselves at the top if they follow this handle.
function synthesizedFollowersFor(handle: string): string[] {
  const seed = hashStr(handle);
  const count = 80 + (seed % 520);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const f = FIRST_NAMES[(seed + i * 7) % FIRST_NAMES.length];
    const l = LAST_NAMES[(seed + i * 13) % LAST_NAMES.length];
    const sfx = HANDLE_SUFFIXES[(seed + i * 3) % HANDLE_SUFFIXES.length];
    const handleStr = `${f.toLowerCase()}.${l.toLowerCase()}${sfx}`;
    out.push(`${f} ${l}|@${handleStr}`); // "Display Name|@handle"
  }
  return out;
}

// Synthesized base count — read by `followerCount` and added to live deltas.
function baseFollowerCount(handle: string): number {
  // Same range as the in-card pseudoStat to keep numbers consistent
  const seed = hashStr(`${handle}::followers`);
  return 5800 + (seed % (184000 - 5800));
}

type FollowCtx = {
  follows: string[];                                  // handles you follow
  isFollowing: (handle: string) => boolean;
  toggleFollow: (handle: string) => boolean;          // returns new state
  followerCount: (handle: string) => number;
  followingCount: () => number;
  followers: (handle: string) => string[];
  searchFollowers: (handle: string, q: string) => string[];
  myDisplayName: string;
  setMyDisplayName: (name: string) => void;
};

const Ctx = createContext<FollowCtx>({
  follows: [],
  isFollowing: () => false,
  toggleFollow: () => false,
  followerCount: baseFollowerCount,
  followingCount: () => 0,
  followers: synthesizedFollowersFor,
  searchFollowers: () => [],
  myDisplayName: "You",
  setMyDisplayName: () => {},
});

export function FollowProvider({ children }: { children: ReactNode }) {
  const [follows, setFollows] = useState<string[]>([]);
  const [myDisplayName, setMyDisplayNameState] = useState<string>("You");

  // Hydrate
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_FOLLOWS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setFollows(arr);
      }
      const n = localStorage.getItem(LS_NAME);
      if (n) setMyDisplayNameState(n);
    } catch {}
  }, []);

  const persist = useCallback((next: string[]) => {
    try { localStorage.setItem(LS_FOLLOWS, JSON.stringify(next)); } catch {}
  }, []);

  const isFollowing = useCallback(
    (handle: string) => follows.includes(handle),
    [follows]
  );

  const toggleFollow = useCallback((handle: string): boolean => {
    let nextState = false;
    setFollows((prev) => {
      const has = prev.includes(handle);
      const next = has ? prev.filter((h) => h !== handle) : [...prev, handle];
      nextState = !has;
      persist(next);
      return next;
    });
    return nextState;
  }, [persist]);

  const followerCount = useCallback(
    (handle: string) => baseFollowerCount(handle) + (follows.includes(handle) ? 1 : 0),
    [follows]
  );

  const followingCount = useCallback(() => follows.length, [follows]);

  const followers = useCallback(
    (handle: string) => {
      const base = synthesizedFollowersFor(handle);
      if (follows.includes(handle)) {
        // Pin the user themselves at the top of the followers list
        return [`${myDisplayName}|@you (you)`, ...base];
      }
      return base;
    },
    [follows, myDisplayName]
  );

  const searchFollowers = useCallback(
    (handle: string, q: string) => {
      const list = followers(handle);
      if (!q) return list;
      const needle = q.toLowerCase().trim();
      return list.filter((f) => f.toLowerCase().includes(needle));
    },
    [followers]
  );

  const setMyDisplayName = useCallback((name: string) => {
    setMyDisplayNameState(name);
    try { localStorage.setItem(LS_NAME, name); } catch {}
  }, []);

  const value = useMemo<FollowCtx>(() => ({
    follows,
    isFollowing,
    toggleFollow,
    followerCount,
    followingCount,
    followers,
    searchFollowers,
    myDisplayName,
    setMyDisplayName,
  }), [follows, isFollowing, toggleFollow, followerCount, followingCount, followers, searchFollowers, myDisplayName, setMyDisplayName]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFollow = () => useContext(Ctx);
