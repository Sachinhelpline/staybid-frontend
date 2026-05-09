"use client";
// Renders the user-type badge: Verified Hotel (blue ✓), Creator (gold ✦),
// or Public Member (grey •). Pure-presentational; receives the user_type
// + verified flags as props from the social profile.
type UserType = "PUBLIC" | "CREATOR" | "HOTEL";

const STYLES: Record<UserType, { bg: string; color: string; mark: string; label: string }> = {
  HOTEL:   { bg: "#1D9BF0", color: "#fff",     mark: "✓", label: "Verified Hotel" },
  CREATOR: { bg: "#F5A623", color: "#1a1208",  mark: "✦", label: "Creator"        },
  PUBLIC:  { bg: "#8E8E8E", color: "#fff",     mark: "•", label: "Member"         },
};

export function ProfileBadge({ userType, size = "sm", showLabel = true }: {
  userType: UserType;
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
}) {
  const style = STYLES[userType] || STYLES.PUBLIC;
  const dim = size === "xs" ? 12 : size === "sm" ? 14 : 18;
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      style={{
        fontSize: size === "xs" ? "0.55rem" : size === "sm" ? "0.62rem" : "0.74rem",
        fontWeight: 700,
        color: showLabel ? "rgba(255,255,255,0.85)" : "transparent",
        letterSpacing: "0.02em",
      }}
    >
      <span
        aria-label={style.label}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: dim, height: dim, borderRadius: 9999,
          background: style.bg, color: style.color,
          fontSize: dim * 0.7, fontWeight: 900, lineHeight: 1,
          boxShadow: "0 1px 3px rgba(0,0,0,0.45)",
        }}
      >{style.mark}</span>
      {showLabel && <span>{style.label}</span>}
    </span>
  );
}
