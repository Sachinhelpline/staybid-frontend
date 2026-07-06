"use client";

// Phase 3b — individual-room display for circle-operated hotels.
//
// When a hotel has investor-owned physical rooms, each room is its OWN
// Airbnb-style listing (own price / amenities / photos / host-rating), grouped
// under its category. The customer picks a SPECIFIC room → the booking routes to
// that room's owner. Owner identity is NEVER shown — rooms differ by attributes
// + a per-room host trust rating.
//
// Self-contained: it synthesizes a "room" object per listing (carrying
// `_assignedUnitId` + the unit's price) and hands it to the SAME openBookNow /
// openNegotiate handlers the category cards use, so the existing booking
// pipeline (BookingReview → Razorpay → placeBid) is reused unchanged. The parent
// only threads `assignedUnitId` into its placeBid calls.

import { useMemo, useState } from "react";

export type RoomListing = {
  unitId: string;
  roomId: string;
  categoryName: string;
  roomNumber: string | null;
  floor: string | null;
  title: string;
  price: number;
  mrp: number | null;
  amenities: any[];
  photos: any[];
  viewLabel: string | null;
  capacity: number;
  hostRating: number | null;
  hostReviews: number;
};

type Props = {
  listings: RoomListing[];
  categories: any[];
  datesSelected: boolean;
  onBook: (room: any) => void;
  onNegotiate: (room: any) => void;
};

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

// Build the "room" object the existing handlers consume, tagged with the unit.
function toRoom(cat: any, l: RoomListing) {
  return {
    ...(cat || {}),
    id: l.roomId, // category id — floor validation + createBidRequest.roomId
    name: l.title,
    floorPrice: l.price,
    mrp: l.mrp ?? cat?.mrp ?? null,
    amenities: l.amenities,
    images: l.photos,
    capacity: l.capacity,
    // Phase 3 markers — the parent reads `_assignedUnitId` into placeBid.
    _assignedUnitId: l.unitId,
    _isIndividual: true,
    _hostRating: l.hostRating,
    _viewLabel: l.viewLabel,
    _roomNumber: l.roomNumber,
  };
}

export default function IndividualRoomsSection({
  listings,
  categories,
  datesSelected,
  onBook,
  onNegotiate,
}: Props) {
  // Group listings by category, preserving category order.
  const groups = useMemo(() => {
    const catById: Record<string, any> = {};
    (categories || []).forEach((c) => {
      if (c?.id) catById[String(c.id)] = c;
    });
    const byCat: Record<string, RoomListing[]> = {};
    (listings || []).forEach((l) => {
      const k = String(l.roomId);
      (byCat[k] = byCat[k] || []).push(l);
    });
    return Object.keys(byCat).map((roomId) => {
      const items = byCat[roomId].slice().sort((a, b) => a.price - b.price);
      return {
        roomId,
        cat: catById[roomId] || { id: roomId, name: items[0]?.categoryName || "Rooms" },
        name: catById[roomId]?.name || items[0]?.categoryName || "Rooms",
        items,
        from: Math.min(...items.map((i) => i.price)),
      };
    });
  }, [listings, categories]);

  if (!groups.length) return null;

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-xl font-semibold"
          style={{ color: "var(--text-base)", fontFamily: "var(--font-display, inherit)" }}
        >
          Choose your room
        </h3>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          Every room is individually hosted — pick the one you love.
        </p>
      </div>

      {groups.map((g) => (
        <CategoryGroup
          key={g.roomId}
          group={g}
          datesSelected={datesSelected}
          onBook={(l) => onBook(toRoom(g.cat, l))}
          onNegotiate={(l) => onNegotiate(toRoom(g.cat, l))}
        />
      ))}
    </div>
  );
}

function CategoryGroup({
  group,
  datesSelected,
  onBook,
  onNegotiate,
}: {
  group: { roomId: string; cat: any; name: string; items: RoomListing[]; from: number };
  datesSelected: boolean;
  onBook: (l: RoomListing) => void;
  onNegotiate: (l: RoomListing) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 3;
  const shown = expanded ? group.items : group.items.slice(0, PREVIEW);

  return (
    <div
      className="rounded-3xl p-4 sm:p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow-soft)" }}
    >
      {/* Category header — "from ₹X · N rooms" (no clashing prices up front) */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-base font-semibold" style={{ color: "var(--text-base)" }}>
            {group.name}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {group.items.length} room{group.items.length === 1 ? "" : "s"} available
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>from</div>
          <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>
            {inr(group.from)}
            <span className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}> /night</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {shown.map((l) => (
          <RoomListingCard
            key={l.unitId}
            l={l}
            datesSelected={datesSelected}
            onBook={() => onBook(l)}
            onNegotiate={() => onNegotiate(l)}
          />
        ))}
      </div>

      {group.items.length > PREVIEW && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full py-2 rounded-xl text-sm font-medium"
          style={{ background: "var(--bg-pill)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}
        >
          {expanded ? "Show fewer rooms" : `Show all ${group.items.length} rooms`}
        </button>
      )}
    </div>
  );
}

function RoomListingCard({
  l,
  datesSelected,
  onBook,
  onNegotiate,
}: {
  l: RoomListing;
  datesSelected: boolean;
  onBook: () => void;
  onNegotiate: () => void;
}) {
  const photo = (Array.isArray(l.photos) && l.photos[0]) || "";
  const amen = Array.isArray(l.amenities) ? l.amenities.slice(0, 3) : [];
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col sm:flex-row"
      style={{ background: "var(--bg-elevated, var(--bg-page))", border: "1px solid var(--border-soft)" }}
    >
      {photo ? (
        <div className="sm:w-40 h-36 sm:h-auto shrink-0 relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt={l.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      ) : null}

      <div className="flex-1 p-3 sm:p-4 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: "var(--text-base)" }}>
              {l.title}
            </div>
            <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "var(--text-muted)" }}>
              {l.roomNumber && <span>Room {l.roomNumber}</span>}
              {l.viewLabel && <span>· {l.viewLabel}</span>}
              <span>· Sleeps {l.capacity}</span>
            </div>
          </div>
          {l.hostRating != null && l.hostRating > 0 && (
            <div
              className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-lg flex items-center gap-1"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              title="Host rating — how this room's host has treated past guests"
            >
              ★ {Number(l.hostRating).toFixed(1)}
              {l.hostReviews > 0 && (
                <span className="font-normal" style={{ color: "var(--text-muted)" }}>({l.hostReviews})</span>
              )}
            </div>
          )}
        </div>

        {amen.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {amen.map((a: any, i: number) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-pill)", color: "var(--text-soft)" }}
              >
                {String(a)}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end justify-between gap-3 mt-auto pt-3">
          <div>
            {l.mrp && l.mrp > l.price && (
              <div className="text-[11px] line-through" style={{ color: "var(--text-muted)" }}>{inr(l.mrp)}</div>
            )}
            <div className="text-base font-bold" style={{ color: "var(--text-base)" }}>
              {datesSelected ? inr(l.price) : "Select dates"}
              {datesSelected && (
                <span className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}> /night</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onNegotiate}
              className="px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background: "var(--bg-pill)", color: "var(--text-base)", border: "1px solid var(--border-strong)" }}
            >
              Bid
            </button>
            <button
              onClick={onBook}
              className="px-4 py-2 rounded-xl text-xs font-bold"
              style={{ background: "var(--accent)", color: "var(--text-inverse, #1F1A0F)" }}
            >
              Book
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
