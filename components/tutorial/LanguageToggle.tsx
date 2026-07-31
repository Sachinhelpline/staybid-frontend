"use client";
// v138 — Compact EN ⇄ Hinglish toggle chip.
//
// Used inside WelcomeStory header + the Phase 4 "?" help panel.
// Two visuals:
//   variant="chip"  — pill with both labels, active state highlighted
//   variant="text"  — minimal "हिं / EN" link-style toggle
//
// Persistence happens inside the tutorial-store; this component just
// reads + writes through useTutorial().

import { useTutorial, TutorialLang } from "@/lib/tutorial/tutorial-store";

type Props = {
  variant?: "chip" | "text";
  className?: string;
};

export function LanguageToggle({ variant = "chip", className }: Props) {
  const { lang, setLang } = useTutorial();

  const toggle = () => setLang(lang === "en" ? "hi" : "en");

  if (variant === "text") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={className}
        aria-label={lang === "en" ? "Switch to Hinglish" : "English mein dekhein"}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          color: "var(--cozy-cocoa, #4A3820)",
          fontSize: "13px",
          letterSpacing: "0.04em",
          cursor: "pointer",
          padding: "4px 6px",
        }}
      >
        {lang === "en" ? "हिं · Hinglish" : "EN · English"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-label={lang === "en" ? "Switch to Hinglish" : "Switch to English"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 4px",
        borderRadius: 999,
        background: "rgba(176, 192, 209, 0.18)",
        border: "1px solid rgba(106, 133, 160, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        cursor: "pointer",
        color: "var(--cozy-cocoa, #4A3820)",
        userSelect: "none",
      }}
    >
      <span
        style={{
          padding: "3px 9px",
          borderRadius: 999,
          background: lang === "en" ? "linear-gradient(135deg, #b4c1cf, #5f7c98)" : "transparent",
          color: lang === "en" ? "#1F1A0F" : "rgba(74, 56, 32, 0.62)",
          transition: "all 0.18s ease",
        }}
      >
        EN
      </span>
      <span
        style={{
          padding: "3px 9px",
          borderRadius: 999,
          background: lang === "hi" ? "linear-gradient(135deg, #b4c1cf, #5f7c98)" : "transparent",
          color: lang === "hi" ? "#1F1A0F" : "rgba(74, 56, 32, 0.62)",
          transition: "all 0.18s ease",
        }}
      >
        हिं
      </span>
    </button>
  );
}
