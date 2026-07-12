"use client";
// ═══════════════════════════════════════════════════════════════════════════
// PanelSwitcher — global Airbnb-style "Switch experience" (v322)
//
// One switcher, reachable from EVERY panel, that lets a signed-in user hop
// between the StayBid surfaces LINKED from the customer frontend (Travelling /
// List Your Hotel / Hotel Partner / StayCircle / List a Property / StayBid
// Hosts / Creator Hub / Worker / Offline Kiosk / Admin). Kiosk + Admin are
// admin-gated; standalone tools with no frontend link (e.g. /agent) are
// intentionally excluded — see lib/panels.ts.
//
// Opened from the menu (v322.1 — no floating pill; it read as clutter over the
// reel feed). A "Switch experience" entry lives in the Navbar dropdown + the
// mobile /me drawer, both firing `window.dispatchEvent(new Event("sb:open-switcher"))`.
// The sheet + "Switching to X…" splash render globally so any route can open it.
//
// Behaviour (locked, see lib/panels.ts):
//   • joined panel → "Switching to X…" splash → hard nav to its home. Hard nav
//     (window.location.assign) re-boots the panel so it re-reads its own token
//     and providers cleanly — no stale cross-panel React context.
//   • not-joined panel → routes to that panel's OWN sign-in / onboarding. The
//     switcher NEVER bypasses a panel's auth.
//   • current panel → "You're here" (no-op).
//
// Styling is fully self-contained (fixed walnut/champagne palette) so it reads
// identically on the dark admin canvas and the themeable customer surface.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useTier } from "@/lib/tier-store";
import {
  visiblePanels,
  panelState,
  type Panel,
  type PanelState,
  type SwitchCtx,
} from "@/lib/panels";

function lsHas(key: string): boolean {
  if (typeof window === "undefined") return false;
  try { return !!localStorage.getItem(key); } catch { return false; }
}

// v323 — The customer frontend surfaces (`/`, `/discover`, `/reels`, `/me`,
// `/hotels`, etc.) already expose "Switch experience" from the Navbar dropdown
// + the /me drawer, and the v322.1 rule explicitly REMOVED the floating pill
// there because it read as clutter over the reel feed. Every OTHER panel
// (admin / partner / circle / host / worker / creator hub / onboard / kiosk)
// has its own chrome with no such entry — so the floating launcher lives ONLY
// on those, giving every panel a way back to the frontend / any other panel.
const NON_CUSTOMER_PANEL_PREFIXES = [
  "/admin", "/partner", "/circle", "/host",
  "/worker", "/influencer", "/onboard", "/kiosk",
];

