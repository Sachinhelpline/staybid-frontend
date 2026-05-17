"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
// v121.1 — Firebase signOut() is needed inside logout(): we only used to
// clear our own localStorage, but Firebase persists the user in its own
// IndexedDB. Without signing out of Firebase too, the user appeared to
// stay logged in even after tapping "Log out", AND signing in with a
// different Google account on the same device was blocked.
//
// v121.2 — Top-level imports of "@/lib/firebase" / "firebase/auth"
// trigger `getAuth(app)` during SSR for any page that loads this module
// (which is almost every customer page). When NEXT_PUBLIC_FIREBASE_API_KEY
// isn't present (local dev, or any preview/build env where Firebase env
// vars aren't wired), that throws `auth/invalid-api-key` and the SSR
// render bails. Fix: defer the Firebase imports to inside logout() via
// dynamic import — runs ONLY on click, ONLY in the browser. Zero SSR
// cost when the user never logs out.

type User = { id: string; phone: string; name?: string; email?: string; role: string } | null;
type TokenType = "backend" | "firebase";
type AuthCtx = {
  user: User;
  token: string | null;
  tokenType: TokenType;
  login: (token: string, user: any, tokenType?: TokenType) => void;
  logout: () => void;
  loading: boolean;
};

const AuthContext = createContext<AuthCtx>({
  user: null, token: null, tokenType: "backend",
  login: () => {}, logout: () => {}, loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User>(null);
  const [token, setToken]         = useState<string | null>(null);
  const [tokenType, setTokenType] = useState<TokenType>("backend");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const t  = localStorage.getItem("sb_token");
    const u  = localStorage.getItem("sb_user");
    const tt = (localStorage.getItem("sb_token_type") as TokenType) || "backend";
    if (t && u) { setToken(t); setUser(JSON.parse(u)); setTokenType(tt); }
    setLoading(false);
  }, []);

  const login = (t: string, u: any, tt: TokenType = "backend") => {
    localStorage.setItem("sb_token", t);
    localStorage.setItem("sb_user", JSON.stringify(u));
    localStorage.setItem("sb_token_type", tt);
    setToken(t); setUser(u); setTokenType(tt);
    // v109 — TierProvider listens for this event to re-probe creator /
    // hotel roles immediately. Without it, the customer menu kept the
    // pre-login (PUBLIC) state until next mount.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:tier-refresh"));
  };

  const logout = () => {
    // v121.1 — Complete sign-out. Until now we only cleared our own
    // localStorage. For Google / Phone OTP users that signed in via
    // Firebase, the Firebase auth state lives in IndexedDB
    // (firebaseLocalStorageDb) — clearing our keys didn't touch it.
    // Symptoms the user hit: tapping "Log out" several times but the
    // session refused to die, and trying to sign in with a different
    // Google account on the same device was blocked because Firebase
    // still believed the original user was authenticated.
    //
    // v132.14 — Bulletproof "logout bluff" fix. Previous implementation
    // listed each known sb_* key individually. The hand-maintained list
    // missed:
    //   sb_user_avatar_url / sb_user_display_name / sb_user_bio /
    //   sb_user_location  / sb_user_website / sb_user_custom_highlights_v1
    //   sb_follows_v1 / sb_seen_notifications_v1 / sb_reel_* / hold_state_*
    //   accept_window_* / bid_dates_* / deal_price_* / sb_flash_viewed_v1
    //   sb_fdeal_audio_* / sb_attribution_* / sb_attempted_routes / …
    // Result: AuthContext.user was null after logout, but /me kept showing
    // the previous user's avatar + name + "Following" / followers count
    // because the FollowStore + PostsStore + various per-user caches read
    // their own localStorage independently. The user perceived it as
    // "logout doesn't work — still logged in".
    //
    // The fix iterates every key in localStorage and clears anything
    // user-specific. A small allow-list keeps device-level prefs that
    // SHOULD survive logout (theme, last city, build version, build-cache
    // markers, debug flags). Any future user-specific key prefixed sb_
    // is auto-cleared with zero maintenance.
    //
    // Fix sequence:
    //   1. Clear EVERY localStorage key except the device-prefs allow-list.
    //   2. Tell Firebase to sign out — wipes its IndexedDB session.
    //   3. Best-effort wipe of Firebase IDB (firebaseLocalStorageDb) so
    //      the persisted user.uid doesn't survive next page load even
    //      if signOut's network round-trip got cancelled by the redirect.
    //   4. Reset React state and broadcast sb:tier-refresh.
    //   5. Hard-navigate to /auth so no stale component closure can
    //      remember the previous user. (router.push was a soft nav
    //      and React kept showing chrome that read from old context.)
    if (typeof window !== "undefined") {
      // Device-level preferences that should survive logout (next user
      // on the same device inherits these without disruption).
      const KEEP = new Set<string>([
        "sb_theme",        // dark / light preference
        "sb_city",         // last selected city for the location filter
        "sb_build",        // last-seen build version (SW cache busting)
        "sb_reel_filter_source", // PUBLIC/CREATOR/HOTEL filter — generic UI pref
        "sb_reel_filter_city",   // generic UI pref
        "sb_reel_mute",          // mute pref — better UX to keep
        "sb_reel_gain",          // volume boost pref
      ]);
      try {
        const keysToClear: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (KEEP.has(k)) continue;
          keysToClear.push(k);
        }
        keysToClear.forEach((k) => {
          try { localStorage.removeItem(k); } catch {}
        });
      } catch {}
      // Also wipe sessionStorage — much smaller surface but the partner
      // panel + admin panel write a couple of session-only flags there.
      try { sessionStorage.clear(); } catch {}
    }
    // Firebase IndexedDB session — fire-and-forget so a slow Google
    // round-trip never blocks the user-visible logout. v121.2 — lazy
    // dynamic imports so Firebase never initialises during SSR.
    if (typeof window !== "undefined") {
      Promise.all([
        import("@/lib/firebase"),
        import("firebase/auth"),
      ]).then(([m1, m2]) => {
        try {
          if (m1?.firebaseAuth && typeof m2?.signOut === "function") {
            m2.signOut(m1.firebaseAuth).catch(() => {});
          }
        } catch {}
      }).catch(() => {});
      // v132.14 — Belt-and-braces wipe of Firebase's IndexedDB store.
      // signOut() above writes to this same DB, but the redirect on
      // step 5 might cancel its async unload. Deleting the DB outright
      // is non-destructive (Firebase rebuilds on next signIn) and
      // guarantees the cached user.uid + tokens don't survive.
      try {
        if ("indexedDB" in window) {
          indexedDB.deleteDatabase("firebaseLocalStorageDb");
        }
      } catch {}
    }
    setToken(null); setUser(null); setTokenType("backend");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sb:tier-refresh"));
      // v132.14 — broadcast so FollowStore / PostsStore / any store with
      // a useEffect-driven cache can reset themselves to fresh state
      // without waiting for the page reload.
      window.dispatchEvent(new Event("sb:logout"));
      // Hard nav guarantees a fresh module graph. Replace (not push)
      // so the back button doesn't return to a logged-out broken state.
      try { window.location.replace("/auth"); } catch {}
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, tokenType, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
