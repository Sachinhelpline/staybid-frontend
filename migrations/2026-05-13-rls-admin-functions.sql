-- ─────────────────────────────────────────────────────────────────────────
-- Admin RLS management RPCs (v99 + v100 + v103, May 2026)
--
-- Consolidated CREATE OR REPLACE migration covering every SECURITY DEFINER
-- function used by /admin/rls. Idempotent. Safe to re-run.
--
-- Functions installed:
--   admin_list_rls(secret)                          — v99
--   admin_set_rls(secret, tbl, enable)              — v99
--   admin_add_permissive_policy(secret, tbl)        — v99
--   admin_drop_policy(secret, tbl, policy)          — v99
--   admin_lockdown_table(secret, tbl)               — v100
--   admin_apply_policy_template(secret,tbl,templ,col)— v103
--
-- All four take a shared secret (`STAYBID_RLS_SECRET_v99_change_me` by
-- default; override via SB_RLS_SECRET env var on Vercel) so anyone with
-- just the anon key cannot flip RLS by hammering the RPC endpoint
-- directly. The Next.js admin API layer additionally checks the caller's
-- sb_admin_token role before forwarding the secret.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. admin_list_rls — used by GET /api/admin/rls ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_rls(secret TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected TEXT := 'STAYBID_RLS_SECRET_v99_change_me';
  result JSONB;
BEGIN
  IF secret IS DISTINCT FROM expected THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'table',         c.relname,
    'rls_enabled',   c.relrowsecurity,
    'policy_count',  (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname),
    'policies',      COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'name', p.policyname, 'cmd', p.cmd, 'permissive', p.permissive,
         'roles', p.roles, 'using', p.qual, 'check', p.with_check
       )) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname),
      '[]'::jsonb)
  ) ORDER BY c.relname)
  INTO result
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r';

  RETURN jsonb_build_object('tables', COALESCE(result, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_rls(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_rls(TEXT) TO anon, authenticated;

-- ── 2. admin_set_rls — toggle RLS on/off ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_rls(secret TEXT, tbl TEXT, enable BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected TEXT := 'STAYBID_RLS_SECRET_v99_change_me';
  ok BOOLEAN;
BEGIN
  IF secret IS DISTINCT FROM expected THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
    RETURN jsonb_build_object('error','table not found');
  END IF;
  IF enable THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  ELSE
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
  END IF;
  SELECT c.relrowsecurity INTO ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=tbl;
  RETURN jsonb_build_object('ok', true, 'table', tbl, 'rls_enabled', ok);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_rls(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_rls(TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- ── 3. admin_add_permissive_policy — adds the standard all_anon_all policy ─
CREATE OR REPLACE FUNCTION public.admin_add_permissive_policy(secret TEXT, tbl TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected TEXT := 'STAYBID_RLS_SECRET_v99_change_me';
BEGIN
  IF secret IS DISTINCT FROM expected THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
    RETURN jsonb_build_object('error','table not found');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND policyname='all_anon_all') THEN
    RETURN jsonb_build_object('ok', true, 'note', 'policy already exists');
  END IF;
  EXECUTE format(
    'CREATE POLICY all_anon_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
    tbl
  );
  RETURN jsonb_build_object('ok', true, 'table', tbl, 'policy', 'all_anon_all');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_permissive_policy(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_permissive_policy(TEXT, TEXT) TO anon, authenticated;

-- ── 4. admin_drop_policy — drop a specific policy by name ──────────────
CREATE OR REPLACE FUNCTION public.admin_drop_policy(secret TEXT, tbl TEXT, policy TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected TEXT := 'STAYBID_RLS_SECRET_v99_change_me';
BEGIN
  IF secret IS DISTINCT FROM expected THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND policyname=policy) THEN
    RETURN jsonb_build_object('error','policy not found');
  END IF;
  EXECUTE format('DROP POLICY %I ON public.%I', policy, tbl);
  RETURN jsonb_build_object('ok', true, 'table', tbl, 'dropped', policy);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_drop_policy(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_drop_policy(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 5. admin_lockdown_table (v100) — drops every permissive policy ─────
CREATE OR REPLACE FUNCTION public.admin_lockdown_table(secret TEXT, tbl TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected TEXT := 'STAYBID_RLS_SECRET_v99_change_me';
  r RECORD;
BEGIN
  IF secret IS DISTINCT FROM expected THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
    RETURN jsonb_build_object('error','table not found');
  END IF;
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename=tbl
      AND (roles && ARRAY['anon','authenticated','public']::name[])
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, tbl);
  END LOOP;
  RETURN jsonb_build_object(
    'ok', true,
    'table', tbl,
    'remaining_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=tbl)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_lockdown_table(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_lockdown_table(TEXT, TEXT) TO anon, authenticated;

-- ── 6. admin_apply_policy_template (v103) — 3 pre-baked templates ──────
CREATE OR REPLACE FUNCTION public.admin_apply_policy_template(
  secret  TEXT,
  tbl     TEXT,
  templ   TEXT,
  col     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected TEXT := 'STAYBID_RLS_SECRET_v99_change_me';
  policy_name TEXT;
  sql TEXT;
BEGIN
  IF secret IS DISTINCT FROM expected THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
    RETURN jsonb_build_object('error', 'table not found');
  END IF;

  IF templ = 'deny_anon' THEN
    policy_name := 'deny_anon';
    sql := format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)',
      policy_name, tbl
    );
  ELSIF templ = 'service_role_only' THEN
    DECLARE r RECORD; BEGIN
      FOR r IN
        SELECT policyname FROM pg_policies
        WHERE schemaname='public' AND tablename=tbl
          AND (roles && ARRAY['anon','authenticated','public']::name[])
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, tbl);
      END LOOP;
    END;
    RETURN jsonb_build_object(
      'ok', true,
      'template', 'service_role_only',
      'table', tbl,
      'remaining_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=tbl)
    );
  ELSIF templ = 'owner_only' THEN
    IF col IS NULL OR col = '' THEN
      RETURN jsonb_build_object('error', 'owner_only requires col argument');
    END IF;
    policy_name := format('owner_%s', col);
    sql := format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (%I::TEXT = (current_setting(''request.jwt.claims'', true)::jsonb ->> ''sub''))',
      policy_name, tbl, col
    );
  ELSE
    RETURN jsonb_build_object('error', 'unknown template: ' || templ);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl AND policyname=policy_name
  ) THEN
    RETURN jsonb_build_object('error', 'policy ' || policy_name || ' already exists');
  END IF;

  EXECUTE sql;
  RETURN jsonb_build_object(
    'ok', true,
    'template', templ,
    'table', tbl,
    'policy', policy_name,
    'remaining_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=tbl)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_apply_policy_template(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_policy_template(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
