"use client";
// Upgrade landing page — the single entry point for Public users to upgrade
// to a Creator (in-app application form, submitted to /api/influencer/register)
// or to a Hotel Partner (links out to the staybid-hotel-panel deployment).
//
// Tier states detected on load:
//   PUBLIC          — can apply to either path. Inline creator form right here.
//   PENDING_CREATOR — application under admin review.
//   CREATOR         — approved, "Open Creator Dashboard →" CTA.
//   HOTEL           — approved hotel partner, "Open Hotel Dashboard →" CTA.
//   BLOCKED         — read-only "support" notice.
//
// Why inline the creator form here instead of routing to /influencer/register:
// the user kept landing on the Creator Hub layout (different chrome) which
// felt like leaving the upgrade flow + occasionally hit a token / hydration
// issue that left the form unsubmitted. Same form logic, but mounted on the
// /upgrade page so the user never leaves the upgrade context.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

type Tier = "PUBLIC" | "PENDING_CREATOR" | "CREATOR" | "HOTEL" | "BLOCKED" | "UNKNOWN";

const HOTEL_PANEL_URL = "https://staybid-hotel-panel.vercel.app";

const INTEREST_OPTIONS = [
  "Luxury Stays", "Adventure", "Wellness", "Family", "Honeymoon",
  "Foodie", "Solo Travel", "Mountain", "Beach", "Heritage",
];

export default function UpgradePage() {
  const { user, loading: authLoading } = useAuth();
  const [tier, setTier] = useState<Tier>("UNKNOWN");
  const [influencer, setInfluencer] = useState<any>(null);
  const [hotelOwned, setHotelOwned] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creatorFormOpen, setCreatorFormOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); setTier("PUBLIC"); return; }
    let cancelled = false;
    (async () => {
      let detected: Tier = "PUBLIC";
      // 1. Creator (influencer) check
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

  // Re-fetch tier after a successful creator submission so the banner flips
  // from PUBLIC → PENDING_CREATOR without a manual reload.
  const refreshTier = async () => {
    try {
      const inf = await api.getMyInfluencer();
      if (inf?.registered && inf?.influencer) {
        setInfluencer(inf.influencer);
        const status = String(inf.influencer.status || "").toUpperCase();
        if (status === "BLOCKED") setTier("BLOCKED");
        else if (status === "PENDING") setTier("PENDING_CREATOR");
        else setTier("CREATOR");
      }
    } catch {}
  };

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
          {/* Logged-in identity strip — also shows the phone the application
              will be filed against, so the user knows admin will see this. */}
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-luxury-100 border border-luxury-200">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[0.65rem] font-bold"
              style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
              {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
            </div>
            <span className="text-luxury-700 text-xs font-semibold">
              Signed in as {user.name || "Guest"} · {user.phone}
            </span>
          </div>
        </div>

        {/* Current status banner */}
        <StatusBanner tier={tier} influencer={influencer} hotelOwned={hotelOwned} />

        {/* Two paths */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <UpgradeCard
            kind="creator"
            tier={tier}
            onAction={() => setCreatorFormOpen((v) => !v)}
            ctaLabelOverride={creatorFormOpen ? "Hide application form" : undefined}
          />
          <UpgradeCard
            kind="hotel"
            tier={tier}
            onAction={() => {
              if (typeof window !== "undefined") window.open(HOTEL_PANEL_URL, "_blank", "noopener,noreferrer");
            }}
          />
        </div>

        {/* Inline creator application — only renders for PUBLIC users who tap
            "Apply as a Creator". Pending / Active / Blocked users skip this. */}
        {tier === "PUBLIC" && creatorFormOpen && (
          <CreatorApplicationForm
            phone={user.phone}
            displayName={user.name || ""}
            onSuccess={() => {
              setCreatorFormOpen(false);
              refreshTier();
            }}
          />
        )}

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
        className="rounded-xl p-4 flex items-center gap-3 flex-wrap"
        style={{ background: "linear-gradient(135deg, rgba(46,204,113,0.10), rgba(91,141,255,0.06))", border: "1px solid rgba(46,204,113,0.45)" }}
      >
        <span className="text-2xl">✨</span>
        <div className="flex-1 min-w-[180px]">
          <p className="font-bold text-luxury-900 text-sm">You're an active Creator</p>
          <p className="text-luxury-600 text-xs">
            12% commission on every booking you bring · {influencer?.total_followers?.toLocaleString?.("en-IN") || "—"} declared followers.
          </p>
        </div>
        {/* Mirror the Hotel partner CTA — every active tier gets a clear
            "open my dashboard" path right here on /upgrade. */}
        <Link href="/influencer/dashboard" className="btn-luxury px-4 py-2 rounded-xl font-bold text-sm">
          Open Creator Dashboard →
        </Link>
      </div>
    );
  }
  if (tier === "HOTEL") {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3 flex-wrap"
        style={{ background: "linear-gradient(135deg, rgba(46,204,113,0.10), rgba(91,141,255,0.06))", border: "1px solid rgba(46,204,113,0.45)" }}
      >
        <span className="text-2xl">🏨</span>
        <div className="flex-1 min-w-[180px]">
          <p className="font-bold text-luxury-900 text-sm">You're an active Hotel partner</p>
          <p className="text-luxury-600 text-xs">{hotelOwned?.name || "Your hotel"} · {hotelOwned?.city || ""}</p>
        </div>
        <a
          href={HOTEL_PANEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-luxury px-4 py-2 rounded-xl font-bold text-sm"
        >
          Open Hotel Dashboard ↗
        </a>
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
  kind, tier, onAction, ctaLabelOverride,
}: {
  kind: "creator" | "hotel";
  tier: Tier;
  onAction: () => void;
  ctaLabelOverride?: string;
}) {
  const isCreator = kind === "creator";
  const config = isCreator ? CREATOR_COPY : HOTEL_COPY;
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
          : (ctaLabelOverride || config.cta)}
      </button>
      <p className="text-luxury-500 text-[0.7rem] text-center mt-2">{config.kyc}</p>
    </div>
  );
}

