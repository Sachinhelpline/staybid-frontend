// v330 — Circle Phase C4: Model 3 inventory LIFECYCLE cron.
//
// Two idempotent passes over `inventory_blocks`:
//   1) MARKDOWN — LISTED blocks within the 14-day check-in window get their
//      resale price auto-marked-down in tiers (from a FROZEN original,
//      never below buy cost). Recomputed from the frozen baseline so re-runs
//      converge and never compound.
//   2) EXPIRY — OWNED/LISTED blocks whose stay has already started
//      (date_from < today) flip to `expired` and their pre-buy `room_blocks`
//      HOLD is released (the nights are past — the hold is moot; released for
//      tidiness + so expiry/buyback consistently free inventory).
//
// Auth mirrors /api/cron/expire-holds (?token= / Bearer CRON_SECRET).
// Register on cron-job.org: */15 * * * * →
//   https://www.staybids.in/api/cron/inventory-lifecycle?token=<CRON_SECRET>
//
// Bounded + budget-guarded (cron-job.org ~30s client timeout — v241.27 lesson).

import { NextRequest, NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { markdownResalePerNight, daysUntil } from "@/lib/inventory/engine";
import { markdownB2bAskPerNight } from "@/lib/b2b/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const MARKDOWN_HORIZON_DAYS = 14; // only blocks ≤ 14 days out can be marked down
const MAX_PER_PASS = 200;
const TIME_BUDGET_MS = 24_000;    // return well inside cron-job.org's window


const round0 = (n: any) => Math.round(Number(n) || 0);
const isoDatePlus = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// Release the pre-buy hold for a block (deterministic id from C2's writeHold).
async function releaseHold(blockId: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(`invhold_${blockId}`)}`,
      { method: "DELETE", headers: SB_H },
    );
    return r.ok;
  } catch { return false; }
}

// ── Pass 1: auto-markdown listed blocks near check-in ──────────────────────
async function markdownPass(startedAt: number): Promise<{ marked: number; scanned: number }> {
  const today = isoDatePlus(0);
  const horizon = isoDatePlus(MARKDOWN_HORIZON_DAYS);
  let scanned = 0, marked = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?status=eq.listed` +
        `&date_from=gte.${today}&date_from=lte.${horizon}` +
        `&select=id,date_from,resale_price_per_night,buy_price_per_night,metadata` +
        `&order=date_from.asc&limit=${MAX_PER_PASS}`,
      { headers: SB_H },
    );
    const blocks: any[] = r.ok ? await r.json().catch(() => []) : [];
    for (const b of blocks) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      scanned++;
      const meta = (b.metadata && typeof b.metadata === "object") ? b.metadata : {};
      // Frozen original — backfill from the current price for pre-C4 listings.
      const original = round0(meta.listResalePerNight ?? b.resale_price_per_night);
      if (original <= 0) continue;
      const daysOut = daysUntil(String(b.date_from));
      const { perNight, pct } = markdownResalePerNight({
        originalPerNight: original,
        buyPerNight: round0(b.buy_price_per_night),
        daysOut,
      });
      if (perNight === round0(b.resale_price_per_night) && round0(meta.markdownPct) === pct
          && meta.listResalePerNight != null) {
        continue; // already at the right marked-down price (idempotent no-op)
      }
      try {
        const pr = await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(String(b.id))}&status=eq.listed`,
          {
            method: "PATCH",
            headers: { ...SB_H, Prefer: "return=minimal" },
            body: JSON.stringify({
              resale_price_per_night: perNight,
              metadata: { ...meta, listResalePerNight: original, markdownPct: pct, markedDownAt: new Date().toISOString() },
              updated_at: new Date().toISOString(),
            }),
          },
        );
        if (pr.ok) marked++;
      } catch { /* skip this block */ }
    }
  } catch { /* pass is best-effort */ }
  return { marked, scanned };
}

// ── Pass 2: expire started-but-unsold blocks + release their holds ─────────
async function expiryPass(startedAt: number): Promise<{ expired: number; holdsReleased: number }> {
  const today = isoDatePlus(0);
  let expired = 0, holdsReleased = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?status=in.(owned,listed)&date_from=lt.${today}` +
        `&select=id,metadata&order=date_from.asc&limit=${MAX_PER_PASS}`,
      { headers: SB_H },
    );
    const blocks: any[] = r.ok ? await r.json().catch(() => []) : [];
    for (const b of blocks) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      const meta = (b.metadata && typeof b.metadata === "object") ? b.metadata : {};
      try {
        const pr = await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(String(b.id))}&status=in.(owned,listed)`,
          {
            method: "PATCH",
            headers: { ...SB_H, Prefer: "return=minimal" },
            body: JSON.stringify({
              status: "expired",
              metadata: { ...meta, expiredAt: new Date().toISOString(), expiredReason: "stay_started_unsold" },
              updated_at: new Date().toISOString(),
            }),
          },
        );
        if (pr.ok) {
          expired++;
          if (await releaseHold(String(b.id))) holdsReleased++;
        }
      } catch { /* skip this block */ }
    }
  } catch { /* pass is best-effort */ }
  return { expired, holdsReleased };
}

// ── Pass 3 (v334 · D4): auto-markdown LISTED B2B listings near check-in ────
// Same tier discipline as Pass 1, on `b2b_listings.ask_per_night`. Frozen
// baseline `metadata.listAskPerNight`; floored at the seller's per-night buy
// cost (`buy_total / nights`); ask_total recomputed. Idempotent no-op skip.
async function b2bMarkdownPass(startedAt: number): Promise<{ marked: number; scanned: number }> {
  const today = isoDatePlus(0);
  const horizon = isoDatePlus(MARKDOWN_HORIZON_DAYS);
  let scanned = 0, marked = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?status=eq.listed` +
        `&date_from=gte.${today}&date_from=lte.${horizon}` +
        `&select=id,date_from,nights,ask_per_night,ask_total,buy_total,metadata` +
        `&order=date_from.asc&limit=${MAX_PER_PASS}`,
      { headers: SB_H },
    );
    const rows: any[] = r.ok ? await r.json().catch(() => []) : [];
    for (const b of rows) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      scanned++;
      const meta = (b.metadata && typeof b.metadata === "object") ? b.metadata : {};
      // v624 — a released WINDOW listing (v356, metadata.window=true) has
      // date_from = the window START, not a stay start; buyers pick nights
      // anywhere inside it, so "near check-in" markdown does not apply.
      if (meta.window === true) continue;
      const nights = Math.max(1, round0(b.nights));
      // Frozen original — backfill from the current ask for pre-D4 listings.
      const original = round0(meta.listAskPerNight ?? b.ask_per_night);
      if (original <= 0) continue;
      const daysOut = daysUntil(String(b.date_from));
      const { perNight, pct } = markdownB2bAskPerNight({
        originalAskPerNight: original,
        buyTotal: round0(b.buy_total),
        nights,
        daysOut,
      });
      if (perNight === round0(b.ask_per_night) && round0(meta.markdownPct) === pct
          && meta.listAskPerNight != null) {
        continue; // already at the right marked-down ask (idempotent no-op)
      }
      try {
        const pr = await fetch(
          `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(String(b.id))}&status=eq.listed`,
          {
            method: "PATCH",
            headers: { ...SB_H, Prefer: "return=minimal" },
            body: JSON.stringify({
              ask_per_night: perNight,
              ask_total: round0(perNight * nights),
              metadata: { ...meta, listAskPerNight: original, markdownPct: pct, markedDownAt: new Date().toISOString() },
              updated_at: new Date().toISOString(),
            }),
          },
        );
        if (pr.ok) marked++;
      } catch { /* skip this listing */ }
    }
  } catch { /* pass is best-effort */ }
  return { marked, scanned };
}

