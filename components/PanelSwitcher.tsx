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
// Opened from each panel's OWN menu (v324 — no floating pill anywhere; a pill
// overlapping a panel's bottom nav read as clutter + duplicated switchers that
// already had one built-in, e.g. StayCircle). Every panel surfaces a "Switch
// experience" entry inside its own chrome (Navbar dropdown, /me drawer, host
// hamburger, partner/worker/onboard header, admin sidebar, kiosk header), each
// firing `window.dispatchEvent(new Event("sb:open-switcher"))`. This component
// only renders the sheet + "Switching to X…" splash — globally, so any route
// can open it.
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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
// v646 — panel tiles + close now lucide; panels.ts keeps its emoji strings as
// fallback for any panel missing from this map.
import { X, Luggage, Signpost, Building2, HandCoins, House, BedDouble, Sparkles, Wrench, Monitor, ShieldCheck } from "lucide-react";
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

const PANEL_ICONS: Record<string, ReactNode> = {
  travel:      <Luggage size={21} strokeWidth={2.1} aria-hidden />,
  onboard:     <Signpost size={21} strokeWidth={2.1} aria-hidden />,
  partner:     <Building2 size={21} strokeWidth={2.1} aria-hidden />,
  circle:      <HandCoins size={21} strokeWidth={2.1} aria-hidden />,
  circle_list: <House size={21} strokeWidth={2.1} aria-hidden />,
  host:        <BedDouble size={21} strokeWidth={2.1} aria-hidden />,
  creator:     <Sparkles size={21} strokeWidth={2.1} aria-hidden />,
  worker:      <Wrench size={21} strokeWidth={2.1} aria-hidden />,
  kiosk:       <Monitor size={21} strokeWidth={2.1} aria-hidden />,
  admin:       <ShieldCheck size={21} strokeWidth={2.1} aria-hidden />,
};
const panelIcon = (p: Panel): ReactNode => PANEL_ICONS[p.key] ?? p.icon;

function lsHas(key: string): boolean {
  if (typeof window === "undefined") return false;
  try { return !!localStorage.getItem(key); } catch { return false; }
}

