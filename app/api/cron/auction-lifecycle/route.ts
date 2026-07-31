// v361 — Model 3 auction LIFECYCLE cron. Two idempotent passes:
//   A) OPEN  — draft lots whose window has opened (open ≤ now < close) → 'open'.
//   B) CLEAR — open lots whose window has CLOSED (close ≤ now) → run the
//              clash-free clearing engine (award winners, mark losers, flip lot).
// Auth mirrors the other crons (?token= / Bearer CRON_SECRET).
// Register on cron-job.org: */15 * * * * → /api/cron/auction-lifecycle?token=…
import { NextRequest, NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { SB_URL, SB_KEY, SB_READ } from "@/lib/sb";
import { clearLotDb } from "@/lib/trade/clear-run";
import { resolveAuctionConfig } from "@/lib/trade/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SB_W = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const MAX_CLEAR = 100;
const TIME_BUDGET_MS = 24_000;


export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  {
    const authFail = cronAuthGuard(req);
    if (authFail) return authFail;
  }const started = Date.now();
  const nowIso = new Date().toISOString();

  // Pass A — open scheduled lots whose window has begun.
  let opened = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/auction_lots?status=eq.draft&window_open_at=lte.${encodeURIComponent(nowIso)}&window_close_at=gt.${encodeURIComponent(nowIso)}`,
      { method: "PATCH", headers: { ...SB_W, Prefer: "return=representation" }, body: JSON.stringify({ status: "open", updated_at: nowIso }) },
    );
    if (r.ok) { const rows = await r.json().catch(() => []); opened = Array.isArray(rows) ? rows.length : 0; }
  } catch { /* non-fatal */ }

  // Pass B — clear open lots whose window has closed.
  let cleared = 0, awards = 0, losers = 0;
  try {
    // SEALED lots only — a LIVE lot has no clearing (its bids resolve live via
    // autopilot + pay-on-accept); it just stops accepting bids at window_close_at.
    const lr = await fetch(
      `${SB_URL}/rest/v1/auction_lots?status=eq.open&sale_mode=neq.live&window_close_at=lte.${encodeURIComponent(nowIso)}&select=*&order=window_close_at.asc&limit=${MAX_CLEAR}`,
      { headers: SB_READ, cache: "no-store" },
    );
    const lots: any[] = lr.ok ? await lr.json().catch(() => []) : [];
    for (const lot of lots) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const res = await clearLotDb(lot);
      cleared++; awards += res.awards; losers += res.losers;
    }
  } catch { /* non-fatal */ }

  // Pass C — LIVE mode expiry. An accepted-but-unpaid live bid past its pay
  // deadline is expired (no units were held — enable-selling assigns at pay —
  // so there's nothing to release, just mark it). The matching live award is
  // expired too (scoped to sale_mode='live' so sealed awards are untouched).
  let liveBidsExpired = 0, liveAwardsExpired = 0;
  try {
    const br = await fetch(
      `${SB_URL}/rest/v1/auction_bids?status=eq.accepted&pay_deadline_at=lte.${encodeURIComponent(nowIso)}`,
      { method: "PATCH", headers: { ...SB_W, Prefer: "return=representation" }, body: JSON.stringify({ status: "expired", updated_at: nowIso }) },
    );
    if (br.ok) { const rows = await br.json().catch(() => []); liveBidsExpired = Array.isArray(rows) ? rows.length : 0; }
  } catch { /* non-fatal */ }
  try {
    const ar = await fetch(
      `${SB_URL}/rest/v1/auction_awards?status=eq.awarded&metadata->>sale_mode=eq.live&pay_window_close_at=lte.${encodeURIComponent(nowIso)}`,
      { method: "PATCH", headers: { ...SB_W, Prefer: "return=representation" }, body: JSON.stringify({ status: "expired", updated_at: nowIso }) },
    );
    if (ar.ok) { const rows = await ar.json().catch(() => []); liveAwardsExpired = Array.isArray(rows) ? rows.length : 0; }
  } catch { /* non-fatal */ }

  // Pass D — auto-withdraw STALE pending live bids so an agent is never blocked
  // by an old bid. A pending (active/countered) live bid older than the offer TTL
  // (config, default 48h) is expired — the owner didn't act in time. Nothing to
  // release (no holds pre-pay). The agent can then bid again.
  let stalePendingExpired = 0;
  try {
    const cfg = await resolveAuctionConfig();
    const ttlMs = (cfg.liveOfferTtlHours > 0 ? cfg.liveOfferTtlHours : 48) * 3_600_000;
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const pr = await fetch(
      `${SB_URL}/rest/v1/auction_bids?status=in.(active,countered)&metadata->>sale_mode=eq.live&created_at=lte.${encodeURIComponent(cutoff)}`,
      { method: "PATCH", headers: { ...SB_W, Prefer: "return=representation" }, body: JSON.stringify({ status: "expired", updated_at: nowIso }) },
    );
    if (pr.ok) { const rows = await pr.json().catch(() => []); stalePendingExpired = Array.isArray(rows) ? rows.length : 0; }
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, opened, cleared, awards, losers, liveBidsExpired, liveAwardsExpired, stalePendingExpired, ms: Date.now() - started });
}
