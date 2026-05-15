"use client";
/* ──────────────────────────────────────────────────────────────────────
   modal-close-delegate — bulletproof capture-phase fallback for
   modal close buttons across the entire app.

   Why this exists
   ---------------
   30+ files in this codebase have inline close buttons like:
     <button onClick={() => setOpen(false)}>✕</button>
   Many of them sit on small 32×32 hit targets, behind stacking contexts,
   or inside `data-autonext-form` containers whose global delegate can
   swallow the click on Android Chrome with imperfect taps. The user
   reports specific close buttons not registering taps at all.

   Migrating every file to <ModalCloseButton> takes time. This delegate
   is the immediate safety net:
     • Listens on document at CAPTURE phase (fires before any other
       handler can preventDefault / stopPropagation).
     • Walks up from the tap target. If any ancestor (within 4 levels)
       carries `data-modal-close="true"`, runs the React-attached
       onClick handler manually.
     • Also recognises a legacy-friendly attribute `data-close-modal`
       so legacy buttons can opt in without touching the React tree.

   The custom <ModalCloseButton> component still owns the visual + a11y
   contract; this delegate just makes sure the tap NEVER gets lost.
   ────────────────────────────────────────────────────────────────────── */

let installed = false;

function findCloseTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof HTMLElement)) return null;
  let cur: HTMLElement | null = start;
  let hops = 0;
  while (cur && hops < 4) {
    if (
      cur.dataset?.modalClose === "true" ||
      cur.dataset?.closeModal === "true"
    ) {
      return cur;
    }
    cur = cur.parentElement;
    hops += 1;
  }
  return null;
}

/** React attaches its onClick via the internal __reactProps$* key. We
 *  can find that key on the close target and dispatch the handler
 *  directly — that's how the delegate "rescues" a tap that the normal
 *  React event system might miss. */
function reactClickHandler(el: HTMLElement): ((e: any) => void) | null {
  for (const k in el) {
    if (k.startsWith("__reactProps$")) {
      const props = (el as any)[k];
      if (props && typeof props.onClick === "function") return props.onClick;
    }
  }
  return null;
}

export function installModalCloseDelegate() {
  if (installed) return;
  if (typeof document === "undefined") return;
  installed = true;

  // We fire on `click` capture so we beat any `onTouchStart` that called
  // preventDefault. Modern browsers synthesize click after touch
  // sequences anyway, and this ensures we run before the modal's
  // backdrop click handler fires.
  document.addEventListener(
    "click",
    (ev) => {
      const target = findCloseTarget(ev.target);
      if (!target) return;
      // Stop the backdrop's click-to-close from running twice — the
      // target's own handler is the source of truth.
      ev.stopPropagation();
      const handler = reactClickHandler(target);
      if (handler) {
        try {
          handler(ev);
        } catch {
          /* swallow */
        }
      }
    },
    /* capture */ true,
  );
}
