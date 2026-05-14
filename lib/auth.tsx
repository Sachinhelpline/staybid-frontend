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
    // Fix sequence:
    //   1. Clear our own auth keys (sb_token / sb_user / sb_token_type).
    //   2. Tell Firebase to sign out — wipes its IndexedDB session.
    //   3. Wipe the partner/admin session keys too, so switching
    //      accounts doesn't carry partner OR admin auth across.
    //   4. Drop the per-user PostsStore + saved-set + comment cache so
    //      the next login starts clean (these are user-specific data
    //      that wouldn't make sense to carry across identities).
    //   5. Reset React state and broadcast sb:tier-refresh.
    //   6. Hard-navigate to /auth so no stale component closure can
    //      remember the previous user. (router.push was a soft nav
    //      and React kept showing chrome that read from old context.)
    try { localStorage.removeItem("sb_token"); } catch {}
    try { localStorage.removeItem("sb_user"); } catch {}
    try { localStorage.removeItem("sb_token_type"); } catch {}
    // Partner / admin session keys — different surfaces, same fix.
    try { localStorage.removeItem("sb_partner_token"); } catch {}
    try { localStorage.removeItem("sb_partner_user"); } catch {}
    try { localStorage.removeItem("sb_admin_token"); } catch {}
    try { localStorage.removeItem("sb_admin_user"); } catch {}
    // Per-user local caches that shouldn't persist across identities.
    try { localStorage.removeItem("sb_user_posts"); } catch {}
    try { localStorage.removeItem("sb_local_saves"); } catch {}
    try { localStorage.removeItem("sb_post_comments_v1"); } catch {}
    try { localStorage.removeItem("sb_post_likes_v1"); } catch {}
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
    }
    setToken(null); setUser(null); setTokenType("backend");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sb:tier-refresh"));
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
