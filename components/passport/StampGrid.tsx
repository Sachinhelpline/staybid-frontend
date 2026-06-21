"use client";
// StampGrid — collected stamps, one per confirmed stay, as tappable 3D region
// "wax seals" (white-highlight metallic disc tinted by region). Empty slots are
// premium dashed placeholders. Tapping a stamp opens its detail (hotel · city ·
// date · region). Empty slots explain how the next stamp lands.
import { useState } from "react";
import { REGION_STYLE, regionForCity, type StampRow, type Region } from "@/lib/passport/engine";
import { PassportMedal, stampFace } from "./PassportMedal";
import { PassportDetailSheet, type DetailItem } from "./PassportDetailSheet";

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export function StampGrid({ stamps }: { stamps: StampRow[] }) {
  const [open, setOpen] = useState<DetailItem | null>(null);
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
        <div className="grid grid-cols-3 gap-3 sb-stagger">
          {stamps.map((s, i) => {
            const region = ((s.region as Region) || regionForCity(s.city)) as Region;
            const rs = REGION_STYLE[region] || REGION_STYLE.city;
            const m = stampFace(rs.ring);
            const detail: DetailItem = {
              glyph: rs.emoji,
              title: s.hotel_name || "Stay",
              blurb: `A ${rs.label.toLowerCase()} stamp earned from your stay${s.city ? ` in ${s.city}` : ""}.`,
              m,
              variant: "stamp",
              earned: true,
              ribbon: rs.label,
              status: { text: "Collected", tone: "good" },
              meta: [
                ...(s.city ? [{ label: "City", value: s.city }] : []),
                { label: "Region", value: rs.label },
                ...(fmtDate(s.stay_date || s.earned_at) ? [{ label: "Stamped", value: fmtDate(s.stay_date || s.earned_at) }] : []),
                { label: "XP earned", value: "+150" },
              ],
            };
            return (
              <button
                key={s.id || s.source_id || i}
                onClick={() => setOpen(detail)}
                className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1.5 sb-card-lift"
                style={{ background: rs.tint, border: "1px solid rgba(201,166,107,0.3)" }}
              >
                <PassportMedal glyph={rs.emoji} size={58} m={m} variant="stamp" pulse ariaLabel={s.hotel_name || "Stay"} />
                <p className="text-[0.64rem] font-bold leading-tight text-center line-clamp-2" style={{ color: "#3A2D10" }}>
                  {s.hotel_name || "Stay"}
                </p>
                <p className="text-[0.55rem] font-mono" style={{ color: "#8B6914" }}>
                  {fmtDate(s.stay_date || s.earned_at)}
                </p>
              </button>
            );
          })}

          {Array.from({ length: empties }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="rounded-2xl flex flex-col items-center justify-center gap-1 py-3"
              style={{ border: "1.5px dashed rgba(201,166,107,0.35)", minHeight: 104, opacity: 0.6 }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "var(--bg-page)",
                  border: "1.5px dashed rgba(201,166,107,0.45)",
                  boxShadow: "inset 0 2px 6px rgba(201,166,107,0.12)",
                }}
              >
                <span className="text-lg" style={{ color: "rgba(201,166,107,0.7)" }}>+</span>
              </div>
              <p className="text-[0.5rem] font-semibold" style={{ color: "rgba(201,166,107,0.75)" }}>
                Next stay
              </p>
            </div>
          ))}
        </div>
      )}

      <PassportDetailSheet item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
