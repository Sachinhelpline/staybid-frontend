"use client";
/* ──────────────────────────────────────────────────────────────────────
   AutoNextMount — installs the global auto-next-scroll delegate once
   per app boot. Mount once in app/layout.tsx (inside any client
   provider tree). Renders nothing. v122.3.

   See lib/auto-next-scroll.ts for the data-attribute contract:
     data-autonext="<key>"               — target section
     data-autonext-target="<key>"        — click trigger
     data-autonext-target-blur="<key>"   — blur trigger (text inputs)
     data-autonext-target-enter="<key>"  — Enter keydown trigger
     data-autonext-target-filled="<key>" — input.value.length >= min
     data-autonext-self="<key>"          — container; any inner click

   Any page across customer / admin / partner / onboard can opt in via
   attributes alone — no per-handler wiring needed.
   ────────────────────────────────────────────────────────────────────── */
import { useEffect } from "react";
import {
  installAutoNextDelegate,
  installAutoNextFilledWatcher,
} from "@/lib/auto-next-scroll";
import { installModalCloseDelegate } from "@/lib/modal-close-delegate";

export function AutoNextMount() {
  useEffect(() => {
    installAutoNextDelegate();
    installAutoNextFilledWatcher();
    // v125.2 — bulletproof modal close tap rescue. Listens at capture
    // phase for any tap whose target/ancestor carries `data-modal-close`.
    installModalCloseDelegate();
  }, []);
  return null;
}
