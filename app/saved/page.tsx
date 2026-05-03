"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

type Tab = "all" | "video" | "hotel" | "influencer" | "deal";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "all",        label: "All",        icon: "🔖" },
  { id: "video",      label: "Reels",      icon: "🎬" },
  { id: "hotel",      label: "Hotels",     icon: "🏨" },
  { id: "influencer", label: "Creators",   icon: "✨" },
  { id: "deal",       label: "Flash Deals",icon: "⚡" },
];

const TOKEN  = () => typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "";
const AUTH_H = () => ({ Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" });

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n || 0);
}

export default function SavedPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [tab, setTab]         = useState<Tab>("all");
  const [saves, setSaves]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth?next=/saved"); return; }
    setLoading(true);
    const url = tab === "all" ? "/api/discover/saves/enriched" : `/api/discover/saves/enriched?type=${tab}`;
    fetch(url, { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => setSaves(d.saves || []))
      .catch(() => setSaves([]))
      .finally(() => setLoading(false));
  }, [tab, user, authLoading, router]);

  async function unsave(s: any) {
    setSaves(prev => prev.filter(x => x.id !== s.id));
    try {
      await fetch("/api/discover/save", {
        method: "DELETE",
        headers: AUTH_H(),
        body: JSON.stringify({ targetType: s.target_type, targetId: s.target_id }),
      });
    } catch {}
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50">
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">🔖</span>
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold text-luxury-900 leading-none">Saved</h1>
            <p className="text-luxury-500 text-sm mt-1">Your collection of reels, hotels & deals</p>
          </div>
        </div>
        <div className="divider-gold my-5" />

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto -mx-1 px-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                tab === t.id
                  ? "bg-gold-500 text-white border-gold-600 shadow-gold"
                  : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
              }`}>
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="card-luxury p-10 text-center text-luxury-500 text-sm">Loading…</div>
        ) : saves.length === 0 ? (
          <div className="card-luxury p-10 text-center">
            <div className="text-5xl mb-3">📭</div>
            <p className="font-bold text-luxury-900">Nothing saved yet</p>
            <p className="text-luxury-500 text-sm mt-1">Tap the bookmark icon on any reel, hotel or deal to save it for later.</p>
            <div className="mt-5 flex gap-2 justify-center">
              <Link href="/reels"  className="btn-luxury px-4 py-2 rounded-full text-sm">Browse Reels</Link>
              <Link href="/hotels" className="px-4 py-2 rounded-full text-sm font-semibold border border-luxury-200">Browse Hotels</Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {saves.map(s => <SaveCard key={s.id} s={s} onUnsave={unsave} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SaveCard({ s, onUnsave }: { s: any; onUnsave: (s: any) => void }) {
  const t = s.target;

  if (s.target_type === "video" && t) {
    return (
      <Wrap href={`/reels`} onUnsave={() => onUnsave(s)}>
        <div className="relative aspect-[9/16] bg-luxury-100">
          {t.thumbnail_url
            ? <img src={t.thumbnail_url} alt={t.title || ""} className="w-full h-full object-cover" />
            : <video src={t.s3_url} className="w-full h-full object-cover" muted playsInline />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 text-white text-[0.7rem] font-bold drop-shadow line-clamp-2">
            {t.title || "Reel"}
          </div>
          <div className="absolute top-2 left-2 text-white text-[0.6rem] font-bold drop-shadow">▶ {fmtNum(t.views_count || 0)}</div>
        </div>
      </Wrap>
    );
  }

  if (s.target_type === "hotel" && t) {
    return (
      <Wrap href={`/hotels/${t.id}`} onUnsave={() => onUnsave(s)}>
        <div className="relative aspect-[4/3] bg-luxury-100">
          {t.images?.[0]
            ? <img src={t.images[0]} alt={t.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-3xl">🏨</div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 text-white">
            <p className="text-sm font-bold drop-shadow line-clamp-1">{t.name}</p>
            <p className="text-[0.65rem] font-semibold opacity-90 drop-shadow">{t.city} {t.star_rating ? `· ${"★".repeat(t.star_rating)}` : ""}</p>
          </div>
        </div>
      </Wrap>
    );
  }

  if (s.target_type === "influencer" && t) {
    return (
      <Wrap href={`/influencer/public/${t.id}`} onUnsave={() => onUnsave(s)}>
        <div className="aspect-[4/3] bg-gradient-to-br from-gold-100 to-luxury-100 flex flex-col items-center justify-center p-3 text-center">
          {t.avatar_url
            ? <img src={t.avatar_url} className="w-16 h-16 rounded-full object-cover ring-4 ring-white shadow" />
            : <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold text-xl ring-4 ring-white shadow">
                {(t.display_name || "C").slice(0, 1).toUpperCase()}
              </div>}
          <p className="font-bold text-luxury-900 text-sm mt-2 line-clamp-1">{t.display_name || "Creator"}</p>
          <p className="text-luxury-500 text-[0.7rem]">{fmtNum(t.followers_count || 0)} followers</p>
        </div>
      </Wrap>
    );
  }

  if (s.target_type === "deal" && t) {
    return (
      <Wrap href={`/flash-deals`} onUnsave={() => onUnsave(s)}>
        <div className="aspect-[4/3] bg-gradient-to-br from-amber-100 to-amber-200 p-4 flex flex-col justify-between">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-widest text-amber-700">⚡ Flash Deal</p>
            <p className="font-bold text-luxury-900 text-sm mt-1 line-clamp-2">{t.title || "Deal"}</p>
          </div>
          {t.price && <p className="font-display text-xl font-bold text-amber-800">₹{Number(t.price).toLocaleString("en-IN")}</p>}
        </div>
      </Wrap>
    );
  }

  // Fallback for missing target (deleted hotel/video etc.)
  return (
    <div className="card-luxury p-4 text-center">
      <p className="text-3xl mb-1">❓</p>
      <p className="text-xs text-luxury-500">Item no longer available</p>
      <button onClick={() => onUnsave(s)} className="mt-2 text-[0.65rem] font-bold text-red-600">Remove</button>
    </div>
  );
}

function Wrap({ href, onUnsave, children }: { href: string; onUnsave: () => void; children: React.ReactNode }) {
  return (
    <div className="relative card-luxury overflow-hidden group">
      <Link href={href} className="block">{children}</Link>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnsave(); }}
        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove from saved">
        ✕
      </button>
    </div>
  );
}
