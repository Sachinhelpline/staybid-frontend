-- v374 — StayBid Circle "Model 3" LIVE mode (Phase 1: foundation).
-- Additive, forward-only. NO FK constraints. TEXT ids. No money path here
-- (that lands in the agent-bid + pay phases). This layer only adds the COLUMNS
-- and CONFIG that the always-open live-bidding mode needs; existing SEALED
-- monthly-auction lots/bids are untouched (they keep working exactly as before).
--
-- WHAT LIVE MODE IS (vs the existing sealed monthly auction)
--   • Always-open: no month-end window, no clearing engine. An owner publishes a
--     lot in `sale_mode='live'` and it stays biddable from publish until the
--     inventory period ends (window_close_at = the lot's month_end).
--   • No EMD: an agent bids like a StayBid customer (but for BULK rooms) with NO
--     refundable deposit. The bid carries no money at submit time.
--   • Autopilot-governed: the owner picks an autopilot mode per lot
--     (auto | hybrid | manual), mirroring the customer reverse-auction:
--       - auto   → any at/above-floor bid auto-accepts instantly.
--       - hybrid → a bid ≥ floor × live_hybrid_accept_ratio auto-accepts;
--                  an at-floor bid waits for the owner (accept / counter / reject).
--       - manual → every bid waits for the owner.
--   • Pay-on-accept: an accepted bid gives the agent a PAY WINDOW
--     (live_pay_window_hours) to pay from their dashboard; on pay the inventory
--     is allotted (reusing the enable-selling operator-scope path) → Option A
--     (sell on StayBid + OTA) / Option B (own channel), same as today.
--
-- The SEALED path (window_open_day, deposit_pct, clearing engine) is unchanged;
-- `sale_mode` distinguishes the two so both run side by side.

-- ---------------------------------------------------------------------------
-- auction_lots — add sale mode + per-lot autopilot mode
-- ---------------------------------------------------------------------------
-- Default 'sealed' so every EXISTING row keeps its current behaviour; the owner
-- publish route sets 'live' explicitly for new always-open lots.
ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS sale_mode      TEXT NOT NULL DEFAULT 'sealed';
  -- 'sealed' = monthly sealed-bid auction (window + EMD + clearing)
  -- 'live'   = always-open live bulk bidding (autopilot, no EMD, pay-on-accept)
ALTER TABLE public.auction_lots
  ADD COLUMN IF NOT EXISTS autopilot_mode TEXT NOT NULL DEFAULT 'hybrid';
  -- only meaningful for sale_mode='live': auto | hybrid | manual

CREATE INDEX IF NOT EXISTS idx_auction_lots_sale_mode ON public.auction_lots (sale_mode, status);

-- ---------------------------------------------------------------------------
-- auction_bids — add live-mode lifecycle columns
--   For a LIVE bid the lifecycle is:
--     active  → (autopilot/owner) accepted → (agent pays) won
--                                          ↘ rejected / countered / expired
--   accepted_at + pay_deadline_at drive the pay-window countdown + cron expiry.
--   `decided_by` records who accepted (autopilot | owner) for the audit trail.
--   (status stays TEXT with no CHECK, so the new enum values need no migration.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.auction_bids
  ADD COLUMN IF NOT EXISTS accepted_at     TIMESTAMPTZ;
ALTER TABLE public.auction_bids
  ADD COLUMN IF NOT EXISTS pay_deadline_at TIMESTAMPTZ;
ALTER TABLE public.auction_bids
  ADD COLUMN IF NOT EXISTS decided_by      TEXT;   -- 'autopilot' | 'owner'
ALTER TABLE public.auction_bids
  ADD COLUMN IF NOT EXISTS counter_per_room_per_night NUMERIC;  -- owner's counter (live hybrid/manual)

-- Cron expiry sweep: find accepted-unpaid live bids past their pay deadline.
CREATE INDEX IF NOT EXISTS idx_auction_bids_pay_deadline ON public.auction_bids (status, pay_deadline_at);

-- ---------------------------------------------------------------------------
-- auction_config — live-mode knobs (all admin-tunable, frozen at bid/accept)
-- ---------------------------------------------------------------------------
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS live_pay_window_hours     INT     NOT NULL DEFAULT 24;
  -- agent's pay window after an accept (live mode). Sealed keeps pay_window_hours.
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS live_default_autopilot    TEXT    NOT NULL DEFAULT 'hybrid';
  -- default autopilot mode pre-selected in the owner publish form.
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS live_hybrid_accept_ratio  NUMERIC NOT NULL DEFAULT 1.10;
  -- hybrid mode auto-accepts a bid ≥ floor × this ratio; at-floor waits for owner.

COMMENT ON COLUMN public.auction_lots.sale_mode IS 'sealed = monthly sealed-bid auction (window+EMD+clearing); live = always-open live bulk bidding (autopilot, no EMD, pay-on-accept).';
COMMENT ON COLUMN public.auction_lots.autopilot_mode IS 'Live mode only: auto|hybrid|manual — governs how agent bids are accepted (mirrors the customer reverse-auction autopilot).';
COMMENT ON COLUMN public.auction_bids.pay_deadline_at IS 'Live mode: an accepted bid must be paid before this or the cron expires it and releases the hold.';
