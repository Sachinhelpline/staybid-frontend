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

const LS_FOLLOWS    = "sb_follows_v1";
const LS_NAME       = "sb_user_display_name";
const LS_AVATAR     = "sb_user_avatar_url";
const LS_BIO        = "sb_user_bio";
const LS_LOCATION   = "sb_user_location";
const LS_WEBSITE    = "sb_user_website";
const LS_HIGHLIGHTS = "sb_user_custom_highlights_v1";

/** Built-in profile highlights that mirror the InstagramHotelFeed
    HIGHLIGHTS list. Custom highlights live alongside these. */
export type HighlightChip = { key: string; label: string; emoji: string; custom?: boolean };
export const BUILTIN_HIGHLIGHTS: HighlightChip[] = [
  { key: "mountains", label: "Mountains",  emoji: "🌄" },
  { key: "beaches",   label: "Beaches",    emoji: "🏖" },
  { key: "foodie",    label: "Foodie",     emoji: "🍜" },
  { key: "suites",    label: "Suites",     emoji: "🛏" },
  { key: "toppicks",  label: "Top picks",  emoji: "✨" },
  { key: "solo",      label: "Solo",       emoji: "🎒" },
];

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
  /** User-chosen profile picture (data-URL, capped ~256x256 JPEG so it fits
      under localStorage's 5 MB ceiling). Empty string = use initials fallback. */
  myAvatarUrl: string;
  setMyAvatarUrl: (url: string) => void;
  /** Free-form bio — surfaced on the user's own profile sheet. Sanitized
      at render-time (anti-bypass for off-platform contact). */
  myBio: string;
  setMyBio: (bio: string) => void;
  /** Optional location string ("Mumbai, India"). */
  myLocation: string;
  setMyLocation: (loc: string) => void;
  /** Optional website / link. */
  myWebsite: string;
  setMyWebsite: (url: string) => void;
  /** Custom highlight chips the user has created on their profile. */
  myCustomHighlights: HighlightChip[];
  addCustomHighlight: (h: HighlightChip) => void;
  removeCustomHighlight: (key: string) => void;
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
  myAvatarUrl: "",
  setMyAvatarUrl: () => {},
  myBio: "",
  setMyBio: () => {},
  myLocation: "",
  setMyLocation: () => {},
  myWebsite: "",
  setMyWebsite: () => {},
  myCustomHighlights: [],
  addCustomHighlight: () => {},
  removeCustomHighlight: () => {},
});

export function FollowProvider({ children }: { children: ReactNode }) {
  const [follows, setFollows] = useState<string[]>([]);
  const [myDisplayName, setMyDisplayNameState] = useState<string>("You");
  const [myAvatarUrl, setMyAvatarUrlState]   = useState<string>("");
  const [myBio, setMyBioState]               = useState<string>("");
  const [myLocation, setMyLocationState]     = useState<string>("");
  const [myWebsite, setMyWebsiteState]       = useState<string>("");
  const [myCustomHighlights, setCustomHighlights] = useState<HighlightChip[]>([]);

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
      const a = localStorage.getItem(LS_AVATAR);
      if (a) setMyAvatarUrlState(a);
      const b = localStorage.getItem(LS_BIO);
      if (b) setMyBioState(b);
      const l = localStorage.getItem(LS_LOCATION);
      if (l) setMyLocationState(l);
      const w = localStorage.getItem(LS_WEBSITE);
      if (w) setMyWebsiteState(w);
      const hl = localStorage.getItem(LS_HIGHLIGHTS);
      if (hl) {
        const parsed = JSON.parse(hl);
        if (Array.isArray(parsed)) setCustomHighlights(parsed);
      }
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

  const setMyAvatarUrl = useCallback((url: string) => {
    setMyAvatarUrlState(url);
    try {
      if (url) localStorage.setItem(LS_AVATAR, url);
      else localStorage.removeItem(LS_AVATAR);
    } catch {}
  }, []);

  const setMyBio = useCallback((bio: string) => {
    setMyBioState(bio);
    try {
      if (bio) localStorage.setItem(LS_BIO, bio);
      else localStorage.removeItem(LS_BIO);
    } catch {}
  }, []);

  const setMyLocation = useCallback((loc: string) => {
    setMyLocationState(loc);
    try {
      if (loc) localStorage.setItem(LS_LOCATION, loc);
      else localStorage.removeItem(LS_LOCATION);
    } catch {}
  }, []);

  const setMyWebsite = useCallback((url: string) => {
    setMyWebsiteState(url);
    try {
      if (url) localStorage.setItem(LS_WEBSITE, url);
      else localStorage.removeItem(LS_WEBSITE);
    } catch {}
  }, []);

  const persistHighlights = useCallback((next: HighlightChip[]) => {
    try { localStorage.setItem(LS_HIGHLIGHTS, JSON.stringify(next)); } catch {}
  }, []);

  const addCustomHighlight = useCallback((h: HighlightChip) => {
    setCustomHighlights((prev) => {
      const filtered = prev.filter((p) => p.key !== h.key);
      const next = [{ ...h, custom: true }, ...filtered].slice(0, 24);
      persistHighlights(next);
      return next;
    });
  }, [persistHighlights]);

  const removeCustomHighlight = useCallback((key: string) => {
    setCustomHighlights((prev) => {
      const next = prev.filter((p) => p.key !== key);
      persistHighlights(next);
      return next;
    });
  }, [persistHighlights]);

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
    myAvatarUrl,
    setMyAvatarUrl,
    myBio,
    setMyBio,
    myLocation,
    setMyLocation,
    myWebsite,
    setMyWebsite,
    myCustomHighlights,
    addCustomHighlight,
    removeCustomHighlight,
  }), [follows, isFollowing, toggleFollow, followerCount, followingCount, followers, searchFollowers, myDisplayName, setMyDisplayName, myAvatarUrl, setMyAvatarUrl, myBio, setMyBio, myLocation, setMyLocation, myWebsite, setMyWebsite, myCustomHighlights, addCustomHighlight, removeCustomHighlight]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFollow = () => useContext(Ctx);
