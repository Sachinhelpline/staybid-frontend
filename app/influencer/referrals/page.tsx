"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function InfluencerReferralsPage() {
  const [inf, setInf] = useState<any>(null);
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [hotelId, setHotelId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const me = await api.getMyInfluencer().catch(() => null);
    const i = me?.influencer;
    setInf(i);
    if (i) {
      const r = await api.listReferralCodes(i.id).catch(() => null);
      setCodes(r?.codes || []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!inf) return;
    setCreating(true);
    try {
      await api.createReferralCode(inf.id, { label: label.trim() || null, hotelId: hotelId.trim() || null });
      setLabel(""); setHotelId("");
      await load();
    } finally { setCreating(false); }
  }

  function shareUrl(code: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://staybids.in";
    return `${origin}/r/${code}`;
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 1800);
    } catch {}
  }

  if (loading) return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Loading…</div>;
  if (!inf)    return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Not registered.</div>;

  const totalClicks      = codes.reduce((s, c) => s + (c.clicks_count || 0), 0);
  const totalConversions = codes.reduce((s, c) => s + (c.conversions_count || 0), 0);
  const cvr = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) + "%" : "—";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Codes"       value={String(codes.length)} />
        <Stat label="Clicks"      value={totalClicks.toLocaleString("en-IN")} />
        <Stat label="Conversion"  value={cvr} />
      </div>

      <div className="card-luxury p-5">
        <h2 className="font-bold text-luxury-900 mb-3">Create New Referral Link</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Instagram Story)" className="input-luxury w-full" />
          <input value={hotelId} onChange={(e) => setHotelId(e.target.value)}
            placeholder="Hotel ID (optional — leave blank for general)" className="input-luxury w-full" />
        </div>
        <button onClick={create} disabled={creating}
          className="btn-luxury px-5 py-2.5 rounded-xl font-bold disabled:opacity-50">
          {creating ? "Creating…" : "Generate Code"}
        </button>
        <p className="text-xs text-luxury-500 mt-2">
          Code is auto-generated. Anyone who books via your link earns you 12% commission.
        </p>
      </div>

      <div className="card-luxury p-0 overflow-hidden">
        {codes.length === 0 ? (
          <div className="p-8 text-center text-luxury-500 text-sm">
            No referral codes yet. Generate one above.
          </div>
        ) : (
          <div className="divide-y divide-luxury-100">
            {codes.map((c) => (
              <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-base font-bold text-gold-700">{c.code}</span>
                    {c.label && <span className="text-xs text-luxury-500 truncate">{c.label}</span>}
                    {c.hotel_id && <span className="text-[0.6rem] uppercase tracking-wider font-bold text-luxury-500 px-2 py-0.5 rounded-full bg-luxury-100">hotel-locked</span>}
                  </div>
                  <p className="text-xs text-luxury-500 mt-1 truncate">{shareUrl(c.code)}</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-center">
                    <p className="font-bold text-luxury-800">{c.clicks_count || 0}</p>
                    <p className="text-[0.6rem] uppercase tracking-wider text-luxury-500">clicks</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-luxury-800">{c.conversions_count || 0}</p>
                    <p className="text-[0.6rem] uppercase tracking-wider text-luxury-500">conversions</p>
                  </div>
                  <button onClick={() => copy(c.code)}
                    className="px-3 py-2 rounded-xl text-xs font-bold border border-gold-400 text-gold-700 hover:bg-gold-50">
                    {copied === c.code ? "Copied ✓" : "Copy Link"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-luxury p-4 text-center">
      <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className="font-display text-xl md:text-2xl font-bold text-luxury-900 mt-1 leading-none">{value}</p>
    </div>
  );
}
