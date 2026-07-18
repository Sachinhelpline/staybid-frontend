-- v355 — DEMO reseed (NOT schema): Model-2 B2B released listings priced by the
-- CORRECT rule — sell price = owner's OWN price/night × 2 (double). The own
-- price/night models the investor's acquisition cost (e.g. a room owned at
-- ₹30,000/month = ₹1,000/day → listed for B2B sale at ₹2,000/day). Each listing
-- carries FROZEN own_per_night + price_multiplier (tamper-safe) and rich tour
-- metadata (room + property images, amenities, capacity, description) copied
-- from the real StayBid hotel so the browse room/property tour has real content
-- and the listing stays purchasable via the existing hotel_owner checkout.
-- source='hotel_owner', seller_user_id='demo_seller_circle' (non-real id so the
-- marketplace never excludes them for a real viewer), metadata.demo=true.

-- Clear the previous demo seed (Spine-priced) so we don't double up.
DELETE FROM b2b_listings WHERE metadata->>'demo' = 'true';

WITH picks(room_id, own_per_night, date_from, date_to) AS (
  VALUES
    ('deh02-r1', 1000, DATE '2026-08-14', DATE '2026-08-16'),
    ('deh02-r2', 1400, DATE '2026-08-28', DATE '2026-08-31'),
    ('dha04-r1', 1000, DATE '2026-09-05', DATE '2026-09-08'),
    ('man03-r1', 1100, DATE '2026-12-20', DATE '2026-12-23'),
    ('man03-r2', 1500, DATE '2026-10-10', DATE '2026-10-12'),
    ('mus01-r1', 1000, DATE '2026-08-22', DATE '2026-08-24'),
    ('mus01-r2', 1600, DATE '2026-10-03', DATE '2026-10-05'),
    ('mus05-r2', 1200, DATE '2026-09-18', DATE '2026-09-21'),
    ('ris02-r1',  900, DATE '2026-11-01', DATE '2026-11-03')
)
INSERT INTO b2b_listings
  (id, block_id, seller_user_id, hotel_id, unit_id, room_id, date_from, date_to, nights,
   ask_per_night, ask_total, buy_total, own_per_night, price_multiplier,
   platform_fee_pct, buyer_fee_pct, seller_fee_pct, status, metadata, source, created_at, updated_at)
SELECT
  'b2bl_demo_' || p.room_id,
  NULL,
  'demo_seller_circle',
  h.id,
  NULL,
  r.id,
  p.date_from,
  p.date_to,
  (p.date_to - p.date_from)                               AS nights,
  (p.own_per_night * 2)                                   AS ask_per_night,   -- 2× own price
  (p.own_per_night * 2) * (p.date_to - p.date_from)       AS ask_total,
  p.own_per_night * (p.date_to - p.date_from)             AS buy_total,       -- owner's own cost
  p.own_per_night                                         AS own_per_night,   -- frozen basis
  2                                                       AS price_multiplier,-- frozen 2× (double)
  10, 5, 5, 'listed',
  jsonb_build_object(
    'demo', true,
    'title', h.name,
    'city', h.city,
    'room', r.name,
    'room_images', to_jsonb(COALESCE(r.images, ARRAY[]::text[])),
    'prop_images', to_jsonb(COALESCE(h.images, ARRAY[]::text[])),
    'amenities', to_jsonb(COALESCE(r.amenities, ARRAY[]::text[])),
    'capacity', r.capacity,
    'star', h."starRating",
    'description', COALESCE(h.description, ''),
    'monthly_rate', p.own_per_night * 30,
    'ownPerNight', p.own_per_night,
    'multiplier', 2
  ),
  'hotel_owner',
  now(), now()
FROM picks p
JOIN rooms r  ON r.id = p.room_id
JOIN hotels h ON h.id = r."hotelId"
ON CONFLICT (id) DO NOTHING;
