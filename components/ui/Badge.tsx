// ─────────────────────────────────────────────────────────────────────────
// Badge / Chip — one chip system. `tone` picks a semantic colour (separate
// from the --accent brand hue). `dot` prepends a status dot; `pill` rounds it.
// Replaces the ~9-element micro-text band that all shouted at 0.46–0.66rem.
// ─────────────────────────────────────────────────────────────────────────
import * as React from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "sbui-badge--neutral",
  accent: "sbui-badge--accent",
  success: "sbui-badge--success",
  warning: "sbui-badge--warning",
  danger: "sbui-badge--danger",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  pill?: boolean;
  dot?: boolean;
};

export function Badge({ tone = "neutral", pill = false, dot = false, className, children, ...rest }: BadgeProps) {
  const cls = [
    "sbui-badge",
    TONE_CLASS[tone],
    pill ? "sbui-badge--pill" : "",
    dot ? "sbui-badge--dot" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}

export default Badge;
