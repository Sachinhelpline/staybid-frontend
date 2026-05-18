"use client";
// ═══════════════════════════════════════════════════════════════════════════
// TierBadge — small inline pill surfacing a content tier.
// ═══════════════════════════════════════════════════════════════════════════
// Per Phase 0 §3.1 + Sachin's clarification: PUBLIC users render WITH NO
// BADGE at all — yeh existing UX matches today. Only non-PUBLIC tiers get
// a visible pill, so PUBLIC accounts look identical to pre-tier-system.
//
// Mapping:
//   PUBLIC                → null (no badge)
//   VERIFIED_GUEST        → green "✓ Verified Guest"
//   COMMUNITY_CONTRIBUTOR → purple "✦ Verified Local"
//   CREATOR               → champagne "✦ Creator"
//   HOTEL                 → blue "🏨 Hotel"
//   ADMIN                 → cocoa "⚙ Admin"
import type { ContentTier } from "@/lib/tier/types";

type Size = "xs" | "sm" | "md";

const STYLE: Record<
  Exclude<ContentTier, "PUBLIC">,
  { glyph: string; label: string; bg: string; fg: string; border: string }
> = {
  VERIFIED_GUEST: {
    glyph: "✓",
    label: "Verified Guest",
    bg: "rgba(125,168,108,0.16)",
    fg: "#3F5C2E",
    border: "rgba(125,168,108,0.40)",
  },
  COMMUNITY_CONTRIBUTOR: {
    glyph: "✦",
    label: "Verified Local",
    bg: "rgba(168,127,196,0.16)",
    fg: "#5A3A78",
    border: "rgba(168,127,196,0.40)",
  },
  CREATOR: {
    glyph: "✦",
    label: "Creator",
    bg: "rgba(201,166,107,0.18)",
    fg: "#6E5430",
    border: "rgba(201,166,107,0.40)",
  },
  HOTEL: {
    glyph: "🏨",
    label: "Hotel",
    bg: "rgba(80,128,184,0.16)",
    fg: "#284868",
    border: "rgba(80,128,184,0.40)",
  },
  ADMIN: {
    glyph: "⚙",
    label: "Admin",
    bg: "rgba(74,56,32,0.16)",
    fg: "#4A3820",
    border: "rgba(74,56,32,0.40)",
  },
};

const SIZE: Record<Size, { pad: string; fs: string; gap: string; r: string }> =
  {
    xs: { pad: "1px 6px", fs: "0.62rem", gap: "3px", r: "8px" },
    sm: { pad: "2px 8px", fs: "0.72rem", gap: "4px", r: "10px" },
    md: { pad: "3px 10px", fs: "0.82rem", gap: "5px", r: "12px" },
  };

export type TierBadgeProps = {
  tier?: ContentTier | null;
  size?: Size;
  /** Hide the text label, show only the glyph (compact contexts). */
  glyphOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export default function TierBadge({
  tier,
  size = "sm",
  glyphOnly = false,
  className,
  style,
}: TierBadgeProps) {
  // PUBLIC / null / unknown → render nothing. Existing UX untouched.
  if (!tier || tier === "PUBLIC") return null;
  const s = STYLE[tier];
  if (!s) return null;
  const sz = SIZE[size];

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sz.gap,
        padding: sz.pad,
        fontSize: sz.fs,
        lineHeight: 1.2,
        fontWeight: 600,
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: sz.r,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        ...style,
      }}
      title={s.label}
      aria-label={s.label}
    >
      <span aria-hidden style={{ fontSize: "0.95em" }}>
        {s.glyph}
      </span>
      {!glyphOnly && <span>{s.label}</span>}
    </span>
  );
}
