"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { sbImage, SB_IMG_CARD } from "@/lib/sb-image";
import SbState from "@/components/SbState";
// v142 — Phase-6 saved tour. 3 steps: filter tabs → grid → tip.
import { usePageTour } from "@/lib/tutorial/usePageTour";

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
  // v142 — Phase 6 saved tour. delayMs:1300 so /api/discover/saves
  // populates before fire.
  usePageTour("saved", "saved", { delayMs: 1300 });

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    // Pull local saves first (works even when anon / API down). These
    // contain a rich snapshot (hotel_name, hotel_image, etc.) written by
    // the save button on the reel feed in v84.
    let localSaves: any[] = [];
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("sb_local_saves") : null;
      if (raw) localSaves = JSON.parse(raw) || [];
      // v586 — heal legacy FLAT saves (pre-v586 home hearts wrote
      // {target_type,target_id,hotel_name,hotel_image} with NO nested
      // `target`, so SaveCard silently dropped them). Rebuild `target` from
      // the flat fields so old wishlists render instead of reading empty.
      localSaves = localSaves.map((s: any) => {
        if (s && !s.target && s.target_type && s.target_id) {
          const img = s.hotel_image || s.thumbnail_url;
          return {
            id: s.id || `local-${s.target_type}-${s.target_id}`,
            target_type: s.target_type,
            target_id: s.target_id,
            saved_at: s.saved_at || new Date().toISOString(),
            target: s.target_type === "video"
              ? { id: s.target_id, title: s.title || s.hotel_name || "Reel", s3_url: s.s3_url || "", thumbnail_url: img || "", views_count: s.views_count || 0 }
              : { id: s.target_id, name: s.hotel_name || "", city: s.city || "", star_rating: s.starRating || s.star_rating || 0, images: img ? [img] : [] },
          };
        }
        return s;
      });
    } catch {}
    if (tab !== "all") {
      localSaves = localSaves.filter((s) => s.target_type === tab);
    }
    // If anon, just show local saves
    if (!user) {
      setSaves(localSaves);
      setLoading(false);
      return;
    }
    // Logged in: merge local + backend. Dedup by `${type}:${id}`.
    const url = tab === "all" ? "/api/discover/saves/enriched" : `/api/discover/saves/enriched?type=${tab}`;
    fetch(url, { headers: { Authorization: `Bearer ${TOKEN()}` } })
      .then(r => r.json())
      .then(d => {
        const remote = d.saves || [];
        const keyOf = (s: any) => `${s.target_type}:${s.target_id}`;
        const seen = new Set<string>();
        const merged: any[] = [];
        // Local first — has the freshest snapshot
        localSaves.forEach((s) => { const k = keyOf(s); if (!seen.has(k)) { seen.add(k); merged.push(s); } });
        remote.forEach((s: any) => { const k = keyOf(s); if (!seen.has(k)) { seen.add(k); merged.push(s); } });
        setSaves(merged);
      })
      .catch(() => setSaves(localSaves))
      .finally(() => setLoading(false));
  }, [tab, user, authLoading]);

  async function unsave(s: any) {
    setSaves(prev => prev.filter(x => x.id !== s.id));
    // Clear local snapshot too — keeps /saved consistent with the reel
    // feed's bookmark icon hydration.
    try {
      const raw = localStorage.getItem("sb_local_saves");
      const arr: any[] = raw ? JSON.parse(raw) : [];
      const key = `${s.target_type}:${s.target_id}`;
      const next = arr.filter((x: any) => `${x.target_type}:${x.target_id}` !== key);
      localStorage.setItem("sb_local_saves", JSON.stringify(next));
    } catch {}
    try {
      await fetch("/api/discover/save", {
        method: "DELETE",
        headers: AUTH_H(),
        body: JSON.stringify({ targetType: s.target_type, targetId: s.target_id }),
      });
    } catch {}
  }

  return (
    <div className="lux-soft min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2 sb-fade-in">
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
              className={`shrink-0 px-4 py-2 rounded-2xl text-sm font-semibold border transition-all sb-card-lift ${
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
          <SbState
            glyph="📭"
            title="Nothing saved yet"
            subtitle="Tap the bookmark icon on any reel, hotel or deal to save it for later."
            actions={[
              { label: "Browse Reels", href: "/reels" },
              { label: "Browse Hotels", href: "/hotels", ghost: true },
            ]}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sb-stagger">
            {saves.map(s => (
              <SaveCard
                key={s.id}
                s={s}
                onUnsave={unsave}
                onOpenReel={(videoId) => router.push(`/saved/posts?start=${encodeURIComponent(videoId)}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SaveCard({
  s, onUnsave, onOpenReel,
}: {
  s:          any;
  onUnsave:   (s: any) => void;
  onOpenReel: (videoId: string) => void;
}) {
  const t = s.target;

  if (s.target_type === "video" && t) {
    return (
      <ClickWrap
        onClick={() => onOpenReel(String(s.target_id))}
        onUnsave={() => onUnsave(s)}
      >
        <div className="relative aspect-9/16 bg-luxury-100">
          {t.thumbnail_url
            ? <img src={t.thumbnail_url} alt={t.title || ""} className="w-full h-full object-cover" />
            : t.s3_url
              ? <video src={t.s3_url} className="w-full h-full object-cover" muted playsInline />
              : <div className="w-full h-full flex items-center justify-center text-4xl">🎬</div>}
          <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 text-white text-[0.7rem] font-bold drop-shadow-sm line-clamp-2">
            {t.title || "Reel"}
          </div>
          <div className="absolute top-2 left-2 text-white text-[0.6rem] font-bold drop-shadow-sm tabular-nums">▶ {fmtNum(t.views_count || 0)}</div>
        </div>
      </ClickWrap>
    );
  }

  if (s.target_type === "hotel" && t) {
    return (
      <Wrap href={`/hotels/${t.id}`} onUnsave={() => onUnsave(s)}>
        <div className="relative aspect-4/3 bg-luxury-100">
          {t.images?.[0]
            ? <img src={sbImage(t.images[0], SB_IMG_CARD)} alt={t.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-3xl">🏨</div>}
          <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 text-white">
            <p className="font-display text-base font-bold drop-shadow-sm line-clamp-2" title={t.name}>{t.name}</p>
            <p className="text-[0.65rem] font-semibold opacity-90 drop-shadow-sm">{t.city} {t.star_rating ? `· ${"★".repeat(t.star_rating)}` : ""}</p>
          </div>
        </div>
      </Wrap>
    );
  }

  if (s.target_type === "influencer" && t) {
    return (
      <Wrap href={`/influencer/public/${t.id}`} onUnsave={() => onUnsave(s)}>
        <div className="aspect-4/3 bg-linear-to-br from-gold-100 to-luxury-100 flex flex-col items-center justify-center p-3 text-center">
          {t.avatar_url
            ? <img src={t.avatar_url} alt={t.display_name ? `${t.display_name} avatar` : "Creator avatar"} className="w-16 h-16 rounded-full object-cover ring-4 ring-white shadow-sm" />
            : <div className="w-16 h-16 rounded-full bg-linear-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold text-xl ring-4 ring-white shadow-sm">
                {(t.display_name || "C").slice(0, 1).toUpperCase()}
              </div>}
          <p className="font-display text-base font-bold text-luxury-900 mt-2 line-clamp-1">{t.display_name || "Creator"}</p>
          <p className="text-luxury-500 text-[0.7rem] tabular-nums">{fmtNum(t.followers_count || 0)} followers</p>
        </div>
      </Wrap>
    );
  }

  if (s.target_type === "deal" && t) {
    return (
      <Wrap href={`/flash-deals`} onUnsave={() => onUnsave(s)}>
        <div className="aspect-4/3 bg-linear-to-br from-amber-100 to-amber-200 p-4 flex flex-col justify-between">
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-widest text-amber-700">⚡ Flash Deal</p>
            <p className="font-bold text-luxury-900 text-sm mt-1 line-clamp-2">{t.title || "Deal"}</p>
          </div>
          {t.price && <p className="font-display text-xl font-bold text-amber-800 tabular-nums">₹{Number(t.price).toLocaleString("en-IN")}</p>}
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

// Tap-to-play wrapper used by the video card. Renders a button (not a Link)
// so the parent's onPlayReel callback runs instead of routing away.
function ClickWrap({ onClick, onUnsave, children }: { onClick: () => void; onUnsave: () => void; children: React.ReactNode }) {
  return (
    <div className="relative card-luxury overflow-hidden group">
      <button onClick={onClick} className="block w-full text-left">{children}</button>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnsave(); }}
        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove from saved">
        ✕
      </button>
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
