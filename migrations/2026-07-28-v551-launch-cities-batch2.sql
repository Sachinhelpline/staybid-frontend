-- v551 — activate 12 new launch cities across ALL panels (mirrors v392).
-- New cities: Haridwar, Bhimtal, Mukteshwar, Kasauli, Chail, Dharamshala, Bir Billing,
--   Neemrana, Mathura, Vrindavan, Ayodhya, Varanasi. Already-live cities (Shimla, Jaipur,
--   Udaipur, Jaisalmer, Lansdowne) are NOT re-added.
-- ADDITIVE / idempotent (ON CONFLICT (id) DO NOTHING; deterministic hco-seed-<slug> +
--   md5(key)::uuid ids). host_circle + approved => live on Flash Deals + /hotels + Discover;
--   circle_properties/circle_room_types => Model 1; auction_lots (live) => Model 3;
--   b2b_listings (hotel_owner) => Model 2. Units auto-created by the v247 trigger. NO money path.

-- 1. customer-bookable hotels (host_circle, approved, year-round)
INSERT INTO public.hotels
  (id, name, description, city, state, country, lat, lng,
   "ownerId", owner_type, account_type, "starRating", property_type,
   amenities, images, approval_status, status, "isActive", "isVerified", prebuy_enabled)
VALUES
  ('hco-seed-hdw', 'Har Ki Pauri Riverside',
   'A StayBid-operated riverside stay in Haridwar, Uttarakhand — bookable year-round.',
   'Haridwar', 'Uttarakhand', 'India', 29.9457, 78.1642,
   'hco-seed-hdw', 'host_circle', 'staybid_operated', 3, 'hotel',
   '{River View,Restaurant,Wi-Fi,AC,Ghat Walk,Rooftop}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-bhi', 'Bhimtal Lakeside Resort',
   'A StayBid-operated lakeside retreat in Bhimtal, Uttarakhand — bookable year-round.',
   'Bhimtal', 'Uttarakhand', 'India', 29.345, 79.5637,
   'hco-seed-bhi', 'host_circle', 'staybid_operated', 3, 'resort',
   '{Lake View,Restaurant,Wi-Fi,Heating,Boating,Garden}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-muk', 'Mukteshwar Orchard Retreat',
   'A StayBid-operated hill retreat in Mukteshwar, Uttarakhand — bookable year-round.',
   'Mukteshwar', 'Uttarakhand', 'India', 29.4731, 79.6469,
   'hco-seed-muk', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format,https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=1200&auto=format,https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-ksl', 'Kasauli Pinewood Manor',
   'A StayBid-operated hill retreat in Kasauli, Himachal Pradesh — bookable year-round.',
   'Kasauli', 'Himachal Pradesh', 'India', 30.9046, 76.965,
   'hco-seed-ksl', 'host_circle', 'staybid_operated', 3, 'resort',
   '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format,https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=1200&auto=format,https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-chl', 'Chail Palace Woods',
   'A StayBid-operated hill retreat in Chail, Himachal Pradesh — bookable year-round.',
   'Chail', 'Himachal Pradesh', 'India', 30.9694, 77.1936,
   'hco-seed-chl', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format,https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=1200&auto=format,https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-dhr', 'Dhauladhar Dharamshala Retreat',
   'A StayBid-operated hill retreat in Dharamshala, Himachal Pradesh — bookable year-round.',
   'Dharamshala', 'Himachal Pradesh', 'India', 32.219, 76.3234,
   'hco-seed-dhr', 'host_circle', 'staybid_operated', 4, 'resort',
   '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format,https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=1200&auto=format,https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-bir', 'Bir Billing Meadows Resort',
   'A StayBid-operated hill retreat in Bir Billing, Himachal Pradesh — bookable year-round.',
   'Bir Billing', 'Himachal Pradesh', 'India', 32.045, 76.718,
   'hco-seed-bir', 'host_circle', 'staybid_operated', 3, 'resort',
   '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[],
   '{https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format,https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=1200&auto=format,https://images.unsplash.com/photo-1516426122078-c23e76319801?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-nmr', 'Neemrana Fort Haveli',
   'A StayBid-operated heritage fort palace in Neemrana, Rajasthan — bookable year-round.',
   'Neemrana', 'Rajasthan', 'India', 27.988, 76.386,
   'hco-seed-nmr', 'host_circle', 'staybid_operated', 5, 'hotel',
   '{Fort View,Pool,Restaurant,Wi-Fi,AC,Heritage}'::text[],
   '{https://images.unsplash.com/photo-1477587458883-47145ed94245?w=1200&auto=format,https://images.unsplash.com/photo-1609920658906-8223bd289001?w=1200&auto=format,https://images.unsplash.com/photo-1524230572899-a752b3835840?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-mth', 'Braj Heritage Mathura',
   'A StayBid-operated heritage stay in Mathura, Uttar Pradesh — bookable year-round.',
   'Mathura', 'Uttar Pradesh', 'India', 27.4924, 77.6737,
   'hco-seed-mth', 'host_circle', 'staybid_operated', 3, 'hotel',
   '{Temple View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-vrn', 'Vrindavan Temple Residency',
   'A StayBid-operated heritage stay in Vrindavan, Uttar Pradesh — bookable year-round.',
   'Vrindavan', 'Uttar Pradesh', 'India', 27.565, 77.6593,
   'hco-seed-vrn', 'host_circle', 'staybid_operated', 3, 'hotel',
   '{Temple View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-ayo', 'Ayodhya Ram Nagari Stay',
   'A StayBid-operated heritage stay in Ayodhya, Uttar Pradesh — bookable year-round.',
   'Ayodhya', 'Uttar Pradesh', 'India', 26.7922, 82.1998,
   'hco-seed-ayo', 'host_circle', 'staybid_operated', 3, 'hotel',
   '{Temple View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true),

  ('hco-seed-vns', 'Kashi Ghatside Varanasi',
   'A StayBid-operated riverside stay in Varanasi, Uttar Pradesh — bookable year-round.',
   'Varanasi', 'Uttar Pradesh', 'India', 25.3176, 82.9739,
   'hco-seed-vns', 'host_circle', 'staybid_operated', 4, 'hotel',
   '{River View,Restaurant,Wi-Fi,AC,Ghat Walk,Rooftop}'::text[],
   '{https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format,https://images.unsplash.com/photo-1599661046289-e31897846e41?w=1200&auto=format,https://images.unsplash.com/photo-1585506942812-e72b29cef752?w=1200&auto=format}'::text[],
   'approved', 'active', true, true, true)
ON CONFLICT (id) DO NOTHING;

-- 2. rooms (2 categories each; v247 trigger auto-creates hotel_room_units from quantity)
INSERT INTO public.rooms
  (id, "hotelId", type, name, description, capacity, "floorPrice", mrp, quantity, amenities, images)
VALUES
  ('hco-seed-hdw-r1','hco-seed-hdw','Deluxe','Riverside Deluxe','Riverside Deluxe with river view.',2,3000,5600,8,'{River View,Restaurant,Wi-Fi,AC}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-hdw-r2','hco-seed-hdw','Suite','Ganga Suite','Ganga Suite — premium river view.',4,5600,9800,5,'{River View,Restaurant,Wi-Fi,AC,Ghat Walk}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),
  ('hco-seed-bhi-r1','hco-seed-bhi','Deluxe','Lake Deluxe','Lake Deluxe with lake view.',2,3400,6400,7,'{Lake View,Restaurant,Wi-Fi,Heating}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-bhi-r2','hco-seed-bhi','Suite','Lakeview Suite','Lakeview Suite — premium lake view.',4,6400,11000,4,'{Lake View,Restaurant,Wi-Fi,Heating,Boating}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),
  ('hco-seed-muk-r1','hco-seed-muk','Deluxe','Mountain Deluxe','Mountain Deluxe with mountain view.',2,3600,6800,7,'{Mountain View,Restaurant,Wi-Fi,Heating}'::text[],'{https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-muk-r2','hco-seed-muk','Suite','Summit Suite','Summit Suite — premium mountain view.',4,6800,11800,4,'{Mountain View,Restaurant,Wi-Fi,Heating,Parking}'::text[],'{https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),
  ('hco-seed-ksl-r1','hco-seed-ksl','Deluxe','Mountain Deluxe','Mountain Deluxe with mountain view.',2,3200,6000,7,'{Mountain View,Restaurant,Wi-Fi,Heating}'::text[],'{https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-ksl-r2','hco-seed-ksl','Suite','Summit Suite','Summit Suite — premium mountain view.',4,6000,10500,4,'{Mountain View,Restaurant,Wi-Fi,Heating,Parking}'::text[],'{https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),
  ('hco-seed-chl-r1','hco-seed-chl','Deluxe','Mountain Deluxe','Mountain Deluxe with mountain view.',2,3600,6800,7,'{Mountain View,Restaurant,Wi-Fi,Heating}'::text[],'{https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-chl-r2','hco-seed-chl','Suite','Summit Suite','Summit Suite — premium mountain view.',4,6800,11800,4,'{Mountain View,Restaurant,Wi-Fi,Heating,Parking}'::text[],'{https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),
  ('hco-seed-dhr-r1','hco-seed-dhr','Deluxe','Mountain Deluxe','Mountain Deluxe with mountain view.',2,3800,7200,8,'{Mountain View,Restaurant,Wi-Fi,Heating}'::text[],'{https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-dhr-r2','hco-seed-dhr','Suite','Summit Suite','Summit Suite — premium mountain view.',4,7200,12500,5,'{Mountain View,Restaurant,Wi-Fi,Heating,Parking}'::text[],'{https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),
  ('hco-seed-bir-r1','hco-seed-bir','Deluxe','Mountain Deluxe','Mountain Deluxe with mountain view.',2,3000,5600,7,'{Mountain View,Restaurant,Wi-Fi,Heating}'::text[],'{https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format}'::text[]),
  ('hco-seed-bir-r2','hco-seed-bir','Suite','Summit Suite','Summit Suite — premium mountain view.',4,5600,9800,4,'{Mountain View,Restaurant,Wi-Fi,Heating,Parking}'::text[],'{https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format}'::text[]),
  ('hco-seed-nmr-r1','hco-seed-nmr','Deluxe','Fort Deluxe','Fort Deluxe with fort view.',2,5000,9500,6,'{Fort View,Pool,Restaurant,Wi-Fi}'::text[],'{https://images.unsplash.com/photo-1564540583246-934409427776?w=1200&auto=format}'::text[]),
  ('hco-seed-nmr-r2','hco-seed-nmr','Suite','Palace Suite','Palace Suite — premium fort view.',4,9500,16000,4,'{Fort View,Pool,Restaurant,Wi-Fi,AC}'::text[],'{https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&auto=format}'::text[]),
  ('hco-seed-mth-r1','hco-seed-mth','Deluxe','Heritage Deluxe','Heritage Deluxe with temple view.',2,3200,6000,8,'{Temple View,Restaurant,Wi-Fi,AC}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-mth-r2','hco-seed-mth','Suite','Temple View Suite','Temple View Suite — premium temple view.',4,6000,10500,5,'{Temple View,Restaurant,Wi-Fi,AC,Rooftop}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),
  ('hco-seed-vrn-r1','hco-seed-vrn','Deluxe','Heritage Deluxe','Heritage Deluxe with temple view.',2,3200,6000,8,'{Temple View,Restaurant,Wi-Fi,AC}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-vrn-r2','hco-seed-vrn','Suite','Temple View Suite','Temple View Suite — premium temple view.',4,6000,10500,5,'{Temple View,Restaurant,Wi-Fi,AC,Rooftop}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),
  ('hco-seed-ayo-r1','hco-seed-ayo','Deluxe','Heritage Deluxe','Heritage Deluxe with temple view.',2,3400,6400,8,'{Temple View,Restaurant,Wi-Fi,AC}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-ayo-r2','hco-seed-ayo','Suite','Temple View Suite','Temple View Suite — premium temple view.',4,6400,11000,5,'{Temple View,Restaurant,Wi-Fi,AC,Rooftop}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[]),
  ('hco-seed-vns-r1','hco-seed-vns','Deluxe','Riverside Deluxe','Riverside Deluxe with river view.',2,3800,7200,8,'{River View,Restaurant,Wi-Fi,AC}'::text[],'{https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format}'::text[]),
  ('hco-seed-vns-r2','hco-seed-vns','Suite','Ganga Suite','Ganga Suite — premium river view.',4,7200,12500,5,'{River View,Restaurant,Wi-Fi,AC,Ghat Walk}'::text[],'{https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format}'::text[])
ON CONFLICT (id) DO NOTHING;

-- 3. Circle investor catalog (Model 1) — one property per city, deterministic uuid
INSERT INTO public.circle_properties
  (id, title, city, state, location_label, tagline, description, images, rooms_label,
   view_label, monthly_rate, roi_min_pct, roi_max_pct, occupancy_label, hotel_id,
   operation_model, status, star_rating, property_type, amenities)
VALUES
  (md5('cp-hco-seed-hdw')::uuid, 'Har Ki Pauri Riverside', 'Haridwar', 'Uttarakhand', 'Har Ki Pauri Riverfront',
   'Ganga-aarti season year-round', 'StayBid-operated riverside stay. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · River View', 'River View', 28000, 12, 16, 'High Occupancy', 'hco-seed-hdw',
   'managed', 'active', 3, 'hotel', '{River View,Restaurant,Wi-Fi,AC,Ghat Walk,Rooftop}'::text[]),

  (md5('cp-hco-seed-bhi')::uuid, 'Bhimtal Lakeside Resort', 'Bhimtal', 'Uttarakhand', 'Bhimtal Lake Belt',
   'Lake-district getaway', 'StayBid-operated lakeside retreat. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Lake View', 'Lake View', 32000, 12, 16, 'High Occupancy', 'hco-seed-bhi',
   'managed', 'active', 3, 'resort', '{Lake View,Restaurant,Wi-Fi,Heating,Boating,Garden}'::text[]),

  (md5('cp-hco-seed-muk')::uuid, 'Mukteshwar Orchard Retreat', 'Mukteshwar', 'Uttarakhand', 'Kumaon Orchard Ridge',
   'Peak Himalayan views', 'StayBid-operated hill retreat. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Mountain View', 'Mountain View', 34000, 12, 16, 'High Occupancy', 'hco-seed-muk',
   'managed', 'active', 4, 'resort', '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[]),

  (md5('cp-hco-seed-ksl')::uuid, 'Kasauli Pinewood Manor', 'Kasauli', 'Himachal Pradesh', 'Kasauli Colonial Ridge',
   'Pine-hill weekender', 'StayBid-operated hill retreat. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Mountain View', 'Mountain View', 30000, 12, 16, 'High Occupancy', 'hco-seed-ksl',
   'managed', 'active', 3, 'resort', '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[]),

  (md5('cp-hco-seed-chl')::uuid, 'Chail Palace Woods', 'Chail', 'Himachal Pradesh', 'Chail Palace Woods',
   'Pine + palace calm', 'StayBid-operated hill retreat. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Mountain View', 'Mountain View', 34000, 12, 16, 'High Occupancy', 'hco-seed-chl',
   'managed', 'active', 4, 'resort', '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[]),

  (md5('cp-hco-seed-dhr')::uuid, 'Dhauladhar Dharamshala Retreat', 'Dharamshala', 'Himachal Pradesh', 'McLeodganj–Dharamshala',
   'Dhauladhar + monastery', 'StayBid-operated hill retreat. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Mountain View', 'Mountain View', 36000, 12, 16, 'High Occupancy', 'hco-seed-dhr',
   'managed', 'active', 4, 'resort', '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[]),

  (md5('cp-hco-seed-bir')::uuid, 'Bir Billing Meadows Resort', 'Bir Billing', 'Himachal Pradesh', 'Bir Billing Meadows',
   'Paragliding capital', 'StayBid-operated hill retreat. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1589881133595-a3c085cb731d?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Mountain View', 'Mountain View', 28000, 12, 16, 'High Occupancy', 'hco-seed-bir',
   'managed', 'active', 3, 'resort', '{Mountain View,Restaurant,Wi-Fi,Heating,Parking,Bonfire}'::text[]),

  (md5('cp-hco-seed-nmr')::uuid, 'Neemrana Fort Haveli', 'Neemrana', 'Rajasthan', 'Neemrana Fort Circuit',
   'Heritage fort-palace', 'StayBid-operated heritage fort palace. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1477587458883-47145ed94245?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Fort View', 'Fort View', 48000, 12, 16, 'High Occupancy', 'hco-seed-nmr',
   'managed', 'active', 5, 'hotel', '{Fort View,Pool,Restaurant,Wi-Fi,AC,Heritage}'::text[]),

  (md5('cp-hco-seed-mth')::uuid, 'Braj Heritage Mathura', 'Mathura', 'Uttar Pradesh', 'Krishna Janmabhoomi',
   'Braj pilgrimage hub', 'StayBid-operated heritage stay. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Temple View', 'Temple View', 30000, 12, 16, 'High Occupancy', 'hco-seed-mth',
   'managed', 'active', 3, 'hotel', '{Temple View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[]),

  (md5('cp-hco-seed-vrn')::uuid, 'Vrindavan Temple Residency', 'Vrindavan', 'Uttar Pradesh', 'Banke Bihari Temple Belt',
   'Temple-town devotion', 'StayBid-operated heritage stay. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Temple View', 'Temple View', 30000, 12, 16, 'High Occupancy', 'hco-seed-vrn',
   'managed', 'active', 3, 'hotel', '{Temple View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[]),

  (md5('cp-hco-seed-ayo')::uuid, 'Ayodhya Ram Nagari Stay', 'Ayodhya', 'Uttar Pradesh', 'Ram Mandir Precinct',
   'Ram-nagari devotion', 'StayBid-operated heritage stay. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · Temple View', 'Temple View', 32000, 12, 16, 'High Occupancy', 'hco-seed-ayo',
   'managed', 'active', 3, 'hotel', '{Temple View,Restaurant,Wi-Fi,AC,Rooftop,Heritage}'::text[]),

  (md5('cp-hco-seed-vns')::uuid, 'Kashi Ghatside Varanasi', 'Varanasi', 'Uttar Pradesh', 'Dashashwamedh Ghats',
   'Ganga-ghat spiritual capital', 'StayBid-operated riverside stay. Year-round occupancy.',
   '["https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format"]'::jsonb,
   '2 Room Types · River View', 'River View', 36000, 12, 16, 'High Occupancy', 'hco-seed-vns',
   'managed', 'active', 4, 'hotel', '{River View,Restaurant,Wi-Fi,AC,Ghat Walk,Rooftop}'::text[])
ON CONFLICT (id) DO NOTHING;

-- 4. Circle room types (Model 1) — 2 per property; total_units matches rooms.quantity
INSERT INTO public.circle_room_types
  (id, property_id, name, monthly_rate, total_units, locked_units, active,
   description, images, amenities, capacity, view_label, roi_pct)
VALUES
  (md5('crt-hco-seed-hdw-r1')::uuid, md5('cp-hco-seed-hdw')::uuid, 'Riverside Deluxe', 28000, 8, 0, true, 'Riverside Deluxe with river view.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["River View","Restaurant","Wi-Fi","AC"]'::jsonb, 2, 'River View', 14),
  (md5('crt-hco-seed-hdw-r2')::uuid, md5('cp-hco-seed-hdw')::uuid, 'Ganga Suite', 43400, 5, 0, true, 'Ganga Suite.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["River View","Restaurant","Wi-Fi","AC","Ghat Walk"]'::jsonb, 4, 'River View', 15),
  (md5('crt-hco-seed-bhi-r1')::uuid, md5('cp-hco-seed-bhi')::uuid, 'Lake Deluxe', 32000, 7, 0, true, 'Lake Deluxe with lake view.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["Lake View","Restaurant","Wi-Fi","Heating"]'::jsonb, 2, 'Lake View', 14),
  (md5('crt-hco-seed-bhi-r2')::uuid, md5('cp-hco-seed-bhi')::uuid, 'Lakeview Suite', 49600, 4, 0, true, 'Lakeview Suite.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["Lake View","Restaurant","Wi-Fi","Heating","Boating"]'::jsonb, 4, 'Lake View', 15),
  (md5('crt-hco-seed-muk-r1')::uuid, md5('cp-hco-seed-muk')::uuid, 'Mountain Deluxe', 34000, 7, 0, true, 'Mountain Deluxe with mountain view.', '["https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating"]'::jsonb, 2, 'Mountain View', 14),
  (md5('crt-hco-seed-muk-r2')::uuid, md5('cp-hco-seed-muk')::uuid, 'Summit Suite', 52700, 4, 0, true, 'Summit Suite.', '["https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating","Parking"]'::jsonb, 4, 'Mountain View', 15),
  (md5('crt-hco-seed-ksl-r1')::uuid, md5('cp-hco-seed-ksl')::uuid, 'Mountain Deluxe', 30000, 7, 0, true, 'Mountain Deluxe with mountain view.', '["https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating"]'::jsonb, 2, 'Mountain View', 14),
  (md5('crt-hco-seed-ksl-r2')::uuid, md5('cp-hco-seed-ksl')::uuid, 'Summit Suite', 46500, 4, 0, true, 'Summit Suite.', '["https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating","Parking"]'::jsonb, 4, 'Mountain View', 15),
  (md5('crt-hco-seed-chl-r1')::uuid, md5('cp-hco-seed-chl')::uuid, 'Mountain Deluxe', 34000, 7, 0, true, 'Mountain Deluxe with mountain view.', '["https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating"]'::jsonb, 2, 'Mountain View', 14),
  (md5('crt-hco-seed-chl-r2')::uuid, md5('cp-hco-seed-chl')::uuid, 'Summit Suite', 52700, 4, 0, true, 'Summit Suite.', '["https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating","Parking"]'::jsonb, 4, 'Mountain View', 15),
  (md5('crt-hco-seed-dhr-r1')::uuid, md5('cp-hco-seed-dhr')::uuid, 'Mountain Deluxe', 36000, 8, 0, true, 'Mountain Deluxe with mountain view.', '["https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating"]'::jsonb, 2, 'Mountain View', 14),
  (md5('crt-hco-seed-dhr-r2')::uuid, md5('cp-hco-seed-dhr')::uuid, 'Summit Suite', 55800, 5, 0, true, 'Summit Suite.', '["https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating","Parking"]'::jsonb, 4, 'Mountain View', 15),
  (md5('crt-hco-seed-bir-r1')::uuid, md5('cp-hco-seed-bir')::uuid, 'Mountain Deluxe', 28000, 7, 0, true, 'Mountain Deluxe with mountain view.', '["https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating"]'::jsonb, 2, 'Mountain View', 14),
  (md5('crt-hco-seed-bir-r2')::uuid, md5('cp-hco-seed-bir')::uuid, 'Summit Suite', 43400, 4, 0, true, 'Summit Suite.', '["https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?w=1200&auto=format"]'::jsonb, '["Mountain View","Restaurant","Wi-Fi","Heating","Parking"]'::jsonb, 4, 'Mountain View', 15),
  (md5('crt-hco-seed-nmr-r1')::uuid, md5('cp-hco-seed-nmr')::uuid, 'Fort Deluxe', 48000, 6, 0, true, 'Fort Deluxe with fort view.', '["https://images.unsplash.com/photo-1564540583246-934409427776?w=1200&auto=format"]'::jsonb, '["Fort View","Pool","Restaurant","Wi-Fi"]'::jsonb, 2, 'Fort View', 14),
  (md5('crt-hco-seed-nmr-r2')::uuid, md5('cp-hco-seed-nmr')::uuid, 'Palace Suite', 74400, 4, 0, true, 'Palace Suite.', '["https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&auto=format"]'::jsonb, '["Fort View","Pool","Restaurant","Wi-Fi","AC"]'::jsonb, 4, 'Fort View', 15),
  (md5('crt-hco-seed-mth-r1')::uuid, md5('cp-hco-seed-mth')::uuid, 'Heritage Deluxe', 30000, 8, 0, true, 'Heritage Deluxe with temple view.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["Temple View","Restaurant","Wi-Fi","AC"]'::jsonb, 2, 'Temple View', 14),
  (md5('crt-hco-seed-mth-r2')::uuid, md5('cp-hco-seed-mth')::uuid, 'Temple View Suite', 46500, 5, 0, true, 'Temple View Suite.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["Temple View","Restaurant","Wi-Fi","AC","Rooftop"]'::jsonb, 4, 'Temple View', 15),
  (md5('crt-hco-seed-vrn-r1')::uuid, md5('cp-hco-seed-vrn')::uuid, 'Heritage Deluxe', 30000, 8, 0, true, 'Heritage Deluxe with temple view.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["Temple View","Restaurant","Wi-Fi","AC"]'::jsonb, 2, 'Temple View', 14),
  (md5('crt-hco-seed-vrn-r2')::uuid, md5('cp-hco-seed-vrn')::uuid, 'Temple View Suite', 46500, 5, 0, true, 'Temple View Suite.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["Temple View","Restaurant","Wi-Fi","AC","Rooftop"]'::jsonb, 4, 'Temple View', 15),
  (md5('crt-hco-seed-ayo-r1')::uuid, md5('cp-hco-seed-ayo')::uuid, 'Heritage Deluxe', 32000, 8, 0, true, 'Heritage Deluxe with temple view.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["Temple View","Restaurant","Wi-Fi","AC"]'::jsonb, 2, 'Temple View', 14),
  (md5('crt-hco-seed-ayo-r2')::uuid, md5('cp-hco-seed-ayo')::uuid, 'Temple View Suite', 49600, 5, 0, true, 'Temple View Suite.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["Temple View","Restaurant","Wi-Fi","AC","Rooftop"]'::jsonb, 4, 'Temple View', 15),
  (md5('crt-hco-seed-vns-r1')::uuid, md5('cp-hco-seed-vns')::uuid, 'Riverside Deluxe', 36000, 8, 0, true, 'Riverside Deluxe with river view.', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format"]'::jsonb, '["River View","Restaurant","Wi-Fi","AC"]'::jsonb, 2, 'River View', 14),
  (md5('crt-hco-seed-vns-r2')::uuid, md5('cp-hco-seed-vns')::uuid, 'Ganga Suite', 55800, 5, 0, true, 'Ganga Suite.', '["https://images.unsplash.com/photo-1604014237800-1c9102c219da?w=1200&auto=format"]'::jsonb, '["River View","Restaurant","Wi-Fi","AC","Ghat Walk"]'::jsonb, 4, 'River View', 15)
ON CONFLICT (id) DO NOTHING;

-- 5. Model 3 live auction lots — one live lot per city (Nov 2026 inventory month)
INSERT INTO public.auction_lots
  (id, owner_user_id, hotel_id, room_id, category, city, month_key, month_start, month_end,
   num_rooms, min_bid_per_room_night, purchase_price_per_night, sale_mode, autopilot_mode,
   window_open_at, window_close_at, status, metadata)
VALUES
  ('lot_live_hdw', 'demo_owner_live', 'hco-seed-hdw', 'hco-seed-hdw-r1', 'Riverside Deluxe', 'Haridwar', '2026-11',
   '2026-11-01','2026-12-01', 8, 3000, 2500, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_bhi', 'demo_owner_live', 'hco-seed-bhi', 'hco-seed-bhi-r1', 'Lake Deluxe', 'Bhimtal', '2026-11',
   '2026-11-01','2026-12-01', 7, 3400, 2800, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_muk', 'demo_owner_live', 'hco-seed-muk', 'hco-seed-muk-r1', 'Mountain Deluxe', 'Mukteshwar', '2026-11',
   '2026-11-01','2026-12-01', 7, 3600, 3000, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_ksl', 'demo_owner_live', 'hco-seed-ksl', 'hco-seed-ksl-r1', 'Mountain Deluxe', 'Kasauli', '2026-11',
   '2026-11-01','2026-12-01', 7, 3200, 2700, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_chl', 'demo_owner_live', 'hco-seed-chl', 'hco-seed-chl-r1', 'Mountain Deluxe', 'Chail', '2026-11',
   '2026-11-01','2026-12-01', 7, 3600, 3000, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_dhr', 'demo_owner_live', 'hco-seed-dhr', 'hco-seed-dhr-r1', 'Mountain Deluxe', 'Dharamshala', '2026-11',
   '2026-11-01','2026-12-01', 8, 3800, 3200, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_bir', 'demo_owner_live', 'hco-seed-bir', 'hco-seed-bir-r1', 'Mountain Deluxe', 'Bir Billing', '2026-11',
   '2026-11-01','2026-12-01', 7, 3000, 2500, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_nmr', 'demo_owner_live', 'hco-seed-nmr', 'hco-seed-nmr-r1', 'Fort Deluxe', 'Neemrana', '2026-11',
   '2026-11-01','2026-12-01', 6, 5000, 4200, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_mth', 'demo_owner_live', 'hco-seed-mth', 'hco-seed-mth-r1', 'Heritage Deluxe', 'Mathura', '2026-11',
   '2026-11-01','2026-12-01', 8, 3200, 2700, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_vrn', 'demo_owner_live', 'hco-seed-vrn', 'hco-seed-vrn-r1', 'Heritage Deluxe', 'Vrindavan', '2026-11',
   '2026-11-01','2026-12-01', 8, 3200, 2700, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_ayo', 'demo_owner_live', 'hco-seed-ayo', 'hco-seed-ayo-r1', 'Heritage Deluxe', 'Ayodhya', '2026-11',
   '2026-11-01','2026-12-01', 8, 3400, 2800, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb),

  ('lot_live_vns', 'demo_owner_live', 'hco-seed-vns', 'hco-seed-vns-r1', 'Riverside Deluxe', 'Varanasi', '2026-11',
   '2026-11-01','2026-12-01', 8, 3800, 3200, 'live','hybrid',
   now(),'2026-12-01T00:00:00Z','open',
   '{"owner_kind":"circle_owner","sale_mode":"live","autopilot_mode":"hybrid","demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 6. Model 2 released B2B inventory — one listing per room of the new host_circle hotels
--    (own/night = floor ÷ 2, ask = own × 2; released window Aug 1 – Dec 1). Idempotent.
INSERT INTO b2b_listings
  (id, block_id, seller_user_id, hotel_id, unit_id, room_id, date_from, date_to, nights,
   ask_per_night, ask_total, buy_total, own_per_night, price_multiplier,
   platform_fee_pct, buyer_fee_pct, seller_fee_pct, status, metadata, source, created_at, updated_at)
SELECT
  'b2bl_demo_' || r.id, NULL, 'demo_seller_circle', h.id, NULL, r.id,
  DATE '2026-08-01', DATE '2026-12-01', (DATE '2026-12-01' - DATE '2026-08-01'),
  ROUND(r."floorPrice"),
  ROUND(r."floorPrice") * (DATE '2026-12-01' - DATE '2026-08-01'),
  ROUND(r."floorPrice" / 2.0) * (DATE '2026-12-01' - DATE '2026-08-01'),
  ROUND(r."floorPrice" / 2.0),
  2, 10, 5, 5, 'listed',
  jsonb_build_object(
    'demo', true, 'title', h.name, 'city', h.city, 'room', r.name,
    'room_images', to_jsonb(COALESCE(r.images, ARRAY[]::text[])),
    'prop_images', to_jsonb(COALESCE(h.images, ARRAY[]::text[])),
    'amenities', to_jsonb(COALESCE(r.amenities, ARRAY[]::text[])),
    'capacity', COALESCE(r.capacity, 2), 'star', h."starRating",
    'description', COALESCE(h.description, ''),
    'monthly_rate', ROUND(r."floorPrice" / 2.0) * 30, 'ownPerNight', ROUND(r."floorPrice" / 2.0), 'multiplier', 2,
    'window', true, 'releasedFrom', '2026-08-01', 'releasedTo', '2026-12-01', 'source_seed', 'v551'
  ),
  'hotel_owner', now(), now()
FROM hotels h JOIN rooms r ON r."hotelId" = h.id
WHERE h.id IN ('hco-seed-hdw','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo','hco-seed-vns')
ON CONFLICT (id) DO NOTHING;

-- verify:
--   SELECT id,city,owner_type,approval_status FROM hotels WHERE id IN ('hco-seed-hdw','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo','hco-seed-vns');
--   SELECT "hotelId", count(*) FROM hotel_room_units WHERE "hotelId" IN ('hco-seed-hdw','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo','hco-seed-vns') GROUP BY 1;
--   SELECT city FROM circle_properties WHERE hotel_id IN ('hco-seed-hdw','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo','hco-seed-vns');
--   SELECT city, status FROM auction_lots WHERE hotel_id IN ('hco-seed-hdw','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo','hco-seed-vns');
