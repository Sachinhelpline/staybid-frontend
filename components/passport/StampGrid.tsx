"use client";
// StampGrid — the collected stamps, one per confirmed stay. Each stamp is a
// region-tinted "ink stamp" with the hotel + city + date. Empty slots are
// dashed placeholders so the page reads like a real passport with room to fill.
import { REGION_STYLE, regionForCity, type StampRow, type Region } from "@/lib/passport/engine";

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export function StampGrid({ stamps }: { stamps: StampRow[] }) {
  const slots = Math.max(6, Math.ceil((stamps.length + 1) / 3) * 3);
  const empties = Math.max(0, slots - stamps.length);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold" style={{ color: "var(--text-base)" }}>
          🛂 Your Stamps
        </h3>
        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          {stamps.length} collected
        </span>
      </div>

      {stamps.length === 0 ? (
        <div
          className="rounded-2xl p-6 text-center"
          style={{ border: "1.5px dashed rgba(201,166,107,0.4)", background: "var(--bg-card)" }}
        >
          <p className="text-3xl mb-2">🧳</p>
          <p className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>
            No stamps yet
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Complete a stay and your first stamp lands here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sb-stagger">
          {stamps.map((s, i) => {
            const region = ((s.region as Region) || regionForCity(s.city)) as Region;
            const rs = REGION_STYLE[region] || REGION_STYLE.city;
            return (
              <div
                key={s.id || s.source_id || i}
                className="rounded-2xl p-2.5 text-center sb-card-lift"
                style={{ background: rs.tint, border: "1px solid rgba(201,166,107,0.28)" }}
                title={`${s.hotel_name || "Stay"} · ${s.city || ""}`}
              >
                <div
                  className="w-11 h-11 rounded-full mx-auto flex items-center justify-center text-lg"
                  style={{ background: rs.ring, color: "#fff", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.35)" }}
                >
                  {rs.emoji}
                </div>
                <p className="text-[0.66rem] font-bold mt-1.5 leading-tight line-clamp-2" style={{ color: "#3A2D10" }}>
                  {s.hotel_name || "Stay"}
                </p>
                <p className="text-[0.58rem] mt-0.5" style={{ color: "#6E5430" }}>
                  {s.city || rs.label}
                </p>
                <p className="text-[0.55rem] mt-0.5 font-mono" style={{ color: "#8B6914" }}>
                  {fmtDate(s.stay_date || s.earned_at)}
                </p>
              </div>
            );
          })}

          {Array.from({ length: empties }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="rounded-2xl p-2.5 flex items-center justify-center"
              style={{ border: "1.5px dashed rgba(201,166,107,0.35)", minHeight: 96, opacity: 0.5 }}
            >
              <span className="text-xl" style={{ color: "rgba(201,166,107,0.6)" }}>
                +
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
