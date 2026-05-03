-- Enable Supabase Realtime broadcasting on every Session 1-6 table.
-- Browser subscribers receive INSERT/UPDATE/DELETE events over WebSocket
-- with no Railway/Express change. Idempotent — duplicate ALTERs are caught.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'influencers',
    'influencer_commissions',
    'influencer_referral_codes',
    'referral_events',
    'hotel_videos',
    'user_points',
    'points_history',
    'user_saves',
    'notification_queue'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
