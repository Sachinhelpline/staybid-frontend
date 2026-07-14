-- v341 — Circle Marketplace Phase M2: Model-3 supply admin — pre-buy inventory window.
--
-- Additive, forward-only. Adds an OPTIONAL date window during which a
-- host-circle hotel accepts pre-buy (Model-3) bookings. NULL on either side =
-- unbounded on that side (a hotel with both NULL = "always open" — the exact
-- v339/v340 behaviour, so ZERO regression for every existing prebuy_enabled hotel).
--
-- The window is DECOUPLED from prebuy_enabled + approval_status:
--   * prebuy_enabled=false  → hotel not in the Model-3 marketplace at all (v339).
--   * prebuy_enabled=true   → browsable supply; the window then bounds which
--                             check-in dates the M1 quote/checkout will price.
--   * approval_status       → the SINGLE customer-feed gate, untouched (v336).
--
-- The window bounds the CHECK-IN date (date_from) of a pre-buy block. A check-in
-- before prebuy_window_start OR on/after prebuy_window_end is rejected by the M1
-- quote (422/400) and checkout (409) routes. NULL = no bound on that edge.

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS prebuy_window_start DATE,
  ADD COLUMN IF NOT EXISTS prebuy_window_end DATE;

COMMENT ON COLUMN public.hotels.prebuy_window_start IS
  'Circle M2: earliest check-in date a pre-buy block may target (NULL = no lower bound).';
COMMENT ON COLUMN public.hotels.prebuy_window_end IS
  'Circle M2: exclusive upper bound — check-in must be < this date (NULL = no upper bound).';
