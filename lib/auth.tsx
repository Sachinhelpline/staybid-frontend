"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

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
    localStorage.removeItem("sb_token");
    localStorage.removeItem("sb_user");
    localStorage.removeItem("sb_token_type");
    setToken(null); setUser(null); setTokenType("backend");
    if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:tier-refresh"));
  };

  return (
    <AuthContext.Provider value={{ user, token, tokenType, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
