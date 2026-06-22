-- ============================================================================
-- StayBid for Hosts (Hospitality Business OS) — Phase 1 Foundation
-- Applied live via Supabase MCP (migration `host_os_phase1_foundation`).
-- Additive-only, forward-only. TEXT CUID-style PKs, permissive anon RLS
-- (matches project precedent — no FK constraints, PostgREST side-loads).
--
-- 12 new tables across 5 modules:
--   host_leads                                   — landing CTA captures
--   host_design_projects / host_design_options   — AI Setup & Design Studio
--   store_categories / store_products /
--     store_orders / store_order_items            — StayBid Store (Buy/Rent/EMI)
--   discovery_properties / discovery_inquiries    — Smart Property Discovery
--   workforce_workers / workforce_jobs /
--     workforce_reviews                           — Workforce on Demand
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.host_leads (
  id         TEXT PRIMARY KEY DEFAULT ('lead_' || gen_random_uuid()::text),
  user_id    TEXT, name TEXT, phone TEXT, email TEXT, city TEXT,
  interest   TEXT NOT NULL DEFAULT 'general'
             CHECK (interest IN ('list','store','workforce','discovery','studio','channels','general')),
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','closed')),
  metadata   JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_host_leads_status ON public.host_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_host_leads_user   ON public.host_leads (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.host_design_projects (
  id TEXT PRIMARY KEY DEFAULT ('dpr_' || gen_random_uuid()::text),
  user_id TEXT, hotel_id TEXT, title TEXT, room_type TEXT, style TEXT,
  budget_min NUMERIC, budget_max NUMERIC,
  source_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','analyzing','ready','archived')),
  ai_provider TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_design_projects_user  ON public.host_design_projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_projects_hotel ON public.host_design_projects (hotel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.host_design_options (
  id TEXT PRIMARY KEY DEFAULT ('dop_' || gen_random_uuid()::text),
  project_id TEXT NOT NULL, style TEXT, title TEXT, description TEXT,
  render_url TEXT, est_cost NUMERIC,
  products JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_design_options_project ON public.host_design_options (project_id, sort_order);

CREATE TABLE IF NOT EXISTS public.store_categories (
  id TEXT PRIMARY KEY DEFAULT ('scat_' || gen_random_uuid()::text),
  name TEXT NOT NULL, slug TEXT, icon TEXT,
  kind TEXT NOT NULL DEFAULT 'furniture'
       CHECK (kind IN ('furniture','appliance','decor','bedbath','outdoor','lighting','amenity','other')),
  sort_order INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_categories_active ON public.store_categories (active, sort_order);

CREATE TABLE IF NOT EXISTS public.store_products (
  id TEXT PRIMARY KEY DEFAULT ('sto_' || gen_random_uuid()::text),
  category_id TEXT, name TEXT NOT NULL, brand TEXT, description TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb, images JSONB NOT NULL DEFAULT '[]'::jsonb,
  buy_price NUMERIC, rent_monthly NUMERIC,
  emi_available BOOLEAN NOT NULL DEFAULT FALSE, emi_min_months INTEGER,
  rating NUMERIC, reviews_count INTEGER NOT NULL DEFAULT 0,
  in_stock BOOLEAN NOT NULL DEFAULT TRUE, featured BOOLEAN NOT NULL DEFAULT FALSE,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_products_cat    ON public.store_products (category_id, active);
CREATE INDEX IF NOT EXISTS idx_store_products_active ON public.store_products (active, featured, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_orders (
  id TEXT PRIMARY KEY DEFAULT ('sord_' || gen_random_uuid()::text),
  user_id TEXT, hotel_id TEXT,
  mode TEXT NOT NULL DEFAULT 'buy' CHECK (mode IN ('buy','rent','emi')),
  status TEXT NOT NULL DEFAULT 'pending'
         CHECK (status IN ('cart','pending','paid','confirmed','shipped','delivered','cancelled')),
  subtotal NUMERIC NOT NULL DEFAULT 0, delivery_fee NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0, emi_months INTEGER,
  razorpay_order_id TEXT, razorpay_payment_id TEXT,
  address JSONB, contact JSONB, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_orders_user   ON public.store_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_status ON public.store_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_order_items (
  id TEXT PRIMARY KEY DEFAULT ('soit_' || gen_random_uuid()::text),
  order_id TEXT NOT NULL, product_id TEXT, name TEXT, mode TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0, qty INTEGER NOT NULL DEFAULT 1,
  line_total NUMERIC NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON public.store_order_items (order_id);

CREATE TABLE IF NOT EXISTS public.discovery_properties (
  id TEXT PRIMARY KEY DEFAULT ('dprop_' || gen_random_uuid()::text),
  title TEXT NOT NULL, city TEXT, locality TEXT, state TEXT,
  property_type TEXT, bhk TEXT, area_sqft NUMERIC, furnishing TEXT,
  rent_monthly NUMERIC, deposit NUMERIC, score NUMERIC,
  images JSONB NOT NULL DEFAULT '[]'::jsonb, amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner','broker','agent','platform')),
  owner_contact JSONB,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','shortlisted','rented','inactive')),
  featured BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_discovery_props_city   ON public.discovery_properties (city, status);
CREATE INDEX IF NOT EXISTS idx_discovery_props_status ON public.discovery_properties (status, featured, created_at DESC);

CREATE TABLE IF NOT EXISTS public.discovery_inquiries (
  id TEXT PRIMARY KEY DEFAULT ('dinq_' || gen_random_uuid()::text),
  property_id TEXT NOT NULL, user_id TEXT, name TEXT, phone TEXT, message TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','visited','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_discovery_inq_prop ON public.discovery_inquiries (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_inq_user ON public.discovery_inquiries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workforce_workers (
  id TEXT PRIMARY KEY DEFAULT ('wkr_' || gen_random_uuid()::text),
  name TEXT NOT NULL,
  skill TEXT NOT NULL DEFAULT 'housekeeping'
        CHECK (skill IN ('housekeeping','laundry','maintenance','chef','guest_support','transport','other')),
  city TEXT, locality TEXT, rate NUMERIC,
  rate_unit TEXT NOT NULL DEFAULT 'job' CHECK (rate_unit IN ('job','hour','day')),
  rating NUMERIC, jobs_done INTEGER NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT FALSE, background_checked BOOLEAN NOT NULL DEFAULT FALSE,
  available BOOLEAN NOT NULL DEFAULT TRUE, avatar_url TEXT, bio TEXT,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workforce_workers_skill  ON public.workforce_workers (skill, city, available);
CREATE INDEX IF NOT EXISTS idx_workforce_workers_active ON public.workforce_workers (active, rating DESC);

CREATE TABLE IF NOT EXISTS public.workforce_jobs (
  id TEXT PRIMARY KEY DEFAULT ('wjob_' || gen_random_uuid()::text),
  worker_id TEXT, user_id TEXT, hotel_id TEXT, skill TEXT,
  scheduled_at TIMESTAMPTZ, duration_hint TEXT, address JSONB, contact JSONB, amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'requested'
         CHECK (status IN ('requested','accepted','in_progress','completed','cancelled')),
  razorpay_order_id TEXT, razorpay_payment_id TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workforce_jobs_user   ON public.workforce_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workforce_jobs_worker ON public.workforce_jobs (worker_id, status);
CREATE INDEX IF NOT EXISTS idx_workforce_jobs_status ON public.workforce_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workforce_reviews (
  id TEXT PRIMARY KEY DEFAULT ('wrev_' || gen_random_uuid()::text),
  job_id TEXT, worker_id TEXT NOT NULL, user_id TEXT,
  rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  comment TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workforce_reviews_worker ON public.workforce_reviews (worker_id, created_at DESC);

-- RLS: permissive anon policies (project precedent)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'host_leads','host_design_projects','host_design_options',
    'store_categories','store_products','store_orders','store_order_items',
    'discovery_properties','discovery_inquiries',
    'workforce_workers','workforce_jobs','workforce_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
        t || '_all_anon', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
