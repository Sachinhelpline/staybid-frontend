"use client";
// /passport — the unified Explorer Passport + Wallet hub. Four tabs:
//   🛂 Passport · 💳 Wallet · ✨ Rewards · 🎟️ Codes
// The old /wallet, /points, /points/redeem, /my-codes routes redirect here.
//
// Passport tab is the "alive" surface — an animated book that opens to the
// digital passport card, stamps from confirmed stays, achievement badges,
// stamp-reward ladder, and a virtual member card. Wallet/Rewards/Codes reuse
// the existing wallet/points/redemption APIs so nothing regresses.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";
import { PassportBook } from "@/components/passport/PassportBook";
import { StampGrid } from "@/components/passport/StampGrid";
import { BadgeGrid } from "@/components/passport/BadgeGrid";
import { RewardLadder } from "@/components/passport/RewardLadder";
import { MemberCard } from "@/components/passport/MemberCard";
import { FamilyPassport } from "@/components/passport/FamilyPassport";
import {
  tierForBalance,
  canUserRedeem,
  kindIcon,
  setPendingRedemption,
  type RedemptionRule,
  type RedemptionCode,
  type Tier,
} from "@/lib/redemption";

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

type TabKey = "passport" | "wallet" | "rewards" | "codes";
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "passport", label: "Passport", icon: "🛂" },
  { key: "wallet", label: "Wallet", icon: "💳" },
  { key: "rewards", label: "Rewards", icon: "✨" },
  { key: "codes", label: "Codes", icon: "🎟️" },
];

