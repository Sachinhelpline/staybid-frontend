"use client";
// ═══════════════════════════════════════════════════════════════════════════
// VerifStatusFlow — premium 4-stage progress rail for a verification request.
//
//   Requested → Hotel records → AI review → Verified
//
// Makes the whole flow legible at a glance on every panel. Tone-aware.
// Maps the raw vp_requests.status (+ report presence) onto the active stage.
// ═══════════════════════════════════════════════════════════════════════════

type Tone = "light" | "dark";

const STAGES = [
  { key: "requested", icon: "📩", label: "Requested" },
  { key: "recorded", icon: "🎬", label: "Hotel records" },
  { key: "ai", icon: "🤖", label: "AI review" },
  { key: "done", icon: "✅", label: "Verified" },
];

export function activeStageIndex(status?: string, hasReport?: boolean): number {
  if (!status || status === "pending") return 0;
  if (status === "uploaded") return hasReport ? 2 : 1;
  if (status === "verified" || status === "rejected") return 3;
  return 1;
}

export default function VerifStatusFlow({
  status,
  hasReport,
  flagged,
  tone = "light",
}: {
  status?: string;
  hasReport?: boolean;
  flagged?: boolean;
  tone?: Tone;
}) {
  const active = activeStageIndex(status, hasReport);
  const accent = flagged ? "#D49583" : "#7F9269";
  const idle = tone === "dark" ? "rgba(255,255,255,0.14)" : "rgba(31,26,15,0.12)";
  const idleText = tone === "dark" ? "#8A8FA8" : "var(--cozy-cocoa-soft, #6E5430)";
  const doneText = tone === "dark" ? "#E8EAF0" : "var(--cozy-warm-dark, #1F1A0F)";

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0, width: "100%" }}>
      {STAGES.map((st, i) => {
        const reached = i <= active;
        const isLast = i === STAGES.length - 1;
        const lastDone = isLast && active >= 3;
        const dotColor = reached ? (lastDone && flagged ? "#D49583" : accent) : idle;
        const label = lastDone && flagged ? "Flagged" : st.label;
        const icon = lastDone && flagged ? "⚠️" : st.icon;
        return (
          <div key={st.key} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  background: reached ? `${dotColor}22` : "transparent",
                  border: `2px solid ${dotColor}`,
                  boxShadow: reached ? `0 0 0 3px ${dotColor}1a` : "none",
                  transition: "all .3s",
                }}
              >
                {reached ? icon : <span style={{ width: 7, height: 7, borderRadius: 999, background: idle }} />}
              </div>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: reached ? 700 : 500,
                  color: reached ? doneText : idleText,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.01em",
                }}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  margin: "0 4px",
                  marginBottom: 18,
                  borderRadius: 2,
                  background: i < active ? accent : idle,
                  transition: "background .3s",
                  minWidth: 12,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
