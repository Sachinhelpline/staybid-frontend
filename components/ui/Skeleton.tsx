// ─────────────────────────────────────────────────────────────────────────
// Skeleton — loading placeholder. Reduced-motion safe (shimmer disabled via
// the CSS guard). Use to reach 100% no-blank-flash loading coverage.
// ─────────────────────────────────────────────────────────────────────────
import * as React from "react";

export type SkeletonProps = React.HTMLAttributes<HTMLSpanElement> & {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
};

export function Skeleton({ width, height = "1em", radius, style, className, ...rest }: SkeletonProps) {
  const merged: React.CSSProperties = {
    width: width ?? "100%",
    height,
    ...(radius != null ? { borderRadius: radius } : null),
    ...style,
  };
  return (
    <span
      className={["sbui-skeleton", className || ""].filter(Boolean).join(" ")}
      aria-hidden="true"
      style={merged}
      {...rest}
    />
  );
}

export default Skeleton;