function PassportHub() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const initialTab = (search.get("tab") as TabKey) || "passport";
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? initialTab : "passport",
  );

  const [loading, setLoading] = useState(true);
  const [passport, setPassport] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [points, setPoints] = useState<any>(null);
  const [codes, setCodes] = useState<RedemptionCode[]>([]);
  const [walletCredit, setWalletCredit] = useState(0);
  const [rules, setRules] = useState<RedemptionRule[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);

  // ── Load everything in parallel ──────────────────────────────────────────
  const load = () => {
    Promise.all([
      api.getPassport().catch(() => null),
      api.getWallet().catch(() => null),
      api.getPoints().catch(() => ({ wallet: null })),
      api.getMyRedemptionCodes().catch(() => ({ codes: [], walletCredit: null })),
      api.getRedemptionRules().catch(() => ({ rules: [] })),
      api.getMyBids().catch(() => ({ bids: [] })),
      api.getMyBookings().catch(() => ({ bookings: [] })),
    ]).then(([pp, w, p, c, r, b, bk]) => {
      setPassport(pp);
      setWallet(w?.wallet || w);
      setPoints(p?.wallet || null);
      setCodes(c?.codes || []);
      setWalletCredit(Number(c?.walletCredit?.balance_inr || 0));
      setRules(r?.rules || []);
      setBids(b?.bids || []);
      setBookings(bk?.bookings || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/passport" }); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  const switchTab = (k: TabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", k);
    window.history.replaceState({}, "", url.toString());
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalSpend = useMemo(() => {
    const backendSpend = wallet?.totalDebit || wallet?.total_debit || wallet?.spent || 0;
    if (backendSpend > 0) return backendSpend;
    const acc = bids
      .filter((x: any) => x.status === "ACCEPTED" || x.status === "CONFIRMED")
      .reduce((s: number, x: any) => s + (x.amount || 0), 0);
    const bk = bookings.reduce((s: number, x: any) => s + (x.totalAmount || x.amount || 0), 0);
    return acc + bk;
  }, [wallet, bids, bookings]);

  const stayPoints = Number(points?.balance || 0);
  const walletBalance = Number(wallet?.balance || 0);

  if (authLoading || loading) {
    return (
      <div className="max-w-xl mx-auto px-5 py-12 space-y-4">
        <div className="h-9 w-40 shimmer rounded-xl" />
        <div className="h-[420px] shimmer rounded-3xl" />
        <div className="h-32 shimmer rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div className="max-w-xl mx-auto px-5 pt-8 pb-28">
        {/* Header */}
        <div className="flex items-end justify-between mb-5 sb-fade-in">
          <div>
            <p className="text-[0.65rem] font-bold tracking-[0.22em] uppercase mb-1" style={{ color: "var(--accent)" }}>
              StayBid
            </p>
            <h1 className="font-display font-light" style={{ fontSize: "clamp(1.8rem,5vw,2.4rem)", color: "var(--text-base)" }}>
              Explorer Passport
            </h1>
          </div>
          <Link
            href="/profile"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl sb-card-lift"
            style={{ border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}
          >
            👤
          </Link>
        </div>

        {/* Tabs */}
        <div
          className="flex rounded-2xl p-1 mb-6 sticky top-2 z-20"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow-soft)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
              style={
                tab === t.key
                  ? { background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)", color: "#fff", boxShadow: "0 4px 12px -5px rgba(201,145,26,0.6)" }
                  : { color: "var(--text-muted)" }
              }
            >
              <span className="mr-1">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── PASSPORT TAB ── */}
        {tab === "passport" && (
          <div className="space-y-7 sb-fade-in">
            {passport?.profile ? (
              <>
                <PassportBook
                  explorerId={passport.profile.explorer_id}
                  displayName={passport.profile.display_name || user?.name}
                  memberSince={passport.profile.member_since}
                  rank={passport.rank}
                  stats={passport.stats}
                />

                <MemberCard
                  explorerId={passport.profile.explorer_id}
                  displayName={passport.profile.display_name || user?.name}
                  rank={passport.rank}
                  walletBalance={walletBalance}
                  stayPoints={stayPoints}
                />

                <StampGrid stamps={passport.stamps || []} />
                <RewardLadder
                  rewards={passport.rewards || []}
                  stampCount={passport.stats?.stampCount || 0}
                  onClaimed={load}
                />
                <FamilyPassport myExplorerId={passport.profile.explorer_id} />
                <BadgeGrid badges={passport.badges || []} />

                {/* How it works */}
                <div
                  className="rounded-3xl p-5"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}
                >
                  <h3 className="font-display text-lg font-semibold mb-3" style={{ color: "var(--text-base)" }}>
                    How your passport grows
                  </h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { e: "🛏️", t: "Stay", s: "Book & complete a stay" },
                      { e: "🛂", t: "Collect", s: "A stamp lands automatically" },
                      { e: "⛰️", t: "Climb", s: "Earn XP → rank up" },
                      { e: "🎁", t: "Unlock", s: "Claim stamp rewards" },
                    ].map((x) => (
                      <div
                        key={x.t}
                        className="rounded-2xl p-3 sb-card-lift"
                        style={{ background: "var(--bg-page)", border: "1px solid var(--border-soft)" }}
                      >
                        <p className="text-xl">{x.e}</p>
                        <p className="font-bold text-sm mt-1" style={{ color: "var(--text-base)" }}>
                          {x.t}
                        </p>
                        <p className="text-[0.66rem] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {x.s}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-3xl p-8 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <p className="text-4xl mb-2">🛂</p>
                <p className="font-semibold" style={{ color: "var(--text-base)" }}>
                  Your passport is being prepared
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Complete a stay to mint your Explorer ID + first stamp.
                </p>
                <Link href="/hotels" className="inline-block mt-4 px-5 py-2.5 rounded-xl text-white font-bold text-sm sb-shimmer relative overflow-hidden"
                  style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                  <span className="relative" style={{ zIndex: 2 }}>Browse hotels</span>
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ── WALLET TAB ── */}
        {tab === "wallet" && (
          <WalletTab
            wallet={wallet}
            walletBalance={walletBalance}
            totalSpend={totalSpend}
            stayPoints={stayPoints}
            bids={bids}
            phone={user?.phone || user?.email}
            onGoRewards={() => switchTab("rewards")}
            onGoCodes={() => switchTab("codes")}
          />
        )}

        {/* ── REWARDS TAB ── */}
        {tab === "rewards" && (
          <RewardsTab
            rules={rules}
            stayPoints={stayPoints}
            lifetimeEarned={Number(points?.lifetime_earned || 0)}
            codes={codes}
            walletCredit={walletCredit}
            onRedeemed={load}
            onGoCodes={() => switchTab("codes")}
          />
        )}

        {/* ── CODES TAB ── */}
        {tab === "codes" && <CodesTab codes={codes} walletCredit={walletCredit} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WALLET TAB
// ═══════════════════════════════════════════════════════════════════════════
function WalletTab({
  wallet, walletBalance, totalSpend, stayPoints, bids, phone, onGoRewards, onGoCodes,
}: {
  wallet: any; walletBalance: number; totalSpend: number; stayPoints: number;
  bids: any[]; phone?: string; onGoRewards: () => void; onGoCodes: () => void;
}) {
  const txns: any[] = (wallet?.transactions && wallet.transactions.length > 0)
    ? wallet.transactions
    : bids
        .filter((b: any) => b.status === "ACCEPTED" || b.status === "CONFIRMED")
        .map((b: any) => ({
          id: `bid_${b.id}`, type: "DEBIT", amount: b.amount || 0,
          description: `Booking — ${b.hotel?.name || "Hotel"}`,
          createdAt: b.updatedAt || b.createdAt,
        }));

  return (
    <div className="space-y-4 sb-fade-in">
      {/* Balance card */}
      <div
        className="sb-balance-halo rounded-3xl p-5 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg,#0a0812 0%,#130f24 60%,#0a1020 100%)" }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none opacity-[0.09]"
          style={{ background: "radial-gradient(circle,#f0b429 0%,transparent 70%)", transform: "translate(30%,-30%)" }} />
        <p className="text-white/40 text-[0.6rem] tracking-[0.2em] uppercase font-semibold mb-1">Available Balance</p>
        <p className="font-display font-light text-white mb-1" style={{ fontSize: "clamp(2rem,5.5vw,2.9rem)" }}>
          ₹<CountUp value={walletBalance} duration={1100} />
        </p>
        <p className="text-white/40 text-xs tracking-wide">{phone}</p>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/10">
          <div>
            <p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">Credited</p>
            <p className="text-emerald-400 font-semibold text-sm">₹<CountUp value={wallet?.totalCredit ?? 0} duration={900} /></p>
          </div>
          <div className="border-x border-white/10 text-center">
            <p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">Total Spent</p>
            <p className="text-red-400 font-semibold text-sm">₹<CountUp value={totalSpend} duration={900} /></p>
          </div>
          <button onClick={onGoRewards} className="text-right">
            <p className="text-white/40 text-[0.58rem] uppercase tracking-widest mb-1">StayPoints</p>
            <p className="text-gold-400 font-semibold text-sm"><CountUp value={stayPoints} duration={900} /></p>
          </button>
        </div>
      </div>

      {/* Shortcuts */}
      <div className="grid grid-cols-2 gap-2.5">
        <button onClick={onGoRewards}
          className="rounded-2xl py-2.5 px-3 text-white font-bold text-xs relative overflow-hidden sb-card-lift sb-shimmer flex items-center justify-center gap-1.5"
          style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
          <span className="relative" style={{ zIndex: 2 }}>✨ Redeem Points</span>
        </button>
        <button onClick={onGoCodes}
          className="rounded-2xl py-2.5 px-3 font-bold text-xs sb-card-lift flex items-center justify-center gap-1.5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}>
          🎟️ My Codes
        </button>
      </div>

      {/* Transactions */}
      <h3 className="font-display text-lg font-semibold pt-2" style={{ color: "var(--text-base)" }}>
        Transactions
      </h3>
      {txns.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
          <p className="text-3xl mb-2">💳</p>
          <p className="font-medium text-sm" style={{ color: "var(--text-base)" }}>No transactions yet</p>
          <p className="text-xs mt-1">Complete a booking to see your spending here.</p>
        </div>
      ) : (
        <div className="space-y-2 sb-stagger">
          {txns.map((tx, i) => {
            const isCredit = String(tx.type || "").toUpperCase().includes("CREDIT");
            return (
              <div key={tx.id || i}
                className="rounded-2xl px-4 py-3.5 flex items-center justify-between sb-tx-row"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: isCredit ? "#e6f0e6" : "#fde8e4", color: isCredit ? "#4a6f4a" : "#a85b4e" }}>
                    {isCredit ? "+" : "−"}
                  </div>
                  <div>
                    <p className="text-sm font-medium leading-snug" style={{ color: "var(--text-base)" }}>
                      {tx.description || tx.type || "Transaction"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-bold" style={{ color: isCredit ? "#4a6f4a" : "#a85b4e" }}>
                  {isCredit ? "+" : "−"}₹{(tx.amount ?? 0).toLocaleString("en-IN")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// REWARDS TAB — StayPoints balance + redemption catalog
// ═══════════════════════════════════════════════════════════════════════════
function RewardsTab({
  rules, stayPoints, lifetimeEarned, codes, walletCredit, onRedeemed, onGoCodes,
}: {
  rules: RedemptionRule[]; stayPoints: number; lifetimeEarned: number;
  codes: RedemptionCode[]; walletCredit: number; onRedeemed: () => void; onGoCodes: () => void;
}) {
  const userTier: Tier = tierForBalance(lifetimeEarned);
  const [filter, setFilter] = useState<string>("all");
  const [confirm, setConfirm] = useState<RedemptionRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<RedemptionCode | null>(null);
  const [error, setError] = useState("");

  // monthly counts per rule
  const monthlyCounts = useMemo(() => {
    const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0);
    const m: Record<string, number> = {};
    for (const c of codes) {
      if (new Date(c.issued_at).getTime() >= first.getTime()) m[c.rule_id] = (m[c.rule_id] || 0) + 1;
    }
    return m;
  }, [codes]);

  const kinds = useMemo(() => Array.from(new Set(rules.map((r) => r.kind))), [rules]);
  const filtered = filter === "all" ? rules : rules.filter((r) => r.kind === filter);

  const doRedeem = async () => {
    if (!confirm) return;
    setBusy(true); setError("");
    try {
      const res = await api.redeemRule({ ruleId: confirm.id });
      if (res?.ok && res?.code) {
        setSuccess(res.code);
        setConfirm(null);
        onRedeemed();
      } else {
        setError(res?.error || "Couldn't redeem — try again.");
      }
    } catch {
      setError("Couldn't redeem — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 sb-fade-in">
      {/* Balance strip */}
      <div className="rounded-3xl p-5 sb-card-lift relative overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
        <p className="text-[0.6rem] uppercase tracking-widest font-bold" style={{ color: "var(--text-muted)" }}>StayPoints</p>
        <p className="font-display text-4xl font-bold leading-none mt-1" style={{ color: "var(--text-base)" }}>
          <CountUp value={stayPoints} duration={1000} />
        </p>
        <div className="flex items-center gap-3 mt-3">
          <span className="text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
            <span className="sb-pulse-dot" style={{ background: "var(--accent)" }} />
            {userTier} tier
          </span>
          {walletCredit > 0 && (
            <span className="text-xs font-semibold" style={{ color: "#4a6f4a" }}>
              · ₹{fmt(walletCredit)} wallet credit
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      {kinds.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["all", ...kinds].map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap sb-card-lift"
              style={filter === k
                ? { background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)", color: "#fff" }
                : { background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
              {k === "all" ? "All" : `${kindIcon(k as any)} ${k.replace("_", " ")}`}
            </button>
          ))}
        </div>
      )}

      {/* Catalog */}
      {filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
          <p className="text-3xl mb-2">✨</p>
          <p className="text-sm">No rewards available right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sb-stagger">
          {filtered.map((r) => {
            const v = canUserRedeem({ rule: r, pointsBalance: stayPoints, userTier, monthlyCount: monthlyCounts[r.id] || 0 });
            return (
              <div key={r.id}
                className="rounded-2xl p-4 flex items-center gap-3 sb-card-lift"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                  style={{ background: "linear-gradient(135deg,#E7CFA0,#C9A66B)" }}>
                  {r.icon || kindIcon(r.kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>{r.title}</p>
                  {r.description && (
                    <p className="text-[0.66rem] mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>{r.description}</p>
                  )}
                  <p className="text-xs font-bold mt-1" style={{ color: "var(--accent)" }}>{fmt(r.points_cost)} pts</p>
                </div>
                <button
                  onClick={() => v.ok && setConfirm(r)}
                  disabled={!v.ok}
                  className="shrink-0 text-[0.72rem] font-bold px-3.5 py-2 rounded-xl text-white relative overflow-hidden disabled:opacity-50"
                  style={{ background: v.ok ? "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" : "var(--bg-pill)" }}
                  title={v.ok ? "Redeem" : (v as any).error}>
                  <span className="relative" style={{ zIndex: 2, color: v.ok ? "#fff" : "var(--text-muted)" }}>
                    {v.ok ? "Redeem" : "🔒"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !busy && setConfirm(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="text-3xl text-center mb-2">{confirm.icon || kindIcon(confirm.kind)}</p>
            <h3 className="font-display text-xl font-semibold text-center text-luxury-900">{confirm.title}</h3>
            <p className="text-sm text-luxury-500 text-center mt-1">{confirm.description}</p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <span className="text-sm font-bold text-gold-600">{fmt(confirm.points_cost)} pts</span>
              <span className="text-luxury-300">→</span>
              <span className="text-sm font-bold text-luxury-900">{fmt(stayPoints - confirm.points_cost)} left</span>
            </div>
            {error && <p className="text-xs text-red-500 text-center mt-3">{error}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={() => setConfirm(null)} disabled={busy}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-luxury-200 text-luxury-600">
                Cancel
              </button>
              <button onClick={doRedeem} disabled={busy}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white relative overflow-hidden sb-shimmer"
                style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                <span className="relative" style={{ zIndex: 2 }}>{busy ? "Redeeming…" : "Confirm"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success modal */}
      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => setSuccess(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-4xl mb-2">🎉</p>
            <h3 className="font-display text-xl font-semibold text-luxury-900">Reward unlocked!</h3>
            <p className="text-sm text-luxury-500 mt-1">{success.title}</p>
            <div className="mt-4 rounded-2xl border-2 border-dashed border-gold-300 bg-gold-50 py-3">
              <p className="font-mono text-lg font-bold text-luxury-900 tracking-wide">{success.code}</p>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setSuccess(null)}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm border border-luxury-200 text-luxury-600">
                Close
              </button>
              <button onClick={() => { setSuccess(null); onGoCodes(); }}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white"
                style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                View in Codes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CODES TAB — issued redemption codes
// ═══════════════════════════════════════════════════════════════════════════
function CodesTab({ codes, walletCredit }: { codes: RedemptionCode[]; walletCredit: number }) {
  const [filter, setFilter] = useState<"all" | "active" | "used" | "expired">("all");
  const [copied, setCopied] = useState<string | null>(null);

  const now = Date.now();
  const withStatus = codes.map((c) => {
    let status = c.status;
    if (status === "active" && new Date(c.expires_at).getTime() < now) status = "expired";
    return { ...c, status };
  });
  const filtered = filter === "all" ? withStatus : withStatus.filter((c) => c.status === filter);

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 1400);
  };

  const useAtCheckout = (c: RedemptionCode) => {
    setPendingRedemption({
      code: c.code, kind: c.kind, value_inr: Number(c.value_inr || 0),
      title: c.title || "Reward", expires_at: c.expires_at,
    });
    setCopied(`queued-${c.code}`);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className="space-y-4 sb-fade-in">
      {walletCredit > 0 && (
        <div className="rounded-2xl p-4 sb-card-lift flex items-center justify-between"
          style={{ background: "linear-gradient(160deg,#fffdf8,#fbf3e2)", border: "1px solid rgba(201,166,107,0.4)" }}>
          <div>
            <p className="text-[0.6rem] uppercase tracking-widest font-bold" style={{ color: "#8B6914" }}>Wallet Credit</p>
            <p className="font-display text-2xl font-bold" style={{ color: "var(--text-base)" }}>₹<CountUp value={walletCredit} duration={900} /></p>
          </div>
          <span className="text-2xl">💰</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {(["all", "active", "used", "expired"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-xs font-bold capitalize sb-card-lift"
            style={filter === f
              ? { background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)", color: "#fff" }
              : { background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
          <p className="text-3xl mb-2">🎟️</p>
          <p className="text-sm font-medium" style={{ color: "var(--text-base)" }}>No codes here yet</p>
          <p className="text-xs mt-1">Redeem points or claim stamp rewards to get codes.</p>
        </div>
      ) : (
        <div className="space-y-3 sb-stagger">
          {filtered.map((c) => {
            const st = c.status;
            const stColor = st === "active" ? "#4a6f4a" : st === "used" ? "#6b7280" : "#a85b4e";
            const stBg = st === "active" ? "#e6f0e6" : st === "used" ? "#eef0f2" : "#fde8e4";
            return (
              <div key={c.id}
                className="rounded-2xl p-4 sb-card-lift"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">{kindIcon(c.kind)}</span>
                    <div>
                      <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>{c.title || "Reward"}</p>
                      {Number(c.value_inr) > 0 && (
                        <p className="text-[0.66rem] mt-0.5" style={{ color: "var(--text-muted)" }}>Worth ₹{fmt(Number(c.value_inr))}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-[0.55rem] font-bold px-2 py-0.5 rounded-full uppercase" style={{ background: stBg, color: stColor }}>
                    {st}
                  </span>
                </div>

                <button onClick={() => copy(c.code)}
                  className="w-full mt-3 rounded-xl border-2 border-dashed py-2.5 flex items-center justify-center gap-2"
                  style={{ borderColor: "rgba(201,166,107,0.4)", background: "var(--bg-page)" }}>
                  <span className="font-mono text-base font-bold tracking-wide" style={{ color: "var(--text-base)" }}>{c.code}</span>
                  <span className="text-xs" style={{ color: copied === c.code ? "#4a6f4a" : "var(--text-muted)" }}>
                    {copied === c.code ? "✓ Copied" : "Tap to copy"}
                  </span>
                </button>

                <div className="flex items-center justify-between mt-2.5">
                  <p className="text-[0.6rem]" style={{ color: "var(--text-muted)" }}>
                    Expires {new Date(c.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  {st === "active" && (c.kind === "coupon" || c.kind === "voucher") && (
                    <button onClick={() => useAtCheckout(c)}
                      className="text-[0.66rem] font-bold px-3 py-1.5 rounded-lg text-white"
                      style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                      {copied === `queued-${c.code}` ? "✓ Queued" : "Use at checkout"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PassportPage() {
  return (
    <Suspense fallback={null}>
      <PassportHub />
    </Suspense>
  );
}
