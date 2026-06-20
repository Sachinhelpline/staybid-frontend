"use client";
// PassportBook — the "alive" hero. A closed premium passport book that opens
// with a 3D cover-flip on first tap (or auto after mount), revealing the
// digital Explorer Passport card: rank ring + XP bar + Explorer ID + stats.
// Tapping the book toggles open/closed for that satisfying physical feel.
import { useEffect, useState } from "react";
import { CountUp } from "@/components/CountUp";
import type { RankState, PassportStats } from "@/lib/passport/engine";

type Props = {
  explorerId: string;
  displayName?: string | null;
  memberSince?: string | null;
  rank: RankState;
  stats: PassportStats;
};

function sinceLabel(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function PassportBook({ explorerId, displayName, memberSince, rank, stats }: Props) {
  const [open, setOpen] = useState(false);

  // Auto-open shortly after mount — gives the "book opening" reveal on landing.
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 450);
    return () => clearTimeout(t);
  }, []);

  const R = rank.rank;

  return (
    <div className="pb-stage" role="group" aria-label="Explorer Passport">
      <style>{`
        .pb-stage { perspective: 1600px; display:flex; justify-content:center; }
        .pb-book {
          position: relative; width: 100%; max-width: 380px;
          aspect-ratio: 1 / 1.18; transform-style: preserve-3d;
          cursor: pointer;
        }
        /* Inside page (digital card) — sits behind the cover */
        .pb-page {
          position:absolute; inset:0; border-radius: 22px;
          background:
            radial-gradient(120% 80% at 100% 0%, rgba(201,166,107,0.18), transparent 60%),
            linear-gradient(160deg,#fffdf8 0%,#fbf3e2 55%,#f4e7cf 100%);
          box-shadow: 0 22px 60px -24px rgba(31,26,15,0.55), inset 0 0 0 1px rgba(201,166,107,0.22);
          padding: 22px 20px; display:flex; flex-direction:column;
          opacity: 0; transition: opacity .4s ease .25s;
        }
        .pb-book.is-open .pb-page { opacity: 1; }
        /* Cover — flips open on the left spine */
        .pb-cover {
          position:absolute; inset:0; border-radius: 22px;
          transform-origin: left center; transform: rotateY(0deg);
          transition: transform .9s cubic-bezier(.6,.02,.2,1), box-shadow .9s ease;
          backface-visibility: hidden;
          background:
            radial-gradient(130% 90% at 50% 0%, rgba(255,255,255,0.10), transparent 55%),
            linear-gradient(160deg,#2a2417 0%,#1f1a0f 60%,#171206 100%);
          box-shadow: 0 22px 60px -22px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(201,166,107,0.28);
          color:#f3e6c8; padding: 26px 22px; display:flex; flex-direction:column;
          z-index: 3;
        }
        .pb-book.is-open .pb-cover { transform: rotateY(-152deg); box-shadow: 0 30px 70px -22px rgba(0,0,0,0.6); }
        .pb-spine { position:absolute; left:0; top:0; bottom:0; width:7px; border-radius:22px 0 0 22px;
          background:linear-gradient(180deg,#d4af37,#8b6914); opacity:.85; }
        .pb-emboss {
          border:1.5px solid rgba(201,166,107,0.5); border-radius:14px; padding:18px 16px;
          margin-top:auto; text-align:center; background:rgba(255,255,255,0.02);
        }
        .pb-tap {
          position:absolute; bottom:14px; left:50%; transform:translateX(-50%);
          font-size:.6rem; letter-spacing:.18em; text-transform:uppercase; color:rgba(243,230,200,0.6);
          animation: pbPulse 2.2s ease-in-out infinite;
        }
        @keyframes pbPulse { 0%,100%{opacity:.4} 50%{opacity:.9} }
        .pb-ring { width:96px; height:96px; }
        @media (prefers-reduced-motion: reduce){
          .pb-cover { transition:none } .pb-page{ transition:none }
        }
      `}</style>

      <div
        className={`pb-book ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={open ? "Tap to close" : "Tap to open your passport"}
      >
        {/* INSIDE PAGE — the digital passport card */}
        <div className="pb-page">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.6rem] tracking-[0.22em] uppercase font-bold" style={{ color: "#8B6914" }}>
                Explorer Passport
              </p>
              <p className="font-display text-[1.45rem] leading-tight font-semibold" style={{ color: "#3A2D10" }}>
                {displayName || "Traveller"}
              </p>
            </div>
            {/* Rank ring */}
            <RankRing rank={rank} />
          </div>

          {/* Rank label + blurb */}
          <div className="mt-2 flex items-center gap-2">
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
              style={{ background: R.gradient }}
            >
              {R.emoji} {R.label}
            </span>
            <span className="text-[0.66rem]" style={{ color: "#6E5430" }}>
              {R.blurb}
            </span>
          </div>

          {/* XP progress */}
          <div className="mt-3">
            <div className="flex justify-between text-[0.62rem] font-semibold mb-1" style={{ color: "#6E5430" }}>
              <span>
                <CountUp value={rank.xp} duration={1000} /> XP
              </span>
              <span>
                {rank.next ? `${rank.xpForNext} → ${rank.next.label}` : "Top rank reached 🏆"}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(201,166,107,0.22)" }}>
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${rank.progressPct}%`, background: R.gradient }}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <Stat label="Stamps" value={stats.stampCount} />
            <Stat label="Cities" value={stats.citiesVisited} />
            <Stat label="Stays" value={stats.propertiesVisited} />
          </div>

          {/* Explorer ID footer */}
          <div className="mt-auto pt-3 flex items-end justify-between border-t" style={{ borderColor: "rgba(201,166,107,0.25)" }}>
            <div>
              <p className="text-[0.55rem] uppercase tracking-widest font-bold" style={{ color: "#8B6914" }}>
                Explorer ID
              </p>
              <p className="font-mono text-sm font-bold" style={{ color: "#3A2D10" }}>
                {explorerId}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[0.55rem] uppercase tracking-widest font-bold" style={{ color: "#8B6914" }}>
                Member Since
              </p>
              <p className="text-sm font-semibold" style={{ color: "#3A2D10" }}>
                {sinceLabel(memberSince)}
              </p>
            </div>
          </div>
        </div>

        {/* COVER */}
        <div className="pb-cover">
          <div className="pb-spine" />
          <p className="text-[0.6rem] tracking-[0.3em] uppercase font-bold" style={{ color: "#d4af37" }}>
            StayBid
          </p>
          <p className="font-display text-2xl font-light mt-1" style={{ color: "#f3e6c8" }}>
            Explorer Passport
          </p>

          <div className="pb-emboss">
            <p className="text-4xl mb-1">🛂</p>
            <p className="font-display text-lg" style={{ color: "#f3e6c8" }}>
              {displayName || "Traveller"}
            </p>
            <p className="font-mono text-[0.7rem] mt-1" style={{ color: "rgba(212,175,55,0.85)" }}>
              {explorerId}
            </p>
          </div>

          <div className="pb-tap">Tap to open</div>
        </div>
      </div>
    </div>
  );
}

function RankRing({ rank }: { rank: RankState }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const off = c - (rank.progressPct / 100) * c;
  return (
    <svg className="pb-ring" viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id="pb-rank-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={rank.rank.color} />
          <stop offset="100%" stopColor="#8B6914" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(201,166,107,0.22)" strokeWidth="7" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="url(#pb-rank-grad)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset 1s ease" }}
      />
      <text x="50" y="46" textAnchor="middle" fontSize="26">
        {rank.rank.emoji}
      </text>
      <text x="50" y="68" textAnchor="middle" fontSize="13" fontWeight="700" fill="#3A2D10">
        {rank.progressPct}%
      </text>
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-xl py-2 text-center"
      style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(201,166,107,0.2)" }}
    >
      <p className="font-display text-xl font-bold" style={{ color: "#3A2D10" }}>
        <CountUp value={value} duration={900} />
      </p>
      <p className="text-[0.55rem] uppercase tracking-widest font-bold" style={{ color: "#8B6914" }}>
        {label}
      </p>
    </div>
  );
}
