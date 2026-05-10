"use client";
// Upgrade landing page — single entry for Public users to apply to become
// either a Creator or a Hotel Partner. Both paths route into existing
// onboarding flows (`/influencer/register` and `/hotel-partner`) so we
// don't duplicate any backend work; this page just makes the choice
// discoverable + explains the perks/KYC/approval flow upfront.
//
// Account states are read from /api/proxy/api/auth/me + getMyInfluencer():
//   PUBLIC          — can apply to either path
//   PENDING_CREATOR — application under admin review
//   CREATOR         — approved, links to /influencer/dashboard
//   HOTEL           — approved hotel partner, links to /hotel-partner
//   BLOCKED         — read-only "support" CTA
//
// Admin-side approval (PENDING → ACTIVE / BLOCKED) lives at /admin/users
// (or a dedicated /admin/upgrades page once that's built).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

type Tier = "PUBLIC" | "PENDING_CREATOR" | "CREATOR" | "HOTEL" | "BLOCKED" | "UNKNOWN";

export default function UpgradePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tier, setTier] = useState<Tier>("UNKNOWN");
  const [influencer, setInfluencer] = useState<any>(null);
  const [hotelOwned, setHotelOwned] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); setTier("PUBLIC"); return; }
    let cancelled = false;
    (async () => {
      let detected: Tier = "PUBLIC";
      // 1. Influencer registration check
      try {
        const inf = await api.getMyInfluencer();
        if (inf?.registered && inf?.influencer) {
          if (!cancelled) setInfluencer(inf.influencer);
          const status = String(inf.influencer.status || "").toUpperCase();
          if (status === "BLOCKED") detected = "BLOCKED";
          else if (status === "PENDING") detected = "PENDING_CREATOR";
          else detected = "CREATOR";
        }
      } catch {}
      // 2. Hotel partner check (only if not already a creator)
      if (detected === "PUBLIC") {
        try {
          const tok = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") : null;
          if (tok) {
            const r = await fetch("/api/partner/hotel", { headers: { Authorization: `Bearer ${tok}` } });
            if (r.ok) {
              const data = await r.json();
              if (data?.hotel) {
                if (!cancelled) setHotelOwned(data.hotel);
                detected = "HOTEL";
              }
            }
          }
        } catch {}
      }
      if (!cancelled) { setTier(detected); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-luxury-50">
        <div className="text-center">
          <div className="shimmer w-16 h-16 rounded-full mx-auto mb-3" />
          <p className="text-luxury-600 text-sm font-medium">Checking your account…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50 px-4 py-10">
        <div className="max-w-md mx-auto card-luxury p-6 text-center">
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
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-6">
          <p className="text-gold-700 text-xs uppercase tracking-widest font-bold">Upgrade your StayBid</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-luxury-900 mt-1">
            How do you want to use StayBid?
          </h1>
          <p className="text-luxury-500 text-sm mt-2 max-w-lg mx-auto">
            Public accounts can browse and bid. Upgrade to <b>Creator</b> to earn commission on every booking
            you bring, or to <b>Hotel partner</b> to list your property and accept reverse-auction bids.
          </p>
        </div>

        {/* Current status banner */}
        <StatusBanner tier={tier} influencer={influencer} hotelOwned={hotelOwned} />

        {/* Two paths */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <UpgradeCard
            kind="creator"
            tier={tier}
            onAction={() => router.push("/influencer/register")}
          />
          <UpgradeCard
            kind="hotel"
            tier={tier}
            onAction={() => router.push("/hotel-partner")}
          />
        </div>

        {/* Approval & KYC explainer */}
        <div className="card-luxury p-5 mt-5">
          <h3 className="font-bold text-luxury-900 mb-3 flex items-center gap-2">
            <span>🛡️</span> How approval works
          </h3>
          <ol className="text-luxury-700 text-sm space-y-2.5 pl-1">
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

// ─── Status banner — shows the user's current account state at a glance ──
function StatusBanner({ tier, influencer, hotelOwned }: { tier: Tier; influencer: any; hotelOwned: any }) {
  if (tier === "PUBLIC") {
    return (
      <div className="card-luxury p-4 flex items-center gap-3">
        <span className="text-2xl">👋</span>
        <div className="flex-1">
          <p className="font-bold text-luxury-900 text-sm">You're on the Public tier</p>
          <p className="text-luxury-500 text-xs">Browse hotels, place bids, post reels. Pick a path below to unlock more.</p>
        </div>
      </div>
    );
  }
  if (tier === "PENDING_CREATOR") {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: "linear-gradient(135deg, rgba(240,180,41,0.12), rgba(255,69,141,0.08))", border: "1px solid rgba(240,180,41,0.45)" }}
      >
        <span className="text-2xl">⏳</span>
        <div className="flex-1">
          <p className="font-bold text-luxury-900 text-sm">Creator application under review</p>
          <p className="text-luxury-600 text-xs">
            Submitted on {influencer?.created_at ? new Date(influencer.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}.
            Most reviews finish within 24 hours.
          </p>
        </div>
      </div>
    );
  }
  if (tier === "CREATOR") {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: "linear-gradient(135deg, rgba(46,204,113,0.10), rgba(91,141,255,0.06))", border: "1px solid rgba(46,204,113,0.45)" }}
      >
        <span className="text-2xl">✨</span>
        <div className="flex-1">
          <p className="font-bold text-luxury-900 text-sm">You're an active Creator</p>
          <p className="text-luxury-600 text-xs">
            12% commission on every booking you bring · {influencer?.total_followers?.toLocaleString?.("en-IN") || "—"} declared followers.
          </p>
        </div>
        <Link href="/influencer/dashboard" className="btn-luxury px-4 py-2 rounded-xl font-bold text-sm">
          Open hub →
        </Link>
      </div>
    );
  }
  if (tier === "HOTEL") {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: "linear-gradient(135deg, rgba(46,204,113,0.10), rgba(91,141,255,0.06))", border: "1px solid rgba(46,204,113,0.45)" }}
      >
        <span className="text-2xl">🏨</span>
        <div className="flex-1">
          <p className="font-bold text-luxury-900 text-sm">You're an active Hotel partner</p>
          <p className="text-luxury-600 text-xs">{hotelOwned?.name || "Your hotel"} · {hotelOwned?.city || ""}</p>
        </div>
        <Link href="/hotel-partner" className="btn-luxury px-4 py-2 rounded-xl font-bold text-sm">
          Open dashboard →
        </Link>
      </div>
    );
  }
  if (tier === "BLOCKED") {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.45)" }}
      >
        <span className="text-2xl">🚫</span>
        <div className="flex-1">
          <p className="font-bold text-red-700 text-sm">Account blocked</p>
          <p className="text-red-600 text-xs">
            Our trust &amp; safety team has paused this account. Reach out via support to appeal.
          </p>
        </div>
      </div>
    );
  }
  return null;
}

