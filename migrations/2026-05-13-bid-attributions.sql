-- ─────────────────────────────────────────────────────────────────────────
-- Booking-source attribution (v94, May 2026)
--
-- Captures the channel a customer used to reach the booking surface so
-- creators, hotels and admin can all see WHERE each booking came from
-- (direct typing of URL, a creator's reel, a hotel's own reel, the
-- flash-deal rail, etc.).
--
-- Additive only — no existing tables touched. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bid_attributions (
  bid_id            TEXT PRIMARY KEY,                 -- 1:1 with a bid
  customer_id       TEXT,
  hotel_id          TEXT NOT NULL,
  source            TEXT NOT NULL,                    -- 'direct' | 'creator' | 'hotel-feed' | 'flash' | 'unknown'
  creator_id        TEXT,                             -- influencers.id when source='creator' AND registered
  creator_user_id   TEXT,                             -- users.id of the creator (fallback when not yet influencer)
  creator_handle    TEXT,                             -- @display name shown in panels
  creator_type      TEXT,                             -- 'CREATOR' | 'HOTEL' | 'PUBLIC' | NULL
  video_id          TEXT,                             -- social_posts.id (the reel that drove this booking)
  flow              TEXT,                             -- 'book' | 'flash' | 'bid' | 'flash-hold' | 'flash-payhotel'
  deal_id           TEXT,                             -- when source='flash'
  paid_total        NUMERIC(12,2),
  commission_pct    NUMERIC(4,3),
  commission_amount NUMERIC(12,2),
  metadata          JSONB,                            -- referrer URL, UA, etc
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bid_attr_creator       ON public.bid_attributions(creator_id);
CREATE INDEX IF NOT EXISTS idx_bid_attr_creator_user  ON public.bid_attributions(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_bid_attr_hotel         ON public.bid_attributions(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bid_attr_source        ON public.bid_attributions(source);
CREATE INDEX IF NOT EXISTS idx_bid_attr_video         ON public.bid_attributions(video_id);
CREATE INDEX IF NOT EXISTS idx_bid_attr_created_at    ON public.bid_attributions(created_at DESC);

GRANT ALL ON public.bid_attributions TO anon, authenticated, service_role;

ALTER TABLE public.bid_attributions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bid_attributions' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.bid_attributions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
