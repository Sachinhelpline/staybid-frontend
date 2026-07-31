"use client";
// Upgrade landing page — single entry for Public users to apply to become
// a Creator (inline form) or a Hotel Partner (links to staybid-hotel-panel).
// All the heavy logic — tier probing, status banner, two-path cards, and
// the creator application form — lives in <UpgradeSection /> which is
// shared with /profile so both pages stay in sync.
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { UpgradeSection } from "@/components/upgrade/UpgradeSection";
// v139 — Phase-3 earn tour. 3 steps walk through Creator path + Hotel
// Partner path + how to apply. Uses data-tour="upgrade-{creator,hotel}"
// anchors injected on UpgradeCard.
import { usePageTour } from "@/lib/tutorial/usePageTour";

export default function UpgradePage() {
  const { user, loading: authLoading } = useAuth();
  // Only fire when user is signed in — UpgradeCard renders behind the
  // auth gate otherwise. usePageTour internally polls for the selector
  // so a brief delay during auth hydration is fine.
  usePageTour("earn", "earn", { delayMs: 1100, manual: !user });

  if (authLoading) {
    return (
      <div className="lux-bg upg-root min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="shimmer w-16 h-16 rounded-full mx-auto mb-3" />
          <p className="text-luxury-600 text-sm font-medium">Checking your account…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="lux-bg upg-root min-h-screen px-4 py-10">
        <div className="max-w-md mx-auto card-luxury sb-card-lift sb-fade-in p-6 text-center">
          <p className="text-3xl mb-2">🔒</p>
          <h1 className="font-display text-2xl font-bold text-luxury-900 mb-1">Sign in first</h1>
          <p className="text-luxury-500 text-sm mb-5">
            Upgrading your account starts with a verified phone number.
          </p>
          <Link
            href={`/auth?next=${encodeURIComponent("/upgrade")}`}
            className="btn-luxury inline-block px-6 py-3 rounded-xl font-bold"
          >
            Sign in to continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="lux-bg upg-root min-h-screen px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-6 sb-fade-in">
          <p className="text-gold-700 text-xs uppercase tracking-widest font-bold">Upgrade your StayBid</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-luxury-900 mt-1">
            How do you want to use StayBid?
          </h1>
          <p className="text-luxury-500 text-sm mt-2 max-w-lg mx-auto">
            Public accounts can browse and bid. Upgrade to <b>Creator</b> to earn commission on every booking
            you bring, or to <b>Hotel partner</b> to list your property and accept reverse-auction bids.
          </p>
          {/* Logged-in identity strip — phone the application will be
              filed against. So the user (and admin) always know who's
              applying. */}
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-luxury-100 border border-luxury-200 sb-card-lift">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[0.65rem] font-bold"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>
              {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
            </div>
            <span className="text-luxury-700 text-xs font-semibold">
              Signed in as {user.name || "Guest"} · {user.phone}
            </span>
          </div>
        </div>

        <UpgradeSection variant="full" />

        {/* Approval & KYC explainer */}
        <div className="card-luxury sb-card-lift p-5 mt-5 sb-fade-in" style={{ animationDelay: "0.15s" }}>
          <h3 className="font-bold text-luxury-900 mb-3 flex items-center gap-2">
            <span>🛡️</span> How approval works
          </h3>
          <ol className="text-luxury-700 text-sm space-y-2.5 pl-1 sb-stagger">
            <li><b>1. Submit application</b> — fill the form for the path you want (Creator or Hotel).</li>
            <li><b>2. KYC review</b> — admin verifies your identity (Aadhaar / PAN for creators · GST &amp; ID proof for hotels). Usually within 24 hours.</li>
            <li><b>3. Active</b> — your account flips to ACTIVE and the new dashboard, revenue and referral tools unlock.</li>
            <li><b>4. Block / Suspend</b> — if our trust &amp; safety team flags an issue, the account moves to BLOCKED. You'll see a notice with the reason and a way to appeal.</li>
          </ol>
        </div>

        <p className="text-center text-xs text-luxury-500 mt-5">
          Phone number stays private — it's only used for OTP login + payout verification, never shown to viewers.
        </p>
      </div>
    </div>
  );
}
