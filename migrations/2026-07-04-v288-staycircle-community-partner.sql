-- ============================================================================
-- v288 — StayCircle™ (Community Partner Platform)
-- "Build Wealth with Hospitality — Discover. Lock. Invest. Earn."
--
-- Room-level hospitality investment vertical at /circle:
--   Step 1  Discover Properties  → reel feed of investment properties
--   Step 2  Lock → Choose room types & rooms → Build bundle → Pay plan
--
-- Fully isolated additive surface (same discipline as the /host vertical):
-- no FK from existing tables, no existing flow touched. `hotel_id` is a
-- SOFT link to public.hotels so partner-panel live-fetch can scope
-- investments to owned hotels (no FK constraint — codebase has none).
--
-- Tables:
--   circle_properties   — curated investment properties (admin CRUD)
--   circle_room_types   — per-property room categories + unit inventory
--   circle_locks        — a user "locking" a property from the Discover feed
--   circle_bundles      — the investment bundle (tamper-safe Razorpay chain:
--                         pending_payment → active flipped ONLY by verify)
--   circle_payouts      — monthly return ledger (admin-posted; live ROI feed)
--
-- Applied live to uxxhbdqedazpmvbvaosh on 2026-07-04 via Supabase MCP.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.circle_properties (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  city           TEXT NOT NULL,
  state          TEXT,
  location_label TEXT,
  tagline        TEXT,
  description    TEXT,
  images         JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_url      TEXT,
  rooms_label    TEXT,                          -- "2 Rooms · Mountain View"
  view_label     TEXT,
  monthly_rate   NUMERIC NOT NULL DEFAULT 0,     -- headline ₹ / room / month
  roi_min_pct    NUMERIC NOT NULL DEFAULT 12,
  roi_max_pct    NUMERIC NOT NULL DEFAULT 16,
  occupancy_label TEXT,                          -- "High Occupancy" etc.
  badges         JSONB NOT NULL DEFAULT '[]'::jsonb,
  hotel_id       TEXT,                           -- soft link → public.hotels.id
  operation_model TEXT NOT NULL DEFAULT 'managed'
    CHECK (operation_model IN ('managed','revenue_share','lease','franchise')),
  status         TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','sold_out','coming_soon')),
  sort_order     INTEGER NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.circle_room_types (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    UUID NOT NULL,
  name           TEXT NOT NULL,                  -- Standard / Deluxe / Family Suite
  monthly_rate   NUMERIC NOT NULL DEFAULT 0,     -- ₹ / room / month
  total_units    INTEGER NOT NULL DEFAULT 2 CHECK (total_units >= 0),
  locked_units   INTEGER NOT NULL DEFAULT 0 CHECK (locked_units >= 0),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.circle_locks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  property_id    UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked','released','converted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.circle_bundles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT,
  items                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- items: [{propertyId, propertyTitle, city, roomTypeId, roomTypeName,
  --          monthlyRate, rooms, roiMin, roiMax}]
  payment_plan            TEXT NOT NULL DEFAULT 'monthly'
    CHECK (payment_plan IN ('monthly','quarterly','half_yearly','yearly')),
  monthly_total           NUMERIC NOT NULL DEFAULT 0,
  discount_pct            NUMERIC NOT NULL DEFAULT 0,
  pay_now                 NUMERIC NOT NULL DEFAULT 0,
  expected_monthly_income NUMERIC NOT NULL DEFAULT 0,
  expected_roi_min        NUMERIC NOT NULL DEFAULT 0,
  expected_roi_max        NUMERIC NOT NULL DEFAULT 0,
  payback_label           TEXT,
  breakdown               JSONB,                 -- full engine snapshot at pay time
  contact                 JSONB,                 -- {name, phone, email}
  status                  TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('draft','pending_payment','active','cancelled','completed')),
  razorpay_order_id       TEXT,
  razorpay_payment_id     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.circle_payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id      UUID NOT NULL,
  user_id        TEXT,
  month_label    TEXT NOT NULL,                  -- "Jul 2026"
  amount         NUMERIC NOT NULL DEFAULT 0,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('pending','paid')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_circle_props_status  ON public.circle_properties (status, sort_order);
CREATE INDEX IF NOT EXISTS idx_circle_props_city    ON public.circle_properties (city);
CREATE INDEX IF NOT EXISTS idx_circle_props_hotel   ON public.circle_properties (hotel_id);
CREATE INDEX IF NOT EXISTS idx_circle_rt_property   ON public.circle_room_types (property_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_circle_locks_user    ON public.circle_locks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_circle_locks_prop    ON public.circle_locks (property_id);
-- one ACTIVE lock per (user, property)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_circle_lock_active
  ON public.circle_locks (user_id, property_id) WHERE status = 'locked';
CREATE INDEX IF NOT EXISTS idx_circle_bundles_user  ON public.circle_bundles (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circle_bundles_state ON public.circle_bundles (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circle_payouts_bundle ON public.circle_payouts (bundle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_circle_payouts_user  ON public.circle_payouts (user_id, created_at DESC);

-- RLS (permissive — matches project-wide 2026-05-13-rls-everywhere baseline)
ALTER TABLE public.circle_properties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_room_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_locks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_bundles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_payouts     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_properties' AND policyname='circle_properties_all_anon') THEN
    CREATE POLICY circle_properties_all_anon ON public.circle_properties FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_room_types' AND policyname='circle_room_types_all_anon') THEN
    CREATE POLICY circle_room_types_all_anon ON public.circle_room_types FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_locks' AND policyname='circle_locks_all_anon') THEN
    CREATE POLICY circle_locks_all_anon ON public.circle_locks FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_bundles' AND policyname='circle_bundles_all_anon') THEN
    CREATE POLICY circle_bundles_all_anon ON public.circle_bundles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='circle_payouts' AND policyname='circle_payouts_all_anon') THEN
    CREATE POLICY circle_payouts_all_anon ON public.circle_payouts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- Seed — 8 curated properties (matched to the launch design)
-- Images: curl-verified Unsplash IDs already used elsewhere in this codebase.
-- Videos: Google CDN sample clips (bare URLs — see reel-feed CORS gotcha).
-- ============================================================================
DO $$
DECLARE
  pid UUID;
BEGIN
  IF (SELECT COUNT(*) FROM public.circle_properties) > 0 THEN RETURN; END IF;

  -- 1 · Premium Cottage — Mussoorie
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Premium Cottage','Mussoorie','Uttarakhand','Landour Road, Mussoorie',
     'Colonial-era charm with sweeping Himalayan panoramas.',
     '2 Rooms · Mountain View','Mountain View',30000,15,18,'High Occupancy',
     '["18% ROI","High Occupancy"]',
     '["https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&q=80","https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80","https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',10)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',24000,3,1),(pid,'Deluxe Room',30000,2,2),(pid,'Family Suite',39000,2,3);

  -- 2 · Riverside Retreat — Rishikesh
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Riverside Retreat','Rishikesh','Uttarakhand','Tapovan, Rishikesh',
     'Wake up to the Ganga — yoga capital footfall all year.',
     '3 Rooms · Ganga View','Ganga View',25000,14,16,'High Demand',
     '["16% ROI","High Demand"]',
     '["https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1200&q=80","https://images.unsplash.com/photo-1455587734955-081b22074882?w=1200&q=80","https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',20)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',20000,4,1),(pid,'Deluxe Room',25000,3,2),(pid,'Family Suite',32500,2,3);

  -- 3 · Himalayan Escape — Manali
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Himalayan Escape','Manali','Himachal Pradesh','Old Manali',
     'Snow-view premium cottage in India''s busiest hill circuit.',
     '2 Rooms · Valley View','Valley View',40000,16,19,'Year Round',
     '["19% ROI","Year Round"]',
     '["https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=80","https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&q=80","https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',30)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',32000,2,1),(pid,'Deluxe Room',40000,2,2),(pid,'Family Suite',52000,1,3);

  -- 4 · Skyline Cottage — Bir Billing
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Skyline Cottage','Bir Billing','Himachal Pradesh','Landing Site Road, Bir',
     'Paragliding capital of India — adventure traffic magnet.',
     '2 Rooms · Valley View','Valley View',28000,15,17,'High Season',
     '["17% ROI","High Season"]',
     '["https://images.unsplash.com/photo-1452784444945-3f422708fe5e?w=1200&q=80","https://images.unsplash.com/photo-1503631015414-3527d1e4506f?w=1200&q=80","https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',40)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',22500,3,1),(pid,'Deluxe Room',28000,2,2),(pid,'Family Suite',36500,1,3);

  -- 5 · Pine View Cottage — Dhanaulti
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Pine View Cottage','Dhanaulti','Uttarakhand','Eco Park Road, Dhanaulti',
     'Quiet pines, weekend crowds from Delhi-NCR.',
     '2 Rooms · Forest View','Forest View',22000,13,15,'Peaceful',
     '["15% ROI","Peaceful"]',
     '["https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&q=80","https://images.unsplash.com/photo-1488462237308-ecaa28b729d7?w=1200&q=80","https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',50)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',17500,3,1),(pid,'Deluxe Room',22000,2,2),(pid,'Family Suite',28500,1,3);

  -- 6 · Lake View Cottage — Nainital
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Lake View Cottage','Nainital','Uttarakhand','Ayarpatta, Nainital',
     'Naini lake at your window — evergreen family destination.',
     '3 Rooms · Lake View','Lake View',27000,15,17,'High Demand',
     '["17% ROI","High Demand"]',
     '["https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=80","https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80","https://images.unsplash.com/photo-1545071677-eea2dbb59f57?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',60)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',21500,4,1),(pid,'Deluxe Room',27000,2,2),(pid,'Family Suite',35000,2,3);

  -- 7 · Colonial Heritage — Shimla
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Colonial Heritage','Shimla','Himachal Pradesh','Near Mall Road, Shimla',
     'Heritage architecture steps from Mall Road footfall.',
     '2 Rooms · Mall Road','Mall Road',35000,16,19,'Year Round',
     '["19% ROI","Year Round"]',
     '["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80","https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80","https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',70)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',28000,2,1),(pid,'Deluxe Room',35000,2,2),(pid,'Family Suite',45500,1,3);

  -- 8 · Riverside Bliss — Kasol
  INSERT INTO public.circle_properties
    (title, city, state, location_label, tagline, rooms_label, view_label, monthly_rate,
     roi_min_pct, roi_max_pct, occupancy_label, badges, images, video_url, sort_order)
  VALUES
    ('Riverside Bliss','Kasol','Himachal Pradesh','Parvati Valley, Kasol',
     'Backpacker capital — Parvati river at the doorstep.',
     '2 Rooms · River View','River View',26000,14,16,'High Occupancy',
     '["16% ROI","High Occupancy"]',
     '["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80","https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80","https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=1200&q=80"]',
     'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',80)
  RETURNING id INTO pid;
  INSERT INTO public.circle_room_types (property_id,name,monthly_rate,total_units,sort_order) VALUES
    (pid,'Standard Room',21000,3,1),(pid,'Deluxe Room',26000,2,2),(pid,'Family Suite',34000,1,3);
END $$;
