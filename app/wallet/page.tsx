"use client";
// /wallet — merged into the unified Explorer Passport hub (v264).
// Redirects to /passport?tab=wallet. Kept as a route so old links/bookmarks
// + redirectToSignIn(route:"/wallet") still resolve.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WalletRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/passport?tab=wallet"); }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>Opening your passport…</p>
    </div>
  );
}
