-- v374 — demo LIVE lots so the browse + tour show the always-open experience
-- (⚡ Live card badge + no-EMD LiveBidBox) alongside the existing SEALED August
-- demos. Different month (2026-09) than the sealed demos so the one-live-lot-per
-- (hotel,room,month) unique index never conflicts. Real hotels/rooms (images).
-- Idempotent: ON CONFLICT (id) DO NOTHING.
INSERT INTO public.auction_lots
  (id, owner_user_id, hotel_id, room_id, category, city, month_key, month_start, month_end,
   num_rooms, min_bid_per_room_night, purchase_price_per_night, sale_mode, autopilot_mode,
   window_open_at, window_close_at, status, metadata)
VALUES
  -- Dehradun · Cave View · auto (any at/above-floor bid confirms instantly)
  ('lot_live_deh02r1','demo_owner_live','deh02','deh02-r1','Cave View Room','Dehradun','2026-09',
   '2026-09-01','2026-10-01',5,2800,NULL,'live','auto',
   now(),'2026-10-01T00:00:00Z','open',
   '{"owner_kind":"property_owner","sale_mode":"live","autopilot_mode":"auto","demo":true}'::jsonb),
  -- Dhanaulti · Apple Orchard Chalet · hybrid (strong bids auto, at-floor waits)
  ('lot_live_dha04r1','demo_owner_live','dha04','dha04-r1','Apple Orchard Chalet','Dhanaulti','2026-09',
   '2026-09-01','2026-10-01',3,3200,NULL,'live','hybrid',
   now(),'2026-10-01T00:00:00Z','open',
   '{"owner_kind":"property_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),
  -- Manali · Beas View · hybrid
  ('lot_live_man04r1','demo_owner_live','man04','man04-r1','Beas View Room','Manali','2026-09',
   '2026-09-01','2026-10-01',4,3500,NULL,'live','hybrid',
   now(),'2026-10-01T00:00:00Z','open',
   '{"owner_kind":"property_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),
  -- Mussoorie · Ridge Deluxe (Circle-operated) · manual — floor = purchase 1000 × 1.20
  ('lot_live_hcomusr1','demo_owner_live','hco-seed-mus','hco-seed-mus-r1','Ridge Deluxe','Mussoorie','2026-09',
   '2026-09-01','2026-10-01',3,1200,1000,'live','manual',
   now(),'2026-10-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"manual","demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;
