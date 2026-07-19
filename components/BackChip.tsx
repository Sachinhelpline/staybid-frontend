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
    pathname.startsWith("/saved/posts") ||   // v87: IG-style "All Posts" has its own ← header
    pathname.startsWith("/u/") ||            // v110: /u/[handle] + /u/[handle]/posts own their headers
    pathname === "/bid" ||                   // v159.19: /bid has its own "‹ Auction Pit" toolbar back
    pathname === "/hotels" ||                // v159.21: dock-tab page — bottom nav handles navigation
    pathname.startsWith("/hotels/") ||       // v243: detail/reviews/feedback have their OWN ‹ back (was a dup chip)
    pathname === "/flash-deals" ||           // v159.21: dock-tab page — bottom nav handles navigation
    pathname.startsWith("/admin") ||
    pathname.startsWith("/partner") ||
    pathname.startsWith("/worker") ||
    pathname.startsWith("/agent") ||
    pathname.startsWith("/onboard") ||
    pathname.startsWith("/circle") ||        // v288: StayCircle — own topbar chrome
    pathname.startsWith("/trade") ||         // v361: Model 3 travel-agent auction — own chrome
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
        /* Slim, icon-only back chip. v82 shrunk from a labelled pill to a
           compact circle so it never crowds page headers / content on any
           route. Tappable target stays ~32px via padding+margin. */
        /* v90 — Theme-aware: light = cream chip, dark = warm cocoa chip.
           Champagne border stays the brand mark across both modes. */
        .sb-back-chip {
          position: fixed;
          /* Sit tight in the very corner so the chip stays clear of left-
             aligned page titles/eyebrows (the wallet/complaints overlap). */
          top: calc(env(safe-area-inset-top, 0px) + 4px);
          left: 6px;
          z-index: 62;
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: var(--bg-elevated);
          color: var(--text-base);
          border: 1px solid var(--border-strong);
          font-size: 1.1rem;
          font-weight: 800;
          cursor: pointer;
          backdrop-filter: blur(10px) saturate(1.2);
          -webkit-backdrop-filter: blur(10px) saturate(1.2);
          box-shadow: var(--shadow-soft);
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1), background 0.18s ease;
        }
        .sb-back-chip:active { transform: scale(0.90); }
        .sb-back-chip:hover { border-color: var(--accent); }
        .sb-back-chip-glyph {
          font-size: 1.1rem;
          line-height: 1;
          font-weight: 800;
          margin-top: -1px;
        }
        /* Hide the label — the glyph alone is unambiguous and the chip
           stays out of the way on every page. */
        .sb-back-chip-label { display: none; }
        /* v124.2 — hide back chip when any modal is open so it doesn't
           overlap modal close button at top-left. */
        body.sb-modal-open .sb-back-chip,
        body.sb-composer-open .sb-back-chip { display: none !important; }

        /* Each non-reel page gets a small top padding so the back chip
           never sits on top of the page's first content row.
           The reel-app routes (/, /discover, /reels, /me) opt out via
           body.is-reel-page (set by useReelFullscreen). */
        body main { padding-top: calc(env(safe-area-inset-top, 0px) + 0px); }
        body.is-reel-page main { padding-top: 0; }
        /* v159.20 — no reserved empty band. The back chip floats in the
           top-left corner and the page content flows right up to the
           top; <main> keeps only a tiny safe-area breathing gap. Slim-
           hero pages (/hotels, /flash-deals) indent their first breadcrumb
           line past the chip — see app/desktop.css §4 — so the chip reads
           as inline with the hero, not floating in dead space. This block
           only ships on customer non-reel pages — BackChip returns null
           (and so does this <style>) on reel routes + operator panels. */
        @media (max-width: 1023px) {
          /* Guarantee the first content row clears the back chip (bottom edge
             ~safe+32px) with a comfortable gap, regardless of the device's
             safe-area inset — this is the wallet/complaints title-overlap fix.
             Reel pages opt out below. */
          body main { padding-top: calc(env(safe-area-inset-top, 0px) + 16px); }
          body.is-reel-page main { padding-top: 0; }
        }
      `}</style>
    </>
  );
}
