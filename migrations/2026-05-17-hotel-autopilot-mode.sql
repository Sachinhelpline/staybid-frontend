-- ─────────────────────────────────────────────────────────────────────────
-- v130 — Hybrid AI Autopilot (Option 2)
--
-- Adds `autopilot_mode` to `hotels` so each partner can pick how aggressively
-- the AI accepts bids on their behalf:
--   • 'auto'   (default) — every tier-eligible bid auto-accepts on schedule
--   • 'hybrid'           — only PREMIUM + STRONG auto-accept; lower tiers
--                          wait for the hotel
--   • 'manual'           — AI never auto-accepts; every bid is manual review
--
-- Why this column (not RPC change): hotels can change their mode any time
-- and the change applies to FUTURE bids placed after that moment. Existing
-- bids in PENDING with auto_accept_at already set keep their original
-- schedule (no retroactive reschedule). This avoids a cron RPC rewrite +
-- preserves the v70-era infrastructure verbatim.
--
-- Idempotent — safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS autopilot_mode TEXT NOT NULL DEFAULT 'auto';

-- Constraint added separately so the `IF NOT EXISTS` add doesn't trip when
-- the column already exists with an older constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hotels_autopilot_mode_check'
  ) THEN
    ALTER TABLE public.hotels
      ADD CONSTRAINT hotels_autopilot_mode_check
      CHECK (autopilot_mode IN ('auto', 'hybrid', 'manual'));
  END IF;
END $$;

-- Audit timestamp so the partner panel can show "last changed N min ago".
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS autopilot_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Index nothing — autopilot_mode is read on the per-bid hot path keyed by
-- hotel_id which is already the table's primary key. No new index needed.

COMMENT ON COLUMN public.hotels.autopilot_mode IS
  'v130 — Hybrid AI Autopilot mode. auto=all tiers, hybrid=premium+strong only, manual=none.';
COMMENT ON COLUMN public.hotels.autopilot_updated_at IS
  'v130 — last time the partner changed their Autopilot mode.';
