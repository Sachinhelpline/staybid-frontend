-- v305 — Property listing enrichment + per-property owner/admin content feed.
-- Applied live to project uxxhbdqedazpmvbvaosh (migration v285_property_enrichment_and_media).
-- Additive only. Existing discovery_properties rows/columns untouched.

-- 1) Listing enrichment: full formatted address + a flexible details bag
--    (floor / facing / availability / lease type / maintenance / landmarks …).
ALTER TABLE public.discovery_properties ADD COLUMN IF NOT EXISTS formatted_address text;
ALTER TABLE public.discovery_properties ADD COLUMN IF NOT EXISTS details jsonb;

-- 2) Per-property content feed (reels + photos). One row per uploaded asset.
--    Only the property OWNER (discovery_properties.submitted_by, resolved across
--    the caller's identities) OR a StayBid ADMIN may write — enforced in the
--    API layer (no FK in this schema — TEXT ids everywhere).
CREATE TABLE IF NOT EXISTS public.property_media (
  id            text PRIMARY KEY,
  property_id   text NOT NULL,
  media_type    text NOT NULL CHECK (media_type IN ('video','photo')),
  media_url     text NOT NULL,
  thumbnail_url text,
  caption       text,
  uploaded_by   text,
  uploaded_role text CHECK (uploaded_role IN ('owner','admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  sort_order    int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_media_prop
  ON public.property_media (property_id, status, sort_order, created_at DESC);

ALTER TABLE public.property_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='property_media'
      AND policyname='property_media_all_anon'
  ) THEN
    CREATE POLICY property_media_all_anon ON public.property_media
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
