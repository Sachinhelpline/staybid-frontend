"use client";
import { useEffect, useState } from "react";

export function ServerStatus() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    fetch(`/api/proxy/api/hotels?limit=1`)
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
