// ─────────────────────────────────────────────────────────────────────────
// Button — the ONE button primitive for the UI upgrade (Phase 0a).
//
// Variants map to the locked Direction A palette (live pewter, verbatim). The
// primary variant uses the exact production brushed-pewter gradient via the
// `--sbui-btn-primary-bg` token, so a future palette tweak is a single-file
// change instead of 47 hand-mixed gradients.
//
// Presentational only — no hooks — so it renders in server OR client trees.
// Renders a real <button> by default, or an <a> when `href` is given, so it is
// always keyboard-focusable and semantic.
// ─────────────────────────────────────────────────────────────────────────
import * as React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "sbui-btn--primary",
  secondary: "sbui-btn--secondary",
  ghost: "sbui-btn--ghost",
  danger: "sbui-btn--danger",
  success: "sbui-btn--success",
};
const SIZE_CLASS: Record<Size, string> = { sm: "sbui-btn--sm", md: "", lg: "sbui-btn--lg" };

function classes(variant: Variant, size: Size, block: boolean, extra?: string): string {
  return [
    "sbui-btn",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? "sbui-btn--block" : "",
    extra || "",
  ]
    .filter(Boolean)
    .join(" ");
}

type CommonProps = {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** Icon element (e.g. <Icon name="Search" />) rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Icon element rendered after the label. */
  trailingIcon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };
type ButtonAsLink = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const {
    variant = "primary",
    size = "md",
    block = false,
    leadingIcon,
    trailingIcon,
    children,
    className,
    ...rest
  } = props as CommonProps & Record<string, unknown>;

  const cls = classes(variant, size, block, className);
  const inner = (
    <>
      {leadingIcon}
      {children != null && <span>{children}</span>}
      {trailingIcon}
    </>
  );

  if (typeof (props as ButtonAsLink).href === "string") {
    const { href, ...anchorRest } = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a className={cls} href={href} {...anchorRest}>
        {inner}
      </a>
    );
  }

  const { type, ...buttonRest } = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button className={cls} type={type || "button"} {...buttonRest}>
      {inner}
    </button>
  );
}

export default Button;
