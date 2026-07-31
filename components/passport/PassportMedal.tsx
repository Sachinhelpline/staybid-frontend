"use client";
// PassportMedal — a genuinely reflective cast-metal medal (the SS3 reference):
// metallic conic bezel + 4 rivets + a colored center disc with sphere-depth
// radial shading + raised glyph + a bright specular crescent + a moving glare
// sweep. Two variants: "medal" (metallic coin) and "stamp" (printed wax seal).
// Pure CSS, no images. Optional progress ring + lock chip + rank ribbon.
import { useId } from "react";

export type MedalFace = {
  metal: "gold" | "silver" | "bronze"; // bezel metal (ignored for stamp)
  core: string; // center disc base color (hex) — or ring color for stamps
  glow: string; // halo / sheen tint
};

// ── Presets ────────────────────────────────────────────────────────────────
export const MEDAL_GOLD: MedalFace = { metal: "gold", core: "#bdc9d5", glow: "#c6d0da" };
export const MEDAL_CHAMPAGNE: MedalFace = { metal: "gold", core: "#d7dee5", glow: "#c6d0da" };
export const MEDAL_LOCKED: MedalFace = { metal: "silver", core: "#c5cfda", glow: "#b8c5d2" };

/** Gold-bezel medal with a tier-colored core — used for rank crests. */
export function rankMedalFace(color: string): MedalFace {
  return { metal: "gold", core: color, glow: color };
}
/** Printed-stamp seal tinted by a region color. */
export function stampFace(ring: string): MedalFace {
  return { metal: "gold", core: ring, glow: ring };
}

const METAL: Record<string, { ring: string; rivet: string; rim: string }> = {
  gold: {
    ring: "conic-gradient(from 125deg,#eceff3 0deg,#bec9d5 38deg,#607b95 88deg,#e5eaef 140deg,#7E5E18 200deg,#b4c1cf 268deg,#eceff3 360deg)",
    rivet: "#607b95",
    rim: "#7A581A",
  },
  silver: {
    ring: "conic-gradient(from 125deg,#FFFFFF 0deg,#CCD2DB 38deg,#828B98 88deg,#EFF2F7 140deg,#717B89 200deg,#D6DBE3 268deg,#FFFFFF 360deg)",
    rivet: "#828B98",
    rim: "#6C7682",
  },
  bronze: {
    ring: "conic-gradient(from 125deg,#F7DBB2 0deg,#CE9259 38deg,#6F421F 88deg,#ECC79E 140deg,#5E371A 200deg,#D8A36D 268deg,#F7DBB2 360deg)",
    rivet: "#8C5C30",
    rim: "#623A1C",
  },
};

