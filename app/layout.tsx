import "./globals.css";
import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth";
import { SoundProvider } from "@/lib/sound-store";
import { FollowProvider } from "@/lib/follow-store";
import { PostsProvider } from "@/lib/posts-store";
import { Navbar } from "@/components/Navbar";
import { ServerStatus } from "@/components/ServerStatus";
export const viewport: Viewport = {
  themeColor: '#0a0f23',
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
      <body>
        <AuthProvider>
          <SoundProvider>
           <FollowProvider>
            <PostsProvider>
            <ServerStatus />
            <Navbar />
            <main className="min-h-screen">{children}</main>
            <div style={{position:"fixed",bottom:"4px",right:"6px",zIndex:9999,fontSize:"8px",padding:"1px 5px",borderRadius:"999px",background:"rgba(240,180,41,0.12)",color:"rgba(240,180,41,0.7)",border:"1px solid rgba(240,180,41,0.25)",pointerEvents:"none",fontFamily:"monospace",letterSpacing:"0.05em"}}>v56</div>
            </PostsProvider>
           </FollowProvider>
          </SoundProvider>
        </AuthProvider>
              <script dangerouslySetInnerHTML={{__html: `
// ── Build version + service-worker bootstrap ──────────────────────────
// Tuned for cold-start speed: SW registers AFTER first paint (requestIdle
// or 1.5s timeout), version-mismatch reload happens only when actually
// needed (not on every fresh visit). The SW itself uses network-first for
// HTML so users instantly see new code without a forced reload.
var SB_BUILD="v56-perf-fullscreen-2026-05-11";
try{
  var prev=localStorage.getItem("sb_build");
  if(prev && prev!==SB_BUILD){
    // Only force-reload when we have a STALE prev (not a first visit).
    // First visits don't need a reload — the SW will install + take over
    // on its own and the page is already current.
    localStorage.setItem("sb_build",SB_BUILD);
    if("caches" in window){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});}
    if("serviceWorker" in navigator){
      navigator.serviceWorker.getRegistrations().then(function(rs){
        rs.forEach(function(r){r.unregister();});
        setTimeout(function(){window.location.reload();},150);
      });
    }
  } else if(!prev){
    localStorage.setItem("sb_build",SB_BUILD);
  }
}catch(e){}
if("serviceWorker" in navigator){
  // Defer SW registration until after first paint so it doesn't compete
  // with the main thread during initial render. Falls back to a 1.5s
  // timeout if requestIdleCallback isn't supported (Safari).
  var registerSW=function(){
    navigator.serviceWorker.register("/sw.js?v="+SB_BUILD).then(function(reg){
      reg.update();
      var refreshing=false;
      navigator.serviceWorker.addEventListener("controllerchange",function(){
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

