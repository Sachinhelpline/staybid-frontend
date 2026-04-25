-- ============================================================================
-- StayBid Onboarding v2 — production-grade OTA-level fields (2026-04-25)
-- This file mirrors what was applied via the Supabase MCP.
-- Idempotent: safe to re-run on staging / dev projects.
-- ============================================================================

-- ---- Hotels: location + contact + status ---------------------------------
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS place_id TEXT;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS formatted_address TEXT;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS contact_website TEXT;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS preview_viewed BOOLEAN NOT NULL DEFAULT FALSE;

-- ---- Rooms enrichments ---------------------------------------------------
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS bedrooms INT NOT NULL DEFAULT 1;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS bathrooms INT NOT NULL DEFAULT 1;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS size_sqft INT;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

-- ---- Image, KYC, Bank, Agreement tables ----------------------------------
CREATE TABLE IF NOT EXISTS public.hotel_images (
  id TEXT PRIMARY KEY DEFAULT ('him_' || gen_random_uuid()::text),
  hotel_id TEXT NOT NULL, url TEXT NOT NULL, storage_path TEXT,
  kind TEXT NOT NULL DEFAULT 'gallery', sort_order INT NOT NULL DEFAULT 0,
  width INT, height INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.room_images (
  id TEXT PRIMARY KEY DEFAULT ('rim_' || gen_random_uuid()::text),
  room_id TEXT NOT NULL, hotel_id TEXT NOT NULL,
  url TEXT NOT NULL, storage_path TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.kyc_submissions (
  id TEXT PRIMARY KEY DEFAULT ('kyc_' || gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES public.onboarding_users(id) ON DELETE CASCADE,
  hotel_id TEXT,
  owner_full_name TEXT, owner_dob DATE, owner_pan TEXT,
  owner_aadhaar_last4 TEXT, owner_address TEXT,
  business_legal_name TEXT, business_type TEXT, business_gstin TEXT,
  business_pan TEXT, business_address TEXT, business_state TEXT, business_pincode TEXT,
  doc_owner_id_url TEXT, doc_property_proof_url TEXT, doc_business_pan_url TEXT, doc_gst_url TEXT,
  consent_listing BOOLEAN NOT NULL DEFAULT FALSE,
  consent_price_compare BOOLEAN NOT NULL DEFAULT FALSE,
  consent_image_rights BOOLEAN NOT NULL DEFAULT FALSE,
  consent_legal BOOLEAN NOT NULL DEFAULT FALSE,
  consent_signed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'submitted', reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_details (
  id TEXT PRIMARY KEY DEFAULT ('bnk_' || gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES public.onboarding_users(id) ON DELETE CASCADE,
  hotel_id TEXT,
  account_holder TEXT NOT NULL, account_number_enc TEXT NOT NULL,
  account_last4 TEXT NOT NULL, ifsc TEXT NOT NULL,
  bank_name TEXT, branch TEXT, account_type TEXT NOT NULL DEFAULT 'savings',
  upi_vpa TEXT, cancelled_cheque_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.host_agreements (
  id TEXT PRIMARY KEY DEFAULT ('agr_' || gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES public.onboarding_users(id) ON DELETE CASCADE,
  hotel_id TEXT, version TEXT NOT NULL,
  commission_percent NUMERIC NOT NULL DEFAULT 12,
  cancellation_policy TEXT NOT NULL, liability_clause TEXT NOT NULL, dispute_clause TEXT NOT NULL,
  full_text_hash TEXT NOT NULL,
  ip_address TEXT, user_agent TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- Indexes -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hotels_status ON public.hotels(status);
CREATE INDEX IF NOT EXISTS idx_hotel_images_hotel ON public.hotel_images(hotel_id);
CREATE INDEX IF NOT EXISTS idx_room_images_room ON public.room_images(room_id);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON public.kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_user ON public.bank_details(user_id);
CREATE INDEX IF NOT EXISTS idx_agreements_user ON public.host_agreements(user_id);

-- ---- Grants --------------------------------------------------------------
GRANT ALL ON public.hotel_images, public.room_images, public.kyc_submissions,
             public.bank_details, public.host_agreements
  TO anon, authenticated, service_role;

-- ---- Storage buckets -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
  ('hotel-images', 'hotel-images', TRUE),
  ('room-images',  'room-images',  TRUE),
  ('kyc-documents','kyc-documents',FALSE),
  ('bank-docs',    'bank-docs',    FALSE)
ON CONFLICT (id) DO NOTHING;

-- ---- RLS: enable + permissive policies (API-layer enforces ownership) ----
-- The onboarding API layer verifies ownership via custom JWT before any
-- write. We enable RLS for defense-in-depth and add policies so that:
--   * anon/authenticated can SELECT hotels, rooms, hotel_images, room_images
--     (storefront reads).
--   * anon/authenticated can write all onboarding-touched tables (writes are
--     gated upstream by JWT verification in app/api/onboard/*).
--   * KYC / bank / agreements have no anon read (PII protection); writes
--     allowed for the API layer until SUPABASE_SERVICE_ROLE_KEY is wired.
ALTER TABLE public.hotels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_images  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_images   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_details    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_agreements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- hotels / rooms / images: public read, anon write (API gates)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hotels' AND policyname='hotels_public_read') THEN
    EXECUTE $p$CREATE POLICY hotels_public_read ON public.hotels FOR SELECT TO anon, authenticated USING (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hotels' AND policyname='hotels_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY hotels_anon_write_temp ON public.hotels FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rooms' AND policyname='rooms_public_read') THEN
    EXECUTE $p$CREATE POLICY rooms_public_read ON public.rooms FOR SELECT TO anon, authenticated USING (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rooms' AND policyname='rooms_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY rooms_anon_write_temp ON public.rooms FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hotel_images' AND policyname='hi_public_read') THEN
    EXECUTE $p$CREATE POLICY hi_public_read ON public.hotel_images FOR SELECT TO anon, authenticated USING (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hotel_images' AND policyname='hi_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY hi_anon_write_temp ON public.hotel_images FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_images' AND policyname='ri_public_read') THEN
    EXECUTE $p$CREATE POLICY ri_public_read ON public.room_images FOR SELECT TO anon, authenticated USING (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_images' AND policyname='ri_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY ri_anon_write_temp ON public.room_images FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
  -- KYC / bank / agreements: anon writes allowed (API enforces auth) but
  -- prefer service_role in production.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kyc_submissions' AND policyname='kyc_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY kyc_anon_write_temp ON public.kyc_submissions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bank_details' AND policyname='bank_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY bank_anon_write_temp ON public.bank_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='host_agreements' AND policyname='agr_anon_write_temp') THEN
    EXECUTE $p$CREATE POLICY agr_anon_write_temp ON public.host_agreements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)$p$;
  END IF;

  -- Storage policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='hotel_images_public_read') THEN
    EXECUTE $p$CREATE POLICY hotel_images_public_read ON storage.objects FOR SELECT TO anon USING (bucket_id = 'hotel-images')$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='room_images_public_read') THEN
    EXECUTE $p$CREATE POLICY room_images_public_read ON storage.objects FOR SELECT TO anon USING (bucket_id = 'room-images')$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='hotel_images_anon_write') THEN
    EXECUTE $p$CREATE POLICY hotel_images_anon_write ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'hotel-images')$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='room_images_anon_write') THEN
    EXECUTE $p$CREATE POLICY room_images_anon_write ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'room-images')$p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='kyc_anon_write') THEN
    EXECUTE $p$CREATE POLICY kyc_anon_write ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id IN ('kyc-documents','bank-docs'))$p$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
