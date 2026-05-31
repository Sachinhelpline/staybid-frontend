"use client";
// ═══════════════════════════════════════════════════════════════════════════
// VerifChecklist — premium AI verification-check chips.
//
// Renders the `vp_ai_reports.checks` object as a tidy grid of pass / fail
// chips. Tone-aware (cozy light vs admin dark). Shared by customer + partner
// + admin so the AI checklist looks identical everywhere.
// ═══════════════════════════════════════════════════════════════════════════

type Checks = {
  code_ok?: boolean;
  ocr_room?: boolean;
  ocr_booking?: boolean;
  scene_match?: number; // 0..1
  geo_ok?: boolean;
  audio_ok?: boolean;
  duration_ok?: boolean;
  objects?: string[];
};

type Tone = "light" | "dark";

const ITEMS: { key: keyof Checks; label: string; custom?: (c: Checks) => boolean }[] = [
  { key: "code_ok", label: "Verification code spoken" },
  { key: "ocr_room", label: "Room number visible" },
  { key: "ocr_booking", label: "Booking ID confirmed" },
  { key: "scene_match", label: "Scene matches room", custom: (c) => (c.scene_match ?? 0) >= 0.7 },
  { key: "duration_ok", label: "Tier duration met" },
  { key: "audio_ok", label: "Audio clear" },
  { key: "geo_ok", label: "Geo-tag valid" },
];

export default function VerifChecklist({
  checks,
  tone = "light",
  columns = 2,
}: {
  checks: Checks | null | undefined;
  tone?: Tone;
  columns?: 1 | 2;
}) {
  const c = checks || {};
  const okC = "#7F9269";
  const noC = "#D49583";
  const labelC = tone === "dark" ? "#C9CCDA" : "var(--cozy-cocoa, #4A3820)";

  const rows = ITEMS.map((it) => {
    const raw = it.custom ? it.custom(c) : (c as any)[it.key];
    if (raw === undefined) return null;
    const ok = !!raw;
    return (
      <div
        key={String(it.key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderRadius: 10,
          fontSize: 12.5,
          background: tone === "dark"
            ? (ok ? "rgba(127,146,105,0.10)" : "rgba(212,149,131,0.10)")
            : (ok ? "rgba(127,146,105,0.10)" : "rgba(212,149,131,0.12)"),
          border: `1px solid ${ok ? "rgba(127,146,105,0.28)" : "rgba(212,149,131,0.30)"}`,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: ok ? okC : noC,
            color: "#fff",
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {ok ? "✓" : "✕"}
        </span>
        <span style={{ color: labelC, fontWeight: 500 }}>{it.label}</span>
      </div>
    );
  }).filter(Boolean);

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: labelC, opacity: 0.7, padding: "4px 0" }}>
        AI analysis pending…
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns === 2 ? "repeat(auto-fit, minmax(170px, 1fr))" : "1fr",
        gap: 8,
      }}
    >
      {rows}
    </div>
  );
}
