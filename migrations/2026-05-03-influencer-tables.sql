-- ADDITIVE only. No existing column / table touched. TEXT IDs to match the
-- live schema (users.id is CUID/TEXT, hotels.id is TEXT, bids.id is TEXT).
-- Apply via Supabase SQL editor or MCP.

CREATE TABLE IF NOT EXISTS public.influencers (
  id                      TEXT PRIMARY KEY DEFAULT ('inf_' || gen_random_uuid()::text),
  user_id                 TEXT NOT NULL UNIQUE,
  bio                     TEXT,
  interests               TEXT[] NOT NULL DEFAULT '{}',
  location                TEXT,
  bank_account_number     TEXT,
  bank_name               TEXT,
  ifsc_code               TEXT,
  aadhaar_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  pan_verified            BOOLEAN NOT NULL DEFAULT FALSE,
  agreement_accepted      BOOLEAN NOT NULL DEFAULT FALSE,
  verification_tier       INT NOT NULL DEFAULT 1,
  total_hotels_reviewed   INT NOT NULL DEFAULT 0,
  total_followers         INT NOT NULL DEFAULT 0,
  avg_rating_given        NUMERIC(2,1) NOT NULL DEFAULT 0,
  total_earnings          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'pending',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_influencers_user_id ON public.influencers(user_id);
CREATE INDEX IF NOT EXISTS idx_influencers_status  ON public.influencers(status);

CREATE TABLE IF NOT EXISTS public.influencer_stats (
  id                  TEXT PRIMARY KEY DEFAULT ('ifs_' || gen_random_uuid()::text),
  influencer_id       TEXT NOT NULL UNIQUE REFERENCES public.influencers(id) ON DELETE CASCADE,
  monthly_bookings    INT NOT NULL DEFAULT 0,
  monthly_commission  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_followers     INT NOT NULL DEFAULT 0,
  content_count       INT NOT NULL DEFAULT 0,
  last_updated        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.influencer_commissions (
  id                      TEXT PRIMARY KEY DEFAULT ('ifc_' || gen_random_uuid()::text),
  influencer_id           TEXT NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  booking_id              TEXT,
  bid_id                  TEXT,
  hotel_id                TEXT NOT NULL,
  booking_amount          NUMERIC(10,2) NOT NULL,
  commission_percentage   NUMERIC(4,3) NOT NULL DEFAULT 0.120,
  commission_amount       NUMERIC(10,2) NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inf_comm_influencer ON public.influencer_commissions(influencer_id);
CREATE INDEX IF NOT EXISTS idx_inf_comm_status     ON public.influencer_commissions(status);
CREATE INDEX IF NOT EXISTS idx_inf_comm_hotel      ON public.influencer_commissions(hotel_id);

-- Optional pointer on bid_requests so an influencer can be attributed to a bid.
-- Additive: the column is nullable and existing rows are unaffected.
ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS influencer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bid_requests_influencer ON public.bid_requests(influencer_id);

GRANT ALL ON public.influencers, public.influencer_stats, public.influencer_commissions
  TO anon, authenticated, service_role;

ALTER TABLE public.influencers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_stats       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_commissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='influencers' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.influencers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='influencer_stats' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.influencer_stats FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='influencer_commissions' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.influencer_commissions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
