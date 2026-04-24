import "./globals.css";
import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth";
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
          <ServerStatus />
          <Navbar />
          <main className="min-h-screen">{children}</main>
        </AuthProvider>
              <script dangerouslySetInnerHTML={{__html: `
if("serviceWorker" in navigator){
  window.addEventListener("load",function(){
    navigator.serviceWorker.register("/sw.js").then(function(reg){
      // Force check for new SW on every load
      reg.update();
      // When a new SW takes control, reload the page so the user sees the latest build
      var refreshing=false;
      navigator.serviceWorker.addEventListener("controllerchange",function(){
        if(refreshing)return; refreshing=true; window.location.reload();
      });
      // If there's a waiting SW, tell it to activate immediately
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
  });
}`}} />
      </body>
    </html>
  );
}

