import "./globals.css";
// v142 — driver.js base CSS (Tutorial Layer 2 spotlight tours). The
// cozy palette overrides live in globals.css after this import.
import "driver.js/dist/driver.css";
import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth";
import { TierProvider } from "@/lib/tier-store";
import { SoundProvider } from "@/lib/sound-store";
import { FollowProvider } from "@/lib/follow-store";
import { PostsProvider } from "@/lib/posts-store";
import { ThemeProvider } from "@/lib/theme-store";
import { TutorialProvider } from "@/lib/tutorial/tutorial-store";
import { WelcomeStory } from "@/components/tutorial/WelcomeStory";
import { TutorialHelpButton } from "@/components/tutorial/TutorialHelpButton";
import { TutorialTriggerMount } from "@/components/tutorial/TutorialTriggerMount";
import { Navbar } from "@/components/Navbar";
// DialerNav (left-edge crown wheel) was retired in v80 — the BottomDock
// now owns primary navigation on every customer-facing page.
import { BottomDock } from "@/components/discover/BottomDock";
import { BackChip } from "@/components/BackChip";
import { ServerStatus } from "@/components/ServerStatus";
import NotificationToast from "@/components/NotificationToast";
import SupportWidget from "@/components/support/SupportWidget";
// v122.3 — installs the global auto-next-scroll delegate so EVERY
// CTA carrying `data-autonext-target="<key>"` smoothly scrolls the
// matching `[data-autonext="<key>"]` section into view on click. No
// per-page handler wiring needed; just attributes.
import { AutoNextMount } from "@/components/AutoNextMount";
export const viewport: Viewport = {
  // Black theme color so the OS status-bar / app-switcher chrome blends
  // with the reel feed (no jarring white strip). Was '#0a0f23' (navy)
  // which clashed with the #07060e reel bg.
  themeColor: '#07060e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};
export const metadata: Metadata = {
  metadataBase: new URL('https://www.staybids.in'),
  title: {
    default: 'StayBid - Bid Your Stay, Save Big',
    template: '%s | StayBid',
  },
  description: "India's first reverse-auction hotel booking platform. Name your price, hotels compete for your booking.",
  applicationName: 'StayBid',
  keywords: "hotel bidding, reverse auction, budget hotels, mountain stays, Mussoorie, Rishikesh, Shimla, Manali",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'StayBid',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-120x120.png', sizes: '120x120', type: 'image/png' },
      { url: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-167x167.png', sizes: '167x167', type: 'image/png' },
      { url: '/icons/icon-180x180.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/icons/icon-192x192.png',
  },
  openGraph: {
    title: "StayBid - Name Your Price. Hotels Compete.",
    description: "India's first reverse-auction hotel platform. Bid on premium stays and save up to 40%.",
    url: 'https://www.staybids.in',
    siteName: 'StayBid',
    images: [
      { url: '/icons/icon-512x512.png', width: 512, height: 512, alt: 'StayBid' },
    ],
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StayBid - Bid Your Stay, Save Big',
    description: "India's first reverse-auction hotel booking platform.",
    images: ['/icons/icon-512x512.png'],
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* ── Preconnect to remote origins we'll hit on every visit. Costs
            ~0 KB and ~0 ms but saves the DNS + TLS handshake (~100–400 ms
            on cellular) the first time the page tries to fetch an image
            or a placeholder video. */}
        <link rel="preconnect" href="https://uxxhbdqedazpmvbvaosh.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://uxxhbdqedazpmvbvaosh.supabase.co" />
        <link rel="preconnect" href="https://commondatastorage.googleapis.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://commondatastorage.googleapis.com" />
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />

        {/* ── Critical CSS — inlined so users see a dark background + spinner
            within ~50ms of first byte. No FOUC, no white flash. The body
            background is the same #07060e as the reel feed so the transition
            into /discover feels seamless. */}
        <style dangerouslySetInnerHTML={{__html: `
          html,body{margin:0;padding:0;background:#07060e;color:#f0eee2;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
          body{overscroll-behavior:none;-webkit-tap-highlight-color:transparent}
          .sb-boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#07060e;z-index:0;pointer-events:none}
          .sb-boot-spinner{width:38px;height:38px;border-radius:50%;border:2px solid rgba(240,180,41,0.18);border-top-color:#f0b429;animation:sbSpin .8s linear infinite}
          @keyframes sbSpin{to{transform:rotate(360deg)}}
        `}} />

        {/* ── Mobile URL-bar collapse trick: scroll to 1px right after first
            paint so Android Chrome / Samsung Internet collapse the URL bar
            before the reel feed mounts. Runs synchronously to land in the
            same animation frame as paint. */}
        <script dangerouslySetInnerHTML={{__html: `
          (function(){
            try{
              // ── v90 theme bootstrap (no-FOUC) ─────────────────────────
              // Runs BEFORE first paint. Reads sb_theme from localStorage
              // (falls back to prefers-color-scheme on first visit) and
              // sets data-theme on <html> so the CSS variables in
              // globals.css are correctly resolved when the page paints.
              var t='light';
              try{
                var saved=localStorage.getItem('sb_theme');
                if(saved==='dark'||saved==='light'){t=saved;}
                else if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches){t='dark';}
              }catch(e){}
              document.documentElement.setAttribute('data-theme',t);
              // Theme-color meta — matches Android Chrome / iOS PWA chrome
              // to the current theme background so there's no white flash.
              var meta=document.querySelector('meta[name="theme-color"]');
              if(!meta){meta=document.createElement('meta');meta.setAttribute('name','theme-color');document.head.appendChild(meta);}
              meta.setAttribute('content',t==='dark'?'#0F0C08':'#FAF5EB');

              // Mark PWA mode so the reel pages can skip the body-lock dance
              if(window.matchMedia && (window.matchMedia('(display-mode:fullscreen)').matches || window.matchMedia('(display-mode:standalone)').matches)){
                document.documentElement.classList.add('sb-pwa');
              }
              // Collapse URL bar on mobile browsers (Android Chrome respects this).
              // iOS Safari ignores it for non-video, but the visualViewport-driven
              // --reel-vh in useReelFullscreen still pins the feed correctly.
              var collapse=function(){try{window.scrollTo(0,1);setTimeout(function(){if(window.scrollY<2)window.scrollTo(0,0);},50);}catch(e){}};
              if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',collapse);}else{collapse();}
              window.addEventListener('load',collapse);
            }catch(e){}
          })();
        `}} />
      </head>
      <body>
        <ThemeProvider>
        <AuthProvider>
         {/* v109 — single source of truth for "is this user a creator /
             hotel owner?". Lifts tier state out of per-component
             useAccountTier hooks into a shared context so the menu,
             /me drawer, /upgrade banner, and DialerNav all flip
             together the moment the user upgrades. Auto-refresh on
             storage / focus / sb:tier-refresh events keeps it in sync
             with logins happening in other tabs. */}
         <TierProvider>
          <SoundProvider>
           <FollowProvider>
            <PostsProvider>
            {/* v142 — Tutorial Layer 1 (Welcome Story) foundation.
                Provider exposes lang (en/hi), seen-flags, replay API.
                <WelcomeStory /> auto-fires 1.2s after first launch on
                customer pages (skips /admin /partner /onboard /auth).
                Phase 2 (per-page spotlight tours) + Phase 4 (help "?"
                button) will plug into the same provider. */}
            <TutorialProvider>
            <AutoNextMount />
            <ServerStatus />
            <Navbar />
            {/* Floating back chip — top-left, visible on every customer
                page that ISN'T the reel-app root (so the user always has
                an unambiguous way to return). Uses router.back(). */}
            <BackChip />
            {/* Instagram-style bottom dock — primary nav on every customer-
                facing page. Self-hides only on admin / partner / onboard.
                DialerNav (left-edge crown wheel) was retired in v80. */}
            <BottomDock />
            <main className="min-h-screen">{children}</main>
            {/* Global in-app toaster — subscribes to "sb:notify" events
                dispatched via lib/notifications.ts notify(). Used by
                AcceptedBidTimer + bid-status polling in My Bids. */}
            <NotificationToast />
            {/* v146 — Hybrid AI + agent support widget. Floating bubble,
                self-hides on admin/partner/onboard/auth + reel-app surfaces. */}
            <SupportWidget />
            {/* Welcome Story portal-mounted to document.body. */}
            <WelcomeStory />
            {/* v144 — Floating "?" help button (Tutorial Layer 3).
                Self-hides on /admin, /partner, /onboard, /auth.
                Hidden while any tour is running.
                Auto-shrinks + fades after 10+ tours seen. */}
            <TutorialHelpButton />
            {/* v144 — Global listener for imperative triggerTour() calls
                from modal/drawer handlers. Fires driver.js using the
                same polling logic as usePageTour. */}
            <TutorialTriggerMount />
            <div style={{position:"fixed",bottom:"68px",right:"6px",zIndex:9999,fontSize:"8px",padding:"1px 5px",borderRadius:"999px",background:"rgba(201,166,107,0.14)",color:"rgba(201,166,107,0.75)",border:"1px solid rgba(201,166,107,0.30)",pointerEvents:"none",fontFamily:"monospace",letterSpacing:"0.05em"}}>v150</div>
            </TutorialProvider>
            </PostsProvider>
           </FollowProvider>
          </SoundProvider>
         </TierProvider>
        </AuthProvider>
        </ThemeProvider>
              <script dangerouslySetInnerHTML={{__html: `
// ── Build version + service-worker bootstrap ──────────────────────────
// v93: removed the cache-nuke / SW-unregister / force-reload kill-switch.
// Previous behaviour wiped ALL caches and forced a hard reload on EVERY
// release bump, so every release punished returning users with a cold-
// start experience instead of the Instagram-fast warm cache. The natural
// SW lifecycle below (controllerchange + skipWaiting) already swaps in
// new code without trashing the static-asset cache.
//
// The SW URL no longer carries SB_BUILD — that was forcing a SW re-install
// on every release even when sw.js itself hadn't changed. Browsers check
// /sw.js for byte-level changes on each navigation, so if the file is
// identical the install is skipped → no reload, no cache wipe, no flicker.
var SB_BUILD="v150-support-widget-full-i18n-admin-full-page-chat";
try{ localStorage.setItem("sb_build",SB_BUILD); }catch(e){}
if("serviceWorker" in navigator){
  // Defer SW registration until after first paint so it doesn't compete
  // with the main thread during initial render. Falls back to a 1.5s
  // timeout if requestIdleCallback isn't supported (Safari).
  var registerSW=function(){
    navigator.serviceWorker.register("/sw.js").then(function(reg){
      try{ reg.update(); }catch(e){}
      var refreshing=false;
      navigator.serviceWorker.addEventListener("controllerchange",function(){
        // Only reload when the SW actually took control of a different
        // build — silent updates on identical sw.js content won't fire
        // controllerchange.
        if(refreshing)return; refreshing=true; window.location.reload();
      });
      if(reg.waiting)reg.waiting.postMessage("SKIP_WAITING");
      reg.addEventListener("updatefound",function(){
        var nw=reg.installing; if(!nw)return;
        nw.addEventListener("statechange",function(){
          if(nw.state==="installed" && navigator.serviceWorker.controller){
            nw.postMessage("SKIP_WAITING");
          }
        });
      });
    }).catch(function(){});
  };
  if("requestIdleCallback" in window){
    window.addEventListener("load",function(){requestIdleCallback(registerSW,{timeout:2000});});
  } else {
    window.addEventListener("load",function(){setTimeout(registerSW,1500);});
  }
}`}} />
      </body>
    </html>
  );
}

