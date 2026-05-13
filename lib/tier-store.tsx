"use client";
// ═══════════════════════════════════════════════════════════════════════════
// TierProvider — single source of truth for "what role is this user?"
//
// v108 introduced tier-gated menu entries (Creator + Hotel Partner only
// show for the matching role). Problem: every consumer (/me drawer,
// Navbar, DialerNav, UpgradeSection) ran its own useAccountTier hook =
// its own state + its own network probe. Upgrading in one place did NOT
// propagate to the rest — user had to refresh the whole app.
//
// v109 fix: lift tier to a Context provider mounted right inside
// AuthProvider. Three auto-refresh triggers fire `refresh()` so every
// consumer flips together:
//
//   1. `user` change from useAuth (customer login / logout) — useEffect dep.
//   2. `storage` event — fires in OTHER tabs when sb_token /
//      sb_partner_token change. This is THE trick that makes
//      "open /partner in new tab, log in, come back" auto-flip the
//      menu in the original tab.
//   3. `sb:tier-refresh` custom event — fired from partner login
//      success (same tab), creator-app submit, partner logout, etc.
//      Anywhere a credential changes WITHOUT a useAuth.login() call.
//
// Probes BOTH creator + hotel ownership in parallel so a creator who
// also owns a hotel gets isCreator=true AND isHotelOwner=true →
// menu shows both entries. Old behaviour collapsed to one role.
// ═══════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

export type Tier = "PUBLIC" | "PENDING_CREATOR" | "CREATOR" | "HOTEL" | "BLOCKED" | "UNKNOWN";

type TierCtx = {
  tier: Tier;                 // primary role label (for legacy StatusBanner)
  isCreator: boolean;         // CREATOR or PENDING_CREATOR — menu shows Creator entry
  isHotelOwner: boolean;      // /api/partner/hotel returned a hotel — menu shows Hotel entry
  influencer: any | null;
  hotelOwned: any | null;
  loading: boolean;
  refresh: () => void;
};

const Ctx = createContext<TierCtx>({
  tier: "UNKNOWN",
  isCreator: false,
  isHotelOwner: false,
  influencer: null,
  hotelOwned: null,
  loading: true,
  refresh: () => {},
});

export function TierProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [tier, setTier] = useState<Tier>("UNKNOWN");
  const [influencer, setInfluencer] = useState<any>(null);
  const [hotelOwned, setHotelOwned] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ── Main probe ─────────────────────────────────────────────────────
  // Runs on user change AND every tick increment.
  useEffect(() => {
    if (authLoading) return;

    // Customer not logged in → public, but STILL check partner-token
    // separately: a hotel owner could technically have no customer-side
    // auth but be on the partner side. (Rare, but the probe is cheap.)
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Parallel probes — a user can be BOTH a creator AND a hotel
      // owner. We resolve both independently and set the flags
      // accordingly.
      const [creatorRow, hotelRow] = await Promise.all([
        (async () => {
          if (!user) return null;
          try {
            const inf = await api.getMyInfluencer();
            return inf?.registered && inf?.influencer ? inf.influencer : null;
          } catch { return null; }
        })(),
        (async () => {
          try {
            const tok = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") : null;
            if (!tok) return null;
            const r = await fetch("/api/partner/hotel", {
              headers: { Authorization: `Bearer ${tok}` },
              cache: "no-store",
            });
            if (!r.ok) return null;
            const data = await r.json();
            return data?.hotel || null;
          } catch { return null; }
        })(),
      ]);

      if (cancelled) return;

      // Resolve primary tier label (legacy StatusBanner uses this).
      // Order: BLOCKED > CREATOR > PENDING_CREATOR > HOTEL > PUBLIC.
      let nextTier: Tier = "PUBLIC";
      if (creatorRow) {
        const status = String(creatorRow.status || "").toUpperCase();
        if (status === "BLOCKED")      nextTier = "BLOCKED";
        else if (status === "PENDING") nextTier = "PENDING_CREATOR";
        else                            nextTier = "CREATOR";
      } else if (hotelRow) {
        nextTier = "HOTEL";
      }

      setInfluencer(creatorRow);
      setHotelOwned(hotelRow);
      setTier(nextTier);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, authLoading, tick]);

  // ── Auto-refresh triggers ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Cross-tab — when sb_token / sb_partner_token are written in
    //    ANOTHER tab, the storage event fires in THIS tab. This is
    //    what makes "click Apply as a Hotel → log in in new tab →
    //    come back to original tab → menu auto-updates" work.
    //    NOTE: storage event does NOT fire in the tab that made the
    //    change. Same-tab updates rely on the custom event below.
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === "sb_token"         || e.key === "sb_user" ||
        e.key === "sb_token_type"    ||
        e.key === "sb_partner_token" || e.key === "sb_partner_user"
      ) refresh();
    };

    // 2. Same-tab credential change — partner login flow, creator-app
    //    submit, logout. They fire window.dispatchEvent(new Event("sb:tier-refresh"))
    //    immediately after setting/clearing localStorage.
    const onTierEvent = () => refresh();

    // 3. Tab returning to focus — covers the "user came back after
    //    logging in elsewhere" case even if storage event was missed
    //    (some browsers throttle background tab events).
    const onFocus = () => refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };

    window.addEventListener("storage", onStorage);
    window.addEventListener("sb:tier-refresh", onTierEvent);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sb:tier-refresh", onTierEvent);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const isCreator    = tier === "CREATOR" || tier === "PENDING_CREATOR";
  const isHotelOwner = !!hotelOwned;

  return (
    <Ctx.Provider value={{ tier, isCreator, isHotelOwner, influencer, hotelOwned, loading, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTier() {
  return useContext(Ctx);
}

// Backward-compat: v108 sites imported useAccountTier from UpgradeSection.
// The hook there now re-exports this one so behaviour is identical.
export const useAccountTier = useTier;

// Helper for the partner login / logout flows + creator-app submit.
// Saves callers from writing `new Event(...)` every time.
export function triggerTierRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("sb:tier-refresh"));
}
