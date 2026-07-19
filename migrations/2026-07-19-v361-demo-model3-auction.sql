-- v361 demo seed — Model 3 auction: a starter set of OPEN monthly lots on real
-- approved hotels (Dehradun / Dhanaulti / Manali) for the upcoming month
-- (Aug 2026) + one approved demo travel agent so the bid side is testable from
-- day one. All rows carry metadata.demo=true for easy cleanup. min_bid = the
-- room's Spine floor (owner never sells below cost). Idempotent (ON CONFLICT).
-- Window is OPEN now (today is 2026-07-19) through 2026-07-31.

-- Demo approved travel agent
INSERT INTO public.trade_agents (id, user_id, email, name, agency_name, city, category, status, metadata)
VALUES ('ta_demo_travels', 'demo_agent_trade', 'demo.agent@staybid.in', 'Demo Agent',
        'Demo Travels', 'Dehradun', 'standard', 'approved', '{"demo": true}'::jsonb)
ON CONFLICT (user_id) DO NOTHING;

-- Demo OPEN lots for Aug 2026
INSERT INTO public.auction_lots
  (id, owner_user_id, hotel_id, room_id, category, city, month_key, month_start, month_end,
   num_rooms, min_bid_per_room_night, window_open_at, window_close_at, status, metadata)
VALUES
  ('lot_demo_deh01r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'deh01', 'deh01-r1', 'Valley Deluxe', 'Dehradun',
   '2026-08', '2026-08-01', '2026-09-01', 4, 4200,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Executive Inn Dehradun","room_name":"Valley Deluxe","room_img":"https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=1200&auto=format"}'::jsonb),
  ('lot_demo_deh02r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'deh02', 'deh02-r1', 'Cave View Room', 'Dehradun',
   '2026-08', '2026-08-01', '2026-09-01', 5, 2800,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Robbers Cave View Dehradun","room_name":"Cave View Room","room_img":"https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&auto=format"}'::jsonb),
  ('lot_demo_deh03r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'deh03', 'deh03-r1', 'Colonial Heritage Room', 'Dehradun',
   '2026-08', '2026-08-01', '2026-09-01', 3, 3500,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Colonial Heritage Dehradun","room_name":"Colonial Heritage Room","room_img":"https://images.unsplash.com/photo-1606744824163-985d376605aa?w=1200&auto=format"}'::jsonb),
  ('lot_demo_dha01r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'dha01', 'dha01-r1', 'Pine Lodge Room', 'Dhanaulti',
   '2026-08', '2026-08-01', '2026-09-01', 4, 2900,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Pine Lodge Dhanaulti","room_name":"Pine Lodge Room","room_img":"https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=1200&auto=format"}'::jsonb),
  ('lot_demo_dha02r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'dha02', 'dha02-r1', 'Eco Cabin', 'Dhanaulti',
   '2026-08', '2026-08-01', '2026-09-01', 5, 2600,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Eco Cabin Retreat Dhanaulti","room_name":"Eco Cabin","room_img":"https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=1200&auto=format"}'::jsonb),
  ('lot_demo_dha04r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'dha04', 'dha04-r1', 'Apple Orchard Chalet', 'Dhanaulti',
   '2026-08', '2026-08-01', '2026-09-01', 3, 3200,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Apple Orchard Resort Dhanaulti","room_name":"Apple Orchard Chalet","room_img":"https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=1200&auto=format"}'::jsonb),
  ('lot_demo_man04r1', 'cmnr4b8ol0001whjy8jc1xxxh', 'man04', 'man04-r1', 'Beas View Room', 'Manali',
   '2026-08', '2026-08-01', '2026-09-01', 4, 3500,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Beas View Manali","room_name":"Beas View Room","room_img":"https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=1200&auto=format"}'::jsonb),
  ('lot_demo_man04r2', 'cmnr4b8ol0001whjy8jc1xxxh', 'man04', 'man04-r2', 'Valley Suite', 'Manali',
   '2026-08', '2026-08-01', '2026-09-01', 2, 5800,
   '2026-07-19T00:00:00Z', '2026-07-31T23:59:59Z', 'open',
   '{"demo":true,"hotel_name":"Beas View Manali","room_name":"Valley Suite","room_img":"https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=1200&auto=format"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