export default function PanelSwitcher() {
  const pathname = usePathname() || "/";
  const { user } = useAuth();
  const { isCreator, isHotelOwner } = useTier();

  const [open, setOpen] = useState(false);
  // v705 (owner ss8) — the splash now carries its OWN destination so a
  // dedicated effect can own the hard-nav + a watchdog escape hatch (the old
  // fire-and-forget setTimeout could leave the splash trapped forever if the
  // single window.location.assign didn't take — SW nav stall, slow dynamic
  // route, a swallowed timer). `stalled` reveals a prominent manual continue.
  const [switching, setSwitching] = useState<{ panel: Panel; dest: string } | null>(null);
  const [stalled, setStalled] = useState(false);
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

  const go = useCallback((p: Panel, state: PanelState) => {
    if (state === "here") { setOpen(false); return; }
    // joined → auto-switch to home. join → the panel's own entry (auth intact).
    const dest = state === "joined" ? p.home : p.joinRoute;
    setOpen(false);
    setStalled(false);
    setSwitching({ panel: p, dest });
  }, []);

  // Force the hard nav right now (also wired to a tap anywhere on the splash so
  // the user is NEVER trapped). A HARD nav re-boots the destination panel so it
  // re-reads its own credential + providers cleanly.
  const goNow = useCallback((dest: string) => {
    try { window.location.assign(dest); }
    catch { try { window.location.href = dest; } catch { /* noop */ } }
  }, []);

  // v705 (owner ss8) — own the navigation from an effect with a layered escape
  // hatch so the "Switching to X…" splash can never hang:
  //   • ~440ms: let the pop animation land, then hard-nav.
  //   • ~3.2s : if we're STILL mounted (nav didn't take), reveal a prominent
  //             "Continue" affordance AND re-fire the nav.
  //   • ~6s   : last-resort location.replace.
  // Timers are cleared on unmount (the normal case — the page navigates away).
  useEffect(() => {
    if (!switching) return;
    const { dest } = switching;
    const t1 = window.setTimeout(() => goNow(dest), 440);
    const t2 = window.setTimeout(() => {
      setStalled(true);
      goNow(dest);
    }, 3200);
    const t3 = window.setTimeout(() => {
      try { window.location.replace(dest); } catch { /* noop */ }
    }, 6000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [switching, goNow]);

  return (
    <>
      <SwitcherStyles />

      {/* v324 — No floating launcher. Every panel opens this switcher from an
          entry inside its OWN nav/menu, firing `sb:open-switcher`. */}

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
              ><X size={16} strokeWidth={2.4} aria-hidden /></button>
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
                    <span className="sbps-card-ic" aria-hidden>{panelIcon(p)}</span>
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

      {/* "Switching to X…" full-screen splash — v705 (owner ss8): alive/native
          (breathing icon + accent halo + moving glow), and tap-anywhere to
          continue so it can never trap the user. */}
      {switching && (
        <div
          className={`sbps-splash${stalled ? " sbps-splash-stalled" : ""}`}
          role="status"
          aria-live="polite"
          style={{ ["--sbps-accent" as string]: switching.panel.accent }}
          onClick={() => goNow(switching.dest)}
        >
          <span className="sbps-splash-glow" aria-hidden />
          <div className="sbps-splash-ic">
            <span className="sbps-splash-halo" aria-hidden />
            <span className="sbps-splash-glyph">{panelIcon(switching.panel)}</span>
          </div>
          <div className="sbps-splash-txt">Switching to {switching.panel.label}</div>
          <div className="sbps-splash-sub">Opening your workspace…</div>
          <div className="sbps-splash-bar"><span /></div>
          <button
            type="button"
            className="sbps-splash-cont"
            onClick={(e) => { e.stopPropagation(); goNow(switching.dest); }}
          >
            {stalled ? "Taking a moment — tap to continue →" : "Tap to continue →"}
          </button>
        </div>
      )}
    </>
  );
}

function SwitcherStyles() {
  return (
    <style
      // v646 — THEME-AWARE (owner order: "light and dark both"): the sheet now
      // rides the app tokens (--bg-card/--bg-pill/--text-*/--border-soft), so it
      // follows the customer theme; [data-theme="dark"] deepens the shadows. It
      // remains an overlay with its own scrim, so it stays readable over the
      // dark admin canvas too.
      dangerouslySetInnerHTML={{ __html: `
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
  background:var(--bg-card);
  border:none;
  border-radius:26px 26px 0 0;
  box-shadow:
    0 -24px 60px -20px rgba(31,26,15,0.45),
    0 10px 20px -12px rgba(31,26,15,0.18),
    inset 0 1px 0 rgba(255,255,255,0.5);
  padding:6px 16px calc(20px + env(safe-area-inset-bottom,0px));
  animation:sbps-up .26s cubic-bezier(.32,1.15,.4,1) both;
}
@media (min-width:600px){ .sbps-sheet{ border-radius:26px; margin:0 16px;
  box-shadow:0 30px 80px rgba(0,0,0,0.55); } }
@keyframes sbps-up{ from{transform:translateY(26px);opacity:.4} to{transform:translateY(0);opacity:1} }

.sbps-grab{ width:42px; height:4px; border-radius:999px;
  background:var(--border-strong, rgba(106,133,160,0.4)); margin:10px auto 6px; }
@media (min-width:600px){ .sbps-grab{ display:none; } }

.sbps-head{ display:flex; align-items:flex-start; justify-content:space-between;
  gap:12px; padding:8px 4px 14px; }
.sbps-eyebrow{ font-size:10.5px; font-weight:800; letter-spacing:.14em;
  text-transform:uppercase; color:var(--accent); margin-bottom:4px; }
.sbps-title{ font-family:'Cormorant Garamond',Georgia,serif; font-style:italic;
  font-size:26px; font-weight:700; color:var(--text-base); line-height:1; margin:0; }
.sbps-close{ width:34px; height:34px; border-radius:999px; flex-shrink:0;
  background:var(--bg-pill); border:1px solid var(--border-soft);
  color:var(--text-soft); font-size:14px; cursor:pointer; line-height:1;
  display:flex; align-items:center; justify-content:center; }
.sbps-close:hover{ background:color-mix(in srgb, var(--accent) 14%, var(--bg-pill)); }

.sbps-grid{ display:flex; flex-direction:column; gap:9px; }

.sbps-card{
  display:flex; align-items:center; gap:13px; width:100%; text-align:left;
  padding:12px 13px; border-radius:18px; cursor:pointer;
  background:var(--bg-pill);
  border:1px solid var(--border-soft);
  transition:transform .14s ease, border-color .14s ease, background .14s ease;
  -webkit-tap-highlight-color:transparent;
}
.sbps-card:hover{ transform:translateY(-2px);
  border-color:color-mix(in srgb, var(--sbps-accent) 55%, transparent);
  background:color-mix(in srgb, var(--sbps-accent) 8%, var(--bg-pill)); }
.sbps-card:active{ transform:translateY(0) scale(.99); }
.sbps-card-here{ cursor:default; border-color:color-mix(in srgb, var(--sbps-accent) 60%, transparent);
  background:color-mix(in srgb, var(--sbps-accent) 12%, transparent); }
.sbps-card-here:hover{ transform:none; }

.sbps-card-ic{ width:44px; height:44px; flex-shrink:0; border-radius:13px;
  display:flex; align-items:center; justify-content:center; font-size:22px;
  color:var(--text-base);
  background:color-mix(in srgb, var(--sbps-accent) 18%, var(--bg-card));
  border:1px solid color-mix(in srgb, var(--sbps-accent) 40%, transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.2); }
.sbps-card-body{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.sbps-card-label{ font-size:14.5px; font-weight:700; color:var(--text-base); line-height:1.15; }
.sbps-card-sub{ font-size:11.5px; color:var(--text-muted); line-height:1.25; }

.sbps-chip{ flex-shrink:0; font-size:11px; font-weight:800; letter-spacing:.2px;
  padding:6px 11px; border-radius:999px; white-space:nowrap; }
.sbps-chip-here{ color:var(--text-soft); background:transparent;
  border:1px solid color-mix(in srgb, var(--sbps-accent) 50%, transparent); }
.sbps-chip-joined{ color:#ffffff;
  background:radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%);
  box-shadow:0 3px 10px rgba(106,133,160,0.3); }
.sbps-chip-join{ color:var(--text-soft); background:var(--bg-pill);
  border:1px solid var(--border-soft); }

.sbps-foot{ margin:14px 4px 2px; font-size:11px; line-height:1.45;
  color:var(--text-muted); text-align:center; }

.sbps-splash{
  position:fixed; inset:0; z-index:10000; overflow:hidden; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:16px; padding:24px;
  background:
    radial-gradient(130% 120% at 50% 38%, color-mix(in srgb, var(--sbps-accent) 12%, var(--bg-page)), var(--bg-page) 72%);
  animation:sbps-fade .18s ease both;
}
/* a slow-moving accent glow behind everything so the screen feels alive, not flat */
.sbps-splash-glow{
  position:absolute; left:50%; top:38%; width:min(120vw,760px); height:min(120vw,760px);
  transform:translate(-50%,-50%);
  background:radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--sbps-accent) 34%, transparent) 0%, transparent 62%);
  filter:blur(30px); opacity:.7; pointer-events:none;
  animation:sbps-drift 4.6s ease-in-out infinite;
}
@keyframes sbps-drift{
  0%,100%{ transform:translate(-50%,-50%) scale(1); opacity:.55; }
  50%{ transform:translate(-50%,-54%) scale(1.14); opacity:.85; }
}
.sbps-splash-ic{ position:relative; width:96px; height:96px; border-radius:28px;
  display:flex; align-items:center; justify-content:center; color:var(--text-base);
  background:color-mix(in srgb, var(--sbps-accent) 24%, var(--bg-card));
  border:1px solid color-mix(in srgb, var(--sbps-accent) 52%, transparent);
  box-shadow:0 22px 60px -14px color-mix(in srgb, var(--sbps-accent) 60%, rgba(0,0,0,0.5)), inset 0 1px 0 rgba(255,255,255,0.14);
  animation:sbps-pop .52s cubic-bezier(.34,1.56,.5,1) both, sbps-breathe 2.8s ease-in-out .52s infinite; }
.sbps-splash-glyph{ display:flex; font-size:46px; animation:sbps-float 2.8s ease-in-out .52s infinite; }
/* a pulsing accent ring that radiates out from the tile */
.sbps-splash-halo{ position:absolute; inset:-6px; border-radius:34px;
  border:2px solid color-mix(in srgb, var(--sbps-accent) 60%, transparent);
  opacity:0; animation:sbps-halo 2.2s ease-out .6s infinite; pointer-events:none; }
@keyframes sbps-pop{ from{transform:scale(.7);opacity:0} to{transform:scale(1);opacity:1} }
@keyframes sbps-breathe{ 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.05); } }
@keyframes sbps-float{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-4px); } }
@keyframes sbps-halo{ 0%{ transform:scale(.9); opacity:.55; } 100%{ transform:scale(1.5); opacity:0; } }
.sbps-splash-txt{ position:relative; font-family:'Cormorant Garamond',Georgia,serif; font-style:italic;
  font-size:25px; color:var(--text-base); letter-spacing:.3px; text-align:center;
  animation:sbps-rise .5s ease .12s both; }
.sbps-splash-sub{ position:relative; margin-top:-6px; font-size:12.5px; font-weight:600;
  letter-spacing:.02em; color:var(--text-muted); animation:sbps-rise .5s ease .2s both; }
@keyframes sbps-rise{ from{ transform:translateY(8px); opacity:0; } to{ transform:translateY(0); opacity:1; } }
.sbps-splash-bar{ position:relative; margin-top:4px; width:150px; height:4px; border-radius:999px;
  background:color-mix(in srgb, var(--sbps-accent) 20%, transparent); overflow:hidden; }
.sbps-splash-bar span{ display:block; height:100%; width:42%; border-radius:999px;
  background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--sbps-accent) 85%, var(--text-base)), transparent);
  animation:sbps-slide 1.05s ease-in-out infinite; }
@keyframes sbps-slide{ 0%{transform:translateX(-130%)} 100%{transform:translateX(360%)} }
/* escape hatch — fades in after a beat so a slow/stalled nav is never a trap */
.sbps-splash-cont{ position:relative; margin-top:10px; cursor:pointer;
  font-size:12.5px; font-weight:700; letter-spacing:.01em;
  color:var(--text-soft); background:var(--bg-pill);
  border:1px solid var(--border-soft); border-radius:999px; padding:9px 16px;
  opacity:0; animation:sbps-cont-in .4s ease 2.2s forwards; }
.sbps-splash-cont:hover{ background:color-mix(in srgb, var(--sbps-accent) 14%, var(--bg-pill));
  border-color:color-mix(in srgb, var(--sbps-accent) 45%, transparent); }
@keyframes sbps-cont-in{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:translateY(0); } }
/* stalled → make the continue affordance prominent immediately */
.sbps-splash-stalled .sbps-splash-cont{ animation:none; opacity:1;
  color:var(--text-base); border-color:color-mix(in srgb, var(--sbps-accent) 55%, transparent);
  background:color-mix(in srgb, var(--sbps-accent) 12%, var(--bg-pill)); }

[data-theme="dark"] .sbps-sheet{
  box-shadow:
    0 -24px 60px -18px rgba(0,0,0,0.75),
    0 10px 20px -12px rgba(0,0,0,0.5),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
[data-theme="dark"] .sbps-card-ic{ box-shadow:inset 0 1px 0 rgba(255,255,255,0.08); }

@media (prefers-reduced-motion:reduce){
  .sbps-backdrop,.sbps-sheet,.sbps-splash,.sbps-splash-ic,.sbps-splash-glyph,
  .sbps-splash-glow,.sbps-splash-halo,.sbps-splash-txt,.sbps-splash-sub{ animation:none !important; }
  .sbps-splash-halo{ display:none; }
  .sbps-splash-bar span{ animation:none; width:100%; }
  /* the escape hatch fades in via animation — keep it visible without motion so
     the user is never trapped even with reduced-motion on. */
  .sbps-splash-cont{ animation:none !important; opacity:1 !important; transform:none !important; }
}
`}}
    />
  );
}
