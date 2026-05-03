"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const TIER: Record<number, { label: string; color: string }> = {
  1: { label: "Starter",  color: "#94a3b8" },
  2: { label: "Verified", color: "#c9911a" },
  3: { label: "Elite",    color: "#7c3aed" },
};

export default function PublicInfluencerPage() {
  const { id } = useParams() as { id: string };
  const [inf, setInf] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/influencer/public/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Not found");
        return r.json();
      })
      .then((d) => setInf(d.influencer))
      .catch((e) => setError(e?.message || "Not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50"><p className="text-luxury-500 text-sm">Loading…</p></div>;
  }
  if (error || !inf) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50">
      <div className="text-center">
        <p className="text-2xl">🔍</p>
        <p className="text-luxury-700 text-lg font-semibold mt-2">Creator not found</p>
        <p className="text-luxury-500 text-sm mt-1">{error}</p>
      </div>
    </div>;
  }

  const tier = TIER[inf.tier] || TIER[1];

  return (
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">
        <div className="card-luxury p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10"
            style={{ background: `radial-gradient(circle, ${tier.color}, transparent 70%)` }} />
          <div className="flex items-start gap-4 relative">
            <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${tier.color}, #f0b429)` }}>
              {(inf.name || "C").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-2xl md:text-3xl font-bold text-luxury-900 leading-tight">
                {inf.name || "StayBid Creator"}
              </h1>
              <p className="text-xs uppercase tracking-widest font-bold mt-1" style={{ color: tier.color }}>
                {tier.label} · {inf.location || "India"}
              </p>
              <p className="text-luxury-600 text-sm mt-3">{inf.bio || "Travel & hospitality content creator."}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Stat label="Followers"  value={(inf.totalFollowers || 0).toLocaleString("en-IN")} />
          <Stat label="Hotels Reviewed" value={String(inf.totalHotelsReviewed || 0)} />
          <Stat label="Avg Rating" value={inf.avgRatingGiven ? `${inf.avgRatingGiven.toFixed(1)}★` : "—"} />
        </div>

        {inf.interests?.length > 0 && (
          <div className="card-luxury p-5 mt-4">
            <h2 className="text-xs uppercase tracking-widest font-bold text-luxury-500 mb-3">Interests</h2>
            <div className="flex flex-wrap gap-2">
              {inf.interests.map((i: string) => (
                <span key={i} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-luxury-100 text-luxury-700">{i}</span>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-luxury-500 text-xs mt-6">
          Member since {new Date(inf.memberSince).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-luxury p-4 text-center">
      <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className="font-display text-xl font-bold text-luxury-900 mt-1 leading-none">{value}</p>
    </div>
  );
}