type Props = {
  glyph: string;
  size?: number;
  m?: MedalFace;
  locked?: boolean;
  progress?: number | null;
  onClick?: () => void;
  ariaLabel?: string;
  pulse?: boolean;
  ribbon?: string;
  variant?: "medal" | "stamp";
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
  variant = "medal",
}: Props) {
  const uid = useId().replace(/[:]/g, "");
  const metal = METAL[m.metal] || METAL.gold;
  const glyphSize = Math.round(size * (variant === "stamp" ? 0.4 : 0.36));
  const hasRing = progress != null;
  const ribbonH = ribbon ? Math.round(size * 0.22) : 0;

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOff = ringC - (Math.max(0, Math.min(100, progress ?? 0)) / 100) * ringC;

  const Tag: any = onClick ? "button" : "div";
  const px = (f: number) => `${Math.round(size * f)}px`;

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`pm-root pm-${uid} ${onClick ? "pm-tap" : ""} ${pulse && !locked ? "pm-br" : ""}`}
      style={{ width: size, height: size + ribbonH }}
    >
      <style>{`
        .pm-${uid}{position:relative;display:inline-flex;flex-direction:column;align-items:center;
          justify-content:flex-end;border:none;background:transparent;padding:0;line-height:0;}
        .pm-${uid}.pm-tap{cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .pm-${uid} .pm-ribbon{position:relative;z-index:6;margin-bottom:${px(-0.08)};
          font-size:${Math.max(8, Math.round(size * 0.135))}px;font-weight:900;letter-spacing:.06em;
          text-transform:uppercase;color:#f6f7f9;padding:2px 9px;border-radius:999px;white-space:nowrap;
          background:linear-gradient(180deg,#d0d8e1,#8ba0b5 60%,#8A6A1E);
          box-shadow:0 3px 8px -3px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.55),
            inset 0 -1px 1px rgba(0,0,0,.3);
          text-shadow:0 1px 1px rgba(0,0,0,.35);}
        .pm-${uid} .pm-stage{position:relative;width:${size}px;height:${size}px;
          ${locked ? "filter:grayscale(.72) brightness(.94);" : ""}}
        .pm-${uid} .pm-halo{position:absolute;inset:-12%;border-radius:50%;z-index:0;
          background:radial-gradient(circle,${m.glow}77 0%,transparent 66%);
          opacity:${locked ? 0 : 0.6};
          ${pulse && !locked ? `animation:pmHalo-${uid} 2.6s ease-in-out infinite;` : ""}}

        /* ── METAL bezel ── */
        .pm-${uid} .pm-bezel{position:absolute;inset:${hasRing ? "10%" : "0"};border-radius:50%;z-index:2;
          overflow:hidden;background:${variant === "stamp" ? "#eef1f4" : metal.ring};
          box-shadow:
            0 ${px(0.16)} ${px(0.3)} -${px(0.1)} rgba(0,0,0,.5),
            0 ${px(0.04)} ${px(0.08)} rgba(0,0,0,.32),
            0 0 0 ${Math.max(1, size * 0.012)}px ${metal.rim}99,
            inset 0 ${px(0.03)} ${px(0.05)} rgba(255,255,255,.7),
            inset 0 -${px(0.05)} ${px(0.09)} rgba(0,0,0,.42);}
        .pm-${uid} .pm-glare{position:absolute;top:-25%;bottom:-25%;width:36%;left:-45%;z-index:5;
          background:linear-gradient(100deg,transparent,rgba(255,255,255,.62),transparent);
          transform:skewX(-18deg);filter:blur(2px);pointer-events:none;
          ${!locked ? `animation:pmGlare-${uid} 4.6s ease-in-out infinite;` : "opacity:0;"}}

        /* ── colored core disc ── */
        .pm-${uid} .pm-core{position:absolute;inset:${variant === "stamp" ? "16%" : "21%"};border-radius:50%;z-index:3;
          background:
            radial-gradient(circle at 36% 27%, rgba(255,255,255,.6) 0%, transparent 40%),
            radial-gradient(circle at 62% 80%, rgba(0,0,0,.42) 0%, transparent 60%),
            ${variant === "stamp" ? "#f2f5f7" : m.core};
          box-shadow:
            inset 0 0 0 ${Math.max(1.5, size * 0.02)}px ${variant === "stamp" ? `${m.core}` : "rgba(255,255,255,.22)"},
            inset 0 ${px(0.04)} ${px(0.07)} rgba(0,0,0,.46),
            inset 0 -${px(0.03)} ${px(0.05)} rgba(255,255,255,.16);}
        ${variant === "stamp" ? `.pm-${uid} .pm-core{box-shadow:
            inset 0 0 0 ${Math.max(2, size * 0.045)}px ${m.core},
            inset 0 0 0 ${Math.max(3, size * 0.06)}px rgba(255,255,255,.85),
            inset 0 2px 5px rgba(0,0,0,.18);}` : ""}

        /* rivets (medal only) */
        .pm-${uid} .pm-rivet{position:absolute;z-index:4;width:${px(0.085)};height:${px(0.085)};
          border-radius:50%;background:radial-gradient(circle at 34% 32%,#fff,${metal.rivet} 72%);
          box-shadow:0 1px 2px rgba(0,0,0,.45),inset 0 0 0 1px rgba(0,0,0,.15);transform:translate(-50%,-50%);}
        .pm-${uid} .pm-rivet.n{left:50%;top:9%} .pm-${uid} .pm-rivet.s{left:50%;top:91%}
        .pm-${uid} .pm-rivet.w{left:9%;top:50%} .pm-${uid} .pm-rivet.e{left:91%;top:50%}

        .pm-${uid} .pm-glyph{position:absolute;inset:0;z-index:5;display:flex;align-items:center;
          justify-content:center;font-size:${glyphSize}px;line-height:1;
          filter:${locked ? "grayscale(.85) opacity(.6)" : "saturate(1.06)"}
            drop-shadow(0 1px 0 rgba(255,255,255,.55)) drop-shadow(0 2px 3px rgba(0,0,0,.45));}
        .pm-${uid} .pm-spec{position:absolute;inset:${hasRing ? "10%" : "0"};border-radius:50%;z-index:5;
          pointer-events:none;mix-blend-mode:screen;opacity:${locked ? 0 : 0.95};
          background:radial-gradient(120% 90% at 28% 18%, rgba(255,255,255,.92) 0%, rgba(255,255,255,.25) 16%, transparent 44%);}

        .pm-${uid} .pm-ringwrap{position:absolute;inset:0;z-index:6;pointer-events:none;}
        .pm-${uid} .pm-lock{position:absolute;right:-3%;bottom:-3%;z-index:7;
          width:${px(0.36)};height:${px(0.36)};border-radius:50%;display:flex;align-items:center;
          justify-content:center;font-size:${px(0.18)};
          background:radial-gradient(circle at 34% 30%,#fff,#d6dee5 75%);
          box-shadow:0 3px 8px -3px rgba(0,0,0,.55),inset 0 0 0 1px rgba(106,133,160,.5);}

        .pm-${uid}.pm-tap:active .pm-bezel{transform:scale(.92);}
        .pm-${uid}.pm-tap:hover .pm-bezel{transform:translateY(-2px) scale(1.04);}
        .pm-${uid}.pm-tap:hover .pm-halo{opacity:.85;}
        .pm-${uid} .pm-bezel{transition:transform .18s cubic-bezier(.34,1.4,.5,1);}
        @keyframes pmHalo-${uid}{0%,100%{opacity:.4;transform:scale(.96)}50%{opacity:.78;transform:scale(1.07)}}
        @keyframes pmGlare-${uid}{0%{left:-48%}55%,100%{left:120%}}
        .pm-${uid}.pm-br .pm-stage{animation:pmBr-${uid} 3.2s ease-in-out infinite;}
        @keyframes pmBr-${uid}{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-2px) rotate(.6deg)}}
        @media (prefers-reduced-motion:reduce){
          .pm-${uid} .pm-glare,.pm-${uid} .pm-halo,.pm-${uid}.pm-br .pm-stage{animation:none!important;}
        }
      `}</style>

      {ribbon && <span className="pm-ribbon">{ribbon}</span>}

      <span className="pm-stage">
        <span className="pm-halo" />
        <span className="pm-bezel">
          <span className="pm-glare" />
        </span>
        {variant === "medal" && (
          <>
            <span className="pm-rivet n" />
            <span className="pm-rivet e" />
            <span className="pm-rivet s" />
            <span className="pm-rivet w" />
          </>
        )}
        <span className="pm-core" />
        <span className="pm-glyph">{glyph}</span>
        <span className="pm-spec" />

        {hasRing && (
          <span className="pm-ringwrap">
            <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
              <circle cx="50" cy="50" r={ringR} fill="none" stroke={`${metal.rim}44`} strokeWidth="5" />
              <circle
                cx="50"
                cy="50"
                r={ringR}
                fill="none"
                stroke="#aab9c8"
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
