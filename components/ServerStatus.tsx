"use client";
import { useEffect, useState } from "react";

export function ServerStatus() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    // Wait 5s for cold-start, then check twice before showing banner
    const check = () =>
      fetch(`/api/proxy/api/hotels?limit=1`)
        .then((r) => r.ok)
        .catch(() => false);

    const timer = setTimeout(async () => {
      const first = await check();
      if (first) return;
      // Second attempt after 6s — avoid false positives on Railway cold start
      await new Promise(r => setTimeout(r, 6000));
      const second = await check();
      if (!second) setDown(true);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  if (!down) return null;

  return (
    <div className="w-full bg-red-600 text-white text-center py-2 px-4 text-xs font-medium tracking-wide z-40">
      ⚠ Server se connection fail ho raha hai — database down ho sakta hai. Admin se contact karein.
    </div>
  );
}
