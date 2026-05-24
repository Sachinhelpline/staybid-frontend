"use client";
// ── Active Bid Conflict — bottom-sheet ─────────────────────────────────
// Shown when the customer tries to place a bid in a city where they
// already have one active. Three CTAs:
//   1. Update Budget — inline slider PATCH /api/bids/:id/budget
//   2. View Active Bid — route to /my-bids#bid-{id}
//   3. Cancel — dismiss
//
// `conflict` shape is returned by /api/bids/place + Railway POST equivalent:
//   { bidId, hotelId, hotelName, city, status, amount, counterAmount, expiresAt }

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export type BidConflict = {
  bidId: string;
  hotelId: string;
  hotelName: string;
  city: string;
  status: "PENDING" | "COUNTER" | "ACCEPTED" | string;
  amount?: number;
  counterAmount?: number | null;
  expiresAt?: string;
};

type Props = {
  conflict: BidConflict;
  flow?: "place" | "negotiate";
  // Customer's intended NEW per-night amount — used to seed the slider.
  desiredAmount?: number;
  // Floor for slider min; falls back to 500.
  floorPrice?: number;
  // Ceiling for slider max; falls back to 4× the current amount.
  maxBudget?: number;
  onClose: () => void;
  // Fired after a successful budget update so the caller can refetch /my-bids
  // or close any wrapping modal. Receives the updated bid.
  onUpdated?: (updatedBid: any) => void;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 1) return `${h}h ${m}m left`;
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s left`;
}

export default function ActiveBidConflictSheet({
  conflict,
  flow,
  desiredAmount,
  floorPrice,
  maxBudget,
  onClose,
  onUpdated,
}: Props) {
  const router = useRouter();
  const currentAmt = Number(conflict.counterAmount || conflict.amount || 0);
  const min = Math.max(100, Math.round(floorPrice || Math.max(currentAmt * 0.5, 500)));
  const max = Math.max(min + 500, Math.round(maxBudget || currentAmt * 2 || 8000));
  const seed = Math.min(max, Math.max(min, Math.round(desiredAmount || currentAmt || min)));

  const [amount, setAmount] = useState<number>(seed);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  // Live countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expiresMs = useMemo(() => {
    if (!conflict.expiresAt) return 0;
    return new Date(conflict.expiresAt).getTime() - now;
  }, [conflict.expiresAt, now]);

  // Body scroll lock while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleUpdate = async () => {
    setErr("");
    setSaving(true);
    try {
      const res = await api.updateBidBudget(conflict.bidId, amount, flow);
      onUpdated?.(res?.bid);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Could not update budget");
    } finally {
      setSaving(false);
    }
  };

  const statusLabel =
    conflict.status === "COUNTER"  ? "Hotel countered" :
    conflict.status === "ACCEPTED" ? "Accepted — pay to confirm" :
    "Pending review";
  const statusColor =
    conflict.status === "COUNTER"  ? "#C77B43" :
    conflict.status === "ACCEPTED" ? "#7F9269" :
    "#C9A66B";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 sm:p-6"
        style={{
          background: "var(--bg-card, #fff)",
          color: "var(--text-base, #1a1205)",
          border: "1px solid var(--border-soft, rgba(0,0,0,0.08))",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.18)",
          animation: "sheetUp 0.28s cubic-bezier(.2,.8,.2,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`@keyframes sheetUp { from { transform: translateY(28px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>

        {/* drag handle */}
        <div className="sm:hidden flex justify-center mb-3">
          <span style={{ width: 44, height: 5, borderRadius: 3, background: "rgba(0,0,0,0.18)" }} />
        </div>

        {/* heading */}
        <div className="flex items-start gap-3 mb-3">
          <span style={{ fontSize: 26 }}>⚠️</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg leading-tight">
              You already have an active bid in {conflict.city}
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted, #6b6357)" }}>
              One active bid per city — update your existing bid instead of starting a new one.
            </p>
          </div>
        </div>

        {/* existing bid summary */}
        <div
          className="rounded-2xl p-3.5 mb-4"
          style={{ background: "var(--bg-pill, rgba(0,0,0,0.04))", border: "1px solid var(--border-soft, rgba(0,0,0,0.08))" }}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="font-semibold text-sm truncate">{conflict.hotelName}</p>
            <span
              className="text-[0.6rem] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{ background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}55` }}
            >
              {statusLabel}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-xs" style={{ color: "var(--text-muted, #6b6357)" }}>Current bid</p>
            <p className="text-sm font-bold" style={{ color: "#c9911a" }}>
              ₹{currentAmt.toLocaleString("en-IN")}/night
            </p>
            {conflict.expiresAt && (
              <p className="text-[0.65rem] ml-auto" style={{ color: expiresMs <= 0 ? "#c0392b" : "var(--text-muted, #6b6357)" }}>
                ⏱ {formatCountdown(expiresMs)}
              </p>
            )}
          </div>
        </div>

        {/* budget update — only meaningful for PENDING/COUNTER */}
        {(conflict.status === "PENDING" || conflict.status === "COUNTER") ? (
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted, #6b6357)" }}>
                New budget per night
              </label>
              <span className="text-lg font-bold" style={{ color: "#c9911a" }}>
                ₹{amount.toLocaleString("en-IN")}
              </span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#c9911a" }}
              disabled={saving}
            />
            <div className="flex justify-between text-[0.62rem] mt-1" style={{ color: "var(--text-muted, #6b6357)" }}>
              <span>₹{min.toLocaleString("en-IN")}</span>
              <span>₹{max.toLocaleString("en-IN")}</span>
            </div>
            {conflict.status === "COUNTER" && (
              <p className="text-[0.65rem] mt-2" style={{ color: "var(--text-muted, #6b6357)" }}>
                Updating drops the counter and sends your new amount back to the hotel.
              </p>
            )}
            {err && <p className="text-xs mt-2" style={{ color: "#c0392b" }}>{err}</p>}
          </div>
        ) : (
          <p className="text-xs mb-4" style={{ color: "var(--text-muted, #6b6357)" }}>
            The hotel already accepted this bid. Pay to confirm before placing another in {conflict.city}.
          </p>
        )}

        {/* actions */}
        <div className="flex flex-col gap-2">
          {(conflict.status === "PENDING" || conflict.status === "COUNTER") && (
            <button
              onClick={handleUpdate}
              disabled={saving || amount <= 0}
              className="w-full py-3 rounded-xl font-bold text-sm disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#b8871a,#f0b429 55%,#c9911a)", color: "#1a1205" }}
            >
              {saving ? "Updating…" : `💰 Update Budget to ₹${amount.toLocaleString("en-IN")}/night`}
            </button>
          )}
          <button
            onClick={() => { onClose(); router.push(`/my-bids#bid-${conflict.bidId}`); }}
            className="w-full py-2.5 rounded-xl font-semibold text-sm"
            style={{ background: "var(--bg-pill, rgba(0,0,0,0.05))", color: "var(--text-base, #1a1205)", border: "1px solid var(--border-soft, rgba(0,0,0,0.08))" }}
          >
            View Active Bid →
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-xs font-semibold"
            style={{ color: "var(--text-muted, #6b6357)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
