"use client";
// PassportMedal — the shared "alive" 3D metallic disc used across the whole
// passport (badges / stamps / rewards / rank). Pure CSS depth (no images):
// radial highlight (top-left light source) + 6-layer box-shadow stack +
// rotating conic sheen with mix-blend-mode:screen + embossed glyph. Tap-press
// micro-interaction + optional SVG progress ring. Emulates HotelScoreBadge.
import { useId } from "react";

export type MedalFace = {
  face: string; // radial-gradient css for the disc face
  rim: string; // rim-ring color
  glow: string; // halo / sheen tint
  ink: string; // glyph + caption color on the face
};

// ── Presets ────────────────────────────────────────────────────────────────
export const MEDAL_GOLD: MedalFace = {
  face: "radial-gradient(circle at 32% 26%, #FFF3CF 0%, #EEDBA6 26%, #D9BE82 54%, #C9A66B 76%, #A07F44 100%)",
  rim: "#8B6914",
  glow: "#F0D060",
  ink: "#3A2D10",
};
export const MEDAL_CHAMPAGNE: MedalFace = {
  face: "radial-gradient(circle at 32% 26%, #FFFBF2 0%, #F4E7CB 30%, #E7CFA0 60%, #D9BE82 100%)",
  rim: "#C9A66B",
  glow: "#F0D060",
  ink: "#4A3208",
};
export const MEDAL_LOCKED: MedalFace = {
  face: "radial-gradient(circle at 32% 26%, #F6F2EA 0%, #E8DECF 42%, #D6C9B4 100%)",
  rim: "#C3B59B",
  glow: "#D9CBB0",
  ink: "#9A8C72",
};

