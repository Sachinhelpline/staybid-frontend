"use client";
// PassportDetailSheet — the "comes alive on tap" surface. Tapping any badge /
// stamp / reward opens a premium bottom-sheet (centered modal on desktop) with
// a big spinning 3D medal flip-in, title, blurb, progress, meta rows + an
// optional footer (claim CTA / code). Portal-free; backdrop blur; esc + tap to
// close; respects reduced-motion.
import { useEffect, type ReactNode } from "react";
import { PassportMedal, type MedalFace } from "./PassportMedal";

export type DetailMeta = { label: string; value: string };

export type DetailItem = {
  glyph: string;
  title: string;
  blurb?: string;
  m: MedalFace;
  locked?: boolean;
  earned?: boolean;
  ribbon?: string;
  variant?: "medal" | "stamp";
  /** progress 0..100, shown as a labelled bar */
  progress?: number | null;
  progressLabel?: string;
  meta?: DetailMeta[];
  footer?: ReactNode;
  /** small status pill text under the title (e.g. "Unlocked", "Collected") */
  status?: { text: string; tone: "good" | "soft" | "lock" };
};

export function PassportDetailSheet({
  item,
  onClose,
}: {
  item: DetailItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [item, onClose]);

  if (!item) return null;

  const statusStyle =
    item.status?.tone === "good"
      ? { bg: "#e6f0e6", fg: "#4a6f4a" }
      : item.status?.tone === "lock"
        ? { bg: "var(--bg-pill)", fg: "var(--text-muted)" }
        : { bg: "rgba(201,166,107,0.18)", fg: "#556d86" };

  return (
    <div className="pds-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.title}>
      <style>{`
        .pds-backdrop {
          position: fixed; inset: 0; z-index: 70; display: flex;
          align-items: flex-end; justify-content: center;
          background: rgba(20,15,5,0.55); backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px); padding: 0; animation: pdsFade .22s ease;
        }
        .pds-card {
          position: relative; width: 100%; max-width: 460px;
          background:
            radial-gradient(120% 70% at 50% 0%, rgba(201,166,107,0.16), transparent 60%),
            linear-gradient(180deg, var(--bg-card) 0%, var(--bg-page) 140%);
          border: 1px solid var(--border-soft);
          border-radius: 28px 28px 0 0;
          box-shadow: 0 -20px 60px -24px rgba(31,26,15,0.5);
          padding: 26px 22px calc(24px + env(safe-area-inset-bottom,0px));
          animation: pdsUp .42s cubic-bezier(.2,.9,.25,1);
        }
        .pds-grip {
          width: 42px; height: 4px; border-radius: 999px; margin: -8px auto 14px;
          background: var(--border-strong, rgba(201,166,107,0.4));
        }
        .pds-x {
          position: absolute; top: 16px; right: 16px; width: 32px; height: 32px;
          border-radius: 50%; border: 1px solid var(--border-soft); background: var(--bg-page);
          color: var(--text-muted); font-size: 15px; cursor: pointer; line-height: 1;
        }
        .pds-medalrow { display: flex; justify-content: center; }
        .pds-medal-anim { animation: pdsPop .55s cubic-bezier(.2,1.3,.35,1) both; }
        .pds-title { text-align: center; margin-top: 14px; }
        .pds-bar { height: 9px; border-radius: 999px; overflow: hidden; background: var(--bg-pill); }
        .pds-bar > i {
          display: block; height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, #c8d2dc, #C9A66B, #556d86);
          animation: pdsGrow .9s cubic-bezier(.2,.9,.25,1) both;
        }
        @keyframes pdsFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pdsUp { from { transform: translateY(60px); opacity: .4 } to { transform: translateY(0); opacity: 1 } }
        @keyframes pdsPop { 0% { transform: rotateY(-90deg) scale(.5); opacity: 0 } 60% { transform: rotateY(8deg) scale(1.04); opacity: 1 } 100% { transform: rotateY(0) scale(1) } }
        @keyframes pdsGrow { from { transform: scaleX(0); transform-origin: left } to { transform: scaleX(1); transform-origin: left } }
        @media (min-width: 640px) {
          .pds-backdrop { align-items: center; padding: 20px; }
          .pds-card { border-radius: 28px; box-shadow: 0 30px 80px -30px rgba(31,26,15,0.6); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pds-card, .pds-medal-anim, .pds-bar > i, .pds-backdrop { animation: none !important; }
        }
      `}</style>

      <div className="pds-card" onClick={(e) => e.stopPropagation()}>
        <div className="pds-grip" />
        <button className="pds-x" onClick={onClose} aria-label="Close">✕</button>

        <div className="pds-medalrow">
          <div className="pds-medal-anim" style={{ perspective: 800 }}>
            <PassportMedal glyph={item.glyph} size={138} m={item.m} locked={item.locked} ribbon={item.ribbon} variant={item.variant} pulse />
          </div>
        </div>

        <div className="pds-title">
          <h3 className="font-display font-semibold" style={{ fontSize: "1.6rem", color: "var(--text-base)" }}>
            {item.title}
          </h3>
          {item.status && (
            <span
              className="inline-block mt-1.5 text-[0.6rem] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide"
              style={{ background: statusStyle.bg, color: statusStyle.fg }}
            >
              {item.status.text}
            </span>
          )}
          {item.blurb && (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--text-soft)" }}>
              {item.blurb}
            </p>
          )}
        </div>

        {item.progress != null && (
          <div className="mt-4">
            <div className="flex justify-between text-[0.66rem] font-bold mb-1.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
              <span>{item.progressLabel || "Progress"}</span>
              <span style={{ color: "var(--accent)" }}>{Math.round(item.progress)}%</span>
            </div>
            <div className="pds-bar">
              <i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
            </div>
          </div>
        )}

        {item.meta && item.meta.length > 0 && (
          <div className="mt-4 grid gap-2">
            {item.meta.map((mr, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl px-3.5 py-2.5"
                style={{ background: "var(--bg-page)", border: "1px solid var(--border-soft)" }}
              >
                <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{mr.label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text-base)" }}>{mr.value}</span>
              </div>
            ))}
          </div>
        )}

        {item.footer && <div className="mt-5">{item.footer}</div>}
      </div>
    </div>
  );
}
