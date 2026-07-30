"use client";
// v199 — Shared "💡 Update Budget" inline slider. Extracted from
// app/my-bids/page.tsx so the same control mounts on the hotel detail
// page's "Your offers" section too. Lives on every PENDING / COUNTER
// card so the customer can re-pitch without losing their place in the
// city (one-active-bid-per-city rule, v195).
//
// PATCHes /api/bids/:id/budget which also resets the countdown. The
// route handles fan-out across sibling bids of a /bid broadcast
// (same requestId) and auto-flips to ACCEPTED when the new amount
// clears the room's floorPrice (v196 contract).
//
// Sachin's "kahan chala gaya wo option" feedback (v199): the control
// was always there on /my-bids, but ACCEPTED bids on the hotel page
// hid it entirely (correct — accepted is price-locked). What was
// MISSING is the same chip on the hotel page's PENDING/COUNTER cards
// so the customer doesn't have to leave the hotel page to re-pitch.

import { useState } from "react";
import { api } from "@/lib/api";

export interface UpdateBudgetInlineProps {
  bid: any;
  flow: "place" | "negotiate";
  floor: number;
  onUpdated: () => void;
  /** When true, opens the slider directly without the chip step. Used by
   * the ActiveBidConflictSheet 409 modal where there's only one CTA. */
  openByDefault?: boolean;
}

export default function UpdateBudgetInline({
  bid, flow, floor, onUpdated, openByDefault = false,
}: UpdateBudgetInlineProps) {
  const current = Number(bid.counterAmount || bid.amount || 0);
  const min = Math.max(100, Math.round(floor || Math.max(current * 0.5, 500)));
  const max = Math.max(min + 500, Math.round(current * 2 || 8000));
  const [open, setOpen] = useState(openByDefault);
  const [amt, setAmt] = useState<number>(Math.max(min, current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => { setAmt(Math.max(min, current)); setOpen(true); }}
        className="mt-2 w-full py-2 text-xs font-semibold rounded-xl"
        style={{ background: "var(--bg-pill)", color: "var(--text-base)", border: "1px solid var(--border-soft)" }}
      >
        💡 Update Budget
      </button>
    );
  }

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.updateBidBudget(bid.id, amt, flow);
      setOpen(false);
      onUpdated();
    } catch (e: any) {
      setErr(e?.message || "Could not update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 p-3 rounded-xl"
      style={{ background: "var(--bg-pill)", border: "1px solid var(--border-soft)" }}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[0.62rem] uppercase tracking-wide font-semibold" style={{ color: "var(--text-muted)" }}>
          New budget / night
        </span>
        <span className="text-sm font-bold" style={{ color: "#8198ae" }}>
          ₹{amt.toLocaleString("en-IN")}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={100}
        value={amt}
        onChange={(e) => setAmt(Number(e.target.value))}
        disabled={busy}
        style={{ width: "100%", accentColor: "#8198ae" }}
      />
      <div className="flex justify-between text-[0.6rem] mt-1" style={{ color: "var(--text-muted)" }}>
        <span>₹{min.toLocaleString("en-IN")}</span>
        <span>₹{max.toLocaleString("en-IN")}</span>
      </div>
      {bid.status === "COUNTER" && (
        <p className="text-[0.62rem] mt-1.5" style={{ color: "var(--text-muted)" }}>
          Drops the counter and re-pitches at your new amount.
        </p>
      )}
      {err && <p className="text-xs mt-2" style={{ color: "#c0392b" }}>{err}</p>}
      <div className="flex gap-2 mt-2">
        <button onClick={submit} disabled={busy}
          className="flex-1 gold-btn py-2 rounded-lg text-xs disabled:opacity-50">
          {busy ? "Updating…" : "Confirm"}
        </button>
        <button onClick={() => setOpen(false)} disabled={busy}
          className="flex-1 py-2 text-xs font-semibold rounded-lg"
          style={{ background: "var(--bg-card)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
