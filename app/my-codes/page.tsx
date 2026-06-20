"use client";
// /my-codes — merged into the unified Explorer Passport hub (v264).
// Redirects to /passport?tab=codes.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MyCodesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/passport?tab=codes"); }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>Opening your passport…</p>
    </div>
  );
}