export default function PanelSwitcher() {
  const pathname = usePathname() || "/";
  const { user } = useAuth();
  const { isCreator, isHotelOwner } = useTier();

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<Panel | null>(null);
  // Token flags are read fresh each time the sheet opens (they can change in
  // another panel/tab). Kept in state so the card list re-renders on open.
  const [tokens, setTokens] = useState({
    partner: false, worker: false, onboard: false, admin: false,
  });

  const readTokens = useCallback(() => {
    setTokens({
      partner: lsHas("sb_partner_token"),
      worker:  lsHas("sb_worker_token"),
      onboard: lsHas("sb_onboard_token"),
      admin:   lsHas("sb_admin_token"),
    });
  }, []);

  const doOpen = useCallback(() => { readTokens(); setOpen(true); }, [readTokens]);

  // Open via the Navbar menu / /me drawer entries.
  useEffect(() => {
    const onOpen = () => doOpen();
    window.addEventListener("sb:open-switcher", onOpen);
    return () => window.removeEventListener("sb:open-switcher", onOpen);
  }, [doOpen]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ctx: SwitchCtx = useMemo(() => ({
    pathname,
    signedIn: !!user || lsHas("sb_token"),
    isCreator,
    isHotelOwner,
    hasPartnerToken: tokens.partner,
    hasWorkerToken: tokens.worker,
    hasOnboardToken: tokens.onboard,
    hasAdminToken: tokens.admin,
  }), [pathname, user, isCreator, isHotelOwner, tokens]);

  const panels = useMemo(() => visiblePanels(ctx), [ctx]);

  // v323 — floating launcher only on non-customer panels (see prefix note).
  const showLauncher = useMemo(
    () => NON_CUSTOMER_PANEL_PREFIXES.some((p) => pathname.startsWith(p)),
    [pathname],
  );

  const go = useCallback((p: Panel, state: PanelState) => {
    if (state === "here") { setOpen(false); return; }
    // joined → auto-switch to home. join → the panel's own entry (auth intact).
    const dest = state === "joined" ? p.home : p.joinRoute;
    setOpen(false);
    setSwitching(p);
    // Brief premium splash, then a HARD nav so the destination panel boots
    // fresh and re-reads its own credential + providers.
    window.setTimeout(() => { window.location.assign(dest); }, 620);
  }, []);

  return (
    <>
      <SwitcherStyles />

      {/* v323 — Global floating launcher. Non-customer panels only; hidden
          while the sheet / splash is up so it never overlaps them. */}
      {showLauncher && !open && !switching && (
        <button
          type="button"
          className="sbps-launcher"
          onClick={doOpen}
          aria-label="Switch experience"
          title="Switch experience"
        >
          <span className="sbps-launcher-ic" aria-hidden>⇄</span>
          <span className="sbps-launcher-txt">Switch</span>
        </button>
      )}

      {/* Airbnb-style sheet */}
      {open && (
        <div className="sbps-backdrop" onClick={() => setOpen(false)}>
          <div
            className="sbps-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Switch experience"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sbps-grab" aria-hidden />
            <div className="sbps-head">
              <div>
                <div className="sbps-eyebrow">One account · all of StayBid</div>
                <h2 className="sbps-title">Switch experience</h2>
              </div>
              <button
                type="button"
                className="sbps-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >✕</button>
            </div>

            <div className="sbps-grid">
              {panels.map((p) => {
                const state = panelState(p, ctx);
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`sbps-card sbps-card-${state}`}
                    style={{ ["--sbps-accent" as string]: p.accent }}
                    onClick={() => go(p, state)}
                    aria-current={state === "here" ? "true" : undefined}
                  >
                    <span className="sbps-card-ic" aria-hidden>{p.icon}</span>
                    <span className="sbps-card-body">
                      <b className="sbps-card-label">{p.label}</b>
                      <span className="sbps-card-sub">{p.tagline}</span>
                    </span>
                    <span className={`sbps-chip sbps-chip-${state}`}>
                      {state === "here" ? "You’re here"
                        : state === "joined" ? "Open →"
                        : p.joinCta}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="sbps-foot">
              Each panel keeps its own sign-in. Once you’ve joined, switching is
              instant — no re-login.
            </p>
          </div>
        </div>
      )}

      {/* "Switching to X…" full-screen splash */}
      {switching && (
        <div className="sbps-splash" role="status" aria-live="polite">
          <div className="sbps-splash-ic" style={{ ["--sbps-accent" as string]: switching.accent }}>
            {switching.icon}
          </div>
          <div className="sbps-splash-txt">Switching to {switching.label}…</div>
          <div className="sbps-splash-bar"><span /></div>
        </div>
      )}
    </>
  );
}

function SwitcherStyles() {
  return (
    <style
      // Fixed walnut/champagne palette — theme-independent so it reads on the
      // dark admin canvas AND the light/dark customer surface identically.
      dangerouslySetInnerHTML={{ __html: `
.sbps-launcher{
  position:fixed; z-index:9000;
  left:max(14px, env(safe-area-inset-left,0px));
  bottom:calc(16px + env(safe-area-inset-bottom,0px));
  display:inline-flex; align-items:center; gap:7px;
  padding:9px 14px 9px 12px; border-radius:999px; cursor:pointer;
  font-size:12.5px; font-weight:800; letter-spacing:.02em; line-height:1;
  color:#F5E9CE;
  background:linear-gradient(135deg, rgba(43,36,21,0.92), rgba(26,21,12,0.92));
  border:1px solid rgba(201,166,107,0.42);
  box-shadow:0 10px 26px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08);
  backdrop-filter:blur(10px) saturate(140%);
  -webkit-backdrop-filter:blur(10px) saturate(140%);
  -webkit-tap-highlight-color:transparent;
  transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease;
  animation:sbps-launch-in .3s cubic-bezier(.32,1.15,.4,1) both;
}
.sbps-launcher:hover{ transform:translateY(-2px);
  border-color:rgba(201,166,107,0.7);
  box-shadow:0 14px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12); }
.sbps-launcher:active{ transform:translateY(0) scale(.97); }
.sbps-launcher-ic{ font-size:15px; color:#E7CFA0; line-height:1;
  display:inline-flex; }
.sbps-launcher-txt{ padding-right:1px; }
@keyframes sbps-launch-in{ from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
@media (prefers-reduced-motion:reduce){ .sbps-launcher{ animation:none !important; } }

.sbps-backdrop{
  position:fixed; inset:0; z-index:9998;
  background:rgba(7,6,4,0.62); backdrop-filter:blur(6px);
  -webkit-backdrop-filter:blur(6px);
  display:flex; align-items:flex-end; justify-content:center;
  animation:sbps-fade .18s ease both;
}
@media (min-width:600px){ .sbps-backdrop{ align-items:center; } }
@keyframes sbps-fade{ from{opacity:0} to{opacity:1} }

.sbps-sheet{
  width:100%; max-width:520px; max-height:88vh; overflow-y:auto;
  background:linear-gradient(180deg,#241E12,#1A150C);
  border:1px solid rgba(201,166,107,0.28);
  border-radius:26px 26px 0 0;
  box-shadow:0 -18px 60px rgba(0,0,0,0.6);
  padding:6px 16px calc(20px + env(safe-area-inset-bottom,0px));
  animation:sbps-up .26s cubic-bezier(.32,1.15,.4,1) both;
}
@media (min-width:600px){ .sbps-sheet{ border-radius:26px; margin:0 16px;
  box-shadow:0 30px 80px rgba(0,0,0,0.55); } }
@keyframes sbps-up{ from{transform:translateY(26px);opacity:.4} to{transform:translateY(0);opacity:1} }

.sbps-grab{ width:42px; height:4px; border-radius:999px;
  background:rgba(201,166,107,0.4); margin:10px auto 6px; }
@media (min-width:600px){ .sbps-grab{ display:none; } }

.sbps-head{ display:flex; align-items:flex-start; justify-content:space-between;
  gap:12px; padding:8px 4px 14px; }
.sbps-eyebrow{ font-size:10.5px; font-weight:800; letter-spacing:.14em;
  text-transform:uppercase; color:#C9A66B; margin-bottom:4px; }
.sbps-title{ font-family:'Cormorant Garamond',Georgia,serif; font-style:italic;
  font-size:26px; font-weight:700; color:#F7EDD6; line-height:1; margin:0; }
.sbps-close{ width:34px; height:34px; border-radius:999px; flex-shrink:0;
  background:rgba(255,255,255,0.06); border:1px solid rgba(201,166,107,0.24);
  color:#E7D6AE; font-size:14px; cursor:pointer; line-height:1;
  display:flex; align-items:center; justify-content:center; }
.sbps-close:hover{ background:rgba(255,255,255,0.12); }

.sbps-grid{ display:flex; flex-direction:column; gap:9px; }

.sbps-card{
  display:flex; align-items:center; gap:13px; width:100%; text-align:left;
  padding:12px 13px; border-radius:18px; cursor:pointer;
  background:rgba(255,255,255,0.035);
  border:1px solid rgba(201,166,107,0.16);
  transition:transform .14s ease, border-color .14s ease, background .14s ease;
  -webkit-tap-highlight-color:transparent;
}
.sbps-card:hover{ transform:translateY(-2px);
  border-color:color-mix(in srgb, var(--sbps-accent) 55%, transparent);
  background:rgba(255,255,255,0.06); }
.sbps-card:active{ transform:translateY(0) scale(.99); }
.sbps-card-here{ cursor:default; border-color:color-mix(in srgb, var(--sbps-accent) 60%, transparent);
  background:color-mix(in srgb, var(--sbps-accent) 12%, transparent); }
.sbps-card-here:hover{ transform:none; }

.sbps-card-ic{ width:44px; height:44px; flex-shrink:0; border-radius:13px;
  display:flex; align-items:center; justify-content:center; font-size:22px;
  background:color-mix(in srgb, var(--sbps-accent) 20%, #1F1A0F);
  border:1px solid color-mix(in srgb, var(--sbps-accent) 40%, transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.08); }
.sbps-card-body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.sbps-card-label{ font-size:14.5px; font-weight:700; color:#F5E9CE; line-height:1.15; }
.sbps-card-sub{ font-size:11.5px; color:rgba(230,214,174,0.62); line-height:1.25; }

.sbps-chip{ flex-shrink:0; font-size:11px; font-weight:800; letter-spacing:.2px;
  padding:6px 11px; border-radius:999px; white-space:nowrap; }
.sbps-chip-here{ color:#D9BE82; background:transparent;
  border:1px solid color-mix(in srgb, var(--sbps-accent) 50%, transparent); }
.sbps-chip-joined{ color:#1F1A0F;
  background:linear-gradient(135deg,#E7CFA0,#C9A66B);
  box-shadow:0 3px 10px rgba(201,166,107,0.3); }
.sbps-chip-join{ color:#E7D6AE; background:rgba(255,255,255,0.06);
  border:1px solid rgba(201,166,107,0.3); }

.sbps-foot{ margin:14px 4px 2px; font-size:11px; line-height:1.45;
  color:rgba(230,214,174,0.5); text-align:center; }

.sbps-splash{
  position:fixed; inset:0; z-index:10000;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:18px; background:radial-gradient(120% 120% at 50% 40%,#241E12,#0E0B06);
  animation:sbps-fade .16s ease both;
}
.sbps-splash-ic{ width:88px; height:88px; border-radius:26px; font-size:44px;
  display:flex; align-items:center; justify-content:center;
  background:color-mix(in srgb, var(--sbps-accent) 22%, #1F1A0F);
  border:1px solid color-mix(in srgb, var(--sbps-accent) 45%, transparent);
  box-shadow:0 18px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
  animation:sbps-pop .5s cubic-bezier(.34,1.56,.5,1) both; }
@keyframes sbps-pop{ from{transform:scale(.7);opacity:0} to{transform:scale(1);opacity:1} }
.sbps-splash-txt{ font-family:'Cormorant Garamond',Georgia,serif; font-style:italic;
  font-size:22px; color:#F7EDD6; letter-spacing:.3px; }
.sbps-splash-bar{ width:140px; height:4px; border-radius:999px;
  background:rgba(201,166,107,0.18); overflow:hidden; }
.sbps-splash-bar span{ display:block; height:100%; width:40%; border-radius:999px;
  background:linear-gradient(90deg,#C9A66B,#F0D060);
  animation:sbps-slide 1s ease-in-out infinite; }
@keyframes sbps-slide{ 0%{transform:translateX(-120%)} 100%{transform:translateX(360%)} }

@media (prefers-reduced-motion:reduce){
  .sbps-backdrop,.sbps-sheet,.sbps-splash,.sbps-splash-ic{ animation:none !important; }
  .sbps-splash-bar span{ animation:none; width:100%; }
}
`}}
    />
  );
}
