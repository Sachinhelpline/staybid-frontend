// ─────────────────────────────────────────────────────────────────────────
// Card — surface primitive. Reads --bg-card / --border-soft / elevation tokens
// so it flips light↔dark for free. `media` variant is depth-on-the-tile (the
// .sbh learning: never box the text, put the shadow on the image surface).
// ─────────────────────────────────────────────────────────────────────────
import * as React from "react";

type CardVariant = "flat" | "elevated" | "media";

const VARIANT_CLASS: Record<CardVariant, string> = {
  flat: "",
  elevated: "sbui-card--elevated",
  media: "sbui-card--media",
};

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  /** Apply the default internal padding. */
  padded?: boolean;
  as?: keyof React.JSX.IntrinsicElements;
};

export function Card({
  variant = "flat",
  padded = false,
  as = "div",
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = as as React.ElementType;
  const cls = ["sbui-card", VARIANT_CLASS[variant], padded ? "sbui-card--pad" : "", className || ""]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}

export default Card;
