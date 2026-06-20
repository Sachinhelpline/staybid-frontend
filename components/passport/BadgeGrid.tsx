"use client";
// BadgeGrid — every achievement. Earned badges glow gold; locked ones dim with
// a progress hint ("2 / 3 cities"). Mirrors the API's badge catalog shape.
type BadgeView = {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  earned: boolean;
  have: number;
  need: number;
  hint: string;
};

export function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  const earned = badges.filter((b) => b.earned).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold" style={{ color: "var(--text-base)" }}>
          🏅 Achievements
        </h3>
        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          {earned} / {badges.length} unlocked
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sb-stagger">
        {badges.map((b) => (
          <div
            key={b.key}
            className="rounded-2xl p-3 text-center sb-card-lift"
            style={{
              background: b.earned ? "linear-gradient(160deg,#fffdf8,#fbf3e2)" : "var(--bg-card)",
              border: b.earned ? "1px solid rgba(201,166,107,0.45)" : "1px solid var(--border-soft)",
              opacity: b.earned ? 1 : 0.62,
              boxShadow: b.earned ? "0 6px 18px -10px rgba(201,166,107,0.5)" : "none",
            }}
            title={b.earned ? b.blurb : b.hint}
          >
            <div
              className="w-12 h-12 rounded-full mx-auto flex items-center justify-center text-xl"
              style={{
                background: b.earned ? "linear-gradient(135deg,#E7CFA0,#C9A66B)" : "var(--bg-pill)",
                filter: b.earned ? "none" : "grayscale(0.7)",
              }}
            >
              {b.earned ? b.emoji : "🔒"}
            </div>
            <p className="text-[0.66rem] font-bold mt-1.5 leading-tight" style={{ color: "var(--text-base)" }}>
              {b.label}
            </p>
            {b.earned ? (
              <p className="text-[0.55rem] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {b.blurb}
              </p>
            ) : (
              <>
                <p className="text-[0.55rem] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {b.hint}
                </p>
                {b.need > 1 && (
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden mx-2" style={{ background: "var(--bg-pill)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (b.have / b.need) * 100)}%`,
                        background: "linear-gradient(90deg,#C9A66B,#8B6914)",
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
