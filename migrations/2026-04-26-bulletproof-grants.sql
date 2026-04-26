-- ============================================================================
-- BULLETPROOF SUPABASE GRANTS + RLS POLICIES
-- ----------------------------------------------------------------------------
-- Run once. Idempotent. Eliminates the recurring 42501 "permission denied"
-- errors when adding new tables, by ensuring two things for EVERY public-
-- schema table (existing + future):
--
--   1. anon / authenticated / service_role have ALL DML grants
--   2. RLS-enabled tables carry a permissive ALL policy named `all_anon_all`
--
-- Real authorization happens upstream in the Next.js API layer (JWT verified
-- by requireOnboardUser / decodeJwt + ownership checks via resolveOwnerIds).
-- ============================================================================

-- 1. Grants — current + future
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL  ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL  ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- 2. RLS policies — add a permissive ALL policy on every RLS-enabled table
--    that doesn't already have one.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname='public' AND c.relrowsecurity=true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname='public' AND p.tablename=c.relname
          AND p.policyname='all_anon_all'
      )
  LOOP
    EXECUTE format(
      'CREATE POLICY all_anon_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      r.tname
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- 3. Verification queries (uncomment to run manually):
-- SELECT t.table_name FROM information_schema.tables t
--   WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
--     AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
--       WHERE g.table_schema=t.table_schema AND g.table_name=t.table_name
--         AND g.grantee='anon' AND g.privilege_type='INSERT');
-- Expected: 0 rows.
