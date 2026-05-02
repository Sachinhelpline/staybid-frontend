interface KpiCardProps {
  title: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: string;
  trend?: number;
}

export default function KpiCard({ title, value, sub, color = "#D4AF37", icon, trend }: KpiCardProps) {
  return (
    <div
      style={{
        background: "#151820",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, ${color}, transparent)`,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span
          style={{
            fontSize: 12,
            color: "#8A8FA8",
            fontFamily: "DM Sans, sans-serif",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
        {icon && (
          <span
            style={{
              width: 36,
              height: 36,
              background: color + "18",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            {icon}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#E8EAF0",
          fontFamily: "Syne, sans-serif",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {(sub || trend !== undefined) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {trend !== undefined && (
            <span
              style={{
                fontSize: 12,
                color: trend >= 0 ? "#2ECC71" : "#FF4757",
                fontWeight: 600,
              }}
            >
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
            </span>
          )}
          {sub && (
            <span style={{ fontSize: 12, color: "#8A8FA8", fontFamily: "DM Sans, sans-serif" }}>
              {sub}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
