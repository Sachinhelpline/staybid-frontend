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
// Auth mirrors /api/cron/expire-holds (?token= / Bearer CRON_SECRET / adm_ token).
// Register on cron-job.org: */15 * * * * →
//   https://www.staybids.in/api/cron/inventory-lifecycle?token=staybid-cron-dev
//
// Bounded + budget-guarded (cron-job.org ~30s client timeout — v241.27 lesson).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { markdownResalePerNight, daysUntil } from "@/lib/inventory/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const MARKDOWN_HORIZON_DAYS = 14; // only blocks ≤ 14 days out can be marked down
const MAX_PER_PASS = 200;
const TIME_BUDGET_MS = 24_000;    // return well inside cron-job.org's window

async function authorized(req: NextRequest): Promise<boolean> {
  const qToken = new URL(req.url).searchParams.get("token");
  if (qToken && qToken === (process.env.CRON_TOKEN || "staybid-cron-dev")) return true;
  const cronAuth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && cronAuth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const adminTok = req.headers.get("x-admin-token");
  if (adminTok && adminTok.startsWith("adm_")) return true;
  return false;
}

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

async function runAll(req: NextRequest) {
  const startedAt = Date.now();
  const md = await markdownPass(startedAt);
  const ex = await expiryPass(startedAt);
  return {
    ok: true,
    markdown: md,
    expiry: ex,
    ranMs: Date.now() - startedAt,
    budgetHit: Date.now() - startedAt > TIME_BUDGET_MS,
  };
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runAll(req)); }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runAll(req)); }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }); }
}
