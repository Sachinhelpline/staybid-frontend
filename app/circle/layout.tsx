import type { ReactNode } from "react";
import Link from "next/link";
import "./circle-premium.css";

export const metadata = {
  title: "StayCircle™ — Build Wealth with Hospitality | StayBid Community Partner",
  description:
    "Discover. Lock. Invest. Earn. India's community partner platform for hospitality — lock handpicked properties, build your room bundle and earn monthly returns.",
};

// StayCircle™ — the Community Partner Platform. Renders its own chrome
// (Navbar / DialerNav / ServerStatus / BottomDock all hide on /circle/**,
// same isolation contract as the /host vertical).
export default function CircleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sbc min-h-screen">
      <header className="sbc-topbar">
        <div className="sbc-topbar-inner">
          <Link href="/circle" className="sbc-brand">
            <span className="sbc-brand-mark">◎</span>
            <span className="sbc-brand-text">
              <span className="sbc-brand-name">
                Stay<em>Circle</em>
              </span>
              <span className="sbc-brand-sub">Community Partner</span>
            </span>
          </Link>
          <nav className="sbc-topnav">
            <Link href="/circle" className="sbc-topnav-link">Discover</Link>
            <Link href="/circle/build" className="sbc-topnav-link">Build Bundle</Link>
            <Link href="/circle/me" className="sbc-topnav-link hidden sm:inline-flex">My Portfolio</Link>
            <Link href="/" className="sbc-topnav-link hidden md:inline-flex">StayBid ↗</Link>
            <Link href="/circle/build" className="sbc-topnav-cta">Start Investing</Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="sbc-footer">
        <div className="sbc-footer-inner">
          <div>
            <div className="sbc-footer-brand">Stay<em>Circle</em>™</div>
            <p>Own Hospitality. Earn More. Live Free. India&apos;s most trusted community partner platform for hospitality investment.</p>
          </div>
          <div>
            <div className="sbc-footer-h">Platform</div>
            <ul>
              <li><Link href="/circle">Discover Properties</Link></li>
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
    </div>
  );
}
