-- v353 — DEMO seed (NOT schema): a handful of live Model-2 B2B released listings
-- on real StayBid hotels across hill-station cities (same cities as the Model-1
-- circle_properties). source='hotel_owner', seller_user_id='demo_seller_circle'
-- (a non-real id so the marketplace never excludes them for a real viewer).
-- metadata.demo=true so they're easy to identify / remove later. Applied live.
INSERT INTO b2b_listings
 (id, block_id, seller_user_id, hotel_id, unit_id, room_id, date_from, date_to, nights,
  ask_per_night, ask_total, buy_total, platform_fee_pct, buyer_fee_pct, seller_fee_pct,
  status, metadata, source, created_at, updated_at)
VALUES
 ('b2bl_demo_deh02', NULL,'demo_seller_circle','deh02', NULL,'deh02-r1','2026-08-14','2026-08-16',2, 3360, 6720, 5600, 10,5,5,'listed','{"demo":true}'::jsonb,'hotel_owner',now(),now()),
 ('b2bl_demo_dha04', NULL,'demo_seller_circle','dha04', NULL,'dha04-r1','2026-09-05','2026-09-08',3, 3840,11520, 9600, 10,5,5,'listed','{"demo":true}'::jsonb,'hotel_owner',now(),now()),
 ('b2bl_demo_man03', NULL,'demo_seller_circle','man03', NULL,'man03-r1','2026-10-10','2026-10-12',2, 5760,11520, 9600, 10,5,5,'listed','{"demo":true}'::jsonb,'hotel_owner',now(),now()),
 ('b2bl_demo_mus01', NULL,'demo_seller_circle','mus01', NULL,'mus01-r1','2026-08-22','2026-08-24',2, 4200, 8400, 7000, 10,5,5,'listed','{"demo":true}'::jsonb,'hotel_owner',now(),now()),
 ('b2bl_demo_mus05', NULL,'demo_seller_circle','mus05', NULL,'mus05-r1','2026-09-18','2026-09-21',3, 3240, 9720, 8100, 10,5,5,'listed','{"demo":true}'::jsonb,'hotel_owner',now(),now()),
 ('b2bl_demo_ris02', NULL,'demo_seller_circle','ris02', NULL,'ris02-r1','2026-11-01','2026-11-03',2, 3360, 6720, 5600, 10,5,5,'listed','{"demo":true}'::jsonb,'hotel_owner',now(),now())
ON CONFLICT (id) DO NOTHING;
