"use client";

// v321 — subtle web-push opt-in banner.
// Shows ONLY when: signed in + browser supports push + permission is still
// "default" (never asked) + not previously dismissed + on a normal customer
// page. Tapping Enable triggers enablePush() from a real user gesture
// (required by browsers). For already-opted-in users it silently refreshes
// the FCM token + re-attaches the foreground handler on load.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { enablePush, refreshPushOnLoad, pushSupported, pushPermission } from "@/lib/push";
import { notify } from "@/lib/notifications";

const DISMISS_KEY = "sb_push_dismissed";

// Routes where the banner would clutter the fullscreen / non-customer chrome.
const HIDE_PREFIXES = ["/admin", "/partner", "/worker", "/onboard", "/auth", "/reels", "/discover"];

export default function PushOptIn() {
  const pathname = usePathname() || "/";
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Refresh token / re-attach foreground handler for opted-in users.
    refreshPushOnLoad();

    if (typeof window === "undefined") return;
    const hidden = pathname === "/" || HIDE_PREFIXES.some((p) => pathname.startsWith(p));
    const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    const signedIn = !!localStorage.getItem("sb_token");
    if (
      !hidden &&
      !dismissed &&
      signedIn &&
      pushSupported() &&
      pushPermission() === "default"
    ) {
      // small delay so it doesn't fight the first paint
      const t = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setShow(false);
  };

  const onEnable = async () => {
    setBusy(true);
    const res = await enablePush();
    setBusy(false);
    if (res.ok) {
      notify({ kind: "success", title: "Notifications on 🔔", body: "You'll get bid & booking alerts.", duration: 4000 });
      setShow(false);
    } else if (res.reason === "denied") {
      // Browser-blocked; don't nag again.
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
      notify({ kind: "warning", title: "Notifications blocked", body: "Enable them from your browser settings anytime.", duration: 5000 });
      setShow(false);
    } else {
      notify({ kind: "error", title: "Couldn't enable", body: "Please try again.", duration: 4000 });
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Enable notifications"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(74px + env(safe-area-inset-bottom, 0px))",
        zIndex: 9998,
        width: "min(420px, calc(100vw - 24px))",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "12px 14px",
        borderRadius: "16px",
        background: "var(--bg-card, #fcfcfd)",
        color: "var(--text-base, #1F1A0F)",
        border: "1px solid var(--border-soft, rgba(106,133,160,0.28))",
        boxShadow: "0 8px 28px -8px rgba(31,26,15,0.35)",
      }}
    >
      <span style={{ fontSize: "20px", lineHeight: 1 }}>🔔</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "13.5px" }}>Stay in the loop</div>
        <div style={{ fontSize: "12px", color: "var(--text-soft, #6E5430)" }}>
          Get alerts when your bid is accepted, countered, or a deal drops.
        </div>
      </div>
      <button
        onClick={onEnable}
        disabled={busy}
        style={{
          flexShrink: 0,
          padding: "8px 14px",
          borderRadius: "999px",
          fontSize: "12.5px",
          fontWeight: 700,
          border: "none",
          cursor: "pointer",
          background: "linear-gradient(135deg,#c8d2dc,#5f7c98)",
          color: "#2B2415",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "…" : "Enable"}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          width: "26px",
          height: "26px",
          borderRadius: "999px",
          border: "none",
          cursor: "pointer",
          background: "var(--bg-pill, rgba(0,0,0,0.05))",
          color: "var(--text-muted, #6E5430)",
          fontSize: "14px",
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
