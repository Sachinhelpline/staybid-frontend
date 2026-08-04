"use client";
// PartnerPassportTab (v265, Phase 2a) — the hotel's "Passport Guests" view.
// Read-only: every Explorer Passport holder who collected a stamp at this
// property, with rank + stamps-here + lifetime stamps. Helps hosts recognise
// and reward repeat / high-rank travellers at check-in.
import { useEffect, useState } from "react";
import { Stamp, RotateCw, Users, Building2 } from "lucide-react";

type Guest = {
  userId: string;
  explorerId: string | null;
  name: string;
  phoneMasked: string;
  rankKey: string;
  rankLabel: string;
  rankEmoji: string;
  rankColor: string;
  rankGradient: string;
  xp: number;
  progressPct: number;
  stampsHere: number;
  lifetimeStamps: number;
  citiesVisited: number;
  lastVisit: string | null;
  memberSince: string | null;
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function PartnerPassportTab() {
  const [loading, setLoading] = useState(true);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [summary, setSummary] = useState<{ guests: number; stamps: number; hotels: number } | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    setErr("");
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
    fetch("/api/partner/passport-guests", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) { setErr(d.error); return; }
        setGuests(d?.guests || []);
        setSummary(d?.summary || null);
      })
      .catch(() => setErr("Couldn't load passport guests."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-luxury-100 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold text-luxury-900 inline-flex items-center gap-2"><Stamp size={19} strokeWidth={2.2} aria-hidden />Passport Guests</h2>
          <p className="text-xs text-luxury-500 mt-0.5">Explorer Passport holders who stamped at your property.</p>
        </div>
        <button onClick={load} className="text-xs font-semibold text-luxury-500 border border-luxury-200 px-3 py-1.5 rounded-xl hover:border-gold-300 inline-flex items-center gap-1.5">
          <RotateCw size={13} strokeWidth={2.3} aria-hidden />Refresh
        </button>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { label: "Passport guests", value: summary.guests, Ic: Users },
            { label: "Stamps here", value: summary.stamps, Ic: Stamp },
            { label: "Properties", value: summary.hotels, Ic: Building2 },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl p-3 text-center border border-gold-200 bg-gold-50">
              <s.Ic size={18} strokeWidth={2.1} aria-hidden className="mx-auto text-gold-600" />
              <p className="font-display text-xl font-bold text-luxury-900 mt-1">{s.value}</p>
              <p className="text-[0.63rem] uppercase tracking-widest font-bold text-gold-700">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {err && (
        <div className="rounded-xl px-3 py-2 text-xs font-medium bg-red-50 text-red-600 border border-red-100">{err}</div>
      )}

      {guests.length === 0 && !err ? (
        <div className="rounded-2xl p-8 text-center border border-luxury-100 bg-luxury-50">
          <Stamp className="mx-auto mb-2 text-luxury-300" size={30} strokeWidth={1.9} aria-hidden />
          <p className="font-semibold text-luxury-900">No passport guests yet</p>
          <p className="text-xs text-luxury-500 mt-1">
            When a guest completes a stay here, they collect a stamp and appear in this list.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {guests.map((g) => (
            <div key={g.userId} className="rounded-2xl p-4 bg-white border border-luxury-100 shadow-luxury flex items-center gap-3">
              {/* Avatar */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
                style={{ background: g.rankGradient }}
              >
                {g.name.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm text-luxury-900 leading-tight">{g.name}</p>
                  <span className="text-[0.63rem] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: g.rankGradient }}>
                    {g.rankEmoji} {g.rankLabel}
                  </span>
                </div>
                <p className="text-[0.66rem] text-luxury-400 mt-0.5 font-mono">
                  {g.explorerId || g.phoneMasked || "—"}
                </p>
                <p className="text-[0.66rem] text-luxury-500 mt-0.5">
                  Last visit {fmtDate(g.lastVisit)}
                </p>
              </div>

              {/* Stats */}
              <div className="text-right shrink-0">
                <p className="font-display text-xl font-bold text-gold-600 leading-none">{g.stampsHere}</p>
                <p className="text-[0.63rem] uppercase tracking-widest font-bold text-luxury-400">stamps here</p>
                <p className="text-[0.63rem] text-luxury-500 mt-1">{g.lifetimeStamps} lifetime · {g.xp} XP</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
