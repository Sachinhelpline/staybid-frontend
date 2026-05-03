-- Session 2: hotel-uploaded walkthrough videos. Distinct from vp_videos
-- (customer-recorded post-stay proofs). Additive only — TEXT IDs.
CREATE TABLE IF NOT EXISTS public.hotel_videos (
  id                    TEXT PRIMARY KEY DEFAULT ('hv_' || gen_random_uuid()::text),
  hotel_id              TEXT NOT NULL,
  room_id               TEXT,
  room_type             TEXT,
  title                 TEXT,
  s3_url                TEXT NOT NULL,
  thumbnail_url         TEXT,
  duration_seconds      INT,
  quality               TEXT NOT NULL DEFAULT 'sd',
  size_bytes            BIGINT,
  verification_status   TEXT NOT NULL DEFAULT 'pending',
  verified_by           TEXT,
  verified_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  view_count            INT NOT NULL DEFAULT 0,
  uploaded_by           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_videos_hotel  ON public.hotel_videos(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_videos_status ON public.hotel_videos(verification_status);
CREATE INDEX IF NOT EXISTS idx_hotel_videos_room   ON public.hotel_videos(room_id);

GRANT ALL ON public.hotel_videos TO anon, authenticated, service_role;
ALTER TABLE public.hotel_videos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hotel_videos' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.hotel_videos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
