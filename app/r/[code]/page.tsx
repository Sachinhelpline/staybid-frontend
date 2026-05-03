"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

// Public referral landing page. Records the click via /api/referrals/track,
// stores the code in a long-lived cookie + localStorage so the upcoming bid
// can be attributed by the bid-create flow, then redirects to the target
// hotel (or home).
export default function ReferralRedirect() {
  const { code } = useParams() as { code: string };
  const router = useRouter();
  const [msg, setMsg] = useState("Welcoming you to StayBid…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        document.cookie = `sb_ref=${encodeURIComponent(code)};path=/;max-age=${30 * 86400};samesite=lax`;
        try { localStorage.setItem("sb_ref", code); } catch {}

        const r = await fetch(`/api/referrals/resolve/${encodeURIComponent(code)}`).then((x) => x.json()).catch(() => ({}));
        await fetch("/api/referrals/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, eventType: "click", targetType: r?.target?.type, targetId: r?.code?.hotelId }),
        }).catch(() => {});

        if (cancelled) return;
        const url = r?.target?.url || "/";
        setMsg("Redirecting…");
        router.replace(url);
      } catch {
        router.replace("/");
      }
    })();
    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-luxury-50">
      <div className="text-center">
        <div className="shimmer w-12 h-12 rounded-full mx-auto mb-3" />
        <p className="text-luxury-700 font-semibold">{msg}</p>
        <p className="text-luxury-500 text-xs mt-1">Code: {code}</p>
      </div>
    </div>
  );
}
