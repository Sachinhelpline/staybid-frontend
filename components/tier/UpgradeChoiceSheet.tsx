"use client";
// ═══════════════════════════════════════════════════════════════════════════
// UpgradeChoiceSheet — shown when a PUBLIC user with no upload eligibility
// taps the + FAB. Two paths:
//   1. Verified Guest  — pick from completed bookings (90-day window)
//   2. Verified Local  — verify physical presence at hotel via OTP
// ═══════════════════════════════════════════════════════════════════════════
// Per Sachin's "Option A" Phase-3 patch: when locationOtpEnabled=false
// (default in production today), the Verified Local card is rendered with
// a "Coming Soon" overlay + disabled state. Only the Verified Guest path
// is interactive. Activate later by flipping NEXT_PUBLIC_ENABLE_LOCATION_OTP=1.
//
// Self-contained: handles its own data fetching, booking-picker step, and
// final hand-off back to the parent. Parent's job is just to mount it
// open=true and listen for onPickedBooking / onClose.
//
// This component does NOT do the actual media upload — it picks the
// booking/location context, then the parent opens the CreateFlow with
// tierContext={...} attached, which routes runUpload to the right endpoint.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { MyTierResponse } from "@/lib/tier/types";

const COZY = {
  paperBg: "linear-gradient(135deg, #FAF5EB 0%, #F2EAD8 100%)",
  cardBg: "#FFFCF6",
  champagne: "#C9A66B",
  champagneLight: "#D9BE82",
  sage: "#7DA86C",
  sageDark: "#3F5C2E",
  cocoa: "#4A3820",
  cocoaSoft: "#6E5430",
  taupe: "#E8DCC8",
  border: "rgba(201,166,107,0.40)",
};

type EligibleBooking = {
  id: string;
  hotelId: string;
  roomId?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  source: "booking" | "bid";
  hotelName?: string | null;
  hotelCity?: string | null;
};

type Step = "choice" | "booking-list";

export type TierContext =
  | { kind: "verified_guest"; hotelId: string; bookingId: string; hotelName?: string }
  | {
      kind: "community_contributor";
      hotelId: string;
      locationVerificationId: string;
      hotelName?: string;
    };