// ─── One of the two upgrade cards ──────────────────────────────────────
function UpgradeCard({
  kind, tier, onAction,
}: {
  kind: "creator" | "hotel";
  tier: Tier;
  onAction: () => void;
}) {
  const isCreator = kind === "creator";
  const config = isCreator ? CREATOR_COPY : HOTEL_COPY;
  // Disable the path that the user already pursued.
  const alreadyMine = (isCreator && (tier === "CREATOR" || tier === "PENDING_CREATOR")) || (!isCreator && tier === "HOTEL");
  const blocked = tier === "BLOCKED";

  return (
    <div
      className="card-luxury p-5 flex flex-col"
      style={{
        background: alreadyMine
          ? "linear-gradient(180deg, rgba(46,204,113,0.06), white)"
          : undefined,
        border: alreadyMine ? "1.5px solid rgba(46,204,113,0.45)" : undefined,
      }}
    >
      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
          style={{ background: config.gradient, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45)" }}
        >
          {config.emoji}
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest font-bold text-luxury-500">{config.tag}</p>
          <h3 className="font-display text-xl font-bold text-luxury-900 leading-tight">{config.title}</h3>
        </div>
      </div>

      <p className="text-luxury-600 text-sm leading-snug mb-3">{config.subtitle}</p>

      <ul className="text-luxury-700 text-sm space-y-1.5 mb-4">
        {config.perks.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <span className="text-emerald-600 mt-0.5">✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onAction}
        disabled={blocked || alreadyMine}
        className="btn-luxury py-2.5 rounded-xl font-bold mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {alreadyMine
          ? (tier === "PENDING_CREATOR" ? "⏳ Application submitted" : "✓ Already active")
          : config.cta}
      </button>
      <p className="text-luxury-500 text-[0.7rem] text-center mt-2">{config.kyc}</p>
    </div>
  );
}

const CREATOR_COPY = {
  emoji: "✨",
  tag: "Path 1",
  title: "Become a Creator",
  subtitle: "Earn commission for every booking you bring. Post reels, share your link, get paid monthly.",
  perks: [
    "12% commission on every booking attributed to you",
    "Personal referral link + analytics dashboard",
    "Reels uploads with creator badge ✓",
    "Tier-up to 15% as Elite once you cross 100 verified bookings",
    "Monthly payouts after a 14-day return window",
  ],
  cta: "Apply as a Creator",
  kyc: "KYC: Aadhaar + PAN. Reviewed within 24 hours.",
  gradient: "linear-gradient(135deg,#ff458d,#b964ff)",
};

const HOTEL_COPY = {
  emoji: "🏨",
  tag: "Path 2",
  title: "List your Hotel",
  subtitle: "Add your property to StayBid's reverse-auction marketplace. Set floor prices, accept bids in real time.",
  perks: [
    "AI-priced rooms recalculated every 60s",
    "Live bid inbox — accept / counter / reject",
    "Flash deal scheduling + booking funnel",
    "Earnings dashboard with daily / monthly views",
    "Direct chat with confirmed guests",
  ],
  cta: "Apply as a Hotel",
  kyc: "KYC: GST + property ownership proof. Reviewed within 24 hours.",
  gradient: "linear-gradient(135deg,#ffd76b,#f0b429)",
};
