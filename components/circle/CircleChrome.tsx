"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CircleChrome — the top bar + footer for the /circle vertical.
//
// v294.4 — DESKTOP SHELL. The vertical was mobile-first: on the dark app-shell
// routes (home · reel · dashboard) the topbar returned null, so DESKTOP showed
// only the mobile bottom dock ("navbar bottom mein show ho raha hai jabki
// header mein hona chahiye"). Now the topbar ALWAYS renders; on the dark routes
// it carries the `.sbc-topbar--dark` glass variant which is:
//   • hidden on mobile   (<1024px — the CircleDock owns nav there, unchanged)
//   • shown on desktop   (≥1024px — a proper top header, the dock is CSS-hidden)
// Light "content" routes (build · me · [id]) keep the cream topbar exactly as
// before, on every width. The footer still hides on the dark app-shell routes.
// ═══════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { usePathname } from "next/navigation";

// Dark app-shell routes carry the dark glass topbar (desktop) + no footer.
// v294.15 — the dashboard is now a LIGHT cream + sage "account" surface (ss3
// premium-cozy), so it leaves the DARK set: its desktop topbar becomes the
// cream `.sbc-topbar` (consistent with the cream page beneath it). It stays in
// NO_FOOTER because the account hub is app-like — no website footer under it.
const DARK = new Set(["/circle", "/circle/discover"]);
function isDark(pathname: string) {
  return DARK.has(pathname) || pathname.startsWith("/circle/discover");
}
const NO_FOOTER = new Set(["/circle", "/circle/discover", "/circle/dashboard", "/circle/profile"]);
function hideFooter(pathname: string) {
  return NO_FOOTER.has(pathname) || pathname.startsWith("/circle/discover");
}

export function CircleTopbar() {
  const pathname = usePathname() || "/circle";
  const dark = isDark(pathname);
  const active = (href: string) =>
    href === "/circle" ? pathname === "/circle" : pathname.startsWith(href);
  return (
    <header className={`sbc-topbar${dark ? " sbc-topbar--dark" : ""}`}>
      <div className="sbc-topbar-inner">
        <Link href="/circle" className="sbc-brand">
          <span className="sbc-brand-mark">◎</span>
          <span className="sbc-brand-text">
            <span className="sbc-brand-name">Stay<em>Circle</em></span>
            <span className="sbc-brand-sub">Community Partner</span>
          </span>
        </Link>
        <nav className="sbc-topnav">
          <Link href="/circle" className={`sbc-topnav-link${active("/circle") ? " on" : ""}`}>Home</Link>
          <Link href="/circle/discover" className={`sbc-topnav-link${active("/circle/discover") ? " on" : ""}`}>Discover</Link>
          {/* Journey step 2 — surfaces the room-select flow from the header
              (Sachin: "header nav main kahi bhi rooms button nahi hai"). Shares
              the /circle/discover path so it carries no active-state of its own. */}
          <Link href="/circle/discover?rooms=1" className="sbc-topnav-link hidden sm:inline-flex">Rooms</Link>
          <Link href="/circle/build" className={`sbc-topnav-link${active("/circle/build") ? " on" : ""}`}>Build Bundle</Link>
          <Link href="/circle/me" className={`sbc-topnav-link hidden sm:inline-flex${active("/circle/me") ? " on" : ""}`}>My Portfolio</Link>
          <Link href="/circle/dashboard" className="sbc-topnav-cta">Dashboard</Link>
        </nav>
      </div>
    </header>
  );
}

export function CircleFooter() {
  const pathname = usePathname() || "/circle";
  if (hideFooter(pathname)) return null;
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
