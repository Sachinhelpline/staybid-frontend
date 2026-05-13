// v107 — Network-tier detection for adaptive media loading.
//
// On India 3G / mid-tier Android, the default "preload all the metadata
// you can" behaviour of <video> elements causes parallel HEAD-style
// network requests that delay the first-card paint by 200-600ms. This
// hook surfaces a coarse tier that components can use to gate work:
//
//   "fast" — 4g+, wifi (or Network Information API not available — we
//            default to the optimistic case so desktop / unknown stays
//            instant. The user already opted into "high quality" by
//            having a fast browser.)
//   "mid"  — 3g
//   "slow" — 2g / slow-2g / Save-Data: on
//
// API:
//   const tier = useNetworkTier();   // "fast" | "mid" | "slow"
//
// Returned value is reactive — subscribes to `connection.change` so the
// feed adapts if the user moves from WiFi to cellular mid-session.
//
// Safari + Firefox don't implement NetworkInformation yet; we treat
// undefined as "fast" so iPhone users on cellular still get the full
// experience (they have the bandwidth, just not the API).
"use client";
import { useEffect, useState } from "react";

export type NetworkTier = "fast" | "mid" | "slow";

function readTier(): NetworkTier {
  if (typeof navigator === "undefined") return "fast";
  const nav: any = navigator;
  const c = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!c) return "fast";
  if (c.saveData) return "slow";
  const t = String(c.effectiveType || "").toLowerCase();
  if (t === "slow-2g" || t === "2g") return "slow";
  if (t === "3g") return "mid";
  return "fast";
}

export function useNetworkTier(): NetworkTier {
  const [tier, setTier] = useState<NetworkTier>("fast");

  useEffect(() => {
    setTier(readTier());
    const nav: any = navigator;
    const c = nav?.connection || nav?.mozConnection || nav?.webkitConnection;
    if (!c || typeof c.addEventListener !== "function") return;
    const onChange = () => setTier(readTier());
    c.addEventListener("change", onChange);
    return () => c.removeEventListener("change", onChange);
  }, []);

  return tier;
}
