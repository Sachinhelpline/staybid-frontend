"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const TIER: Record<number, { label: string; color: string }> = {
  1: { label: "Starter",  color: "#94a3b8" },
  2: { label: "Verified", color: "#c9911a" },
  3: { label: "Elite",    color: "#7c3aed" },
};

const TOKEN = () => typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "";
const AUTH_H = () => ({ Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" });

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n || 0);
}

export default function PublicInfluencerPage() {
  const { id }  = useParams() as { id: string };
  const router  = useRouter();
  const [inf, setInf]         = useState<any>(null);
  const [videos, setVideos]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [following, setFollowing]   = useState(false);
  const [followLoading, setFL]      = useState(false);
  const [followers, setFollowers]   = useState(0);

  useEffect(() => {
    fetch(`/api/influencer/public/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Not found");
        return r.json();
      })
      .then((d) => {
        setInf(d.influencer);
        setVideos(d.videos || []);
        setFollowers(d.influencer?.totalFollowers || 0);
      })
      .catch((e) => setError(e?.message || "Not found"))
      .finally(() => setLoading(false));
  }, [id]);

  // Check follow state once we know the influencer's row id
  useEffect(() => {
    if (!inf?.id || !TOKEN()) return;
    fetch(`/api/influencer/follow/${inf.id}`, { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setFollowing(!!d.following))
      .catch(() => {});
  }, [inf?.id]);

  async function toggleFollow() {
    if (!inf?.id) return;
    if (!TOKEN()) { router.push(`/auth?next=/influencer/public/${id}`); return; }
    setFL(true);
    const prev = following;
    setFollowing(!prev);
    setFollowers(f => prev ? Math.max(0, f - 1) : f + 1);
    try {
      await fetch(`/api/influencer/follow/${inf.id}`, { method: "POST", headers: AUTH_H() });
    } catch {
      setFollowing(prev);
      setFollowers(f => prev ? f + 1 : Math.max(0, f - 1));
    }
    setFL(false);
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50"><p className="text-luxury-500 text-sm">Loading…</p></div>;
  }
  if (error || !inf) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-luxury-50">
        <div className="text-center">
          <p className="text-2xl">🔍</p>
          <p className="text-luxury-700 text-lg font-semibold mt-2">Creator not found</p>
          <p className="text-luxury-500 text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const tier = TIER[inf.tier] || TIER[1];

  return (
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">

        {/* Hero card */}
        <div className="card-luxury p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10"
            style={{ background: `radial-gradient(circle, ${tier.color}, transparent 70%)` }} />
          <div className="flex items-start gap-4 relative">
            {inf.avatarUrl ? (
              <img src={inf.avatarUrl} alt={inf.name || "creator"} className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-md shrink-0" />
            ) : (
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0 ring-4 ring-white shadow-md"
                style={{ background: `linear-gradient(135deg, ${tier.color}, #f0b429)` }}>
                {(inf.name || "C").slice(0, 1).toUpperCase()}
              </div>
            )}
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

          {/* Follow button */}
          <button
            onClick={toggleFollow}
            disabled={followLoading}
            className={`mt-5 w-full py-3 rounded-2xl font-bold text-sm transition-all ${
              following
                ? "bg-white border-2 border-luxury-200 text-luxury-700 hover:border-luxury-300"
                : "text-white shadow-gold hover:shadow-lg"
            } disabled:opacity-50`}
            style={following ? {} : { background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
            {following ? "✓ Following" : "+ Follow"}
          </button>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <Stat label="Followers" value={fmtNum(followers)} />
          <Stat label="Reels"     value={fmtNum(videos.length)} />
          <Stat label="Hotels"    value={String(inf.totalHotelsReviewed || 0)} />
          <Stat label="Rating"    value={inf.avgRatingGiven ? `${inf.avgRatingGiven.toFixed(1)}★` : "—"} />
        </div>

        {/* Interests */}
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

        {/* Reels grid */}
        <div className="card-luxury p-5 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-luxury-900 flex items-center gap-2">🎬 Reels <span className="text-xs font-semibold text-luxury-500">({videos.length})</span></h2>
            {videos.length > 0 && (
              <Link href="/reels" className="text-xs font-bold text-gold-700 hover:text-gold-800">Open feed →</Link>
            )}
          </div>
          {videos.length === 0 ? (
            <p className="text-center text-luxury-500 text-sm py-8">No reels published yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {videos.map((v) => (
                <Link key={v.id} href={`/reels`} className="relative aspect-[9/16] rounded-xl overflow-hidden bg-luxury-100 group">
                  {v.thumbnail_url
                    ? <img src={v.thumbnail_url} alt={v.title || "reel"} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    : <video src={v.s3_url} className="w-full h-full object-cover" muted playsInline />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-white text-[0.65rem] font-bold drop-shadow">
                    <span>▶ {fmtNum(v.views_count || 0)}</span>
                    <span>❤ {fmtNum(v.likes_count || 0)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-luxury-500 text-xs mt-6">
          Member since {new Date(inf.memberSince).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-luxury p-3 text-center">
      <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className="font-display text-lg font-bold text-luxury-900 mt-1 leading-none">{value}</p>
    </div>
  );
}
