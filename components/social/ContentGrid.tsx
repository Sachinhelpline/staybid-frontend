"use client";
// 3-column grid of posts (reels / photos / stories) with kind badge.
type Post = {
  id: string;
  media_type: "PHOTO" | "REEL" | "STORY";
  media_url: string;
  thumbnail_url?: string | null;
  view_count: number;
  caption?: string | null;
};

const KIND_BADGE = { PHOTO: "📷", REEL: "▶", STORY: "📖" };

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function ContentGrid({ posts, onPickPost }: { posts: Post[]; onPickPost?: (id: string) => void }) {
  if (!posts || posts.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-white/45">
        <p className="text-5xl mb-3">🎬</p>
        <p className="text-sm">No posts yet</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-[2px]">
      {posts.map((p) => (
        <button
          key={p.id}
          onClick={() => onPickPost?.(p.id)}
          className="relative aspect-9/14 overflow-hidden bg-black/40 active:scale-95 transition-transform"
        >
          {p.thumbnail_url ? (
            <img src={p.thumbnail_url} alt="" className="w-full h-full object-cover" />
          ) : p.media_type === "PHOTO" ? (
            <img src={p.media_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <video src={p.media_url} muted className="w-full h-full object-cover" preload="metadata" />
          )}
          <div
            className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full flex items-center gap-1"
            style={{
              background: "rgba(0,0,0,0.50)",
              border: "1px solid rgba(255,255,255,0.20)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          >
            <span className="text-[0.62rem] leading-none">{KIND_BADGE[p.media_type]}</span>
            {p.view_count > 0 && (
              <span className="text-white text-[0.56rem] font-bold leading-none" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
                {fmt(p.view_count)}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
