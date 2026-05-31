import { NextResponse } from "next/server";
import { sbSelect, sbInsert, genId } from "@/lib/sb-server";
import { ratioBandFor } from "@/lib/pricing/outcomes";
import { upsertModelParams, type ModelParamRow, type ModelScope } from "@/lib/pricing/model-store";

// ════════════════════════════════════════════════════════════════
// v249.4 Phase 4 — AI Pricing: nightly online-learning trainer.
//
// THE LEARNING LOOP. Reads every Phase-1 `pricing_decisions` row joined
// to its `bids` outcome (accepted vs not), buckets by price-ratio band,
// and writes the empirical accept-rate per (room / hotel / city / global)
// into `pricing_model_params`. The accept-model then shrinks the Phase-2
// baseline curve toward these learned rates (when PRICING_MODEL_LEARNED=1).
//
// This is what turns the engine from "fixed rules" into "learns from its
// own outcomes" — the difference between a smart calculator and real AI.
//
// PURELY ADDITIVE + read-mostly: it only WRITES to pricing_model_params +
// pricing_model_runs (both new in Phase 1). A failure cannot break any
// user-facing flow — it just leaves the learned table stale and every
// surface keeps using the Phase-2 baseline curve.
//
// Schedule on cron-job.org (Vercel 2-cron Hobby cap is full):
//   GET /api/cron/pricing-model-train?token=<CRON_SECRET>   — weekly
//   (daily is also fine — the upsert is idempotent; a re-run overwrites
//    the same (scope, band) rows in place.)
// ════════════════════════════════════════════════════════════════
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISION_PAGE = 1000;     // pricing_decisions rows per PostgREST page
const MAX_DECISIONS = 20000;    // hard scan cap (ample for current volume)
const BID_CHUNK = 300;          // bid ids per in-list lookup
const ACCEPTED = new Set(["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);

const idList = (ids: string[]) =>
  ids.map((s) => `"${String(s).replace(/"/g, "")}"`).join(",");

export async function GET(req: Request) {
  const token =
    new URL(req.url).searchParams.get("token") ||
    req.headers.get("x-cron-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET || "staybid-cron-dev";
  const adminTok = req.headers.get("x-admin-token") || "";
  const ok = token === expected || adminTok.startsWith("adm_");
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const t0 = Date.now();
  const lookbackDays = Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 180);
  const runId = genId("pmr");
  const out: any = {
    lookbackDays,
    decisionsScanned: 0,
    bidsJoined: 0,
    paramsWritten: 0,
    scopes: { room: 0, hotel: 0, city: 0, global: 0 },
    errors: [] as string[],
  };

  try {
    const sinceISO = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

    // ── 1. Page through pricing_decisions (bid-linked only) ──────────
    type Dec = { bid_id: string; room_id: string; hotel_id: string;
                 spine_floor: any; static_floor: any; intent_amount: any; bid_amount: any };
    const decisions: Dec[] = [];
    for (let offset = 0; offset < MAX_DECISIONS; offset += DECISION_PAGE) {
      const page = await sbSelect(
        `pricing_decisions?bid_id=not.is.null&created_at=gte.${encodeURIComponent(sinceISO)}` +
        `&select=bid_id,room_id,hotel_id,spine_floor,static_floor,intent_amount,bid_amount` +
        `&order=created_at.desc&limit=${DECISION_PAGE}&offset=${offset}`,
      );
      if (!page.length) break;
      decisions.push(...(page as Dec[]));
      if (page.length < DECISION_PAGE) break;
    }
    out.decisionsScanned = decisions.length;
    if (decisions.length === 0) {
      out.elapsedMs = Date.now() - t0;
      void sbInsert("pricing_model_runs", {
        id: runId, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
        lookback_days: lookbackDays, decisions_scanned: 0, bids_joined: 0, params_written: 0,
        scopes: out.scopes, ok: true, error: null,
      }).catch(() => {});
      return NextResponse.json({ ...out, note: "no decisions" });
    }

    // ── 2. Side-load bid outcomes (in-memory join, no FK embeds) ─────
    const bidIds = Array.from(new Set(decisions.map((d) => d.bid_id).filter(Boolean))) as string[];
    const statusById: Record<string, string> = {};
    for (let i = 0; i < bidIds.length; i += BID_CHUNK) {
      const chunk = bidIds.slice(i, i + BID_CHUNK);
      const rows = await sbSelect(`bids?id=in.(${idList(chunk)})&select=id,status`);
      for (const b of rows) statusById[b.id] = String(b.status || "");
    }
    out.bidsJoined = Object.keys(statusById).length;

    // ── 3. Side-load hotel → city for the city scope ─────────────────
    const hotelIds = Array.from(new Set(decisions.map((d) => d.hotel_id).filter(Boolean))) as string[];
    const cityOf: Record<string, string> = {};
    for (let i = 0; i < hotelIds.length; i += BID_CHUNK) {
      const chunk = hotelIds.slice(i, i + BID_CHUNK);
      const rows = await sbSelect(`hotels?id=in.(${idList(chunk)})&select=id,city`);
      for (const h of rows) cityOf[h.id] = String(h.city || "").trim();
    }

    // ── 4. Aggregate per (scope, scopeId, band) → {n, accepts} ───────
    // key = `${scope}${scopeId}${band}`
    const agg = new Map<string, { scope: ModelScope; scopeId: string; band: string; n: number; accepts: number }>();
    const bump = (scope: ModelScope, scopeId: string, band: string, accepted: number) => {
      if (!scopeId) return;
      const key = `${scope}${scopeId}${band}`;
      const cur = agg.get(key) || { scope, scopeId, band, n: 0, accepts: 0 };
      cur.n += 1;
      cur.accepts += accepted;
      agg.set(key, cur);
    };

    for (const d of decisions) {
      const status = statusById[d.bid_id];
      if (!status) continue; // bid row missing → can't classify
      const floor = Number(d.spine_floor) || Number(d.static_floor) || 0;
      const intent = Number(d.intent_amount) || Number(d.bid_amount) || 0;
      if (!(floor > 0) || !(intent > 0)) continue;
      const band = ratioBandFor(intent / floor);
      const accepted = ACCEPTED.has(status) ? 1 : 0;
      bump("room", d.room_id, band, accepted);
      bump("hotel", d.hotel_id, band, accepted);
      const city = cityOf[d.hotel_id];
      if (city) bump("city", city, band, accepted);
      bump("global", "GLOBAL", band, accepted);
    }

    // ── 5. Flush to pricing_model_params (batched upsert) ────────────
    const rows: ModelParamRow[] = Array.from(agg.values()).map((a) => ({
      scope: a.scope, scopeId: a.scopeId, ratioBand: a.band, n: a.n, accepts: a.accepts,
    }));
    for (const r of rows) out.scopes[r.scope] += 1;

    const UPSERT_BATCH = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      written += await upsertModelParams(rows.slice(i, i + UPSERT_BATCH));
    }
    out.paramsWritten = written;

    void sbInsert("pricing_model_runs", {
      id: runId, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      lookback_days: lookbackDays, decisions_scanned: out.decisionsScanned,
      bids_joined: out.bidsJoined, params_written: written, scopes: out.scopes,
      ok: true, error: null,
    }).catch(() => {});
  } catch (e: any) {
    out.errors.push(e?.message || String(e));
    void sbInsert("pricing_model_runs", {
      id: runId, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      lookback_days: lookbackDays, decisions_scanned: out.decisionsScanned,
      bids_joined: out.bidsJoined, params_written: out.paramsWritten, scopes: out.scopes,
      ok: false, error: out.errors.join("; ").slice(0, 500),
    }).catch(() => {});
  }

  out.elapsedMs = Date.now() - t0;
  const status = out.errors.length && out.paramsWritten === 0 ? 500 : 200;
  return NextResponse.json(out, { status });
}
