"use client";
// ═══════════════════════════════════════════════════════════════════════════
// InspirationBanner — "Share your trip, earn StayPoints" nudge surface.
// ═══════════════════════════════════════════════════════════════════════════
// Per Phase 0 §3.1: two placements
//   1. Post-payment success modal on /hotels/[id]   (variant="modal")
//   2. Sticky dismissible card on /bookings list    (variant="card")
//
// Self-contained — no API calls, no tier probe. The host page already
// knows the user is in the post-booking context. Dismissal persists per
// (user, booking, variant) in localStorage so the same nudge doesn't
// re-show after the user closes it.
//
// Phase 6 will wire `inspiration_nudges` table writes for cron-driven
// reward tracking. This component only handles the visible CTA today.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type InspirationBannerProps = {
  variant: "modal" | "card";
  /** Optional booking id — drives the dismiss key + future deep-link. */
  bookingId?: string;
  /** Optional hotel id — passed to /create as context for the upload flow. */
  hotelId?: string;
  /** Optional hotel name — shown in copy. */
  hotelName?: string;
  className?: string;
};

const COZY = {
  paperBg: "linear-gradient(135deg, #f4f6f8 0%, #e7ebef 100%)",
  champagne: "#5f7c98",
  champagneLight: "#b4c1cf",
  cocoa: "#4A3820",
  cocoaSoft: "#6E5430",
  border: "rgba(106,133,160,0.40)",
};

export default function InspirationBanner({
  variant,
  bookingId,
  hotelId,
  hotelName,
  className,
}: InspirationBannerProps) {
  const router = useRouter();
  const dismissKey = `sb_insp_dismiss_${variant}_${bookingId || "no-booking"}`;
  const [dismissed, setDismissed] = useState(true); // start true; flip after we read LS

  useEffect(() => {
    try {
      const v = localStorage.getItem(dismissKey);
      setDismissed(v === "1");
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {}
    setDismissed(true);
  };

  const cta = () => {
    // Route into the Create flow. Phase 4 will land "/create" or
    // /discover with a hash trigger — for now we use /discover#create
    // since the FAB lives there.
    const href = hotelId ? `/discover#create?hotel=${encodeURIComponent(hotelId)}` : "/discover#create";
    router.push(href);
  };

  if (variant === "modal") {
    // Inline banner inside another modal (e.g. post-payment success).
    return (
      <div
        className={className}
        style={{
          marginTop: 16,
          padding: "14px 14px",
          borderRadius: 14,
          background: COZY.paperBg,
          border: `1px solid ${COZY.border}`,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: "1.8rem", flexShrink: 0 }} aria-hidden>
          ✨
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: COZY.cocoa,
              fontWeight: 700,
              fontSize: "0.92rem",
              marginBottom: 2,
              fontFamily:
                "'Cormorant Garamond', Georgia, serif",
              fontStyle: "italic",
              letterSpacing: "0.01em",
            }}
          >
            Share your stay
          </div>
          <div
            style={{
              color: COZY.cocoaSoft,
              fontSize: "0.78rem",
              lineHeight: 1.4,
            }}
          >
            Post a reel or photo of {hotelName || "your trip"} after
            check-out — earn StayPoints + help other travellers discover
            the place.
          </div>
        </div>
        <button
          type="button"
          onClick={cta}
          style={{
            background: `linear-gradient(135deg, ${COZY.champagneLight}, ${COZY.champagne})`,
            color: COZY.cocoa,
            border: "none",
            borderRadius: 999,
            padding: "8px 14px",
            fontWeight: 700,
            fontSize: "0.78rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Share now →
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            color: COZY.cocoaSoft,
            border: "none",
            cursor: "pointer",
            fontSize: "1.2rem",
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  // variant === "card" — full-width sticky banner above the bookings list.
  return (
    <div
      className={className}
      style={{
        marginBottom: 16,
        padding: "16px 18px",
        borderRadius: 18,
        background: COZY.paperBg,
        border: `1px solid ${COZY.border}`,
        boxShadow: "0 4px 14px rgba(74,56,32,0.06)",
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: "2rem", flexShrink: 0 }} aria-hidden>
        ✨
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: COZY.cocoa,
            fontWeight: 700,
            fontSize: "1.02rem",
            marginBottom: 4,
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontStyle: "italic",
            letterSpacing: "0.01em",
          }}
        >
          Share your StayBid moments
        </div>
        <div
          style={{
            color: COZY.cocoaSoft,
            fontSize: "0.84rem",
            lineHeight: 1.45,
          }}
        >
          Show your trip in reels &amp; photos · Earn StayPoints when
          your stay is verified · Inspire other travellers
        </div>
      </div>
      <button
        type="button"
        onClick={cta}
        style={{
          background: `linear-gradient(135deg, ${COZY.champagneLight}, ${COZY.champagne})`,
          color: COZY.cocoa,
          border: "none",
          borderRadius: 999,
          padding: "10px 18px",
          fontWeight: 700,
          fontSize: "0.84rem",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Share now →
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          color: COZY.cocoaSoft,
          border: "none",
          cursor: "pointer",
          fontSize: "1.4rem",
          lineHeight: 1,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
