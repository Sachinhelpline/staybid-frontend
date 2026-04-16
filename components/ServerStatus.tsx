"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

export function ServerStatus() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    // Quick health ping — if /api/hotels returns error, show warning
    fetch(`${API}/api/hotels?limit=1`)
      .then((r) => { if (!r.ok) setDown(true); })
      .catch(() => setDown(true));
  }, []);

  if (!down) return null;

  return (
    <div className="w-full bg-red-600 text-white text-center py-2 px-4 text-xs font-medium tracking-wide z-40">
      ⚠ Server se connection fail ho raha hai — database down ho sakta hai. Admin se contact karein.
    </div>
  );
}
