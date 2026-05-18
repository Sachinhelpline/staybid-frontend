"use client";
// v140 — Tutorial replay list (Phase 4).
//
// Renders a list of all tours with status (Seen ✓ / Not seen) and a
// Replay button per row. Used in two surfaces:
//   • Inside the floating "?" help sheet (TutorialHelpButton)
//   • Inside the /me MoreDrawer "App Tour" section
//
// Also surfaces the master kill-switch + language picker so users
// have ONE place to configure tutorial preferences.
//
// Props:
//   highlightTourKey — current page's tour key, shown first with a
//                      gold "this page" badge if set.
//   onAfterReplay    — called after the user taps any Replay button;
//                      lets the parent close its sheet.

import { useRouter, usePathname } from "next/navigation";
import { useTutorial, type TutorialKey } from "@/lib/tutorial/tutorial-store";
import { TUTORIAL_DRAWER_COPY } from "@/lib/tutorial/tutorial-content";
import { LanguageToggle } from "./LanguageToggle";

type Row = { key: TutorialKey; labelEn: string; labelHi: string; emoji: string; route?: string };

const ROWS: Row[] = [
  { key: "welcome",    emoji: "✨", labelEn: "Welcome story",         labelHi: "Welcome story" },
  { key: "home",       emoji: "🏠", labelEn: "Home & reels feed",     labelHi: "Home aur reels",      route: "/discover" },
  { key: "explore",    emoji: "🔎", labelEn: "Explore hotels",        labelHi: "Hotels explore karo", route: "/hotels" },
  { key: "hotel",      emoji: "🏨", labelEn: "Hotel detail page",     labelHi: "Hotel detail page",   route: "/hotels" },
  { key: "bid",        emoji: "💰", labelEn: "Reverse auction bid",   labelHi: "Reverse auction bid", route: "/bid" },
  { key: "flash",      emoji: "⚡", labelEn: "Flash Deals",           labelHi: "Flash Deals",         route: "/flash-deals" },
  { key: "mybids",     emoji: "📋", labelEn: "My Bids",               labelHi: "My Bids",             route: "/my-bids" },
  { key: "bookings",   emoji: "🎫", labelEn: "Bookings",              labelHi: "Bookings",            route: "/bookings" },
  // v142 — Phase 6: account + creator + support
  { key: "wallet",     emoji: "💸", labelEn: "Wallet",                labelHi: "Wallet",              route: "/wallet" },
  { key: "points",     emoji: "💎", labelEn: "StayPoints",            labelHi: "StayPoints",          route: "/points" },
  { key: "saved",      emoji: "🔖", labelEn: "Saved items",           labelHi: "Saved items",         route: "/saved" },
  { key: "me",         emoji: "👤", labelEn: "Your profile",          labelHi: "Aapka profile",       route: "/me" },
  { key: "verify",     emoji: "🎥", labelEn: "Stay verification",     labelHi: "Stay verification",   route: "/verification" },
  { key: "complaints", emoji: "📣", labelEn: "Complaints",            labelHi: "Complaints",          route: "/complaints" },
  { key: "influencer", emoji: "🎬", labelEn: "Creator Hub",           labelHi: "Creator Hub",         route: "/influencer/dashboard" },
  { key: "earn",       emoji: "✨", labelEn: "Become a Creator",      labelHi: "Creator bano",        route: "/upgrade" },
  // v143 — modal/drawer tours. No `route` because they fire from a
  // CTA tap inside another page. Replay button just resets the seen
  // flag — the user has to open the modal again to actually see it.
  { key: "negotiate",     emoji: "🎯", labelEn: "Negotiate modal",       labelHi: "Negotiate modal" },
  { key: "bookingReview", emoji: "💳", labelEn: "Pay/Hold options",      labelHi: "Pay/Hold options" },
  { key: "flashDrawer",   emoji: "⚡", labelEn: "Flash Deal details",    labelHi: "Flash Deal details" },
];

type Props = {
  highlightTourKey?: string | null;
  onAfterReplay?: () => void;
};

