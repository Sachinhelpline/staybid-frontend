"use client";
//
// HelpLauncher — v404
//
// The floating "?" app-tour button and the floating support chat bubble were
// removed from every screen (they distracted on every panel). Instead each
// panel mounts these tiny in-menu buttons, which just dispatch a global event
// the globally-mounted <TutorialHelpButton> / <SupportWidget> listen for —
// exactly the same pattern as <SwitchExperienceButton> + the panel switcher.
//
import type { CSSProperties, ReactNode } from "react";

export function openAppTour() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:open-tour"));
}
export function openSupport() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:open-support"));
}

type BtnProps = {
  className?: string;
  style?: CSSProperties;
  label?: string;
  title?: string;
  children?: ReactNode;
  /** Optional side-effect (e.g. close a parent dropdown). The action still fires. */
  onClick?: () => void;
};

/** Opens the App Tour / Help sheet (replay any guided tour, language, toggles). */
export function AppTourButton({ className, style, label = "App Tour", title = "Open the app tour & help", children, onClick }: BtnProps) {
  return (
    <button
      type="button"
      onClick={() => { onClick?.(); openAppTour(); }}
      className={className}
      style={style}
      title={title}
      aria-label={title}
    >
      {children ?? (<><span aria-hidden>❓</span> {label}</>)}
    </button>
  );
}

/** Opens the Help & Support chat panel. */
export function HelpSupportButton({ className, style, label = "Help & Support", title = "Chat with StayBid support", children, onClick }: BtnProps) {
  return (
    <button
      type="button"
      onClick={() => { onClick?.(); openSupport(); }}
      className={className}
      style={style}
      title={title}
      aria-label={title}
    >
      {children ?? (<><span aria-hidden>🎧</span> {label}</>)}
    </button>
  );
}
