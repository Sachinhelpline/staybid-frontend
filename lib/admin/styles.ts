import type { CSSProperties } from "react";

export const adminColors = {
  bg: "#07080C",
  surface: "#0F1117",
  card: "#151820",
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.12)",
  text: "#E8EAF0",
  textDim: "#8A8FA8",
  gold: "#D4AF37",
  gold2: "#F0D060",
  green: "#2ECC71",
  red: "#FF4757",
  blue: "#3D9CF5",
  purple: "#A855F7",
  amber: "#F59E0B",
};

export const inputStyle: CSSProperties = {
  background: "#151820",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "10px 14px",
  color: "#E8EAF0",
  fontSize: 14,
  outline: "none",
  fontFamily: "DM Sans, sans-serif",
  minWidth: 200,
};

export const selectStyle: CSSProperties = { ...inputStyle, minWidth: 140, cursor: "pointer" };

export const btnGold: CSSProperties = {
  background: adminColors.gold,
  color: "#000",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "DM Sans, sans-serif",
};

export const btnGhost: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  color: adminColors.text,
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "9px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "DM Sans, sans-serif",
};

export const cardStyle: CSSProperties = {
  background: adminColors.card,
  border: `1px solid ${adminColors.border}`,
  borderRadius: 14,
  padding: 20,
};

export const h1Style: CSSProperties = {
  fontFamily: "Syne, sans-serif",
  color: adminColors.text,
  fontSize: 28,
  margin: "0 0 20px",
};

export const pageStyle: CSSProperties = {
  fontFamily: "DM Sans, sans-serif",
};

export function pill(color: string, label: string): CSSProperties {
  return {
    background: color + "22",
    color,
    padding: "3px 10px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    display: "inline-block",
  } as CSSProperties;
}
