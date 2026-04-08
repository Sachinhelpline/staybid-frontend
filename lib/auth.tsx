"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type User = { id: string; phone: string; name?: string; role: string } | null;
type AuthCtx = { user: User; token: string | null; login: (token: string, user: any) => void; logout: () => void; loading: boolean };

const AuthContext = createContext<AuthCtx>({ user: null, token: null, login: () => {}, logout: () => {}, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem("sb_token");
    const u = localStorage.getItem("sb_user");
    if (t && u) { setToken(t); setUser(JSON.parse(u)); }
    setLoading(false);
  }, []);

  const login = (t: string, u: any) => {
    localStorage.setItem("sb_token", t);
    localStorage.setItem("sb_user", JSON.stringify(u));
    setToken(t); setUser(u);
  };
  const logout = () => {
    localStorage.removeItem("sb_token");
    localStorage.removeItem("sb_user");
    setToken(null); setUser(null);
  };

  return <AuthContext.Provider value={{ user, token, login, logout, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
