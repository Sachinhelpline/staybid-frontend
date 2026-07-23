"use client";
// MemberCard — a premium VIRTUAL membership card (NOT a bank card). Shows the
// Explorer ID, rank, holder name, wallet balance + StayPoints. Pure flex/cred,
// no real money rails. Animated foil shimmer on the rank chip.
import { CountUp } from "@/components/CountUp";
import type { RankState } from "@/lib/passport/engine";

export function MemberCard({
  explorerId,
  displayName,
  rank,
  walletBalance,
  stayPoints,
}: {
  explorerId: string;
  displayName?: string | null;
  rank: RankState;
  walletBalance: number;
  stayPoints: number;
}) {
  const R = rank.rank;
  return (
    <div
      className="rounded-3xl p-5 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg,#0a0812 0%,#1a1326 55%,#0a1020 100%)",
        boxShadow: "0 18px 50px -20px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,166,107,0.25)",
      }}
    >
      <style>{`
        @keyframes mcFoil { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .mc-foil { background-size:220% 220%; animation: mcFoil 3.2s ease infinite; }
        @keyframes mcIdSheen { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .mc-id {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-weight: 800; font-size: 0.94rem; letter-spacing: 0.04em;
          background: linear-gradient(110deg,#FCEFC6,#F0D060 45%,#C79A3A 70%,#FCEFC6);
          background-size: 220% 220%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: mcIdSheen 4s ease infinite;
          text-shadow: 0 1px 1px rgba(0,0,0,0.35);
        }
      `}</style>
      {/* glow */}
      <div
        className="absolute top-0 right-0 w-56 h-56 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${R.color}66 0%, transparent 70%)`, transform: "translate(30%,-30%)", opacity: 0.5 }}
      />

      <div className="flex items-center justify-between">
        <p className="text-[0.6rem] tracking-[0.3em] uppercase font-bold" style={{ color: "rgba(212,175,55,0.9)" }}>
          StayBid Member
        </p>
        <span className="mc-foil text-[0.66rem] font-bold px-2.5 py-1 rounded-full text-white" style={{ background: R.gradient }}>
          {R.emoji} {R.label}
        </span>
      </div>

      <p className="font-display text-2xl font-light mt-3 text-white">{displayName || "Traveller"}</p>
      <p className="mc-id mt-1.5">{explorerId}</p>

      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/10">
        <div>
          <p className="text-white/40 text-[0.55rem] uppercase tracking-widest mb-1">Wallet</p>
          <p className="text-emerald-400 font-semibold text-base tabular-nums">
            ₹<CountUp value={walletBalance} duration={900} />
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-[0.55rem] uppercase tracking-widest mb-1">StayPoints</p>
          <p className="text-gold-400 font-semibold text-base tabular-nums">
            <CountUp value={stayPoints} duration={900} />
          </p>
        </div>
      </div>
    </div>
  );
}
