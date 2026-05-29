-- v241.28 — Backfill the last legacy <30 hold-config value (verify-session close-out).
--
-- The hotel_hold_config `_global_defaults` row still held
-- acceptance_window_min = 15 (the pre-v241.23 platform default). It was the
-- ONLY row below the 30-min floor (no per-hotel overrides exist).
--
-- It was already functionally floored to 30 by BOTH:
--   • trg_stamp_accepted_expiry  → GREATEST(30, ...)   (DB write layer)
--   • the /api/hotel-hold-config resolver → Math.max(30, raw)  (read layer)
-- so this is NOT a behavior change — accepts were already getting a 30-min
-- window. This aligns the STORED value with the enforced floor so nothing
-- depends on the trigger/resolver clamp alone (defense-in-depth: if the floor
-- were ever removed, the value would no longer silently revert to 15).
--
-- Closes the v241.27 carry-forward item "Backfill legacy 15 rows → 30".
-- Applied live via Supabase apply_migration `v241_28_backfill_global_acceptance_window_30`.

UPDATE public.hotel_hold_config
SET acceptance_window_min = 30
WHERE hotel_id = '_global_defaults' AND acceptance_window_min < 30;
