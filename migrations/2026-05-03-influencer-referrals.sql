-- Session 3: bridges influencers ↔ bookings via referral codes + click events.
-- bid_requests.influencer_id (added in Session 1's migration) is the
-- attribution column; this migration only adds new tables.

CREATE TABLE IF NOT EXISTS public.influencer_referral_codes (
  id                  TEXT PRIMARY KEY DEFAULT ('rc_' || gen_random_uuid()::text),
  influencer_id       TEXT NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  code                TEXT NOT NULL UNIQUE,
  hotel_id            TEXT,
  label               TEXT,
  clicks_count        INT NOT NULL DEFAULT 0,
  conversions_count   INT NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rc_influencer ON public.influencer_referral_codes(influencer_id);
CREATE INDEX IF NOT EXISTS idx_rc_hotel      ON public.influencer_referral_codes(hotel_id);

CREATE TABLE IF NOT EXISTS public.referral_events (
  id            TEXT PRIMARY KEY DEFAULT ('re_' || gen_random_uuid()::text),
  code          TEXT NOT NULL,
  influencer_id TEXT,
  event_type    TEXT NOT NULL,
  user_id       TEXT,
  target_type   TEXT,
  target_id     TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_re_code        ON public.referral_events(code);
CREATE INDEX IF NOT EXISTS idx_re_influencer  ON public.referral_events(influencer_id);
CREATE INDEX IF NOT EXISTS idx_re_event_type  ON public.referral_events(event_type);
CREATE INDEX IF NOT EXISTS idx_re_created_at  ON public.referral_events(created_at DESC);

GRANT ALL ON public.influencer_referral_codes, public.referral_events
  TO anon, authenticated, service_role;

ALTER TABLE public.influencer_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_events           ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='influencer_referral_codes' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.influencer_referral_codes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referral_events' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.referral_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
