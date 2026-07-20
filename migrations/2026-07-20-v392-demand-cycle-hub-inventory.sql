-- v392 — 12-Month Travel Demand Cycle: year-round inventory for the 8 new hub cities.
--
-- Builds the investor-portfolio poster into real data on BOTH panels:
--   • customer side  → bookable host_circle hotels + rooms (units auto-created by
--                       the v247 trigger). approval_status='approved' → live in the
--                       customer feed. NO prebuy window → bookable all 12 months.
--                       The per-city seasonal price is handled by the AI engine
--                       (lib/ai-pricing.ts CITY_SEASON_MULT) — every city is
--                       available year-round, the month only moves the price.
--   • Circle side    → one circle_properties investor listing per city (+ 2 room
--                       types) so the Model-1 investor browse shows every hub.
--
-- The 10 hubs = these 8 NEW cities + Rishikesh + Dhanaulti (already had inventory,
-- not re-seeded). Satellites are a later phase (10-hubs-first scope).
--
-- ADDITIVE / idempotent: hotels+rooms ON CONFLICT (id) DO NOTHING (deterministic
-- hco-seed-<city> ids); circle_properties/circle_room_types use deterministic
-- md5(key)::uuid ids so re-running never duplicates. Demo StayBid-operated
-- inventory (id prefix hco-seed-… = the cleanup key), swappable for real
-- properties later. NO money path, NO destructive SQL.

-- ── 1. customer-bookable hotels (host_circle, approved, year-round) ───────────
INSERT INTO public.hotels
  (id, name, description, city, state, country, lat, lng,
   "ownerId", owner_type, account_type, "starRating", property_type,
   amenities, images, approval_status, status, "isActive", "isVerified",
   prebuy_enabled)
VALUES
  ('hco-seed-goa', 'StayBid Circle · Goa Beachside Resort',
   'A StayBid-operated beachside resort in Goa — peak Nov–Feb, open and bookable year-round.',
   'Goa', 'Goa', 'India', 15.4909, 73.8278,
   'hco-seed-goa', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Beach Access,Pool,Restaurant,Wi-Fi,AC,Bar}'::text[],
   '{https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=1200&auto=format,https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=1200&auto=format,https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-ker', 'StayBid Circle · Munnar Hills Retreat',
   'A StayBid-operated tea-country retreat in Munnar, Kerala — peak Oct–Feb, bookable year-round.',
   'Kerala', 'Kerala', 'India', 10.0889, 77.0595,
   'hco-seed-ker', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Hill View,Restaurant,Wi-Fi,AC,Garden,Tea Estate}'::text[],
   '{https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=1200&auto=format,https://images.unsplash.com/photo-1580889240912-c39ecf3fef47?w=1200&auto=format,https://images.unsplash.com/photo-1593693411515-c20261bcad6e?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-uda', 'StayBid Circle · Udaipur Lake Palace Stay',
   'A StayBid-operated lake-view heritage stay in Udaipur — peak Oct–Mar + wedding season, bookable year-round.',
   'Udaipur', 'Rajasthan', 'India', 24.5854, 73.7125,
   'hco-seed-uda', 'host_circle', 'staybid_operated', 5, 'hotel',
   '{Lake View,Pool,Restaurant,Wi-Fi,AC,Heritage}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-jai', 'StayBid Circle · Jaisalmer Desert Haveli',
   'A StayBid-operated desert haveli in Jaisalmer — peak Nov–Feb desert season, bookable year-round.',
   'Jaisalmer', 'Rajasthan', 'India', 26.9157, 70.9083,
   'hco-seed-jai', 'host_circle', 'staybid_operated', 4, 'hotel',
   '{Desert View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[],
   '{https://images.unsplash.com/photo-1477587458883-47145ed94245?w=1200&auto=format,https://images.unsplash.com/photo-1609920658906-8223bd289001?w=1200&auto=format,https://images.unsplash.com/photo-1524230572899-a752b3835840?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-leh', 'StayBid Circle · Leh Himalayan Lodge',
   'A StayBid-operated Himalayan lodge in Leh — peak Jun–Sep, bookable year-round.',
   'Leh', 'Ladakh', 'India', 34.1526, 77.5771,
   'hco-seed-leh', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Trekking}'::text[],
   '{https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format,https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=1200&auto=format,https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-meg', 'StayBid Circle · Shillong Pine Retreat',
   'A StayBid-operated pine-hill retreat in Shillong, Meghalaya — strong spring + monsoon + autumn, bookable year-round.',
   'Meghalaya', 'Meghalaya', 'India', 25.5788, 91.8933,
   'hco-seed-meg', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Hill View,Restaurant,Wi-Fi,Heating,Garden,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&auto=format,https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&auto=format,https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-pur', 'StayBid Circle · Puri Seafront Stay',
   'A StayBid-operated seafront stay in Puri, Odisha — peak Oct–Feb, bookable year-round.',
   'Puri', 'Odisha', 'India', 19.8135, 85.8312,
   'hco-seed-pur', 'host_circle', 'staybid_operated', 3, 'hotel',
   '{Sea View,Restaurant,Wi-Fi,AC,Beach Access}'::text[],
   '{https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=1200&auto=format,https://images.unsplash.com/photo-1519046904884-53103b34b206?w=1200&auto=format,https://images.unsplash.com/photo-1533760881669-80db4d7b4c15?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-crg', 'StayBid Circle · Coorg Coffee Estate',
   'A StayBid-operated coffee-estate resort in Coorg, Karnataka — peak Oct–Dec + spring, bookable year-round.',
   'Coorg', 'Karnataka', 'India', 12.4244, 75.7382,
   'hco-seed-crg', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Estate View,Restaurant,Wi-Fi,AC,Coffee Estate,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1200&auto=format,https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1200&auto=format,https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true)
