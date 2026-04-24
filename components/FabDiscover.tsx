"use client";
// Floating "Try Discovery" button — small, translucent pill.
// Hides on /discover itself (silly there) and on /partner/** (partner panel).
import Link from "next/link";
import { usePathname } from "next/navigation";

export function FabDiscover() {
  const pathname = usePathname() || "";
  if (pathname.startsWith("/discover") || pathname.startsWith("/partner")) return null;
  return (
    <Link
      href="/discover"
      aria-label="Try Discovery reels mode"
      style={{
        position: "fixed",
        bottom: "84px",
        right: "14px",
        zIndex: 9999,
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "7px 11px",
        borderRadius: "999px",
        background: "rgba(240,180,41,0.82)",
        backdropFilter: "blur(10px) saturate(1.3)",
        WebkitBackdropFilter: "blur(10px) saturate(1.3)",
        color: "#0a0f23",
        fontWeight: 700,
        fontSize: "10.5px",
        letterSpacing: "0.02em",
        textDecoration: "none",
        boxShadow: "0 6px 18px -4px rgba(240,180,41,0.5)",
        border: "1px solid rgba(255,255,255,0.25)",
      }}
    >
      ✨ Discover
    </Link>
  );
}
