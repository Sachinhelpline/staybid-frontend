"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

const LEVELS = [
  {
    name: "Silver", icon: "🥈", min: 0, max: 9999,
    gradient: "linear-gradient(135deg,#94a3b8,#cbd5e1,#94a3b8)",
    ring: "ring-slate-300", text: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200",
    pointsRate: 5,
    perks: ["5 StayPoints per ₹100 spent", "Access to Flash Deals", "Standard booking support"],
    nextLabel: "Upgrade to Gold at ₹10,000 total spend",
  },
  {
    name: "Gold", icon: "🥇", min: 10000, max: 49999,
    gradient: "linear-gradient(135deg,#c9911a,#f0b429,#c9911a)",
    ring: "ring-gold-400", text: "text-gold-600", bg: "bg-gold-50", border: "border-gold-200",
    pointsRate: 7,
    perks: ["7 StayPoints per ₹100 spent", "Priority bid processing", "Exclusive Gold member deals", "Early Flash Deal access"],
    nextLabel: "Upgrade to Platinum at ₹50,000 total spend",
  },
  {
    name: "Platinum", icon: "💎", min: 50000, max: Infinity,
    gradient: "linear-gradient(135deg,#7c3aed,#a78bfa,#6d28d9)",
    ring: "ring-purple-400", text: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200",
    pointsRate: 10,
    perks: ["10 StayPoints per ₹100 spent", "Free room upgrade on every stay", "Dedicated concierge support", "Priority flash deal booking", "Free trip rewards unlocked"],
    nextLabel: "You've reached the highest tier!",
  },
];

const MILESTONES = [
  { at: 10000,  label: "Gold Member",         reward: "7 pts/₹100 + Priority Bids",   icon: "🥇" },
  { at: 25000,  label: "500 Bonus StayPoints", reward: "Credited to your wallet",       icon: "⭐" },
  { at: 50000,  label: "Platinum Member",      reward: "10 pts/₹100 + Free Upgrades",  icon: "💎" },
  { at: 75000,  label: "Free Room Upgrade",    reward: "Auto-applied on next booking",  icon: "🏨" },
  { at: 100000, label: "Free Night Stay",      reward: "Any StayBid partner hotel",     icon: "🎁" },
  { at: 250000, label: "Weekend Getaway",      reward: "2-night luxury voucher",        icon: "✈️" },
];

