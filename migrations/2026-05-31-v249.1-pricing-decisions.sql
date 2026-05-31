-- ════════════════════════════════════════════════════════════════
-- v249.1 Phase 1 — AI Pricing: decision + outcome data foundation.
--
-- THE LEARNING SUBSTRATE. Today's pricing is a rule engine (deterministic
-- demand × occupancy × competitor-undercut). To grow into a real learning
-- engine, a model needs the ONE thing the rule engine never recorded: every
-- price decision the platform made, AND whether it worked (accepted / paid).
--
-- Design — bulletproof + zero-downstream-touch:
--   • `pricing_decisions` snapshots the EPHEMERAL decision context at bid
--     time — the spine floor/live/flash/vacancy/competitor values AS THEY
--     WERE when the bid was placed. These are UNRECONSTRUCTABLE later (the
--     /api/cron/price-spine cron recomputes room_date_price daily, so the
--     vacancy + competitor that drove THIS decision are gone tomorrow).
--   • The OUTCOME (accepted? paid? revenue?) is NOT duplicated here. It lives
--     on `bids` (status, expiresAt) + `bid_paid_amounts` — the single source
--     of truth. Phase 2 training JOINs pricing_decisions → bids on bid_id.
--     This is why Phase 1 needs ZERO wiring into any accept / pay / expire /
--     cron status-change path: the outcome can never drift because it's read
--     live from the authoritative row, never copied.
--   • Write path is a single fire-and-forget call (lib/pricing/decision-log)
--     AFTER the bid insert in /api/bids/place. It NEVER throws — a logging
--     failure can never block, slow, or break a real bid.
--
-- Additive-only. No existing table/column/trigger touched. RLS + permissive
-- policy match the project-wide anon pattern (2026-05-13-rls-everywhere).
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pricing_decisions (
  id              TEXT PRIMARY KEY,
  bid_id          TEXT,                       -- → bids.id (the JOIN key for outcome). NULL only if a future caller logs a non-bid price impression.
  request_id      TEXT,                       -- → bid_requests.id
  hotel_id        TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  customer_id     TEXT,
  flow            TEXT,                       -- place / negotiate / direct / flash
  check_in        DATE,                       -- the stay date the price was for
  num_rooms       INTEGER NOT NULL DEFAULT 1,

  -- ── customer price signal ───────────────────────────────────────
  bid_amount      NUMERIC,                    -- submitted amount (per-room-per-night)
  intent_amount   NUMERIC,                    -- real desired price (below-floor preferred; = bid_amount otherwise)

  -- ── spine snapshot AT decision time (the unreconstructable bit) ──
  static_floor    NUMERIC,                    -- rooms.floorPrice fallback
  spine_floor     NUMERIC,                    -- resolved bid_floor used for the accept/counter threshold
  spine_live      NUMERIC,                    -- live customer-facing price
  spine_flash     NUMERIC,                    -- flash price
  spine_base      NUMERIC,                    -- base/reference rate
  competitor_min  NUMERIC,                    -- cheapest scraped OTA price, if known
  vacancy_ratio   NUMERIC,                    -- 0 = sold out … 1 = empty
  demand_score    NUMERIC,                    -- 0..100
  spine_source    TEXT,                       -- cache / computed / fallback / none

  -- ── autopilot decision context (what the engine DECIDED) ─────────
  bidder_tier     TEXT,                       -- PREMIUM / STRONG / SMART / CAUTIOUS / LOWBALL / NEW
  autopilot_mode  TEXT,                       -- auto / hybrid / manual
  counter_band    NUMERIC,                    -- v249 Layer 2 vacancy-tuned band used
  decided_action  TEXT,                       -- accept / counter / manual
  decided_status  TEXT,                       -- PENDING / ACCEPTED / COUNTER (status the bid got at insert)
  counter_amount  NUMERIC,                    -- the counter price, when decided_action = counter

  factors         JSONB,                      -- spine "why" list (demand factors)
  meta            JSONB,                      -- extensible bag for future signals
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: one decision row per bid. A re-run of the place route inserts
-- a NEW bid (new id) so this rarely collides, but the unique index + the
-- logger's `Prefer: resolution=ignore-duplicates` make a double-log a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_decisions_bid
  ON public.pricing_decisions (bid_id) WHERE bid_id IS NOT NULL;

-- Training + analytics read paths.
CREATE INDEX IF NOT EXISTS idx_pricing_decisions_hotel_created
  ON public.pricing_decisions (hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_decisions_room_created
  ON public.pricing_decisions (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_decisions_created
  ON public.pricing_decisions (created_at DESC);

-- RLS — permissive anon, matching the project-wide pattern.
ALTER TABLE public.pricing_decisions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pricing_decisions'
      AND policyname = 'pricing_decisions_all_anon'
  ) THEN
    CREATE POLICY pricing_decisions_all_anon ON public.pricing_decisions
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