// Region-tinted stamp face (mountain / beach / city). Builds a metallic disc
// from a single base color so stamps still read 3D, not flat ink.
export function regionFace(base: string, ring: string): MedalFace {
  return {
    face: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.92) 0%, ${base} 34%, ${ring} 78%, ${ring} 100%)`,
    rim: ring,
    glow: ring,
    ink: "#2C2410",
  };
}

type Props = {
  glyph: string;
  size?: number; // disc diameter in px (default 64)
  m?: MedalFace; // face preset
  locked?: boolean; // dim + lock chip
  progress?: number | null; // 0..100 ring (null = no ring)
  onClick?: () => void;
  ariaLabel?: string;
  pulse?: boolean; // earned items gently breathe + sheen spins
  ribbon?: string; // optional tiny ribbon text above the disc (rank / tier)
};

export function PassportMedal({
  glyph,
  size = 64,
  m = MEDAL_GOLD,
  locked = false,
  progress = null,
  onClick,
  ariaLabel,
  pulse = false,
  ribbon,
}: Props) {
  const uid = useId().replace(/[:]/g, "");
  const face = locked ? MEDAL_LOCKED : m;
  const glyphSize = Math.round(size * 0.42);
  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOff = ringC - (Math.max(0, Math.min(100, progress ?? 0)) / 100) * ringC;

  const Tag: any = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`pm-root pm-${uid} ${onClick ? "pm-tappable" : ""} ${pulse && !locked ? "pm-breathe" : ""}`}
      style={{ width: size, height: ribbon ? size + 18 : size }}
    >
      <style>{`
        .pm-${uid} {
          position: relative; display: inline-flex; flex-direction: column;
          align-items: center; justify-content: flex-end; border: none;
          background: transparent; padding: 0; line-height: 0;
        }
        .pm-${uid}.pm-tappable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .pm-${uid} .pm-ribbon {
          position: relative; z-index: 4; margin-bottom: -6px;
          font-size: ${Math.max(8, Math.round(size * 0.135))}px; font-weight: 800;
          letter-spacing: 0.06em; text-transform: uppercase; color: #fff;
          padding: 2px 8px; border-radius: 999px; white-space: nowrap;
          background: linear-gradient(180deg, ${face.glow}, ${face.rim});
          box-shadow: 0 3px 7px -3px rgba(31,26,15,0.5), inset 0 1px 0 rgba(255,255,255,0.4);
          text-shadow: 0 1px 1px rgba(0,0,0,0.25);
        }
        .pm-${uid} .pm-stage {
          position: relative; width: ${size}px; height: ${size}px;
        }
        .pm-${uid} .pm-halo {
          position: absolute; inset: -10%; border-radius: 50%; z-index: 0;
          background: radial-gradient(circle, ${face.glow}66 0%, transparent 68%);
          opacity: ${locked ? 0 : 0.55};
          ${pulse && !locked ? `animation: pmHalo-${uid} 2.6s ease-in-out infinite;` : ""}
        }
        .pm-${uid} .pm-disc {
          position: absolute; inset: ${progress != null ? "9%" : "0"};
          border-radius: 50%; z-index: 2; overflow: hidden;
          background: ${face.face};
          box-shadow:
            0 ${Math.round(size * 0.18)}px ${Math.round(size * 0.34)}px -${Math.round(size * 0.14)}px rgba(31,26,15,0.5),
            0 ${Math.round(size * 0.06)}px ${Math.round(size * 0.12)}px -${Math.round(size * 0.04)}px rgba(31,26,15,0.4),
            0 0 0 ${Math.max(1.5, size * 0.028)}px ${face.rim}88,
            inset 0 ${Math.round(size * 0.045)}px ${Math.round(size * 0.07)}px rgba(255,255,255,0.6),
            inset 0 -${Math.round(size * 0.06)}px ${Math.round(size * 0.1)}px rgba(31,26,15,0.28),
            inset 0 0 0 1px rgba(255,255,255,0.28);
          transition: transform .18s cubic-bezier(.34,1.4,.5,1), box-shadow .18s ease;
        }
        .pm-${uid} .pm-sheen {
          position: absolute; inset: -30%; z-index: 3; pointer-events: none;
          mix-blend-mode: screen; opacity: ${locked ? 0 : 0.9};
          background: conic-gradient(from 0deg,
            transparent 0deg, rgba(255,255,255,0.7) 24deg,
            transparent 72deg, transparent 180deg,
            rgba(255,255,255,0.35) 210deg, transparent 252deg, transparent 360deg);
          ${pulse && !locked ? `animation: pmSpin-${uid} 7s linear infinite;` : ""}
        }
        .pm-${uid} .pm-glyph {
          position: absolute; inset: 0; z-index: 4; display: flex;
          align-items: center; justify-content: center;
          font-size: ${glyphSize}px; line-height: 1;
          filter: ${locked ? "grayscale(0.85) opacity(0.55)" : "saturate(1.05)"};
          text-shadow: 0 1px 0 rgba(255,255,255,0.5), 0 -1px 0 rgba(31,26,15,0.22),
            0 2px 4px rgba(31,26,15,0.25);
        }
        .pm-${uid} .pm-ringwrap { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
        .pm-${uid} .pm-lock {
          position: absolute; right: -2%; bottom: -2%; z-index: 6;
          width: ${Math.round(size * 0.34)}px; height: ${Math.round(size * 0.34)}px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: ${Math.round(size * 0.17)}px;
          background: linear-gradient(180deg,#fff,#ece3d2);
          box-shadow: 0 3px 8px -3px rgba(31,26,15,0.55), inset 0 0 0 1px rgba(201,166,107,0.5);
        }
        .pm-${uid}.pm-tappable:active .pm-disc { transform: scale(0.92); }
        .pm-${uid}.pm-tappable:hover .pm-disc { transform: translateY(-2px) scale(1.03); }
        .pm-${uid}.pm-tappable:hover .pm-halo { opacity: 0.8; }
        @keyframes pmHalo-${uid} { 0%,100%{ opacity:.35; transform:scale(.96) } 50%{ opacity:.7; transform:scale(1.06) } }
        @keyframes pmSpin-${uid} { to { transform: rotate(360deg) } }
        .pm-${uid}.pm-breathe .pm-stage { animation: pmBreathe-${uid} 3s ease-in-out infinite; }
        @keyframes pmBreathe-${uid} { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-2px) } }
        @media (prefers-reduced-motion: reduce) {
          .pm-${uid} .pm-sheen, .pm-${uid} .pm-halo, .pm-${uid}.pm-breathe .pm-stage { animation: none !important; }
        }
      `}</style>

      {ribbon && <span className="pm-ribbon">{ribbon}</span>}

      <span className="pm-stage">
        <span className="pm-halo" />
        <span className="pm-disc">
          <span className="pm-sheen" />
        </span>
        <span className="pm-glyph">{glyph}</span>

        {progress != null && (
          <span className="pm-ringwrap">
            <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
              <circle cx="50" cy="50" r={ringR} fill="none" stroke={`${face.rim}33`} strokeWidth="5" />
              <circle
                cx="50"
                cy="50"
                r={ringR}
                fill="none"
                stroke={face.rim}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={ringC}
                strokeDashoffset={ringOff}
                transform="rotate(-90 50 50)"
                style={{ transition: "stroke-dashoffset 1s ease" }}
              />
            </svg>
          </span>
        )}

        {locked && <span className="pm-lock">🔒</span>}
      </span>
    </Tag>
  );
}
