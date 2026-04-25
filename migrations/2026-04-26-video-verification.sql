-- Tier-Based Video Proof + Complaint System (mirrors what was applied via Supabase MCP)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'silver';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.vp_videos (
  id TEXT PRIMARY KEY DEFAULT ('vv_' || gen_random_uuid()::text),
  booking_id TEXT NOT NULL, bid_id TEXT,
  hotel_id TEXT NOT NULL, customer_id TEXT NOT NULL, uploader_id TEXT NOT NULL,
  type TEXT NOT NULL, tier TEXT NOT NULL,
  required_secs INT NOT NULL, actual_secs INT,
  storage_path TEXT NOT NULL, url TEXT NOT NULL, thumbnail_url TEXT,
  verification_code TEXT NOT NULL,
  steps_completed JSONB NOT NULL DEFAULT '[]'::jsonb,
  geo JSONB, device_info JSONB,
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vp_requests (
  id TEXT PRIMARY KEY DEFAULT ('vr_' || gen_random_uuid()::text),
  booking_id TEXT NOT NULL, bid_id TEXT,
  hotel_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  tier TEXT NOT NULL, required_secs INT NOT NULL,
  verification_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  hotel_video_id TEXT, customer_video_id TEXT, ai_report_id TEXT,
  due_by TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vp_ai_reports (
  id TEXT PRIMARY KEY DEFAULT ('air_' || gen_random_uuid()::text),
  request_id TEXT NOT NULL, hotel_video_id TEXT, customer_video_id TEXT,
  trust_score INT NOT NULL DEFAULT 0,
  hotel_validity TEXT NOT NULL DEFAULT 'low',
  customer_claim_validity TEXT,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  fraud_flag BOOLEAN NOT NULL DEFAULT FALSE,
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL DEFAULT 'mock', raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vp_complaints (
  id TEXT PRIMARY KEY DEFAULT ('cmp_' || gen_random_uuid()::text),
  booking_id TEXT NOT NULL, bid_id TEXT,
  hotel_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  request_id TEXT, evidence_video_id TEXT,
  category TEXT, description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT, resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

GRANT ALL ON public.vp_videos, public.vp_requests, public.vp_ai_reports, public.vp_complaints
  TO anon, authenticated, service_role;

ALTER TABLE public.vp_videos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_ai_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vp_complaints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vp_videos' AND policyname='vpv_all') THEN
    EXECUTE 'CREATE POLICY vpv_all ON public.vp_videos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vp_requests' AND policyname='vpr_all') THEN
    EXECUTE 'CREATE POLICY vpr_all ON public.vp_requests FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vp_ai_reports' AND policyname='vpa_all') THEN
    EXECUTE 'CREATE POLICY vpa_all ON public.vp_ai_reports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vp_complaints' AND policyname='vpc_all') THEN
    EXECUTE 'CREATE POLICY vpc_all ON public.vp_complaints FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('verification-videos', 'verification-videos', FALSE) ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
