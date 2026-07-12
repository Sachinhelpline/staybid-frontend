import type { ReactNode } from "react";
import Link from "next/link";
import SwitchExperienceButton from "@/components/SwitchExperienceButton";
import "./host-premium.css";

export const metadata = {
  title: "StayBid for Hosts — Build. Launch. Manage. Grow.",
  description:
    "Your complete hospitality business partner. AI setup studio, furniture store, property discovery, on-demand workforce and channel manager — one powerful platform.",
};

export default function HostLayout({ children }: { children: ReactNode }) {
  return (
    <div className="hostos min-h-screen" style={{ background: "var(--bg-page)", color: "var(--text-base)" }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--bg-page) 82%, transparent)", borderBottom: "1px solid var(--border-soft)" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/host" className="flex items-center gap-2.5">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow"
              style={{ background: "linear-gradient(135deg,#c9911a,#8a6a14)" }}
            >S</span>
            <span className="leading-tight">
              <span className="block font-display text-lg sm:text-xl" style={{ color: "var(--text-base)" }}>
                Stay<span style={{ color: "var(--accent)" }}>Bid</span>
              </span>
              <span className="block text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                for Hosts
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2 text-sm">
            <Link href="/host/store" className="hidden md:inline px-3 py-2 rounded-full hover:opacity-80" style={{ color: "var(--text-soft)" }}>Store</Link>
            <Link href="/host/workforce" className="hidden md:inline px-3 py-2 rounded-full hover:opacity-80" style={{ color: "var(--text-soft)" }}>Workforce</Link>
            <Link href="/host/properties" className="hidden lg:inline px-3 py-2 rounded-full hover:opacity-80" style={{ color: "var(--text-soft)" }}>Properties</Link>
            <Link href="/partner" className="hidden sm:inline px-3 py-2 rounded-full hover:opacity-80" style={{ color: "var(--text-soft)" }}>Host login</Link>
            <SwitchExperienceButton
              className="hidden lg:inline px-3 py-2 rounded-full hover:opacity-80"
              style={{ color: "var(--text-soft)" }}
              label="Switch"
            />
            <Link
              href="/onboard"
              className="px-4 py-2 rounded-full text-white font-medium shadow"
              style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}
            >List your property</Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer style={{ borderTop: "1px solid var(--border-soft)" }}>
        <div className="max-w-7xl mx-auto px-6 py-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="font-display text-xl mb-2" style={{ color: "var(--text-base)" }}>StayBid <span style={{ color: "var(--accent)" }}>for Hosts</span></div>
            <p style={{ color: "var(--text-muted)" }}>Your growth partner in hospitality. Build, launch, manage & grow your stay business — all in one place.</p>
          </div>
          <div>
            <div className="font-semibold mb-2">Platform</div>
            <ul className="space-y-1.5" style={{ color: "var(--text-muted)" }}>
              <li><Link href="/host/studio" className="hover:opacity-80">AI Design Studio</Link></li>
              <li><Link href="/host/store" className="hover:opacity-80">StayBid Store</Link></li>
              <li><Link href="/host/properties" className="hover:opacity-80">Property Discovery</Link></li>
              <li><Link href="/host/workforce" className="hover:opacity-80">Workforce on Demand</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Hosts</div>
            <ul className="space-y-1.5" style={{ color: "var(--text-muted)" }}>
              <li><Link href="/onboard" className="hover:opacity-80">List your property</Link></li>
              <li><Link href="/partner" className="hover:opacity-80">Host dashboard</Link></li>
              <li><Link href="/host/channels" className="hover:opacity-80">Channel manager</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">StayBid</div>
            <ul className="space-y-1.5" style={{ color: "var(--text-muted)" }}>
              <li><a href="https://staybids.in" className="hover:opacity-80">staybids.in</a></li>
              <li><Link href="/" className="hover:opacity-80">Book a stay</Link></li>
            </ul>
          </div>
        </div>
        <div className="text-center text-xs py-5" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-soft)" }}>
          © 2026 StayBid · Your most trusted hospitality business partner
        </div>
      </footer>
    </div>
  );
}