export type UpgradeChoiceSheetProps = {
  open: boolean;
  /** Initial tier snapshot — saves a roundtrip when the parent has it. */
  tier?: MyTierResponse | null;
  onClose: () => void;
  /** Called when user picks a booking. Parent opens CreateFlow with tierContext. */
  onPickedContext: (ctx: TierContext) => void;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function UpgradeChoiceSheet({
  open,
  tier,
  onClose,
  onPickedContext,
}: UpgradeChoiceSheetProps) {
  const [step, setStep] = useState<Step>("choice");
  const [bookings, setBookings] = useState<EligibleBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingErr, setBookingErr] = useState<string | null>(null);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset to choice step on close
  useEffect(() => {
    if (!open) setStep("choice");
  }, [open]);

  const fetchBookings = async () => {
    setLoadingBookings(true);
    setBookingErr(null);
    try {
      const r: any = await api.getEligibleBookings();
      const rows: EligibleBooking[] = r?.bookings || [];
      setBookings(rows);
      if (!rows.length) {
        setBookingErr(
          "No completed stays in the last 90 days. Book a stay and check out to unlock content sharing."
        );
      }
    } catch (e: any) {
      setBookingErr(e?.message || "Failed to load bookings");
    } finally {
      setLoadingBookings(false);
    }
  };

  const goToBookingPicker = async () => {
    setStep("booking-list");
    await fetchBookings();
  };

  const pickBooking = (b: EligibleBooking) => {
    onPickedContext({
      kind: "verified_guest",
      hotelId: b.hotelId,
      bookingId: b.id,
      hotelName: b.hotelName || undefined,
    });
  };

  if (!open) return null;

  const locationEnabled = tier?.locationOtpEnabled === true;
  const eligibleCount = tier?.eligibleBookingsCount ?? 0;

  const sheet = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose how you'd like to share content"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(31,26,15,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "92dvh",
          overflow: "auto",
          background: COZY.cardBg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          padding: "24px 22px 28px",
          boxShadow: "0 -12px 40px rgba(31,26,15,0.30)",
          animation: "ucsFadeIn 0.22s ease-out",
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: 48,
            height: 4,
            borderRadius: 2,
            background: COZY.taupe,
            margin: "0 auto 18px",
          }}
        />

        {step === "choice" && (
          <>
            <h2
              style={{
                margin: 0,
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontStyle: "italic",
                fontSize: "1.7rem",
                color: COZY.cocoa,
                lineHeight: 1.15,
                marginBottom: 6,
              }}
            >
              Share your StayBid moment
            </h2>
            <p
              style={{
                margin: 0,
                color: COZY.cocoaSoft,
                fontSize: "0.92rem",
                lineHeight: 1.5,
                marginBottom: 18,
              }}
            >
              Posting reels &amp; photos is reserved for verified travellers.
              Choose how to verify yourself below.
            </p>

            {/* Card 1: Verified Guest — booking-based */}
            <button
              type="button"
              onClick={goToBookingPicker}
              disabled={eligibleCount === 0}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "16px 16px",
                borderRadius: 16,
                border: `1px solid ${COZY.border}`,
                background:
                  eligibleCount > 0 ? COZY.paperBg : "rgba(232,220,200,0.30)",
                color: COZY.cocoa,
                cursor: eligibleCount > 0 ? "pointer" : "not-allowed",
                opacity: eligibleCount > 0 ? 1 : 0.62,
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: "1.8rem" }} aria-hidden>
                🎫
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.98rem",
                    marginBottom: 4,
                  }}
                >
                  Verified Guest
                  {eligibleCount > 0 && (
                    <span
                      style={{
                        marginLeft: 8,
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(125,168,108,0.20)",
                        color: COZY.sageDark,
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {eligibleCount}{" "}
                      {eligibleCount === 1 ? "stay" : "stays"} ✓
                    </span>
                  )}
                </div>
                <div
                  style={{
                    color: COZY.cocoaSoft,
                    fontSize: "0.82rem",
                    lineHeight: 1.4,
                  }}
                >
                  Pick a hotel where you&apos;ve checked out in the last
                  90 days. Your content goes to the hotel for review,
                  then publishes.
                </div>
              </div>
              <div
                style={{ fontSize: "1.4rem", color: COZY.champagne }}
                aria-hidden
              >
                ›
              </div>
            </button>

            {/* Card 2: Community Contributor — location OTP */}
            <button
              type="button"
              disabled={!locationEnabled}
              onClick={() => {
                /* Phase 3 OFF — will wire LocationVerifyFlow when flag flips */
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "16px 16px",
                borderRadius: 16,
                border: `1px solid ${COZY.border}`,
                background: locationEnabled
                  ? COZY.paperBg
                  : "rgba(232,220,200,0.30)",
                color: COZY.cocoa,
                cursor: locationEnabled ? "pointer" : "not-allowed",
                opacity: locationEnabled ? 1 : 0.62,
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginBottom: 4,
                position: "relative",
              }}
            >
              <div style={{ fontSize: "1.8rem" }} aria-hidden>
                📍
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.98rem",
                    marginBottom: 4,
                  }}
                >
                  Verified Local
                  {!locationEnabled && (
                    <span
                      style={{
                        marginLeft: 8,
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(201,166,107,0.20)",
                        color: COZY.cocoaSoft,
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                      }}
                    >
                      Coming Soon
                    </span>
                  )}
                </div>
                <div
                  style={{
                    color: COZY.cocoaSoft,
                    fontSize: "0.82rem",
                    lineHeight: 1.4,
                  }}
                >
                  Verify your physical presence at a hotel using your
                  phone&apos;s location + OTP. Great for walk-ins and
                  day-trippers.
                </div>
              </div>
              <div
                style={{ fontSize: "1.4rem", color: COZY.champagne }}
                aria-hidden
              >
                ›
              </div>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                marginTop: 16,
                width: "100%",
                padding: "12px 16px",
                borderRadius: 14,
                border: `1px solid ${COZY.taupe}`,
                background: "transparent",
                color: COZY.cocoaSoft,
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: "pointer",
              }}
            >
              Not now
            </button>
          </>
        )}

        {step === "booking-list" && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <button
                type="button"
                onClick={() => setStep("choice")}
                aria-label="Back"
                style={{
                  background: "transparent",
                  color: COZY.cocoa,
                  border: "none",
                  cursor: "pointer",
                  fontSize: "1.3rem",
                  padding: 4,
                  lineHeight: 1,
                }}
              >
                ←
              </button>
              <h3
                style={{
                  margin: 0,
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontStyle: "italic",
                  fontSize: "1.35rem",
                  color: COZY.cocoa,
                }}
              >
                Pick a stay
              </h3>
            </div>

            {loadingBookings && (
              <div
                style={{
                  color: COZY.cocoaSoft,
                  fontSize: "0.9rem",
                  padding: "20px 8px",
                  textAlign: "center",
                }}
              >
                Loading your stays…
              </div>
            )}

            {!loadingBookings && bookingErr && (
              <div
                style={{
                  color: COZY.cocoaSoft,
                  fontSize: "0.88rem",
                  padding: "20px 8px",
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                {bookingErr}
              </div>
            )}

            {!loadingBookings &&
              bookings.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => pickBooking(b)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "14px 14px",
                    borderRadius: 14,
                    border: `1px solid ${COZY.border}`,
                    background: COZY.paperBg,
                    color: COZY.cocoa,
                    cursor: "pointer",
                    marginBottom: 10,
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontSize: "1.6rem" }} aria-hidden>
                    🏨
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "0.94rem",
                        marginBottom: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {b.hotelName || "Hotel"}
                      {b.hotelCity && (
                        <span
                          style={{
                            color: COZY.cocoaSoft,
                            fontWeight: 500,
                            marginLeft: 6,
                          }}
                        >
                          · {b.hotelCity}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        color: COZY.cocoaSoft,
                        fontSize: "0.78rem",
                      }}
                    >
                      Checked out {formatDate(b.checkOut)}
                    </div>
                  </div>
                  <div
                    style={{ fontSize: "1.3rem", color: COZY.champagne }}
                    aria-hidden
                  >
                    ›
                  </div>
                </button>
              ))}
          </>
        )}
      </div>

      <style jsx global>{`
        @keyframes ucsFadeIn {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );

  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}
