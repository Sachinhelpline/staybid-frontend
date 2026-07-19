-- v372 demo — two CIRCLE-OWNER (host_circle) lots so the browse shows the new
-- owner-type pricing next to the property-owner lots. min_bid = floorPrice × 1.20
-- (cover purchase cost + 20% profit): Mussoorie 4200→5040, Manali 3800→4560.
INSERT INTO public.auction_lots
  (id, owner_user_id, hotel_id, room_id, category, city, month_key, month_start, month_end,
   num_rooms, min_bid_per_room_night, window_open_at, window_close_at, status, metadata)
VALUES
  ('lot_demo_hcomusr1', 'demo_circle_owner', 'hco-seed-mus', 'hco-seed-mus-r1', 'Ridge Deluxe', 'Mussoorie',
   '2026-08', '2026-08-01', '2026-09-01', 3, 5040,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"owner_kind":"circle_owner","hotel_name":"StayBid Circle · Mussoorie Ridge Retreat","room_name":"Ridge Deluxe","room_img":"https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=1200&auto=format"}'::jsonb),
  ('lot_demo_hcomanr1', 'demo_circle_owner', 'hco-seed-man', 'hco-seed-man-r1', 'Riverside Deluxe', 'Manali',
   '2026-08', '2026-08-01', '2026-09-01', 3, 4560,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"owner_kind":"circle_owner","hotel_name":"StayBid Circle · Manali Riverside Lodge","room_name":"Riverside Deluxe","room_img":"https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&auto=format"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
