-- v356 — DEMO reseed (NOT schema): turn each Model-2 B2B demo listing into a
-- RELEASED AVAILABILITY WINDOW instead of a fixed 2–3 night range, so a buyer
-- can open the room's live calendar and pick their OWN nights within the window
-- (deck ss2: "access a city's live calendar → buy selected dates"). The frozen
-- own_per_night + price_multiplier stay the source of truth; ask_per_night/
-- ask_total are nominal window figures (the buyer's charge is computed from the
-- nights they pick, own_per_night × multiplier). No schema change.
UPDATE b2b_listings
   SET date_from = DATE '2026-08-01',
       date_to   = DATE '2026-12-01',
       nights    = (DATE '2026-12-01' - DATE '2026-08-01'),
       ask_total = ask_per_night * (DATE '2026-12-01' - DATE '2026-08-01'),
       metadata  = metadata || jsonb_build_object(
         'releasedFrom', '2026-08-01',
         'releasedTo',   '2026-12-01',
         'window', true
       ),
       updated_at = now()
 WHERE metadata->>'demo' = 'true';
