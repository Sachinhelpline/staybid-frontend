"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function ServerStatus() {
  const pathname = usePathname();
  const [down, setDown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = () =>
      fetch(`/api/proxy/api/hotels?limit=1`)
        .then((r) => r.ok)
        .catch(() => false);

    // Wait 5s for cold-start, then check twice before showing the banner.
    const start = setTimeout(async () => {
      const first = await check();
      if (cancelled) return;
      if (!first) {
        // Second attempt after 6s — avoid false positives on Railway cold start.
        await new Promise((r) => setTimeout(r, 6000));
        if (cancelled) return;
        const second = await check();
        if (cancelled) return;
        if (!second) setDown(true);
      }
    }, 5000);

    // Keep re-checking every 30s so the banner clears itself once the
    // server recovers — instead of staying stuck until a page reload.
    const poll = setInterval(async () => {
      const ok = await check();
      if (!cancelled) setDown(!ok);
    }, 30000);

    return () => {
      cancelled = true;
      clearTimeout(start);
      clearInterval(poll);
    };
  }, []);

  // Never show on full-screen reel surfaces — the red bar would push the
  // 100dvh feed down and create the "card" look.
  if (pathname?.startsWith("/discover")) return null;
  if (pathname?.startsWith("/reels")) return null;
  if (pathname?.startsWith("/me")) return null;
  if (pathname?.startsWith("/saved/posts")) return null;
  if (pathname?.startsWith("/admin")) return null;
  if (pathname?.startsWith("/partner")) return null;
  if (pathname?.startsWith("/agent")) return null;
  if (pathname?.startsWith("/onboard")) return null;

  if (!down) return null;

  return (
    <div className="w-full bg-red-600 text-white text-center py-2 px-4 text-xs font-medium tracking-wide z-40">
      ⚠ We’re having trouble reaching the server. Some features may be temporarily unavailable — please try again shortly.
    </div>
  );
}
