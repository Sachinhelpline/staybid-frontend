-- v337 — Circle Marketplace Redesign · Phase M0 groundwork
-- Model-3 pre-buy SUPPLY: a `prebuy_enabled` flag on hotels + a seed batch of
-- host-circle operated properties so the Model-3 marketplace has day-one supply.
--
-- WHY a separate flag (not approval_status): the ONLY customer-feed gate is
-- approval_status='approved' (verified v336). Seed pre-buy supply must be
-- browsable in the Model-3 marketplace WITHOUT being live-bookable by regular
-- customers. So Model-3 Step-1 filters on `owner_type='host_circle' AND
-- prebuy_enabled=true`, independent of approval_status. When ops later Go-Lives
-- a property (v336, approval_status='approved') it becomes ALSO customer-
-- bookable; pre-buy visibility stays decoupled.
--
-- ADDITIVE. Default false → zero impact on the existing 35 classic hotels.
-- Seed hotels are host_circle operated (owner-invisible, per-property hco_ id),
-- approval_status='pending' (OUT of customer feed), isActive=false, DRAFT.
-- The v247 trigger (trg_rooms_provision_units) auto-creates hotel_room_units
-- from rooms.quantity on insert.

-- ── 1. schema ───────────────────────────────────────────────────────────────
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS prebuy_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hotels_prebuy
  ON public.hotels (owner_type, prebuy_enabled)
  WHERE prebuy_enabled = true;

-- ── 2. seed hotels (host-circle operated, pre-buy supply only) ───────────────
INSERT INTO public.hotels
  (id, name, description, city, state, country, lat, lng,
   "ownerId", owner_type, account_type, "starRating", property_type,
   amenities, images, approval_status, status, "isActive", "isVerified",
   prebuy_enabled)
VALUES
  ('hco-seed-mus', 'StayBid Circle · Mussoorie Ridge Retreat',
   'A StayBid-operated hillside retreat above Mussoorie ridge — available for Circle pre-buy.',
   'Mussoorie', 'Uttarakhand', 'India', 30.4599, 78.0664,
   'hco-seed-mus', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Restaurant,Wi-Fi,Mountain View,Parking,AC,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&auto=format,https://images.unsplash.com/photo-1486915309851-b0cc1f8a0084?w=1200&auto=format,https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=1200&auto=format}'::text[],
   'pending', 'draft', false, false, true),

  ('hco-seed-man', 'StayBid Circle · Manali Riverside Lodge',
   'A StayBid-operated riverside lodge on the Beas — available for Circle pre-buy.',
   'Manali', 'Himachal Pradesh', 'India', 32.2432, 77.1892,
   'hco-seed-man', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Restaurant,Wi-Fi,River View,Parking,AC,Trekking}'::text[],
   '{https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=1200&auto=format,https://images.unsplash.com/photo-1551524559-8af4e6624178?w=1200&auto=format,https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1200&auto=format}'::text[],
   'pending', 'draft', false, false, true),

  ('hco-seed-ris', 'StayBid Circle · Rishikesh Ganga View',
   'A StayBid-operated Ganga-view stay in Rishikesh — available for Circle pre-buy.',
   'Rishikesh', 'Uttarakhand', 'India', 30.0869, 78.2676,
   'hco-seed-ris', 'host_circle', 'staybid_operated', 4, 'hotel',
   '{Restaurant,Wi-Fi,River View,Yoga,Parking,AC}'::text[],
   '{https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5?w=1200&auto=format,https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&auto=format,https://images.unsplash.com/photo-1551776235-dde6d482980b?w=1200&auto=format}'::text[],
   'pending', 'draft', false, false, true),

  ('hco-seed-shi', 'StayBid Circle · Shimla Colonial Suites',
   'A StayBid-operated colonial suite property in Shimla — available for Circle pre-buy.',
   'Shimla', 'Himachal Pradesh', 'India', 31.1048, 77.1734,
   'hco-seed-shi', 'host_circle', 'staybid_operated', 4, 'hotel',
   '{Restaurant,Wi-Fi,Mountain View,Heritage,Parking,AC}'::text[],
   '{https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8?w=1200&auto=format,https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format,https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=1200&auto=format}'::text[]
   , 'pending', 'draft', false, false, true)
ON CONFLICT (id) DO NOTHING;

-- ── 3. seed rooms (2 categories each; v247 trigger auto-creates units) ───────
INSERT INTO public.rooms
  (id, "hotelId", type, name, description, capacity, "floorPrice", mrp,
   quantity, amenities, images)
VALUES
  ('hco-seed-mus-r1','hco-seed-mus','Deluxe','Ridge Deluxe','Deluxe room with valley view.',2,4200,7200,4,
   '{Mountain View,Wi-Fi,AC,Balcony}'::text[],
   '{https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=1200&auto=format,https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-mus-r2','hco-seed-mus','Suite','Ridge Suite','Premium suite with living area.',3,7800,12900,2,
   '{Mountain View,Wi-Fi,AC,Living Area,Bathtub}'::text[],
   '{https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&auto=format,https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),

  ('hco-seed-man-r1','hco-seed-man','Deluxe','Riverside Deluxe','Deluxe room facing the Beas.',2,3800,6500,5,
   '{River View,Wi-Fi,AC,Balcony}'::text[],
   '{https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&auto=format,https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=1200&auto=format}'::text[]),
  ('hco-seed-man-r2','hco-seed-man','Suite','Riverside Suite','Suite with private deck.',4,7200,12100,2,
   '{River View,Wi-Fi,AC,Living Area,Deck}'::text[],
   '{https://images.unsplash.com/photo-1590490359854-dfba19688d70?w=1200&auto=format,https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),

  ('hco-seed-ris-r1','hco-seed-ris','Deluxe','Ganga Deluxe','Deluxe room with river view.',2,3200,5500,4,
   '{River View,Wi-Fi,AC,Yoga Mat}'::text[],
   '{https://images.unsplash.com/photo-1606744824163-985d376605aa?w=1200&auto=format,https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=1200&auto=format}'::text[]),
  ('hco-seed-ris-r2','hco-seed-ris','Suite','Ganga Suite','Riverside suite with balcony.',3,6000,10200,2,
   '{River View,Wi-Fi,AC,Living Area,Balcony}'::text[],
   '{https://images.unsplash.com/photo-1551776235-dde6d482980b?w=1200&auto=format,https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&auto=format}'::text[]),

  ('hco-seed-shi-r1','hco-seed-shi','Deluxe','Colonial Deluxe','Heritage deluxe room.',2,3900,6700,4,
   '{Mountain View,Wi-Fi,AC,Heritage Decor}'::text[],
   '{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format,https://images.unsplash.com/photo-1564540583246-934409427776?w=1200&auto=format}'::text[]),
  ('hco-seed-shi-r2','hco-seed-shi','Suite','Colonial Suite','Heritage family suite.',4,7400,12500,2,
   '{Mountain View,Wi-Fi,AC,Heritage Decor,Living Area}'::text[],
   '{https://images.unsplash.com/photo-1551776235-dde6d482980b?w=1200&auto=format,https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&auto=format}'::text[])
ON CONFLICT (id) DO NOTHING;

-- verify:
--   SELECT id,name,city,owner_type,account_type,prebuy_enabled,approval_status FROM hotels WHERE prebuy_enabled;
--   SELECT "hotelId", count(*) FROM hotel_room_units WHERE "hotelId" LIKE 'hco-seed-%' GROUP BY 1;  -- expect 6 each
