"use client";
// /points/redeem — StayPoints catalog. Customer browses rules, taps to redeem.
// Confirmation modal → POST /api/redemption/redeem → success modal with the
// fresh code + barcode + 5-button share rail.
//
// Mobile + desktop + tablet: CSS uses CSS-grid auto-fit minmax(260px, 1fr)
// so cards reflow cleanly across 320 → 1920px widths.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";
import {
  type RedemptionRule,
  type RedemptionCode,
  type Tier,
  tierForBalance,
  canUserRedeem,
  kindIcon,
} from "@/lib/redemption";

const TIER_COLOR: Record<Tier, string> = {
  silver: "#94a3b8",
  gold: "#c9911a",
  platinum: "#7c3aed",
};

const KIND_LABEL: Record<string, string> = {
  coupon: "Coupon",
  voucher: "Voucher",
  amenity: "Hotel Perk",
  wallet_credit: "Wallet Credit",
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

export default function RedeemPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [rules, setRules] = useState<RedemptionRule[]>([]);
  const [wallet, setWallet] = useState<any>(null);
  const [monthlyCounts, setMonthlyCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<string>("all");
  const [confirmRule, setConfirmRule] = useState<RedemptionRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<RedemptionCode | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/points/redeem" }); return; }
    let dead = false;
    Promise.all([
      api.getRedemptionRules().catch(() => ({ rules: [] })),
      api.getPoints().catch(() => ({ wallet: null })),
      api.getMyRedemptionCodes().catch(() => ({ codes: [] })),
    ]).then(([rData, pData, cData]) => {
      if (dead) return;
      setRules(rData?.rules || []);
      setWallet(pData?.wallet || null);
      // monthly counts per rule_id (this month)
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const cnts: Record<string, number> = {};
      for (const c of (cData?.codes || [])) {
        if (new Date(c.issued_at).getTime() >= firstOfMonth.getTime()) {
          cnts[c.rule_id] = (cnts[c.rule_id] || 0) + 1;
        }
      }
      setMonthlyCounts(cnts);
    }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [authLoading, user, router]);

  const balance = Number(wallet?.balance || 0);
  const lifetimeEarned = Number(wallet?.lifetime_earned || 0);
  const userTier: Tier = tierForBalance(lifetimeEarned);

  const filtered = useMemo(() => {
    if (filterKind === "all") return rules;
    return rules.filter((r) => r.kind === filterKind);
  }, [rules, filterKind]);

  const confirm = async () => {
    if (!confirmRule) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.redeemRule({ ruleId: confirmRule.id });
      if (res?.ok && res?.code) {
        setSuccess(res.code);
        setConfirmRule(null);
        setWallet((w: any) => ({ ...(w || {}), balance: res?.wallet?.balance ?? Math.max(0, balance - confirmRule.points_cost) }));
        // Bump monthly count
        setMonthlyCounts((m) => ({ ...m, [confirmRule.id]: (m[confirmRule.id] || 0) + 1 }));
      } else {
        setError(res?.error || "Redemption failed. Try again.");
      }
    } catch (e: any) {
      setError(e?.message || "Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading || authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50">
      <p className="text-luxury-500 text-sm">Loading rewards…</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-luxury-50 via-white to-luxury-50 pb-24" data-autonext-form>
      <div className="max-w-5xl mx-auto px-4 pt-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-3 sb-fade-in">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-luxury-900 leading-tight">Redeem Rewards</h1>
            <p className="text-luxury-500 text-sm mt-0.5">Turn your StayPoints into real benefits.</p>
          </div>
          <Link href="/my-codes"
            className="flex items-center gap-1.5 text-xs font-semibold text-luxury-700 border border-luxury-200 px-3 py-2 rounded-xl hover:border-gold-300 hover:text-gold-600 transition whitespace-nowrap shrink-0 sb-card-lift">
            🎟️ My Codes
          </Link>
        </div>

        {/* Balance strip */}
        <div className="card-luxury sb-card-lift sb-fade-in p-4 mb-5 relative overflow-hidden" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500 mb-1">Your Balance</p>
              <p className="font-display text-3xl font-bold text-luxury-900 leading-none">
                <CountUp value={balance} duration={1100} /> <span className="text-base font-semibold text-luxury-400">pts</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider sb-card-lift"
              style={{ background: `${TIER_COLOR[userTier]}20`, color: TIER_COLOR[userTier], border: `1px solid ${TIER_COLOR[userTier]}40` }}>
              <span className="sb-pulse-dot" style={{ background: TIER_COLOR[userTier], boxShadow: `0 0 0 0 ${TIER_COLOR[userTier]}55` }} />
              {userTier === "silver" ? "🥈" : userTier === "gold" ? "🥇" : "💎"} {userTier}
            </div>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: "none" }}>
          {([
            ["all", "✨ All"],
            ["coupon", "🎟️ Coupons"],
            ["wallet_credit", "💰 Wallet Credit"],
            ["amenity", "🏨 Hotel Perks"],
          ] as [string, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setFilterKind(k)}
              className={`text-xs font-semibold px-3.5 py-1.5 rounded-full border whitespace-nowrap transition sb-card-lift ${
                filterKind === k
                  ? "bg-luxury-900 text-white border-luxury-900"
                  : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-300"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid gap-3 sb-stagger" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {filtered.map((r) => {
            const m = monthlyCounts[r.id] || 0;
            const v = canUserRedeem({
              rule: r,
              pointsBalance: balance,
              userTier,
              monthlyCount: m,
            });
            const locked = !v.ok;
            return (
              <button
                key={r.id}
                onClick={() => locked ? null : setConfirmRule(r)}
                disabled={locked}
                className={`card-luxury p-4 text-left relative overflow-hidden transition-all ${locked ? "opacity-60" : "sb-card-lift hover:shadow-luxury"}`}>
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                    style={{ background: r.kind === "wallet_credit" ? "linear-gradient(135deg,#fbbf24,#f59e0b)" :
                                          r.kind === "coupon" ? "linear-gradient(135deg,#f0b429,#c9911a)" :
                                          r.kind === "amenity" ? "linear-gradient(135deg,#8b5cf6,#6d28d9)" :
                                          "linear-gradient(135deg,#6366f1,#4f46e5)" }}>
                    {r.icon || kindIcon(r.kind)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-luxury-900 text-sm leading-tight">{r.title}</p>
                    <p className="text-[0.65rem] uppercase tracking-wider font-bold mt-0.5"
                      style={{ color: TIER_COLOR[r.min_tier as Tier] }}>
                      {KIND_LABEL[r.kind] || r.kind}{r.min_tier !== "silver" ? ` · ${r.min_tier}+` : ""}
                    </p>
                  </div>
                </div>
                {r.description && (
                  <p className="text-xs text-luxury-500 leading-relaxed mb-3 line-clamp-2">{r.description}</p>
                )}
                <div className="flex items-end justify-between">
                  <div>
                    <p className="font-display text-xl font-bold text-luxury-900 leading-none">{fmt(r.points_cost)} <span className="text-xs font-semibold text-luxury-500">pts</span></p>
                    {r.value_inr > 0 && (
                      <p className="text-[0.65rem] text-emerald-600 font-bold mt-0.5">= ₹{fmt(r.value_inr)} value</p>
                    )}
                  </div>
                  {locked ? (
                    <span className="text-[0.6rem] font-bold uppercase tracking-wider text-luxury-400 bg-luxury-100 border border-luxury-200 px-2 py-1 rounded-full">
                      {v.ok ? "" : ((v as any).error || "Locked").split(".")[0]}
                    </span>
                  ) : (
                    <span className="text-[0.6rem] font-bold uppercase tracking-wider text-gold-600 bg-gold-50 border border-gold-200 px-2 py-1 rounded-full">
                      Redeem →
                    </span>
                  )}
                </div>
                {m > 0 && (
                  <p className="text-[0.6rem] text-luxury-400 mt-2">Used {m}/{r.max_per_user_per_month} this month</p>
                )}
              </button>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="text-sm text-luxury-500 text-center py-10">No rewards available right now.</p>
        )}
      </div>

      {/* Confirm modal */}
      {confirmRule && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center backdrop-blur-md bg-black/70 p-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} onClick={() => !busy && setConfirmRule(null)}>
          <div className="w-full sm:max-w-md rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: "linear-gradient(135deg,#f0b429,#c9911a)" }}>{confirmRule.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-luxury-900 text-base leading-tight">{confirmRule.title}</p>
                <p className="text-xs text-luxury-500 mt-1">{confirmRule.description}</p>
              </div>
            </div>
            {confirmRule.terms && (
              <div className="bg-luxury-50 border border-luxury-100 rounded-2xl p-3 mb-3">
                <p className="text-[0.6rem] uppercase tracking-wider font-bold text-luxury-500 mb-1">Terms</p>
                <p className="text-xs text-luxury-700 leading-relaxed">{confirmRule.terms}</p>
              </div>
            )}
            <div className="flex justify-between items-center bg-gold-50 border border-gold-200 rounded-2xl p-3 mb-4">
              <span className="text-sm font-semibold text-luxury-700">You spend</span>
              <span className="font-display text-2xl font-bold text-gold-700">{fmt(confirmRule.points_cost)} pts</span>
            </div>
            {error && <p className="text-sm text-red-600 mb-3 bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConfirmRule(null)} disabled={busy}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm border border-luxury-200 text-luxury-700 hover:bg-luxury-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirm} disabled={busy}
                className="flex-1 py-3 rounded-2xl font-bold text-sm text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                {busy ? "Redeeming…" : "Confirm & Redeem"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success modal */}
      {success && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center backdrop-blur-md bg-black/80 p-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} onClick={() => setSuccess(null)}>
          <div className="w-full sm:max-w-md rounded-3xl bg-white overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center" style={{ background: "linear-gradient(135deg,#fff9ec,#fdf4d3)" }}>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3 text-3xl"
                style={{ background: "linear-gradient(135deg,#f0b429,#c9911a)", boxShadow: "0 8px 24px rgba(240,180,41,0.4)" }}>
                ✓
              </div>
              <p className="font-display text-xl font-bold text-luxury-900">Redeemed!</p>
              <p className="text-sm text-luxury-600 mt-1">{success.title}</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="border-2 border-dashed border-gold-300 rounded-2xl p-4 text-center bg-white">
                <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-400 mb-1">Your Code</p>
                <p className="font-mono text-2xl font-bold text-luxury-900 tracking-wider select-all">{success.code}</p>
                <p className="text-[0.65rem] text-luxury-500 mt-1.5">
                  Expires {new Date(success.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <Link href="/my-codes"
                onClick={() => setSuccess(null)}
                className="block w-full py-3 rounded-2xl font-bold text-sm text-center text-white"
                style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                View all my codes →
              </Link>
              <button onClick={() => setSuccess(null)}
                className="w-full py-2.5 rounded-2xl font-semibold text-xs border border-luxury-200 text-luxury-600 hover:bg-luxury-50">
                Redeem another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
