-- v624 — Restore the Model-2 released-WINDOW B2B listings that the
-- inventory-lifecycle cron wrongly expired the night their window OPENED.
--
-- Root cause: Pass 4 (v334 `b2bExpiryPass`) expires any draft|listed listing
-- with date_from < today ("stay started, can't sell"). That rule predates the
-- v356 released-WINDOW model (metadata.window=true, Aug 1 – Dec 1), where
-- date_from is the window START — buyers pick their own nights inside the
-- window, so a window listing is sellable until date_to. On 2026-08-02T00:00Z
-- the cron flipped ALL 32 window listings listed → expired
-- (expiredReason='stay_started_unsold'), which emptied /circle/model2/browse
-- and dropped the Model-2 chip from the home Stage (it renders only when
-- liveListings > 0). Pass 3 (b2bMarkdownPass) had also marked their ask down
-- 40% off the frozen baseline as the window start approached — same
-- date_from-as-check-in misread.
--
-- The paired code fix (same release, v624) makes Pass 4 expire a window
-- listing only when date_to < today (reason 'window_ended_unsold') and makes
-- Pass 3 skip window listings entirely. This migration restores the data:
--   status  → listed
--   ask     → the frozen tamper-safe baseline metadata.listAskPerNight
--             (= own_per_night × price_multiplier, the v355 regulated rule)
--   metadata: markdown + expiry stamps removed, restore audit stamp added.
--
-- Guarded: only expired WINDOW rows expired by this exact bug
-- (expiredReason='stay_started_unsold') whose window is still open
-- (date_to >= CURRENT_DATE). Nothing else is touched. Forward-only, no DDL.

UPDATE b2b_listings
SET
  status         = 'listed',
  ask_per_night  = COALESCE((metadata->>'listAskPerNight')::numeric, ask_per_night),
  ask_total      = COALESCE((metadata->>'listAskPerNight')::numeric, ask_per_night)
                   * GREATEST(COALESCE(nights, 1), 1),
  metadata       = (metadata - 'expiredAt' - 'expiredReason' - 'markdownPct' - 'markedDownAt')
                   || jsonb_build_object(
                        'restoredAt', now(),
                        'restoredReason', 'v624_window_expiry_bug'
                      ),
  updated_at     = now()
WHERE status = 'expired'
  AND metadata->>'window' = 'true'
  AND metadata->>'expiredReason' = 'stay_started_unsold'
  AND date_to >= CURRENT_DATE;