export function TutorialReplayList({ highlightTourKey, onAfterReplay }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const { lang, isSeen, replayTour, disabled, setDisabled } = useTutorial();
  const copy = TUTORIAL_DRAWER_COPY[lang] || TUTORIAL_DRAWER_COPY.en;

  // Sort: current-page tour first, then unseen, then seen
  const sorted = [...ROWS].sort((a, b) => {
    if (a.key === highlightTourKey) return -1;
    if (b.key === highlightTourKey) return 1;
    const aSeen = isSeen(a.key);
    const bSeen = isSeen(b.key);
    if (aSeen && !bSeen) return 1;
    if (!aSeen && bSeen) return -1;
    return 0;
  });

  const handleReplay = (row: Row) => {
    onAfterReplay?.();
    // Welcome story renders on every customer page — just trigger it.
    if (row.key === "welcome") {
      replayTour("welcome");
      return;
    }
    // Per-page tours need the user to be ON that page. If they're on a
    // different route, navigate first; the usePageTour hook fires after
    // mount.
    if (row.route && !pathname.startsWith(row.route)) {
      // Reset the seen-flag first so the auto-fire on the destination
      // page picks it up. (replayTour does this internally.)
      replayTour(row.key);
      router.push(row.route);
      return;
    }
    // Same page — trigger immediately
    replayTour(row.key);
  };

  return (
    <div>
      {/* Language strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(201, 166, 107, 0.10)",
          border: "1px solid rgba(201, 166, 107, 0.22)",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cozy-cocoa, #4A3820)" }}>
          {lang === "hi" ? "Bhasha" : "Language"}
        </span>
        <LanguageToggle variant="chip" />
      </div>

      {/* Tour rows */}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {sorted.map((row) => {
          const seen = isSeen(row.key);
          const isHighlight = row.key === highlightTourKey;
          const label = lang === "hi" ? row.labelHi : row.labelEn;
          return (
            <li
              key={row.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "11px 12px",
                borderRadius: 12,
                background: isHighlight
                  ? "linear-gradient(135deg, rgba(231,207,160,0.32), rgba(255,252,246,0.7))"
                  : "rgba(255, 252, 246, 0.6)",
                border: isHighlight
                  ? "1px solid rgba(201, 166, 107, 0.55)"
                  : "1px solid rgba(201, 166, 107, 0.18)",
              }}
            >
              <span style={{ fontSize: 18 }}>{row.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--cozy-warm-dark, #1F1A0F)",
                  }}
                >
                  {label}
                  {isHighlight && (
                    <span
                      style={{
                        marginLeft: 8,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "linear-gradient(135deg, #E7CFA0, #C9A66B)",
                        color: "#1F1A0F",
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                      }}
                    >
                      {lang === "hi" ? "IS PAGE PE" : "THIS PAGE"}
                    </span>
                  )}
                </p>
                <p
                  style={{
                    margin: "1px 0 0",
                    fontSize: 11,
                    color: "var(--cozy-cocoa-soft, #6E5430)",
                  }}
                >
                  {seen
                    ? (lang === "hi" ? "Seen · dobara dekhne ke liye replay" : "Seen · tap replay to re-watch")
                    : (lang === "hi" ? "Pehli baar — tap to start" : "Not seen yet — tap to start")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleReplay(row)}
                style={{
                  appearance: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: seen
                    ? "rgba(201, 166, 107, 0.16)"
                    : "linear-gradient(135deg, #E7CFA0, #C9A66B)",
                  color: seen ? "var(--cozy-cocoa, #4A3820)" : "#1F1A0F",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {seen ? copy.replay : (lang === "hi" ? "Start" : "Start")}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Master kill-switch */}
      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 12,
          background: disabled
            ? "rgba(212, 149, 131, 0.10)"
            : "rgba(201, 166, 107, 0.06)",
          border: disabled
            ? "1px solid rgba(212, 149, 131, 0.32)"
            : "1px solid rgba(201, 166, 107, 0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--cozy-warm-dark, #1F1A0F)",
            }}
          >
            {disabled ? copy.disabledTitle : (lang === "hi" ? "Auto-tour chalu hai" : "Auto-tours on")}
          </p>
          <p
            style={{
              margin: "1px 0 0",
              fontSize: 10,
              color: "var(--cozy-cocoa-soft, #6E5430)",
            }}
          >
            {disabled ? copy.disabledSub : (lang === "hi" ? "First-visit pe auto-fire" : "Auto-fires on first visit")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDisabled(!disabled)}
          style={{
            appearance: "none",
            border: "1px solid rgba(201, 166, 107, 0.32)",
            background: "transparent",
            color: "var(--cozy-cocoa, #4A3820)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "6px 12px",
            borderRadius: 999,
            cursor: "pointer",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {disabled ? copy.enableLabel : copy.disableLabel}
        </button>
      </div>
    </div>
  );
}
