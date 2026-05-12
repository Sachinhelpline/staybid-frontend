"use client";
// ═══════════════════════════════════════════════════════════════════════════
// BackChip — small floating "← Back" chip pinned top-left of every
// secondary route. Lets the user return to wherever they came from
// without having to find a page-specific back affordance.
//
// Visibility:
//   • SHOWN on every customer route EXCEPT the reel-app surfaces
//     (/, /discover, /reels, /me) — those have their own top chrome
//     and the user always has the bottom dock anyway.
//   • HIDDEN on operator panels (/admin, /partner, /onboard, /auth).
//
// Behaviour: uses router.back() when history exists, falls back to /me
// (the IG-style profile) so the user is never stranded.
// ═══════════════════════════════════════════════════════════════════════════
import { usePathname, useRouter } from "next/navigation";

export function BackChip() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  // Routes where the chip should NOT appear: reel-app surfaces (own
  // chrome + IG-style top bar) and operator panels.
  const hidden =
    pathname === "/" ||
    pathname.startsWith("/discover") ||
    pathname.startsWith("/reels") ||
    pathname.startsWith("/me") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/partner") ||
    pathname.startsWith("/onboard") ||
    pathname.startsWith("/auth");
  if (hidden) return null;

  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/me");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="sb-back-chip"
        aria-label="Go back"
      >
        <span className="sb-back-chip-glyph">‹</span>
        <span className="sb-back-chip-label">Back</span>
      </button>

      <style jsx global>{`
        .sb-back-chip {
          position: fixed;
          top: calc(env(safe-area-inset-top, 0px) + 12px);
          left: 12px;
          z-index: 62;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px 6px 8px;
          border-radius: 999px;
          background: rgba(7, 6, 14, 0.78);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.18);
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          backdrop-filter: blur(14px) saturate(1.3);
          -webkit-backdrop-filter: blur(14px) saturate(1.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1), background 0.18s ease;
        }
        .sb-back-chip:active { transform: scale(0.92); }
        .sb-back-chip:hover { background: rgba(7, 6, 14, 0.92); }
        .sb-back-chip-glyph {
          font-size: 1.05rem;
          line-height: 1;
          font-weight: 800;
          margin-top: -1px;
        }
        .sb-back-chip-label {
          line-height: 1;
        }
      `}</style>
    </>
  );
}
