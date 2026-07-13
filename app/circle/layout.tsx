import type { ReactNode } from "react";
import { CircleDock } from "@/components/circle/CircleDock";
import { CircleTopbar, CircleFooter } from "@/components/circle/CircleChrome";
import "./circle-premium.css";

export const metadata = {
  title: "StayCircle™ — Build Wealth with Hospitality | StayBid Community Partner",
  description:
    "Discover. Lock. Invest. Earn. India's community partner platform for hospitality — lock handpicked properties, build your room bundle and earn expected monthly income from real bookings (never guaranteed).",
};

// StayCircle™ — the Community Partner Platform. Renders its own chrome
// (Navbar / DialerNav / ServerStatus / BottomDock all hide on /circle/**,
// same isolation contract as the /host vertical). The cream top bar + footer
// (CircleChrome) hide on the dark app-shell routes (/circle home, /discover
// reel, /dashboard) which render their own headers; the CircleDock 3-step
// wizard is mounted globally below.
export default function CircleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sbc min-h-screen">
      <CircleTopbar />
      <main>{children}</main>
      <CircleFooter />
      <CircleDock />
    </div>
  );
}
