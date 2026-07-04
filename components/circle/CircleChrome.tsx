"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CircleChrome — the cream top bar + footer for the /circle vertical (v293).
//
// These belong to the classic "content" pages (build · me · [id]). The dark
// app-shell routes render their own headers, so the cream chrome hides on:
//   /circle            (Hello, Investor home — its own greeting header)
//   /circle/discover   (immersive reel feed — full-bleed)
//   /circle/dashboard  (Airbnb-style hub — its own header)
// ═══════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { usePathname } from "next/navigation";

const HIDE = new Set(["/circle", "/circle/discover", "/circle/dashboard"]);
function isDark(pathname: string) {
  return HIDE.has(pathname) || pathname.startsWith("/circle/discover");
}

export function CircleTopbar() {
  const pathname = usePathname() || "/circle";
  if (isDark(pathname)) return null;
  return (
    <header className="sbc-topbar">
      <div className="sbc-topbar-inner">
        <Link href="/circle" className="sbc-brand">
          <span className="sbc-brand-mark">◎</span>
          <span className="sbc-brand-text">
            <span className="sbc-brand-name">Stay<em>Circle</em></span>
            <span className="sbc-brand-sub">Community Partner</span>
          </span>
        </Link>
        <nav className="sbc-topnav">
          <Link href="/circle" className="sbc-topnav-link">Home</Link>
          <Link href="/circle/discover" className="sbc-topnav-link">Discover</Link>
          <Link href="/circle/build" className="sbc-topnav-link">Build Bundle</Link>
          <Link href="/circle/me" className="sbc-topnav-link hidden sm:inline-flex">My Portfolio</Link>
          <Link href="/circle/dashboard" className="sbc-topnav-cta">Dashboard</Link>
        </nav>
      </div>
    </header>
  );
}

export function CircleFooter() {
  const pathname = usePathname() || "/circle";
  if (isDark(pathname)) return null;
  return (
    <footer className="sbc-footer">
      <div className="sbc-footer-inner">
        <div>
          <div className="sbc-footer-brand">Stay<em>Circle</em>™</div>
          <p>Own Hospitality. Earn More. Live Free. India&apos;s most trusted community partner platform for hospitality investment.</p>
        </div>
        <div>
          <div className="sbc-footer-h">Platform</div>
          <ul>
            <li><Link href="/circle/discover">Discover Properties</Link></li>
            <li><Link href="/circle/build">Build Your Bundle</Link></li>
            <li><Link href="/circle/me">Partner Dashboard</Link></li>
          </ul>
        </div>
        <div>
          <div className="sbc-footer-h">StayBid Family</div>
          <ul>
            <li><Link href="/">StayBid — Bid &amp; Book</Link></li>
            <li><Link href="/host">StayBid for Hosts</Link></li>
            <li><Link href="/partner">Hotel Partner Panel</Link></li>
          </ul>
        </div>
        <div>
          <div className="sbc-footer-h">Trust &amp; Safety</div>
          <ul>
            <li>✓ Verified &amp; legal properties</li>
            <li>✓ Transparent pricing — no hidden charges</li>
            <li>✓ Secure Razorpay payments</li>
            <li>✓ Expert end-to-end support</li>
          </ul>
        </div>
      </div>
      <div className="sbc-footer-bar">
        Returns shown are indicative projections based on property performance bands — not guaranteed. © StayBid.
      </div>
    </footer>
  );
}
