"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";

const TIER_META: Record<string, { color: string; min: number; max: number }> = {
  silver:   { color: "#94a3b8", min: 0,     max: 9999  },
  gold:     { color: "#c9911a", min: 10000, max: 49999 },
  platinum: { color: "#7c3aed", min: 50000, max: Infinity },
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

export default function PointsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [wallet, setWallet] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [activeCodesCount, setActiveCodesCount] = useState(0);
  const [walletCreditBalance, setWalletCreditBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    Promise.all([
      api.getPoints().catch(() => ({ wallet: null, recent: [] })),
      api.getMyRedemptionCodes("active").catch(() => ({ codes: [], walletCredit: null })),
    ]).then(([p, c]) => {
      setWallet(p?.wallet || null);
      setRecent(p?.recent || []);
      setActiveCodesCount((c?.codes || []).length);
      setWalletCreditBalance(Number(c?.walletCredit?.balance_inr || 0));
    }).finally(() => setLoading(false));
  }, [authLoading, user, router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50">
      <p className="text-luxury-500 text-sm">Loading…</p>
    </div>;
  }

  const tierKey = (wallet?.tier as string) || "silver";
  const tier = TIER_META[tierKey] || TIER_META.silver;
  const balance = wallet?.balance || 0;
  const nextTier = tierKey === "silver" ? TIER_META.gold : tierKey === "gold" ? TIER_META.platinum : null;
  const progress = nextTier ? Math.min(100, ((balance - tier.min) / (nextTier.min - tier.min)) * 100) : 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-luxury-900 mb-1">Loyalty Points</h1>
        <p className="text-luxury-500 text-sm mb-5">Earned on every booking. Redeem for discounts.</p>

        <div className="card-luxury sb-card-lift sb-fade-in p-6 mb-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10"
            style={{ background: `radial-gradient(circle, ${tier.color}, transparent 70%)` }} />
          <div className="relative">
            <p className="text-xs uppercase tracking-widest font-bold text-luxury-500">Balance</p>
            <p className="font-display text-5xl font-bold text-luxury-900 leading-none mt-1">
              <CountUp value={balance} duration={1100} />
            </p>
            <p className="text-xs uppercase tracking-widest font-bold mt-3 inline-flex items-center gap-1.5" style={{ color: tier.color }}>
              <span className="sb-pulse-dot" style={{ background: tier.color, boxShadow: `0 0 0 0 ${tier.color}55` }} />
              {tierKey} Tier
            </p>

            {nextTier && (
              <div className="mt-4">
                <div className="w-full h-2 bg-luxury-100 rounded-full overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${tier.color}, ${nextTier.color})` }} />
                </div>
                <p className="text-xs text-luxury-500 mt-2">
                  {fmt(nextTier.min - balance)} pts to next tier
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Primary CTAs — Redeem + View codes */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Link href="/points/redeem"
            className="rounded-2xl p-4 text-white text-center font-bold text-sm relative overflow-hidden sb-card-lift sb-shimmer"
            style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)", boxShadow: "0 8px 24px rgba(240,180,41,0.35)" }}>
            <span className="text-base block mb-0.5 relative" style={{ zIndex: 2 }}>✨</span>
            <span className="relative" style={{ zIndex: 2 }}>Redeem Rewards</span>
          </Link>
          <Link href="/my-codes"
            className="rounded-2xl p-4 text-luxury-900 text-center font-bold text-sm relative overflow-hidden border-2 border-luxury-200 bg-white hover:border-gold-300 transition sb-card-lift">
            <span className="text-base block mb-0.5">🎟️</span>
            My Codes{activeCodesCount > 0 ? ` · ${activeCodesCount}` : ""}
          </Link>
        </div>
        {walletCreditBalance > 0 && (
          <Link href="/wallet"
            className="block rounded-2xl p-3 mb-3 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition flex items-center justify-between sb-card-lift">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">💰</span>
              <div>
                <p className="text-xs font-bold text-emerald-800">Wallet Credit Available</p>
                <p className="text-[0.65rem] text-emerald-700">Use at any booking</p>
              </div>
            </div>
            <p className="font-display text-lg font-bold text-emerald-700">
              ₹<CountUp value={walletCreditBalance} duration={900} /> →
            </p>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3 mb-5">
          <Stat label="Lifetime Earned" value={wallet?.lifetime_earned || 0} />
          <Stat label="Lifetime Redeemed" value={wallet?.lifetime_redeemed || 0} />
        </div>

        <div className="card-luxury sb-card-lift p-5">
          <h2 className="font-bold text-luxury-900 mb-3">Recent Activity</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-luxury-500 py-4 text-center">No points activity yet. Make a booking to start earning.</p>
          ) : (
            <div className="divide-y divide-luxury-100 sb-stagger">
              {recent.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-semibold text-luxury-800 capitalize">{h.type}</p>
                    <p className="text-xs text-luxury-500">{h.reason || "—"} · {new Date(h.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                  </div>
                  <p className={`font-bold ${h.delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {h.delta >= 0 ? "+" : ""}{fmt(h.delta)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-luxury sb-card-lift p-4">
      <p className="text-[0.65rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className="font-display text-xl font-bold text-luxury-900 mt-1 leading-none">
        <CountUp value={value} duration={900} />
      </p>
    </div>
  );
}
