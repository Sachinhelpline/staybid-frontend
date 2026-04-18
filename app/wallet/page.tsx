"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import Link from "next/link";

const LEVELS = [
  {
    name: "Silver", icon: "🥈", min: 0, max: 9999,
    gradient: "linear-gradient(135deg,#94a3b8,#cbd5e1,#94a3b8)",
    color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200",
    pointsRate: 5,
    perks: ["5 pts / ₹100", "Flash deal access"],
  },
  {
    name: "Gold", icon: "🥇", min: 10000, max: 49999,
    gradient: "linear-gradient(135deg,#c9911a,#f0b429,#c9911a)",
    color: "text-gold-600", bg: "bg-gold-50", border: "border-gold-200",
    pointsRate: 7,
    perks: ["7 pts / ₹100", "Priority bids", "Early flash access"],
  },
  {
    name: "Platinum", icon: "💎", min: 50000, max: Infinity,
    gradient: "linear-gradient(135deg,#7c3aed,#a78bfa,#6d28d9)",
    color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200",
    pointsRate: 10,
    perks: ["10 pts / ₹100", "Free upgrades", "Free trip rewards"],
  },
];

const MILESTONES = [
  { at: 10000,  label: "Gold Member",          icon: "🥇", reward: "Priority bids + 7 pts/₹100" },
  { at: 25000,  label: "500 Bonus Points",      icon: "⭐", reward: "Auto-credited to wallet" },
  { at: 50000,  label: "Platinum Member",       icon: "💎", reward: "Free upgrades + 10 pts/₹100" },
  { at: 75000,  label: "Free Room Upgrade",     icon: "🏨", reward: "Next booking auto-upgrade" },
  { at: 100000, label: "Free Night Stay",       icon: "🎁", reward: "Any StayBid partner hotel" },
  { at: 250000, label: "Weekend Getaway",       icon: "✈️", reward: "2-night luxury voucher" },
];

function getLevel(spend: number) {
  if (spend >= 50000) return LEVELS[2];
  if (spend >= 10000) return LEVELS[1];
  return LEVELS[0];
}

