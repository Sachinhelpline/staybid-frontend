-- v360 — DEMO reseed onto CIRCLE-OPERATED (host_circle) hotels so the full
-- sell-to-public loop works. On host_circle hotels the guest hotel page renders
-- individual UNIT listings (account_type != 'hotel_owner'), so after a buyer
-- purchases a unit + releases the hold, a guest can book THAT specific unit and
-- the bid carries assignedUnitId → owner_user_id (the buyer). Classic hotels
-- can't do that. Replaces the classic-hotel demo listings.
--
-- Price rule unchanged: ask = own/night × 2. Here own/night = the room's Spine
-- floor ÷ 2, so the B2B buy price = the wholesale floor (below the room's real
-- market ADR/MRP → clear resale upside). Released window Aug 1 – Dec 1
-- (metadata.window=true → calendar all-available; physical safety at payment).

DELETE FROM b2b_listings WHERE metadata->>'demo' = 'true';

INSERT INTO b2b_listings
  (id, block_id, seller_user_id, hotel_id, unit_id, room_id, date_from, date_to, nights,
   ask_per_night, ask_total, buy_total, own_per_night, price_multiplier,
   platform_fee_pct, buyer_fee_pct, seller_fee_pct, status, metadata, source, created_at, updated_at)
SELECT
  'b2bl_demo_' || r.id,
  NULL, 'demo_seller_circle', h.id, NULL, r.id,
  DATE '2026-08-01', DATE '2026-12-01', (DATE '2026-12-01' - DATE '2026-08-01'),
  ROUND(r."floorPrice")                                             AS ask_per_night,   -- = own × 2
  ROUND(r."floorPrice") * (DATE '2026-12-01' - DATE '2026-08-01')   AS ask_total,
  ROUND(r."floorPrice" / 2.0) * (DATE '2026-12-01' - DATE '2026-08-01') AS buy_total,
  ROUND(r."floorPrice" / 2.0)                                       AS own_per_night,   -- own = floor ÷ 2
  2,
  10, 5, 5, 'listed',
  jsonb_build_object(
    'demo', true, 'title', h.name, 'city', h.city, 'room', r.name,
    'room_images', to_jsonb(COALESCE(r.images, ARRAY[]::text[])),
    'prop_images', to_jsonb(COALESCE(h.images, ARRAY[]::text[])),
    'amenities', to_jsonb(COALESCE(r.amenities, ARRAY[]::text[])),
    'capacity', COALESCE(r.capacity, 2), 'star', h."starRating",
    'description', COALESCE(h.description, ''),
    'monthly_rate', ROUND(r."floorPrice" / 2.0) * 30, 'ownPerNight', ROUND(r."floorPrice" / 2.0), 'multiplier', 2,
    'window', true, 'releasedFrom', '2026-08-01', 'releasedTo', '2026-12-01'
  ),
  'hotel_owner', now(), now()
FROM hotels h JOIN rooms r ON r."hotelId" = h.id
WHERE h.owner_type = 'host_circle'
ON CONFLICT (id) DO NOTHING;

-- Take the demo Circle-operated hotels LIVE so guests can browse + book them
-- (the SINGLE customer-feed gate). Guarded to host_circle — never touches a real
-- hotel's ownerId/owner_type/account_type.
UPDATE hotels
   SET approval_status = 'approved'
 WHERE owner_type = 'host_circle' AND approval_status <> 'approved';
