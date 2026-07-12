"use client";

//
// SwitchExperienceButton — v324
//
// A tiny client button that opens the global "Switch experience" panel
// switcher (the Airbnb-style sheet mounted once in the root layout via
// <PanelSwitcher>). It just dispatches `sb:open-switcher`; the sheet + splash
// live globally.
//
// Every non-customer panel (Host / Partner / Worker / Onboard / Admin / Kiosk)
// mounts this INSIDE its own nav/header chrome — there is NO floating pill
// anymore (v324). Each caller passes its own `className` / `style` so the
// entry matches that panel's look, exactly like the customer Navbar dropdown
// + /me drawer entries do.
//
import type { CSSProperties, ReactNode } from "react";

function openSwitcher() {
  window.dispatchEvent(new Event("sb:open-switcher"));
}

export default function SwitchExperienceButton({
  className,
  style,
  label = "Switch experience",
  title = "Switch to another StayBid panel",
  children,
  onClick,
}: {
  className?: string;
  style?: CSSProperties;
  /** Text shown when no custom children are provided. */
  label?: string;
  title?: string;
  /** Fully custom inner content (overrides the default ⇄ + label). */
  children?: ReactNode;
  /** Optional side-effect fired alongside opening the switcher (e.g. close a
      parent dropdown). The switcher still opens regardless. */
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => { onClick?.(); openSwitcher(); }}
      className={className}
      style={style}
      title={title}
      aria-label={title}
    >
      {children ?? (
        <>
          <span aria-hidden>⇄</span> {label}
        </>
      )}
    </button>
  );
}
