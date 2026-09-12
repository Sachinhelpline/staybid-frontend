"use client";
// ═══════════════════════════════════════════════════════════════════════════
// InspirationBanner — "Share your trip" nudge surface (truthful, SEC-00B).
// ═══════════════════════════════════════════════════════════════════════════
// Two placements:
//   1. Post-payment success modal on /hotels/[id]   (variant="modal")
//   2. Sticky dismissible card on /bookings list    (variant="card")
//
// Truthfulness rule (SEC-00B Objective C): the CTA must reflect what the
// traveller can ACTUALLY do right now.
//   • eligible now (a confirmed stay that has started, within 90 days) →
//     "Share now" opens the composer directly, with the stay preselected
//     (no reel feed, no re-pick). More than one eligible stay → "Share now"
//     opens the one picker.
//   • confirmed but FUTURE (stay not started) → "Share from check-in ·
//     Available <date>" — informational, NO Create route.
//   • not confirmed / nothing shareable → NO verified-share CTA.
// This is DISPLAY only. The upload route re-verifies the strict media identity,
// exact booking ownership, the canonical confirmed-stay rule, and the hotel
// binding server-side, so a deep-link is never trusted as authority.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BannerShareState } from "@/lib/stay/share-eligibility";

export type InspirationBannerProps = {
  variant: "modal" | "card";
  /** Optional booking id — drives the dismiss key + future deep-link. */
  bookingId?: string;
  /** Optional hotel id — passed to /create as context for the upload flow. */
  hotelId?: string;
  /** Optional hotel name — shown in copy. */
  hotelName?: string;
  /**
   * The truthful share state for the CARD variant, computed by the page from
   * the loaded bookings. When omitted the card shows nothing (no false CTA).
   * The MODAL variant ignores this (a just-booked stay is always "after
   * check-in"), and shows an honest post-booking nudge with no "Share now".
   */
  shareState?: BannerShareState;
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

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

export default function InspirationBanner({
  variant,
  bookingId,
  hotelId,
  hotelName,
  shareState,
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

  // ── MODAL: post-payment nudge. The stay hasn't happened yet, so we never
  // show a misleading "Share now" — the sharing loop the customer complained
  // about started exactly here. Route the traveller to their bookings, where
  // the per-card Share becomes live once the stay begins.
  if (variant === "modal") {
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
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontStyle: "italic",
              letterSpacing: "0.01em",
            }}
          >
            Share your stay after check-in
          </div>
          <div
            style={{
              color: COZY.cocoaSoft,
              fontSize: "0.78rem",
              lineHeight: 1.4,
            }}
          >
            Once your stay at {hotelName || "your hotel"} begins, post a reel or
            photo from My Bookings — earn StayPoints and help other travellers
            discover the place.
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/bookings")}
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
          My Bookings →
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

  // ── CARD (on /bookings): driven by the truthful share state. Nothing
  // shareable → render nothing (no false CTA).
  const s = shareState;
  if (!s || s.kind === "none") return null;

  let title = "Share your StayBid moments";
  let sub =
    "Show your trip in reels & photos · Earn StayPoints when your stay is verified · Inspire other travellers";
  let ctaLabel: string | null = null;
  let ctaEnabled = true;
  let onCta: (() => void) | null = null;

  if (s.kind === "eligible") {
    title = "Share your stay";
    sub =
      "Post a reel or photo — your booking is the proof, so it publishes instantly and earns StayPoints.";
    ctaLabel = "Share now →";
    onCta = () => {
      const params = new URLSearchParams({
        share: "1",
        bookingId: s.bookingId,
        hotelId: s.hotelId,
      });
      if (s.hotelName) params.set("hotelName", s.hotelName);
      router.push(`/discover?${params.toString()}`);
    };
  } else if (s.kind === "eligible_many") {
    title = "Share your stay";
    sub =
      "Post a reel or photo of one of your stays — your booking is the proof, so it publishes instantly.";
    ctaLabel = "Share now →";
    onCta = () => router.push("/discover?create=1");
  } else if (s.kind === "future") {
    title = "Share your stay soon";
    sub =
      "You'll be able to post reels & photos once your stay begins — earn StayPoints then.";
    ctaLabel = `Share from check-in · ${formatDate(s.availableFrom)}`;
    ctaEnabled = false;
    onCta = null;
  }

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
          {title}
        </div>
        <div
          style={{
            color: COZY.cocoaSoft,
            fontSize: "0.84rem",
            lineHeight: 1.45,
          }}
        >
          {sub}
        </div>
      </div>
      {ctaLabel && (
        <button
          type="button"
          onClick={ctaEnabled && onCta ? onCta : undefined}
          disabled={!ctaEnabled}
          aria-disabled={!ctaEnabled}
          style={{
            background: ctaEnabled
              ? `linear-gradient(135deg, ${COZY.champagneLight}, ${COZY.champagne})`
              : "rgba(106,133,160,0.14)",
            color: ctaEnabled ? COZY.cocoa : COZY.cocoaSoft,
            border: ctaEnabled ? "none" : `1px solid ${COZY.border}`,
            borderRadius: 999,
            padding: "10px 18px",
            fontWeight: 700,
            fontSize: "0.8rem",
            cursor: ctaEnabled ? "pointer" : "default",
            whiteSpace: "nowrap",
          }}
        >
          {ctaLabel}
        </button>
      )}
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