ON CONFLICT (id) DO NOTHING;

-- ── 2. rooms (2 categories each; v247 trigger auto-creates hotel_room_units) ──
INSERT INTO public.rooms
  (id, "hotelId", type, name, description, capacity, "floorPrice", mrp, quantity, amenities, images)
VALUES
  ('hco-seed-goa-r1','hco-seed-goa','Deluxe','Beachside Deluxe','Deluxe room steps from the sand.',2,4500,8500,8,'{Beach Access,Wi-Fi,AC,Balcony}'::text[],'{https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&auto=format}'::text[]),
  ('hco-seed-goa-r2','hco-seed-goa','Suite','Ocean Suite','Sea-facing suite with lounge.',4,8500,15000,5,'{Sea View,Wi-Fi,AC,Living Area,Balcony}'::text[],'{https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&auto=format}'::text[]),

  ('hco-seed-ker-r1','hco-seed-ker','Deluxe','Tea Valley Deluxe','Deluxe room over the tea slopes.',2,3800,7200,8,'{Hill View,Wi-Fi,AC,Balcony}'::text[],'{https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=1200&auto=format}'::text[]),
  ('hco-seed-ker-r2','hco-seed-ker','Suite','Plantation Suite','Suite with private sit-out.',3,7000,12500,5,'{Hill View,Wi-Fi,AC,Living Area}'::text[],'{https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&auto=format}'::text[]),

  ('hco-seed-uda-r1','hco-seed-uda','Deluxe','Lake Deluxe','Deluxe room with lake glimpses.',2,4200,8000,8,'{Lake View,Wi-Fi,AC,Balcony}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-uda-r2','hco-seed-uda','Suite','Palace Suite','Heritage suite with lake view.',4,8000,14000,5,'{Lake View,Wi-Fi,AC,Living Area,Heritage Decor}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),

  ('hco-seed-jai-r1','hco-seed-jai','Deluxe','Haveli Deluxe','Deluxe room in a carved haveli.',2,3200,6000,7,'{Desert View,Wi-Fi,AC,Heritage Decor}'::text[],'{https://images.unsplash.com/photo-1564540583246-934409427776?w=1200&auto=format}'::text[]),
  ('hco-seed-jai-r2','hco-seed-jai','Suite','Fort View Suite','Rooftop suite facing the fort.',4,6000,10500,4,'{Desert View,Wi-Fi,AC,Rooftop,Living Area}'::text[],'{https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&auto=format}'::text[]),

  ('hco-seed-leh-r1','hco-seed-leh','Deluxe','Himalayan Deluxe','Deluxe room with mountain view.',2,3500,6500,7,'{Mountain View,Wi-Fi,Heating,Parking}'::text[],'{https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-leh-r2','hco-seed-leh','Suite','Summit Suite','Suite with panoramic peaks.',3,6500,11500,4,'{Mountain View,Wi-Fi,Heating,Living Area}'::text[],'{https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),

  ('hco-seed-meg-r1','hco-seed-meg','Deluxe','Pine Deluxe','Deluxe room among the pines.',2,3000,5800,7,'{Hill View,Wi-Fi,Heating,Garden}'::text[],'{https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=1200&auto=format}'::text[]),
  ('hco-seed-meg-r2','hco-seed-meg','Suite','Cloud Suite','Suite with valley view.',4,5800,10000,4,'{Hill View,Wi-Fi,Heating,Living Area}'::text[],'{https://images.unsplash.com/photo-1606744824163-985d376605aa?w=1200&auto=format}'::text[]),

  ('hco-seed-pur-r1','hco-seed-pur','Deluxe','Seafront Deluxe','Deluxe room near the shore.',2,2800,5200,7,'{Sea View,Wi-Fi,AC,Beach Access}'::text[],'{https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1200&auto=format}'::text[]),
  ('hco-seed-pur-r2','hco-seed-pur','Suite','Bay Suite','Suite facing the Bay of Bengal.',4,5200,9200,4,'{Sea View,Wi-Fi,AC,Living Area}'::text[],'{https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&auto=format}'::text[]),

  ('hco-seed-crg-r1','hco-seed-crg','Deluxe','Estate Deluxe','Deluxe room in the coffee estate.',2,3400,6200,7,'{Estate View,Wi-Fi,AC,Balcony}'::text[],'{https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?w=1200&auto=format}'::text[]),
  ('hco-seed-crg-r2','hco-seed-crg','Suite','Plantation Villa','Villa suite amid the coffee.',4,6200,11000,4,'{Estate View,Wi-Fi,AC,Living Area,Bonfire}'::text[],'{https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&auto=format}'::text[])
ON CONFLICT (id) DO NOTHING;

-- ── 3. Circle investor catalog (one property per city, deterministic uuid) ────
INSERT INTO public.circle_properties
  (id, title, city, state, location_label, tagline, description, images, rooms_label,
   view_label, monthly_rate, roi_min_pct, roi_max_pct, occupancy_label, hotel_id,
   operation_model, status, star_rating, property_type, amenities)
VALUES
  (md5('cp-hco-seed-goa')::uuid, 'Goa Beachside Resort', 'Goa', 'Goa', 'North Goa Beltway',
   'Peak season Nov–Feb', 'StayBid-operated beachside resort. Year-round occupancy with a Nov–Feb demand peak.',
   '["https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Beach View', 'Beach View', 42000, 12, 16, 'High Occupancy', 'hco-seed-goa',
   'managed', 'active', 4, 'resort', '{Beach Access,Pool,Restaurant,Wi-Fi,AC,Bar}'::text[]),

  (md5('cp-hco-seed-ker')::uuid, 'Munnar Hills Retreat', 'Kerala', 'Kerala', 'Munnar Tea Country',
   'Peak season Oct–Feb', 'StayBid-operated tea-country retreat. Year-round occupancy across the Kerala season.',
   '["https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Hill View', 'Hill View', 36000, 12, 16, 'High Occupancy', 'hco-seed-ker',
   'managed', 'active', 4, 'resort', '{Hill View,Restaurant,Wi-Fi,AC,Garden,Tea Estate}'::text[]),

  (md5('cp-hco-seed-uda')::uuid, 'Udaipur Lake Palace Stay', 'Udaipur', 'Rajasthan', 'Lake Pichola',
   'Peak season Oct–Mar', 'StayBid-operated lake-view heritage stay. Winter + wedding-season demand, occupancy year-round.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Lake View', 'Lake View', 40000, 12, 16, 'High Occupancy', 'hco-seed-uda',
   'managed', 'active', 5, 'hotel', '{Lake View,Pool,Restaurant,Wi-Fi,AC,Heritage}'::text[]),

  (md5('cp-hco-seed-jai')::uuid, 'Jaisalmer Desert Haveli', 'Jaisalmer', 'Rajasthan', 'Golden Fort Circuit',
   'Peak season Nov–Feb', 'StayBid-operated desert haveli. Strong desert-season demand, occupancy year-round.',
   '["https://images.unsplash.com/photo-1477587458883-47145ed94245?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Desert View', 'Desert View', 30000, 12, 16, 'Seasonal Peak', 'hco-seed-jai',
   'managed', 'active', 4, 'hotel', '{Desert View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[]),

  (md5('cp-hco-seed-leh')::uuid, 'Leh Himalayan Lodge', 'Leh', 'Ladakh', 'Leh–Nubra Belt',
   'Peak season Jun–Sep', 'StayBid-operated Himalayan lodge. Summer-peak Ladakh market, part of the year-round portfolio.',
   '["https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Mountain View', 'Mountain View', 33000, 12, 16, 'Seasonal Peak', 'hco-seed-leh',
   'managed', 'active', 4, 'resort', '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Trekking}'::text[]),

  (md5('cp-hco-seed-meg')::uuid, 'Shillong Pine Retreat', 'Meghalaya', 'Meghalaya', 'Shillong–Cherrapunji',
   'Strong spring & monsoon', 'StayBid-operated pine-hill retreat. Spring, monsoon and autumn demand, occupancy year-round.',
   '["https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Hill View', 'Hill View', 28000, 12, 16, 'High Occupancy', 'hco-seed-meg',
   'managed', 'active', 4, 'resort', '{Hill View,Restaurant,Wi-Fi,Heating,Garden,Bonfire}'::text[]),

  (md5('cp-hco-seed-pur')::uuid, 'Puri Seafront Stay', 'Puri', 'Odisha', 'Puri–Konark Marine Drive',
   'Peak season Oct–Feb', 'StayBid-operated seafront stay. Winter-peak coastal market, occupancy year-round.',
   '["https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Sea View', 'Sea View', 26000, 12, 16, 'High Occupancy', 'hco-seed-pur',
   'managed', 'active', 3, 'hotel', '{Sea View,Restaurant,Wi-Fi,AC,Beach Access}'::text[]),

  (md5('cp-hco-seed-crg')::uuid, 'Coorg Coffee Estate', 'Coorg', 'Karnataka', 'Madikeri Estates',
   'Peak season Oct–Dec', 'StayBid-operated coffee-estate resort. Autumn + spring demand, occupancy year-round.',
   '["https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Estate View', 'Estate View', 32000, 12, 16, 'High Occupancy', 'hco-seed-crg',
   'managed', 'active', 4, 'resort', '{Estate View,Restaurant,Wi-Fi,AC,Coffee Estate,Bonfire}'::text[])
ON CONFLICT (id) DO NOTHING;

-- ── 4. Circle room types (2 per property; total_units matches rooms.quantity) ─
INSERT INTO public.circle_room_types
  (id, property_id, name, monthly_rate, total_units, locked_units, active,
   description, images, amenities, capacity, view_label, roi_pct)
VALUES
  (md5('crt-hco-seed-goa-r1')::uuid, md5('cp-hco-seed-goa')::uuid, 'Beachside Deluxe', 42000, 8, 0, true, 'Deluxe room steps from the sand.', '["https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&auto=format"]'::jsonb, '["Beach Access","Wi-Fi","AC","Balcony"]'::jsonb, 2, 'Beach View', 14),
  (md5('crt-hco-seed-goa-r2')::uuid, md5('cp-hco-seed-goa')::uuid, 'Ocean Suite', 68000, 5, 0, true, 'Sea-facing suite with lounge.', '["https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&auto=format"]'::jsonb, '["Sea View","Wi-Fi","AC","Living Area","Balcony"]'::jsonb, 4, 'Sea View', 15),

  (md5('crt-hco-seed-ker-r1')::uuid, md5('cp-hco-seed-ker')::uuid, 'Tea Valley Deluxe', 36000, 8, 0, true, 'Deluxe room over the tea slopes.', '["https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=1200&auto=format"]'::jsonb, '["Hill View","Wi-Fi","AC","Balcony"]'::jsonb, 2, 'Hill View', 14),
  (md5('crt-hco-seed-ker-r2')::uuid, md5('cp-hco-seed-ker')::uuid, 'Plantation Suite', 58000, 5, 0, true, 'Suite with private sit-out.', '["https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&auto=format"]'::jsonb, '["Hill View","Wi-Fi","AC","Living Area"]'::jsonb, 3, 'Hill View', 15),

  (md5('crt-hco-seed-uda-r1')::uuid, md5('cp-hco-seed-uda')::uuid, 'Lake Deluxe', 40000, 8, 0, true, 'Deluxe room with lake glimpses.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["Lake View","Wi-Fi","AC","Balcony"]'::jsonb, 2, 'Lake View', 14),
  (md5('crt-hco-seed-uda-r2')::uuid, md5('cp-hco-seed-uda')::uuid, 'Palace Suite', 64000, 5, 0, true, 'Heritage suite with lake view.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["Lake View","Wi-Fi","AC","Living Area","Heritage Decor"]'::jsonb, 4, 'Lake View', 15),

  (md5('crt-hco-seed-jai-r1')::uuid, md5('cp-hco-seed-jai')::uuid, 'Haveli Deluxe', 30000, 7, 0, true, 'Deluxe room in a carved haveli.', '["https://images.unsplash.com/photo-1564540583246-934409427776?w=1200&auto=format"]'::jsonb, '["Desert View","Wi-Fi","AC","Heritage Decor"]'::jsonb, 2, 'Desert View', 13),
  (md5('crt-hco-seed-jai-r2')::uuid, md5('cp-hco-seed-jai')::uuid, 'Fort View Suite', 48000, 4, 0, true, 'Rooftop suite facing the fort.', '["https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&auto=format"]'::jsonb, '["Desert View","Wi-Fi","AC","Rooftop","Living Area"]'::jsonb, 4, 'Desert View', 14),

  (md5('crt-hco-seed-leh-r1')::uuid, md5('cp-hco-seed-leh')::uuid, 'Himalayan Deluxe', 33000, 7, 0, true, 'Deluxe room with mountain view.', '["https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format"]'::jsonb, '["Mountain View","Wi-Fi","Heating","Parking"]'::jsonb, 2, 'Mountain View', 13),
  (md5('crt-hco-seed-leh-r2')::uuid, md5('cp-hco-seed-leh')::uuid, 'Summit Suite', 52000, 4, 0, true, 'Suite with panoramic peaks.', '["https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format"]'::jsonb, '["Mountain View","Wi-Fi","Heating","Living Area"]'::jsonb, 3, 'Mountain View', 14),

  (md5('crt-hco-seed-meg-r1')::uuid, md5('cp-hco-seed-meg')::uuid, 'Pine Deluxe', 28000, 7, 0, true, 'Deluxe room among the pines.', '["https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=1200&auto=format"]'::jsonb, '["Hill View","Wi-Fi","Heating","Garden"]'::jsonb, 2, 'Hill View', 13),
  (md5('crt-hco-seed-meg-r2')::uuid, md5('cp-hco-seed-meg')::uuid, 'Cloud Suite', 46000, 4, 0, true, 'Suite with valley view.', '["https://images.unsplash.com/photo-1606744824163-985d376605aa?w=1200&auto=format"]'::jsonb, '["Hill View","Wi-Fi","Heating","Living Area"]'::jsonb, 4, 'Hill View', 14),

  (md5('crt-hco-seed-pur-r1')::uuid, md5('cp-hco-seed-pur')::uuid, 'Seafront Deluxe', 26000, 7, 0, true, 'Deluxe room near the shore.', '["https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1200&auto=format"]'::jsonb, '["Sea View","Wi-Fi","AC","Beach Access"]'::jsonb, 2, 'Sea View', 13),
  (md5('crt-hco-seed-pur-r2')::uuid, md5('cp-hco-seed-pur')::uuid, 'Bay Suite', 42000, 4, 0, true, 'Suite facing the Bay of Bengal.', '["https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&auto=format"]'::jsonb, '["Sea View","Wi-Fi","AC","Living Area"]'::jsonb, 4, 'Sea View', 14),

  (md5('crt-hco-seed-crg-r1')::uuid, md5('cp-hco-seed-crg')::uuid, 'Estate Deluxe', 32000, 7, 0, true, 'Deluxe room in the coffee estate.', '["https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?w=1200&auto=format"]'::jsonb, '["Estate View","Wi-Fi","AC","Balcony"]'::jsonb, 2, 'Estate View', 14),
  (md5('crt-hco-seed-crg-r2')::uuid, md5('cp-hco-seed-crg')::uuid, 'Plantation Villa', 50000, 4, 0, true, 'Villa suite amid the coffee.', '["https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&auto=format"]'::jsonb, '["Estate View","Wi-Fi","AC","Living Area","Bonfire"]'::jsonb, 4, 'Estate View', 15)
ON CONFLICT (id) DO NOTHING;

-- verify:
--   SELECT id,city,owner_type,approval_status,"isActive" FROM hotels WHERE id LIKE 'hco-seed-%' AND city NOT IN ('Mussoorie','Manali','Rishikesh','Shimla');
--   SELECT "hotelId", count(*) FROM hotel_room_units WHERE "hotelId" IN ('hco-seed-goa','hco-seed-ker','hco-seed-uda','hco-seed-jai','hco-seed-leh','hco-seed-meg','hco-seed-pur','hco-seed-crg') GROUP BY 1;  -- expect 13,13,13,11,11,11,11,11
--   SELECT city, count(*) FROM circle_properties WHERE hotel_id LIKE 'hco-seed-%' GROUP BY 1;
