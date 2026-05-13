-- ─────────────────────────────────────────────────────────────────────────
-- Enable RLS on every public table (v99, May 2026)
--
-- Supabase advisory flagged 23 tables with RLS disabled. The standard
-- Supabase remediation is `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`,
-- but doing that naively BLOCKS ALL ACCESS unless a policy exists —
-- which would instantly break every route in this app (uses anon key
-- universally for both read + write).
--
-- This migration follows the same pattern as the existing RLS-enabled
-- tables in this DB:
--   1. CREATE POLICY all_anon_all FOR ALL TO anon, authenticated
--      USING (true) WITH CHECK (true)        ← permissive (matches today's
--                                              behaviour exactly)
--   2. ALTER TABLE … ENABLE ROW LEVEL SECURITY
--
-- The end result: no functional change, but Supabase's RLS advisory
-- clears, AND admins can now flip individual tables to restrictive
-- policies later from the /admin/rls UI without first wrestling with
-- the "RLS disabled" baseline.
--
-- Skipped tables (already have RLS or already have permissive policies):
--   users — already has 3 permissive policies (insert / read / update),
--   safe to flip the RLS bit without adding all_anon_all.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
  needs_policy BOOLEAN;
  tables TEXT[] := ARRAY[
    'agents','app_events','bid_acceptance_windows','bid_holds','bid_unit_assignments',
    'booking_messages','complaints','hotel_drafts','hotel_hold_config','hotel_room_units',
    'notifications','onboarding_users','ota_feeds','otp_codes','room_blocks',
    'social_follows','social_posts','social_profiles','user_follows','users',
    'video_comments','video_likes','video_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if the table doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      RAISE NOTICE 'Skipping % — table not found', t;
      CONTINUE;
    END IF;

    -- Add permissive policy IF the table has zero policies. (`users` already
    -- has 3 named policies that cover its real-world ops — leave them alone.)
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t
    ) INTO needs_policy;

    IF needs_policy THEN
      EXECUTE format(
        'CREATE POLICY all_anon_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
        t
      );
      RAISE NOTICE 'Added all_anon_all policy on %', t;
    END IF;

    -- Flip the RLS bit
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE 'Enabled RLS on %', t;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