// ─── Inline creator application form ────────────────────────────────────
// Submits straight to /api/influencer/register (same endpoint the old
// /influencer/register page used). Lives on /upgrade so the user never
// leaves the upgrade flow.
function CreatorApplicationForm({
  phone, displayName, onSuccess,
}: {
  phone: string;
  displayName: string;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [followers, setFollowers] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  const toggleInterest = (i: string) =>
    setInterests((prev) => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!agreementAccepted) {
      setError("Please accept the creator agreement to continue.");
      return;
    }
    if (!bio.trim()) {
      setError("A short bio helps us approve you faster.");
      return;
    }
    setSubmitting(true);
    try {
      await api.registerInfluencer({
        bio,
        location,
        totalFollowers: Number(followers) || 0,
        interests,
        bankName,
        bankAccountNumber,
        ifscCode,
        agreementAccepted,
      });
      onSuccess();
    } catch (err: any) {
      // Surface the real backend message so the user knows what to fix.
      // Earlier "registration silently failed" reports almost always traced
      // back to an invalid token (Firebase login) or RLS reject.
      setError(err?.message || "Couldn't submit your application. Please retry, or sign out and back in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 mt-5">
      <div className="card-luxury p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-xl font-bold text-luxury-900">Creator application</h3>
          <span className="text-[0.62rem] uppercase tracking-widest font-bold text-gold-700">Step 1 of 1</span>
        </div>

        {/* Identity strip — phone is the auth identity, never editable here.
            Stops the "no mobile number" confusion and reassures the user
            admin will see who's applying. */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="px-3 py-2 rounded-xl bg-luxury-50 border border-luxury-200">
            <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500">Mobile number</p>
            <p className="text-sm font-bold text-luxury-800 mt-0.5">{phone || "—"}</p>
          </div>
          <div className="px-3 py-2 rounded-xl bg-luxury-50 border border-luxury-200">
            <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500">Account name</p>
            <p className="text-sm font-bold text-luxury-800 mt-0.5">{displayName || "Guest"}</p>
          </div>
        </div>

        <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Short Bio *</label>
        <textarea
          value={bio} onChange={(e) => setBio(e.target.value)}
          rows={3} maxLength={400}
          placeholder="Travel content, hospitality reviews, lifestyle…"
          className="input-luxury w-full mb-3"
          required
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Primary City</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Mussoorie" className="input-luxury w-full" />
          </div>
          <div>
            <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Total Followers (across platforms)</label>
            <input value={followers} onChange={(e) => setFollowers(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric" placeholder="e.g. 12500" className="input-luxury w-full" />
          </div>
        </div>

        <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Your Interests</label>
        <div className="flex flex-wrap gap-1.5 mb-1">
          {INTEREST_OPTIONS.map((i) => {
            const on = interests.includes(i);
            return (
              <button key={i} type="button" onClick={() => toggleInterest(i)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  on ? "bg-gold-500 text-white border-gold-600" : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
                }`}>
                {i}
              </button>
            );
          })}
        </div>
        <p className="text-luxury-500 text-[0.65rem] mt-2">We use these to surface relevant hotels and campaigns.</p>
      </div>

      <div className="card-luxury p-5">
        <h3 className="font-bold text-luxury-900 mb-1">Payout Bank Details</h3>
        <p className="text-luxury-500 text-xs mb-3">Optional now — required before your first payout. Stored encrypted.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={bankName} onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name" className="input-luxury w-full" />
          <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric" placeholder="Account number" className="input-luxury w-full" />
          <input value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
            placeholder="IFSC" className="input-luxury w-full" />
        </div>
      </div>

      <div className="card-luxury p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={agreementAccepted}
            onChange={(e) => setAgreementAccepted(e.target.checked)}
            className="mt-1 w-5 h-5 accent-gold-600" />
          <span className="text-sm text-luxury-700">
            I agree to the StayBid <span className="font-semibold text-gold-700">Creator Agreement</span> — 12% commission on bookings attributed to me, payable monthly after a 14-day return window. KYC (Aadhaar + PAN) required before payout.
          </span>
        </label>
      </div>

      {error && (
        <div className="card-luxury p-4 border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button type="submit" disabled={submitting}
        className="btn-luxury w-full py-3.5 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting ? "Submitting your application…" : "Submit Creator Application"}
      </button>
      <p className="text-center text-luxury-500 text-[0.7rem]">
        Application reviews finish within 24 hours. You'll see "Under Review" here once submitted.
      </p>
    </form>
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
