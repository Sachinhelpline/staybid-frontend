"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n || 0);
}

export default function HashtagPage() {
  const { name } = useParams() as { name: string };
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/hashtags/${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50"><p className="text-luxury-500 text-sm">Loading #{name}…</p></div>;
  }

  if (!data || data.count === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-luxury-50 px-8 text-center">
        <div className="text-6xl mb-4">🔖</div>
        <p className="font-display text-2xl font-bold text-luxury-900">#{name}</p>
        <p className="text-luxury-500 text-sm mt-2">No reels yet for this tag.</p>
        <Link href="/reels" className="btn-luxury px-6 py-2 rounded-full mt-6">Browse Reels</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24">

        {/* Hero */}
        <div className="card-luxury p-6 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 text-[12rem] font-black opacity-5 text-gold-700 leading-none select-none pointer-events-none">#</div>
          <p className="text-xs uppercase tracking-widest font-bold text-luxury-500">Hashtag</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-luxury-900 mt-1">
            #{data.tag}
          </h1>
          <p className="text-luxury-600 text-sm mt-2">
            <span className="font-bold text-gold-700">{fmtNum(data.count)}</span> {data.count === 1 ? "reel" : "reels"}
          </p>

          <Link
            href={`/reels?tag=${encodeURIComponent(data.tag)}`}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-white text-sm shadow-gold"
            style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
            ▶ Watch in Reels
          </Link>
        </div>

        {/* Related tags */}
        {data.related?.length > 0 && (
          <div className="card-luxury p-5 mt-4">
            <h2 className="text-xs uppercase tracking-widest font-bold text-luxury-500 mb-3">Related</h2>
            <div className="flex flex-wrap gap-2">
              {data.related.map((r: any) => (
                <Link key={r.tag} href={`/tag/${encodeURIComponent(r.tag)}`}
                  className="px-3 py-1.5 rounded-full text-xs font-bold bg-luxury-100 text-luxury-700 hover:bg-gold-50 hover:text-gold-700 transition-colors">
                  #{r.tag} <span className="text-luxury-400 font-semibold">{r.uses}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Reels grid */}
        <div className="card-luxury p-5 mt-4">
          <h2 className="font-bold text-luxury-900 mb-4">Top reels</h2>
          <div className="grid grid-cols-3 gap-2">
            {data.videos.map((v: any) => (
              <Link key={v.id} href={`/reels?tag=${encodeURIComponent(data.tag)}`}
                className="relative aspect-[9/16] rounded-xl overflow-hidden bg-luxury-100 group">
                {v.thumbnail_url
                  ? <img src={v.thumbnail_url} alt={v.title || "reel"} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  : <video src={v.s3_url} className="w-full h-full object-cover" muted playsInline />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-white text-[0.6rem] font-bold drop-shadow">
                  <span>▶ {fmtNum(v.views_count || 0)}</span>
                  <span>❤ {fmtNum(v.likes_count || 0)}</span>
                </div>
                {v.hotel && (
                  <div className="absolute top-1 left-1 right-1 text-white text-[0.55rem] font-bold drop-shadow truncate">
                    🏨 {v.hotel.name}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