// ── Pass 4 (v334 · D4): expire started-but-unsold B2B listings ──────────────
// A B2B listing whose stay has started (date_from < today) can no longer sell.
// It flips `draft|listed → expired`. The underlying `inventory_block` STAYS
// `owned` (the seller keeps their pre-bought right — only the LISTING dies) and
// NO room_blocks hold is touched (Pass 2 owns block expiry + hold release).
//
// v624 — released WINDOW listings (v356, metadata.window=true) are the
// exception: their date_from is the window START, not a stay start — buyers
// pick their own nights anywhere inside [date_from, date_to], so the listing
// stays sellable until the WINDOW CLOSES. A window listing expires only when
// date_to < today (reason `window_ended_unsold`). This was the bug that
// silently expired the entire Model-2 inventory the night its Aug-1 window
// opened.
async function b2bExpiryPass(startedAt: number): Promise<{ expired: number }> {
  const today = isoDatePlus(0);
  let expired = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?status=in.(draft,listed)&date_from=lt.${today}` +
        `&select=id,date_to,metadata&order=date_from.asc&limit=${MAX_PER_PASS}`,
      { headers: SB_H },
    );
    const rows: any[] = r.ok ? await r.json().catch(() => []) : [];
    for (const b of rows) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      const meta = (b.metadata && typeof b.metadata === "object") ? b.metadata : {};
      const isWindow = meta.window === true;
      // A window listing is alive until its window closes.
      if (isWindow && String(b.date_to || "") >= today) continue;
      try {
        const pr = await fetch(
          `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(String(b.id))}&status=in.(draft,listed)`,
          {
            method: "PATCH",
            headers: { ...SB_H, Prefer: "return=minimal" },
            body: JSON.stringify({
              status: "expired",
              metadata: {
                ...meta,
                expiredAt: new Date().toISOString(),
                expiredReason: isWindow ? "window_ended_unsold" : "stay_started_unsold",
              },
              updated_at: new Date().toISOString(),
            }),
          },
        );
        if (pr.ok) expired++;
      } catch { /* skip this listing */ }
    }
  } catch { /* pass is best-effort */ }
  return { expired };
}

async function runAll(req: NextRequest) {
  const startedAt = Date.now();
  const md = await markdownPass(startedAt);
  const ex = await expiryPass(startedAt);
  const b2bMd = await b2bMarkdownPass(startedAt);
  const b2bEx = await b2bExpiryPass(startedAt);
  return {
    ok: true,
    markdown: md,
    expiry: ex,
    b2bMarkdown: b2bMd,
    b2bExpiry: b2bEx,
    ranMs: Date.now() - startedAt,
    budgetHit: Date.now() - startedAt > TIME_BUDGET_MS,
  };
}

export async function GET(req: NextRequest) {
  {
    const authFail = cronAuthGuard(req);
    if (authFail) return authFail;
  }try { return NextResponse.json(await runAll(req)); }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  {
    const authFail = cronAuthGuard(req);
    if (authFail) return authFail;
  }try { return NextResponse.json(await runAll(req)); }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }); }
}
