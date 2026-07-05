-- v297.3 — StayCircle property preferred-start-date feature (ask E)
--
-- Pre-known property availability date is shown UPFRONT (on the property card +
-- inside the /circle/build wizard) so the investor can factor it into the
-- decision. The customer's PREFERRED start date is captured at checkout and
-- server-validated/clamped against the property's available_from (payment day
-- is NOT necessarily rent-start day). Additive, applied live 2026-07-05.
ALTER TABLE public.circle_properties
  ADD COLUMN IF NOT EXISTS available_from DATE;

ALTER TABLE public.circle_bundles
  ADD COLUMN IF NOT EXISTS start_date DATE;
