"use client";

// v361 — Model 3 travel-agent client auth hook. Google (Firebase) sign-in only
// (phone OTP is off). Stores the Firebase idToken as `sb_trade_token` and sends
// it as Bearer to /api/trade/*. Browsing needs no sign-in; only bidding does.

import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "sb_trade_token";
const USER_KEY = "sb_trade_user";

export type AgentStatus = "signed_out" | "unregistered" | "pending" | "approved" | "rejected" | "suspended";

export type TradeUser = { id?: string; email?: string; name?: string };

export function getTradeToken(): string {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) || "" : "";
}

export function useTradeAuth() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<TradeUser | null>(null);
  const [status, setStatus] = useState<AgentStatus>("signed_out");
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async (tok?: string) => {
    const t = tok || getTradeToken();
    if (!t) { setStatus("signed_out"); setLoading(false); return; }
    try {
      const r = await fetch("/api/trade/login", { method: "POST", headers: { Authorization: `Bearer ${t}` } });
      const d = await r.json();
      if (r.status === 401) { setStatus("signed_out"); }
      else if (!d.registered) { setStatus("unregistered"); }
      else { setStatus((d.status as AgentStatus) || "pending"); setAgent(d.agent || null); }
    } catch { /* keep prior */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = getTradeToken();
    if (t) { setToken(t); try { setUser(JSON.parse(localStorage.getItem(USER_KEY) || "null")); } catch {} }
    refreshStatus(t);
  }, [refreshStatus]);

  const signIn = useCallback(async () => {
    const { firebaseAuth } = await import("@/lib/firebase");
    const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(firebaseAuth, provider);
    const fbUser = result.user;
    const idToken = await fbUser.getIdToken();
    const u: TradeUser = { id: fbUser.uid, email: fbUser.email || "", name: fbUser.displayName || "" };
    try {
      localStorage.setItem(TOKEN_KEY, idToken);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {}
    setToken(idToken); setUser(u);
    await refreshStatus(idToken);
    return idToken;
  }, [refreshStatus]);

  const register = useCallback(async (details: { agencyName: string; name?: string; city?: string; phone?: string; gst?: string }) => {
    const t = getTradeToken();
    const r = await fetch("/api/trade/register", {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(details),
    });
    const d = await r.json();
    if (r.ok) await refreshStatus(t);
    return { ok: r.ok, data: d };
  }, [refreshStatus]);

  const signOut = useCallback(() => {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch {}
    setToken(""); setUser(null); setStatus("signed_out"); setAgent(null);
  }, []);

  return { token, user, status, agent, loading, signIn, register, signOut, refreshStatus, isApproved: status === "approved" };
}