export default function WalletPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [wallet, setWallet]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [activeTab, setActiveTab] = useState<"wallet"|"tracker">("wallet");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }

    // Fetch wallet + bids + bookings in parallel
    Promise.all([
      api.getWallet().catch(() => null),
      api.getMyBids().catch(() => null),
      api.getMyBookings().catch(() => null),
    ]).then(([walletData, bidsData, bookingsData]) => {
      const w = walletData?.wallet || walletData;

      // Compute totalSpent from accepted bids
      const bids: any[]     = bidsData?.bids || [];
      const bookings: any[] = bookingsData?.bookings || [];

      const acceptedBidAmount = bids
        .filter((b: any) => b.status === "ACCEPTED" || b.status === "CONFIRMED")
        .reduce((sum: number, b: any) => sum + (b.amount || 0), 0);

      const bookingAmount = bookings
        .reduce((sum: number, bk: any) => sum + (bk.totalAmount || bk.amount || 0), 0);

      const computedSpend = acceptedBidAmount + bookingAmount;

      // Build synthetic transactions from bids if backend wallet is empty
      const syntheticTxns: any[] = bids
        .filter((b: any) => b.status === "ACCEPTED" || b.status === "CONFIRMED")
        .map((b: any) => ({
          id: `bid_${b.id}`,
          type: "DEBIT",
          amount: b.amount || 0,
          description: `Booking — ${b.hotel?.name || "Hotel"}`,
          createdAt: b.updatedAt || b.createdAt,
        }));

      if (w && (w.balance !== undefined || w.totalCredit !== undefined || w.totalDebit !== undefined)) {
        // Real wallet exists — merge computed spend if backend spent is 0
        const backendSpend = w.totalDebit || w.total_debit || w.spent || 0;
        setWallet({
          ...w,
          _computedSpend: backendSpend > 0 ? backendSpend : computedSpend,
          transactions: (w.transactions && w.transactions.length > 0)
            ? w.transactions
            : syntheticTxns,
        });
      } else {
        // No real wallet — build one from bids/bookings
        setWallet({
          balance: 0,
          totalCredit: 0,
          totalDebit: computedSpend,
          _computedSpend: computedSpend,
          transactions: syntheticTxns,
          _synthetic: true,
        });
      }
    }).finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const txTypeStyle = (type: string) => {
    if (!type) return { color: "text-luxury-600", icon: "•" };
    const t = type.toUpperCase();
    if (t.includes("CREDIT") || t.includes("REFUND") || t.includes("ADD")) return { color: "text-emerald-600", icon: "+" };
    if (t.includes("DEBIT") || t.includes("CHARGE") || t.includes("PAY"))  return { color: "text-red-500",     icon: "−" };
    return { color: "text-luxury-600", icon: "•" };
  };

  if (authLoading || loading) return (
    <div className="max-w-xl mx-auto px-5 py-12 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-28 shimmer rounded-3xl" />)}
    </div>
  );

  const totalSpend  = wallet?._computedSpend || wallet?.totalDebit || wallet?.total_debit || wallet?.spent || 0;
  const totalPoints = Math.floor(totalSpend / 100 * getLevel(totalSpend).pointsRate);
  const level       = getLevel(totalSpend);
  const nextLevel   = LEVELS[LEVELS.indexOf(level) + 1];
  const progress    = nextLevel ? Math.min(100, ((totalSpend - level.min) / (nextLevel.min - level.min)) * 100) : 100;
  const nextMile    = MILESTONES.find(m => m.at > totalSpend);

  return (
    <div className="bg-luxury-50 min-h-screen">
      <style>{`
        @keyframes shimmerGold { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .badge-anim { background-size:200% 200%; animation:shimmerGold 3s ease infinite; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .fu { animation:fadeUp 0.35s ease-out both; }
      `}</style>

      <div className="max-w-xl mx-auto px-5 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-1">Account</p>
            <h1 className="font-display font-light text-luxury-900" style={{ fontSize:"clamp(1.8rem,4vw,2.5rem)" }}>My Wallet</h1>
          </div>
          <Link href="/profile"
            className="flex items-center gap-1.5 text-xs font-semibold text-luxury-500 border border-luxury-200 px-3 py-2 rounded-xl hover:border-gold-300 hover:text-gold-600 transition-all">
            👤 Profile
          </Link>
        </div>

        {error && <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-5"><p className="text-sm text-red-600">{error}</p></div>}

        {wallet && (
          <>
            {/* ── Balance card ── */}
            <div className="fu rounded-3xl p-7 mb-5 text-white relative overflow-hidden"
              style={{ background:"linear-gradient(135deg,#0a0812 0%,#130f24 60%,#0a1020 100%)" }}>
              <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none opacity-[0.08]"
                style={{ background:"radial-gradient(circle,#f0b429 0%,transparent 70%)",transform:"translate(30%,-30%)" }} />

              {/* Level badge */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-white/40 text-[0.6rem] tracking-[0.2em] uppercase font-semibold">Available Balance</span>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-white badge-anim"
                  style={{ background: level.gradient }}>
                  {level.icon} {level.name}
                </div>
              </div>

              <p className="font-display font-light text-white mb-1" style={{ fontSize:"clamp(2.4rem,6vw,3.5rem)" }}>
                ₹{(wallet.balance ?? 0).toLocaleString("en-IN")}
              </p>
              <p className="text-white/40 text-xs tracking-wide">{user?.phone || user?.email}</p>

              <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/10">
                <div>
                  <p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">Credited</p>
                  <p className="text-emerald-400 font-semibold text-sm">₹{(wallet.totalCredit ?? 0).toLocaleString("en-IN")}</p>
                </div>
                <div className="border-x border-white/10 text-center">
                  <p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">Total Spent</p>
                  <p className="text-red-400 font-semibold text-sm">₹{totalSpend.toLocaleString("en-IN")}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">StayPoints</p>
                  <p className="text-gold-400 font-semibold text-sm">{totalPoints.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* ── Tabs ── */}
            <div className="flex border border-luxury-200 rounded-2xl p-1 mb-5 bg-white">
              {(["wallet","tracker"] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab===t ? "btn-luxury shadow-gold" : "text-luxury-400 hover:text-luxury-700"}`}>
                  {t === "wallet" ? "💳 Transactions" : "📊 Spend Tracker"}
                </button>
              ))}
            </div>

            {/* ── Transactions tab ── */}
            {activeTab === "wallet" && (
              <div className="fu space-y-2">
                {(!wallet.transactions || wallet.transactions.length === 0) ? (
                  <div className="text-center py-14">
                    <div className="w-14 h-14 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-3"><span className="text-2xl">💳</span></div>
                    <p className="text-luxury-600 font-medium">No transactions yet</p>
                    <p className="text-luxury-400 text-xs mt-1">Complete a booking to see your spending history</p>
                  </div>
                ) : (
                  wallet.transactions.map((tx: any, i: number) => {
                    const st = txTypeStyle(tx.type);
                    return (
                      <div key={tx.id || i} className="card-luxury px-5 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${st.icon==="+"?"bg-emerald-50 text-emerald-600":st.icon==="−"?"bg-red-50 text-red-500":"bg-luxury-100 text-luxury-600"}`}>
                            {st.icon}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-luxury-900 leading-snug">{tx.description || tx.type || "Transaction"}</p>
                            <p className="text-xs text-luxury-400 mt-0.5">
                              {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—"}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-bold ${st.color}`}>{st.icon !== "•" ? st.icon : ""}₹{(tx.amount??0).toLocaleString("en-IN")}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ── Spend tracker tab ── */}
            {activeTab === "tracker" && (
              <div className="fu space-y-4">

                {/* Level card */}
                <div className={`rounded-3xl p-5 border ${level.border} ${level.bg}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">{level.icon}</span>
                    <div>
                      <p className="font-bold text-luxury-900 text-base">{level.name} Member</p>
                      <p className={`text-xs font-semibold ${level.color}`}>{level.pointsRate} StayPoints per ₹100 spent</p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="font-bold text-luxury-900">₹{totalSpend.toLocaleString()}</p>
                      <p className="text-xs text-luxury-400">total spent</p>
                    </div>
                  </div>

                  {/* Progress to next */}
                  {nextLevel && (
                    <>
                      <div className="flex justify-between text-xs text-luxury-400 mb-1.5">
                        <span>{level.name}</span>
                        <span>{nextLevel.icon} {nextLevel.name} at ₹{nextLevel.min.toLocaleString()}</span>
                      </div>
                      <div className="h-2.5 bg-white/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full badge-anim transition-all duration-1000"
                          style={{ width:`${progress}%`, background: level.gradient }} />
                      </div>
                      <p className="text-xs text-luxury-500 mt-1.5 font-medium">
                        ₹{Math.max(0,nextLevel.min - totalSpend).toLocaleString()} more → {nextLevel.icon} {nextLevel.name}
                      </p>
                    </>
                  )}
                  {!nextLevel && (
                    <p className="text-xs text-purple-600 font-semibold mt-1">🏆 Highest tier achieved — Platinum Elite</p>
                  )}

                  {/* Perks */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {level.perks.map((p, i) => (
                      <span key={i} className={`text-xs px-2.5 py-1 rounded-full font-medium border ${level.border} ${level.color} bg-white/70`}>{p}</span>
                    ))}
                  </div>
                </div>

                {/* All 3 level cards */}
                <div className="grid grid-cols-3 gap-3">
                  {LEVELS.map((lv) => {
                    const achieved = totalSpend >= lv.min;
                    return (
                      <div key={lv.name} className={`rounded-2xl p-3 text-center border transition-all ${achieved ? lv.border + " " + lv.bg : "border-luxury-100 bg-luxury-50 opacity-50"}`}>
                        <p className="text-2xl mb-1">{lv.icon}</p>
                        <p className={`text-xs font-bold ${achieved ? lv.color : "text-luxury-400"}`}>{lv.name}</p>
                        <p className="text-[0.58rem] text-luxury-400 mt-0.5">₹{lv.min.toLocaleString()}+</p>
                        {achieved && <div className="mt-1.5 text-[0.55rem] font-bold text-emerald-600 bg-emerald-50 rounded-full px-1.5 py-0.5">UNLOCKED</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Next milestone highlight */}
                {nextMile && (
                  <div className="rounded-3xl p-5 border border-gold-200 bg-gradient-to-br from-gold-50 to-amber-50">
                    <p className="text-[0.65rem] font-bold text-gold-600 uppercase tracking-widest mb-2">Next Reward</p>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{nextMile.icon}</span>
                      <div>
                        <p className="font-bold text-luxury-900 text-sm">{nextMile.label}</p>
                        <p className="text-xs text-luxury-500">{nextMile.reward}</p>
                      </div>
                      <div className="ml-auto text-right">
                        <p className="font-bold text-gold-600">₹{nextMile.at.toLocaleString()}</p>
                        <p className="text-[0.6rem] text-luxury-400">target</p>
                      </div>
                    </div>
                    <div className="h-2 bg-gold-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300 rounded-full"
                        style={{ width:`${Math.min(100,(totalSpend/nextMile.at)*100)}%` }} />
                    </div>
                    <p className="text-[0.62rem] text-luxury-400 mt-1.5">₹{Math.max(0,nextMile.at-totalSpend).toLocaleString()} more to unlock</p>
                  </div>
                )}

                {/* All milestones */}
                <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-5">
                  <h3 className="font-semibold text-luxury-900 text-sm mb-3">🎯 All Milestones</h3>
                  <div className="space-y-2.5">
                    {MILESTONES.map((m, i) => {
                      const done = totalSpend >= m.at;
                      return (
                        <div key={i} className={`flex items-center gap-3 p-2.5 rounded-xl ${done ? "bg-emerald-50 border border-emerald-100" : "bg-luxury-50"}`}>
                          <span className={`text-lg ${done ? "" : "opacity-40"}`}>{m.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-semibold ${done ? "text-emerald-800" : "text-luxury-600"}`}>{m.label}</p>
                            <p className="text-[0.6rem] text-luxury-400">{m.reward}</p>
                          </div>
                          {done ? (
                            <span className="text-[0.6rem] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">✓ Done</span>
                          ) : (
                            <span className="text-[0.6rem] text-luxury-400 shrink-0">₹{m.at.toLocaleString()}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!wallet && !error && !loading && (
          <div className="fu rounded-3xl p-7 mb-5 text-white relative overflow-hidden"
            style={{ background:"linear-gradient(135deg,#0a0812 0%,#130f24 60%,#0a1020 100%)" }}>
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none opacity-[0.08]"
              style={{ background:"radial-gradient(circle,#f0b429 0%,transparent 70%)",transform:"translate(30%,-30%)" }} />
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/40 text-[0.6rem] tracking-[0.2em] uppercase font-semibold">Available Balance</span>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-white badge-anim"
                style={{ background: LEVELS[0].gradient }}>
                {LEVELS[0].icon} {LEVELS[0].name}
              </div>
            </div>
            <p className="font-display font-light text-white mb-1" style={{ fontSize:"clamp(2.4rem,6vw,3.5rem)" }}>₹0</p>
            <p className="text-white/40 text-xs tracking-wide">{user?.phone || user?.email}</p>
            <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/10">
              <div><p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">Credited</p><p className="text-emerald-400 font-semibold text-sm">₹0</p></div>
              <div className="border-x border-white/10 text-center"><p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">Total Spent</p><p className="text-red-400 font-semibold text-sm">₹0</p></div>
              <div className="text-right"><p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">StayPoints</p><p className="text-gold-400 font-semibold text-sm">0</p></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