function getLevel(spend: number) {
  if (spend >= 50000) return LEVELS[2];
  if (spend >= 10000) return LEVELS[1];
  return LEVELS[0];
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading, login } = useAuth();
  const [editMode, setEditMode]     = useState(false);
  const [name, setName]             = useState("");
  const [email, setEmail]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [totalSpend, setTotalSpend] = useState(0);
  const [bookingCount, setBookingCount] = useState(0);
  const [stayPoints, setStayPoints] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    setName(user.name || "");
    const extra = localStorage.getItem("sb_profile_extra");
    if (extra) { try { setEmail(JSON.parse(extra).email || ""); } catch {} }

    Promise.all([
      api.getWallet().catch(() => null),
      api.getMyBookings().catch(() => null),
    ]).then(([wd, bd]) => {
      const w = wd?.wallet || wd || {};
      const spend = w.totalDebit || w.total_debit || w.spent || 0;
      setTotalSpend(spend);
      setStayPoints(Math.floor(spend / 100 * getLevel(spend).pointsRate));
      setBookingCount((bd?.bookings || []).length);
    }).finally(() => setLoadingStats(false));
  }, [user, authLoading, router]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    localStorage.setItem("sb_profile_extra", JSON.stringify({ email }));
    try { await api.updateProfile({ name, email }); } catch {}
    const token = localStorage.getItem("sb_token")!;
    login(token, { ...user, name });
    setSaving(false); setEditMode(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  const level      = getLevel(totalSpend);
  const nextLevel  = LEVELS[LEVELS.indexOf(level) + 1];
  const progress   = nextLevel ? Math.min(100, ((totalSpend - level.min) / (nextLevel.min - level.min)) * 100) : 100;
  const initials   = (user.name || user.phone || "S").slice(0, 2).toUpperCase();
  const nextMilestone = MILESTONES.find(m => m.at > totalSpend);

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(160deg,#faf9f6 0%,#f0ede6 100%)" }}>
      <style>{`
        @keyframes shimmerGold { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .badge-animate { background-size:200% 200%; animation:shimmerGold 3s ease infinite; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation:fadeUp 0.4s ease-out both; }
      `}</style>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-5">

        {/* ── Avatar + level card ── */}
        <div className="fade-up rounded-3xl overflow-hidden shadow-luxury"
          style={{ background:"linear-gradient(135deg,#0a0812 0%,#130f24 60%,#0a1020 100%)" }}>
          <div className="px-7 pt-8 pb-7">
            <div className="flex items-start justify-between mb-6">
              {/* Avatar */}
              <div className="relative">
                <div
                  style={{ background: level.gradient }}
                  className={`w-20 h-20 rounded-2xl flex items-center justify-center text-white text-2xl font-bold font-display ring-2 ring-offset-2 ring-offset-transparent ${level.ring}`}>
                  {initials}
                </div>
                <span className="absolute -bottom-2 -right-2 text-xl">{level.icon}</span>
              </div>
              {/* Level badge */}
              <div className="text-right">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-xs font-bold tracking-widest uppercase badge-animate"
                  style={{ background: level.gradient }}>
                  {level.icon} {level.name}
                </div>
                <p className="text-white/30 text-[0.6rem] mt-1 tracking-widest">MEMBERSHIP TIER</p>
              </div>
            </div>

            <h2 className="font-display font-light text-white text-2xl leading-snug mb-0.5">
              {user.name || "StayBid Member"}
            </h2>
            <p className="text-white/40 text-sm">{user.phone}</p>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mt-6 pt-5 border-t border-white/10">
              {loadingStats ? (
                [1,2,3].map(i => <div key={i} className="h-10 bg-white/10 animate-pulse rounded-xl" />)
              ) : (
                <>
                  <div className="text-center">
                    <p className="text-white font-bold text-xl">{bookingCount}</p>
                    <p className="text-white/40 text-[0.6rem] uppercase tracking-wider mt-0.5">Bookings</p>
                  </div>
                  <div className="text-center border-x border-white/10">
                    <p className="text-gold-400 font-bold text-xl">{stayPoints.toLocaleString()}</p>
                    <p className="text-white/40 text-[0.6rem] uppercase tracking-wider mt-0.5">StayPoints</p>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-bold text-xl">₹{(totalSpend/1000).toFixed(0)}k</p>
                    <p className="text-white/40 text-[0.6rem] uppercase tracking-wider mt-0.5">Total Spent</p>
                  </div>
                </>
              )}
            </div>

            {/* Level progress */}
            {nextLevel && (
              <div className="mt-5">
                <div className="flex justify-between text-[0.65rem] text-white/40 mb-1.5">
                  <span>{level.name}</span>
                  <span>{nextLevel.name} at ₹{nextLevel.min.toLocaleString()}</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full badge-animate transition-all duration-1000"
                    style={{ width:`${progress}%`, background: level.gradient }} />
                </div>
                <p className="text-white/30 text-[0.6rem] mt-1.5">
                  ₹{Math.max(0, (nextLevel.min - totalSpend)).toLocaleString()} more to {nextLevel.name}
                </p>
              </div>
            )}
            {!nextLevel && (
              <div className="mt-4 flex items-center gap-2 text-purple-300 text-xs">
                <span>💎</span>
                <span>You've reached the highest tier — Platinum Elite</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Personal details ── */}
        <div className="fade-up bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6" style={{ animationDelay:"0.1s" }}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-luxury-900 text-base tracking-tight">Personal Details</h3>
            {!editMode ? (
              <button onClick={() => setEditMode(true)}
                className="text-xs font-semibold text-gold-600 border border-gold-200 px-3 py-1.5 rounded-xl hover:bg-gold-50 transition-all">
                ✏️ Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditMode(false)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-luxury-200 text-luxury-400 hover:bg-luxury-50 transition-all">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="btn-luxury text-xs px-4 py-1.5 rounded-xl disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>

          {saved && (
            <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              <span className="text-emerald-700 text-sm font-medium">Profile updated successfully</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-[0.68rem] font-semibold text-luxury-400 uppercase tracking-widest block mb-1.5">Full Name</label>
              {editMode ? (
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name"
                  className="input-luxury text-sm w-full" />
              ) : (
                <p className="text-luxury-900 font-medium text-sm py-2.5 px-4 bg-luxury-50 rounded-xl border border-luxury-100">
                  {user.name || <span className="text-luxury-300 italic">Not set</span>}
                </p>
              )}
            </div>

            <div>
              <label className="text-[0.68rem] font-semibold text-luxury-400 uppercase tracking-widest block mb-1.5">Phone</label>
              <div className="flex items-center gap-2 py-2.5 px-4 bg-luxury-50 rounded-xl border border-luxury-100">
                <span className="text-luxury-900 font-medium text-sm">{user.phone}</span>
                <span className="ml-auto text-[0.6rem] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">Verified</span>
              </div>
            </div>

            <div>
              <label className="text-[0.68rem] font-semibold text-luxury-400 uppercase tracking-widest block mb-1.5">Email</label>
              {editMode ? (
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" type="email"
                  className="input-luxury text-sm w-full" />
              ) : (
                <p className="text-luxury-900 font-medium text-sm py-2.5 px-4 bg-luxury-50 rounded-xl border border-luxury-100">
                  {email || <span className="text-luxury-300 italic">Not set</span>}
                </p>
              )}
            </div>

            <div>
              <label className="text-[0.68rem] font-semibold text-luxury-400 uppercase tracking-widest block mb-1.5">Member Since</label>
              <p className="text-luxury-900 font-medium text-sm py-2.5 px-4 bg-luxury-50 rounded-xl border border-luxury-100">
                {user.id ? new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* ── Membership perks ── */}
        <div className="fade-up bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6" style={{ animationDelay:"0.18s" }}>
          <h3 className="font-semibold text-luxury-900 text-base mb-4 tracking-tight">
            {level.icon} {level.name} Member Perks
          </h3>
          <div className="space-y-2.5">
            {level.perks.map((perk, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: level.gradient }}>
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm text-luxury-700">{perk}</span>
              </div>
            ))}
          </div>
          {nextLevel && (
            <div className={`mt-4 pt-4 border-t border-luxury-100`}>
              <p className="text-xs text-luxury-400 mb-2">Unlock with {nextLevel.name}:</p>
              <div className="space-y-1.5 opacity-50">
                {nextLevel.perks.slice(nextLevel.perks.length - 2).map((perk, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-luxury-100 flex items-center justify-center shrink-0 text-[0.6rem]">🔒</span>
                    <span className="text-sm text-luxury-500">{perk}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Next milestone ── */}
        {nextMilestone && (
          <div className="fade-up rounded-3xl p-6 border border-gold-200 bg-gradient-to-br from-gold-50 to-amber-50" style={{ animationDelay:"0.24s" }}>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-2xl">{nextMilestone.icon}</span>
              <div>
                <p className="font-semibold text-luxury-900 text-sm">{nextMilestone.label}</p>
                <p className="text-xs text-luxury-500">{nextMilestone.reward}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-gold-600 font-bold text-sm">₹{nextMilestone.at.toLocaleString()}</p>
                <p className="text-luxury-400 text-[0.6rem]">target spend</p>
              </div>
            </div>
            <div className="mt-3">
              <div className="h-1.5 bg-gold-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300 rounded-full"
                  style={{ width:`${Math.min(100,(totalSpend/nextMilestone.at)*100)}%` }} />
              </div>
              <p className="text-[0.6rem] text-luxury-400 mt-1.5">
                ₹{Math.max(0, nextMilestone.at - totalSpend).toLocaleString()} more to unlock
              </p>
            </div>
          </div>
        )}

        {/* ── All milestones ── */}
        <div className="fade-up bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6" style={{ animationDelay:"0.3s" }}>
          <h3 className="font-semibold text-luxury-900 text-base mb-4 tracking-tight">🎯 Reward Milestones</h3>
          <div className="space-y-3">
            {MILESTONES.map((m, i) => {
              const achieved = totalSpend >= m.at;
              return (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${achieved ? "bg-emerald-50 border border-emerald-100" : "bg-luxury-50 border border-luxury-100"}`}>
                  <span className={`text-xl ${achieved ? "" : "opacity-40"}`}>{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-snug ${achieved ? "text-emerald-800" : "text-luxury-600"}`}>{m.label}</p>
                    <p className={`text-xs ${achieved ? "text-emerald-600" : "text-luxury-400"}`}>{m.reward}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {achieved ? (
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">✓ Done</span>
                    ) : (
                      <span className="text-xs text-luxury-400">₹{m.at.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
