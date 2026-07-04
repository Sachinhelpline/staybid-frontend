"use client";

// StayCircle™ — shared per-room "complete tour" body (v294).
// One source of truth for what a room's full tour looks like — a photo
// gallery (with its own thumbnail index), description, complete spec grid
// (size / sleeps / bed / view / rent / ROI / availability) and every amenity
// chip. Reused by BOTH the Step-2 room-selection sheet (/circle/discover) and
// the property tour page (/circle/[id]) so the two never drift.

import { useState } from "react";
import { fmtINR } from "@/lib/circle/engine";

export type RoomTourData = {
  name: string;
  monthlyRate: number;
  description?: string;
  images?: string[];
  amenities?: string[];
  sizeSqft?: number;
  capacity?: number;
  bedType?: string;
  viewLabel?: string;
  roiPct?: number;
  availableUnits: number;
  totalUnits: number;
};

export default function RoomTourBody({
  rt, fallbackRoi,
}: {
  rt: RoomTourData;
  fallbackRoi: string;
}) {
  const [gi, setGi] = useState(0);
  const imgs = Array.isArray(rt.images) ? rt.images.filter(Boolean) : [];
  const amen = Array.isArray(rt.amenities) ? rt.amenities.filter(Boolean) : [];
  const avail = rt.availableUnits > 0;
  const idx = Math.min(gi, Math.max(imgs.length - 1, 0));

  return (
    <div className="sbc-roomtour">
      {imgs.length > 0 && (
        <div className="sbc-rc-gallery">
          <div className="sbc-rc-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgs[idx]} alt={rt.name} loading="lazy" />
            {imgs.length > 1 && <span className="sbc-rc-count">{idx + 1} / {imgs.length}</span>}
          </div>
          {imgs.length > 1 && (
            <div className="sbc-rc-thumbs">
              {imgs.map((src, i) => (
                <button key={i} className={`sbc-rc-thumb ${i === idx ? "on" : ""}`} onClick={() => setGi(i)} aria-label={`Photo ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {rt.description && <p className="sbc-rc-desc">{rt.description}</p>}

      <div className="sbc-rc-specs">
        {rt.sizeSqft ? <div className="sbc-rc-spec"><span>Size</span><b>{rt.sizeSqft} sq ft</b></div> : null}
        {rt.capacity ? <div className="sbc-rc-spec"><span>Sleeps</span><b>{rt.capacity} guest{rt.capacity > 1 ? "s" : ""}</b></div> : null}
        {rt.bedType ? <div className="sbc-rc-spec"><span>Bed</span><b>{rt.bedType}</b></div> : null}
        {rt.viewLabel ? <div className="sbc-rc-spec"><span>View</span><b>{rt.viewLabel}</b></div> : null}
        <div className="sbc-rc-spec"><span>Rent</span><b>{fmtINR(rt.monthlyRate)}/mo</b></div>
        <div className="sbc-rc-spec"><span>Expected ROI</span><b>{rt.roiPct ? `${rt.roiPct}%` : `${fallbackRoi}%`}</b></div>
        <div className="sbc-rc-spec"><span>Availability</span><b style={{ color: avail ? "var(--sbc-sage)" : "var(--sbc-rose)" }}>{avail ? `${rt.availableUnits} / ${rt.totalUnits}` : "Full"}</b></div>
      </div>

      {amen.length > 0 && (
        <div className="sbc-rc-amen">
          {amen.map((a) => <span key={a} className="sbc-rc-amen-chip">{a}</span>)}
        </div>
      )}
    </div>
  );
}
