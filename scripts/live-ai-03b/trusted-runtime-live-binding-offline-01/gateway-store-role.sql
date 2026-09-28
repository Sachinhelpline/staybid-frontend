-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — M6 GATEWAY BUDGET-STORE DB ROLE (B+) — REVIEW ARTIFACT (UNAPPLIED)
--
-- ⚠ UNAPPLIED. NOT executed against any live database by the packet that created it. Owner-applied
--   ONLY, from a securely linked superuser session, against AI-STAGING PostgreSQL
--   b7362594-a01b-4623-a982-394707a6cec2 (database `railway`) — NEVER CORE-PROD 1fbd7632-...
--
-- WHAT IT CREATES (and nothing else):
--   1. role live_ai_03b_gateway_store — LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
--      NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8, with NO password (this file never sets,
--      generates or accepts a credential; the gateway DB credential is a separate, later decision).
--   2. the exact SOURCE-DERIVED privilege matrix of the accepted gateway budget store
--      (server/voice-gateway/live-ai-budget-store.ts + live-ai-staging-main.ts; every one of the 47
--      accepted statements was proven on real PostgreSQL to need — and to succeed with — exactly
--      this matrix; see gateway-store-privilege-matrix.json):
--        SELECT                         budget_policy_versions, budget_price_catalog_versions,
--                                       budget_price_catalog_entries
--        SELECT + UPDATE(record_digest) budget_control_epochs      (row-lock capability ONLY)
--        SELECT + INSERT + UPDATE(id)   budget_sessions            (row-lock capability ONLY)
--        SELECT + INSERT + UPDATE       budget_scope_counters, budget_envelopes,
--                                       budget_provider_reservations
--        SELECT + INSERT                budget_envelope_allocations, budget_provider_settlements,
--                                       budget_execution_consumptions, budget_reconciliations
--        INSERT                         budget_decisions
--      plus CONNECT on database railway and USAGE on schema public. Nothing on the trusted schema /
--      approval ledger / trusted functions, no DELETE/TRUNCATE/REFERENCES/TRIGGER, no sequence,
--      no ALL-TABLES / default / future-object privilege, no membership, no ownership.
--   3. the UPDATE-DENY GUARD: ONE bounded SECURITY INVOKER trigger function (empty search_path, no
--      dynamic SQL, reads/writes no table) and one BEFORE UPDATE FOR EACH STATEMENT trigger, set
--      ENABLE ALWAYS, on each of budget_control_epochs and budget_sessions.
--
-- WHY TWO COLUMN-LEVEL UPDATE GRANTS EXIST: the accepted store takes row locks —
--   `SELECT … FROM budget_control_epochs … FOR SHARE` and `SELECT … FROM budget_sessions … FOR UPDATE` —
--   and PostgreSQL requires UPDATE privilege on at least one column of a table to lock its rows.
--   UPDATE(record_digest) / UPDATE(id) are therefore ROW-LOCK CAPABILITY grants only. They must never
--   become data-mutation authority, so EVERY UPDATE statement (incl. zero-row UPDATE, INSERT … ON
--   CONFLICT DO UPDATE and MERGE … UPDATE, which fire statement-level UPDATE triggers) issued by the
--   gateway-store login/session is rejected by the guard, independently of the column grant. The
--   accepted store issues no UPDATE on either table. The guard returns normally for every other
--   principal (Owner/admin, fn_owner inside the trusted functions, reader), so the accepted control
--   activation / dormant restoration paths are unaffected.
--
-- ENABLE ALWAYS: the triggers fire regardless of session_replication_role. The gateway role cannot
--   change that parameter, cannot ALTER/DROP/DISABLE the triggers (not owner, no TRIGGER privilege),
--   cannot replace the function (not owner, no CREATE on public) — all proven by the postconditions
--   below and by real-PostgreSQL tests.
--
-- IDEMPOTENCE: applies ONLY from the exact ABSENT state (no role, no guard function, no guard
-- triggers) or re-verifies the exact APPLIED state (no-op). Any partial / drifted state RAISEs before
-- any change. One transaction; postconditions re-verified before COMMIT; ON_ERROR_STOP.
-- Rollback (Owner-run, separate) is the exact inverse, only from the exact applied state.
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- ── PRECONDITIONS + state classification (ABSENT → create | APPLIED → verify only | else RAISE) ──
DO $pre$
DECLARE
  n bigint; v_role boolean; v_fn boolean; v_trg bigint; t text;
  budget_tables text[] := ARRAY[
    'budget_policy_versions','budget_control_epochs','budget_price_catalog_versions',
    'budget_price_catalog_entries','budget_sessions','budget_scope_counters','budget_envelopes',
    'budget_envelope_allocations','budget_decisions','budget_provider_reservations',
    'budget_provider_settlements','budget_execution_consumptions','budget_reconciliations'];
BEGIN
  IF current_database() <> 'railway' THEN RAISE EXCEPTION 'gateway-store: wrong database % (expected railway on AI-STAGING)', current_database(); END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'gateway-store: must be applied by the Owner superuser session'; END IF;
  FOREACH t IN ARRAY budget_tables LOOP
    PERFORM 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
      WHERE s.nspname = 'public' AND c.relname = t AND c.relkind = 'r' AND r.rolname = 'postgres';
    IF NOT FOUND THEN RAISE EXCEPTION 'gateway-store: public.% missing / not an ordinary table owned by postgres', t; END IF;
  END LOOP;
  PERFORM 1 FROM pg_attribute WHERE attrelid = 'public.budget_control_epochs'::regclass AND attname = 'record_digest' AND NOT attisdropped;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway-store: budget_control_epochs.record_digest missing'; END IF;
  PERFORM 1 FROM pg_attribute WHERE attrelid = 'public.budget_sessions'::regclass AND attname = 'id' AND NOT attisdropped;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway-store: budget_sessions.id missing'; END IF;
  -- no user rule on any BUDGET table (a rewrite rule could route around a statement trigger)
  SELECT count(*) INTO n FROM pg_rewrite w JOIN pg_class c ON c.oid = w.ev_class JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'public' AND c.relname = ANY (budget_tables);
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: % rewrite rule(s) exist on BUDGET tables — REFUSED', n; END IF;

  v_role := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ai_03b_gateway_store');
  v_fn   := to_regprocedure('public.live_ai_03b_gateway_store_update_guard()') IS NOT NULL
            OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'live_ai_03b_gateway_store_update_guard');
  SELECT count(*) INTO v_trg FROM pg_trigger WHERE tgname = 'live_ai_03b_gateway_store_update_guard';
  IF NOT v_role AND NOT v_fn AND v_trg = 0 THEN
    PERFORM set_config('live_ai_03b.gateway_store_state', 'absent', true);
    RAISE NOTICE 'gateway-store: preconditions OK — state ABSENT, creating';
  ELSIF v_role AND v_fn AND v_trg = 2 THEN
    PERFORM set_config('live_ai_03b.gateway_store_state', 'present', true);
    RAISE NOTICE 'gateway-store: role + guard already present — verifying the exact applied state only (no change)';
  ELSE
    RAISE EXCEPTION 'gateway-store: PARTIAL state (role=% guard_function=% guard_triggers=%) — REFUSED (HOLD for manual review)', v_role, v_fn, v_trg;
  END IF;
END $pre$;

SELECT current_setting('live_ai_03b.gateway_store_state') = 'absent' AS m6_gateway_store_create \gset
\if :m6_gateway_store_create

-- ── 1. role (no password clause: the role is created credentialless) ──
CREATE ROLE live_ai_03b_gateway_store LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;

-- ── 2. database + schema ──
GRANT CONNECT ON DATABASE railway TO live_ai_03b_gateway_store;
GRANT USAGE ON SCHEMA public TO live_ai_03b_gateway_store;

-- ── 3. exact source-derived table matrix (explicit objects only) ──
GRANT SELECT ON public.budget_policy_versions, public.budget_price_catalog_versions, public.budget_price_catalog_entries TO live_ai_03b_gateway_store;
GRANT SELECT ON public.budget_control_epochs TO live_ai_03b_gateway_store;
GRANT UPDATE (record_digest) ON public.budget_control_epochs TO live_ai_03b_gateway_store;   -- row-lock capability only (FOR SHARE)
GRANT SELECT, INSERT ON public.budget_sessions TO live_ai_03b_gateway_store;
GRANT UPDATE (id) ON public.budget_sessions TO live_ai_03b_gateway_store;                    -- row-lock capability only (FOR UPDATE)
GRANT SELECT, INSERT, UPDATE ON public.budget_scope_counters, public.budget_envelopes, public.budget_provider_reservations TO live_ai_03b_gateway_store;
GRANT SELECT, INSERT ON public.budget_envelope_allocations, public.budget_provider_settlements, public.budget_execution_consumptions, public.budget_reconciliations TO live_ai_03b_gateway_store;
GRANT INSERT ON public.budget_decisions TO live_ai_03b_gateway_store;

-- ── 4. UPDATE-deny guard (one function, two ENABLE ALWAYS statement triggers) ──
CREATE FUNCTION public.live_ai_03b_gateway_store_update_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $guard$
BEGIN
  IF session_user = 'live_ai_03b_gateway_store' OR current_user = 'live_ai_03b_gateway_store' THEN
    RAISE EXCEPTION 'live_ai_03b gateway-store UPDATE denied on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END
$guard$;
REVOKE ALL ON FUNCTION public.live_ai_03b_gateway_store_update_guard() FROM PUBLIC;
CREATE TRIGGER live_ai_03b_gateway_store_update_guard BEFORE UPDATE ON public.budget_control_epochs
  FOR EACH STATEMENT EXECUTE FUNCTION public.live_ai_03b_gateway_store_update_guard();
ALTER TABLE public.budget_control_epochs ENABLE ALWAYS TRIGGER live_ai_03b_gateway_store_update_guard;
CREATE TRIGGER live_ai_03b_gateway_store_update_guard BEFORE UPDATE ON public.budget_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.live_ai_03b_gateway_store_update_guard();
ALTER TABLE public.budget_sessions ENABLE ALWAYS TRIGGER live_ai_03b_gateway_store_update_guard;

\endif

-- ── POSTCONDITIONS: the EXACT applied state (runs on create AND on the no-op re-verify path) ──
DO $post$
DECLARE
  v_gw oid; v_fn oid; n bigint; t text; p text; c text; want boolean; got text[];
  budget_tables text[] := ARRAY[
    'budget_policy_versions','budget_control_epochs','budget_price_catalog_versions',
    'budget_price_catalog_entries','budget_sessions','budget_scope_counters','budget_envelopes',
    'budget_envelope_allocations','budget_decisions','budget_provider_reservations',
    'budget_provider_settlements','budget_execution_consumptions','budget_reconciliations'];
  all_privs text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  -- table-level matrix (effective, has_table_privilege): 'table:PRIV'
  matrix text[] := ARRAY[
    'budget_policy_versions:SELECT','budget_price_catalog_versions:SELECT','budget_price_catalog_entries:SELECT',
    'budget_control_epochs:SELECT',
    'budget_sessions:SELECT','budget_sessions:INSERT',
    'budget_scope_counters:SELECT','budget_scope_counters:INSERT','budget_scope_counters:UPDATE',
    'budget_envelopes:SELECT','budget_envelopes:INSERT','budget_envelopes:UPDATE',
    'budget_provider_reservations:SELECT','budget_provider_reservations:INSERT','budget_provider_reservations:UPDATE',
    'budget_envelope_allocations:SELECT','budget_envelope_allocations:INSERT',
    'budget_provider_settlements:SELECT','budget_provider_settlements:INSERT',
    'budget_execution_consumptions:SELECT','budget_execution_consumptions:INSERT',
    'budget_reconciliations:SELECT','budget_reconciliations:INSERT',
    'budget_decisions:INSERT'];
  -- the ONLY column-level grants (row-lock capability): 'table.column:PRIV'
  column_only text[] := ARRAY['budget_control_epochs.record_digest:UPDATE','budget_sessions.id:UPDATE'];
BEGIN
  SELECT oid INTO v_gw FROM pg_roles WHERE rolname = 'live_ai_03b_gateway_store';
  IF v_gw IS NULL THEN RAISE EXCEPTION 'gateway-store: post — role absent'; END IF;
  -- attributes + credentialless
  PERFORM 1 FROM pg_authid WHERE oid = v_gw AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
    AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit = 8 AND rolpassword IS NULL AND rolvaliduntil IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway-store: post — role attributes not exact (LOGIN NOINHERIT unprivileged, CONNECTION LIMIT 8, password NULL)'; END IF;
  SELECT count(*) INTO n FROM pg_auth_members WHERE member = v_gw OR roleid = v_gw;
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — % membership(s)', n; END IF;
  SELECT count(*) INTO n FROM pg_db_role_setting WHERE setrole = v_gw;
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — role settings present'; END IF;
  -- owns nothing, no default privileges, no parameter privileges
  SELECT (SELECT count(*) FROM pg_class WHERE relowner = v_gw) + (SELECT count(*) FROM pg_proc WHERE proowner = v_gw)
       + (SELECT count(*) FROM pg_namespace WHERE nspowner = v_gw) + (SELECT count(*) FROM pg_type WHERE typowner = v_gw)
       + (SELECT count(*) FROM pg_database WHERE datdba = v_gw) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — role owns % object(s)', n; END IF;
  SELECT count(*) INTO n FROM pg_default_acl d WHERE d.defaclrole = v_gw OR EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = v_gw);
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — default privileges involve the role'; END IF;
  SELECT count(*) INTO n FROM pg_parameter_acl pa, aclexplode(pa.paracl) a WHERE a.grantee = v_gw;
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — parameter privileges granted to the role'; END IF;
  IF has_parameter_privilege(v_gw, 'session_replication_role', 'SET') THEN RAISE EXCEPTION 'gateway-store: post — role can SET session_replication_role'; END IF;
  -- database: explicit grant = exactly CONNECT; no CREATE
  SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) INTO got FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = current_database() AND a.grantee = v_gw;
  IF got IS DISTINCT FROM ARRAY['CONNECT']::text[] THEN RAISE EXCEPTION 'gateway-store: post — explicit database grant is not exactly CONNECT (%)', got; END IF;
  IF has_database_privilege(v_gw, current_database(), 'CREATE') THEN RAISE EXCEPTION 'gateway-store: post — database CREATE'; END IF;
  -- schemas: public USAGE yes / CREATE no; trusted schema nothing; no other schema grant
  IF NOT has_schema_privilege(v_gw, 'public', 'USAGE') OR has_schema_privilege(v_gw, 'public', 'CREATE') THEN RAISE EXCEPTION 'gateway-store: post — public schema privilege not exactly USAGE'; END IF;
  IF to_regnamespace('live_ai_03b_trusted') IS NOT NULL AND (has_schema_privilege(v_gw, 'live_ai_03b_trusted', 'USAGE') OR has_schema_privilege(v_gw, 'live_ai_03b_trusted', 'CREATE')) THEN
    RAISE EXCEPTION 'gateway-store: post — trusted-schema access'; END IF;
  IF to_regprocedure('live_ai_03b_trusted.activate_catalog(jsonb,text)') IS NOT NULL AND has_function_privilege(v_gw, 'live_ai_03b_trusted.activate_catalog(jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'gateway-store: post — activate_catalog EXECUTE'; END IF;
  IF to_regprocedure('live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)') IS NOT NULL AND has_function_privilege(v_gw, 'live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'gateway-store: post — restore_catalog_inactive EXECUTE'; END IF;
  SELECT count(*) INTO n FROM pg_namespace s, aclexplode(s.nspacl) a WHERE a.grantee = v_gw AND NOT (s.nspname = 'public' AND a.privilege_type = 'USAGE');
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — % unexpected schema grant(s)', n; END IF;
  -- table-level matrix EXACT (effective) on all 13 tables × 7 privileges
  FOREACH t IN ARRAY budget_tables LOOP
    FOREACH p IN ARRAY all_privs LOOP
      want := (t || ':' || p) = ANY (matrix);
      IF has_table_privilege(v_gw, 'public.' || t, p) IS DISTINCT FROM want THEN
        RAISE EXCEPTION 'gateway-store: post — table privilege %.% is % (expected %)', t, p, NOT want, want; END IF;
    END LOOP;
  END LOOP;
  -- explicit relation grants: exactly the matrix, on exactly the 13 tables, nothing on any other relation (incl. sequences)
  SELECT count(*) INTO n FROM pg_class c, aclexplode(c.relacl) a WHERE a.grantee = v_gw;
  IF n <> array_length(matrix, 1) THEN RAISE EXCEPTION 'gateway-store: post — % explicit relation grant(s) (expected %)', n, array_length(matrix, 1); END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace, aclexplode(c.relacl) a
    WHERE a.grantee = v_gw AND NOT (s.nspname = 'public' AND (c.relname || ':' || a.privilege_type) = ANY (matrix));
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — explicit grant outside the matrix'; END IF;
  SELECT count(*) INTO n FROM pg_class c, aclexplode(c.relacl) a WHERE a.grantee = v_gw AND a.is_grantable;
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — grantable (WITH GRANT OPTION) privilege'; END IF;
  -- column-level: exactly the two row-lock capability grants; table-level UPDATE absent on those tables
  SELECT count(*) INTO n FROM pg_attribute at JOIN pg_class c ON c.oid = at.attrelid, aclexplode(at.attacl) a WHERE a.grantee = v_gw;
  IF n <> 2 THEN RAISE EXCEPTION 'gateway-store: post — % explicit column grant(s) (expected exactly 2)', n; END IF;
  FOREACH t IN ARRAY budget_tables LOOP
    FOR c IN SELECT attname::text FROM pg_attribute WHERE attrelid = ('public.' || t)::regclass AND attnum > 0 AND NOT attisdropped LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        want := has_table_privilege(v_gw, 'public.' || t, p) OR (t || '.' || c || ':' || p) = ANY (column_only);
        IF has_column_privilege(v_gw, 'public.' || t, c, p) IS DISTINCT FROM want THEN
          RAISE EXCEPTION 'gateway-store: post — column privilege %.%:% is % (expected %)', t, c, p, NOT want, want; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF has_table_privilege(v_gw, 'public.budget_control_epochs', 'UPDATE') OR has_table_privilege(v_gw, 'public.budget_sessions', 'UPDATE') THEN
    RAISE EXCEPTION 'gateway-store: post — table-level UPDATE on a guarded table'; END IF;
  -- no routine / large-object / foreign grants
  SELECT count(*) INTO n FROM pg_proc pr, aclexplode(pr.proacl) a WHERE a.grantee = v_gw;
  IF n <> 0 THEN RAISE EXCEPTION 'gateway-store: post — routine grant(s) to the role'; END IF;
  -- guard function: exact identity / shape / body / privileges
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'live_ai_03b_gateway_store_update_guard';
  IF n <> 1 THEN RAISE EXCEPTION 'gateway-store: post — % guard function(s)', n; END IF;
  v_fn := to_regprocedure('public.live_ai_03b_gateway_store_update_guard()');
  PERFORM 1 FROM pg_proc pr JOIN pg_roles r ON r.oid = pr.proowner JOIN pg_language l ON l.oid = pr.prolang
    WHERE pr.oid = v_fn AND r.rolname = 'postgres' AND l.lanname = 'plpgsql' AND pr.prorettype = 'trigger'::regtype
      AND pr.pronargs = 0 AND NOT pr.prosecdef AND pr.prokind = 'f' AND NOT pr.proleakproof
      AND pr.proconfig = ARRAY['search_path=""']::text[] AND md5(pr.prosrc) = '94f0da6752ffec40b05d63a0e396231f';
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway-store: post — guard function not exact (owner/language/SECURITY INVOKER/search_path/body)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pr, aclexplode(pr.proacl) a WHERE pr.oid = v_fn AND a.grantee = 0) OR (SELECT proacl IS NULL FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'gateway-store: post — PUBLIC can EXECUTE the guard function'; END IF;
  IF has_function_privilege(v_gw, v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'gateway-store: post — gateway role holds EXECUTE on the guard'; END IF;
  -- guard triggers: exactly one per guarded table; BEFORE UPDATE FOR EACH STATEMENT (tgtype 18); ENABLE ALWAYS;
  -- no column list, no WHEN, no arguments; no other user trigger on either table; no trigger anywhere else
  SELECT count(*) INTO n FROM pg_trigger WHERE tgname = 'live_ai_03b_gateway_store_update_guard';
  IF n <> 2 THEN RAISE EXCEPTION 'gateway-store: post — % guard trigger(s) (expected 2)', n; END IF;
  FOREACH t IN ARRAY ARRAY['budget_control_epochs','budget_sessions'] LOOP
    PERFORM 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND tgname = 'live_ai_03b_gateway_store_update_guard'
      AND tgfoid = v_fn AND tgtype = 18 AND tgenabled = 'A' AND NOT tgisinternal AND tgnargs = 0
      AND tgqual IS NULL AND COALESCE(array_length(tgattr::int2[], 1), 0) = 0 AND tgconstraint = 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'gateway-store: post — guard trigger on % not exact (BEFORE UPDATE / STATEMENT / ENABLE ALWAYS)', t; END IF;
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND NOT tgisinternal;
    IF n <> 1 THEN RAISE EXCEPTION 'gateway-store: post — % user trigger(s) on % (expected exactly the guard)', n, t; END IF;
  END LOOP;
  -- the role can neither own/alter the guarded tables nor the guard: not owner, no TRIGGER, not a member of the owner
  IF pg_has_role(v_gw, 'postgres', 'MEMBER') THEN RAISE EXCEPTION 'gateway-store: post — role is a member of postgres'; END IF;
  RAISE NOTICE 'gateway-store: postconditions OK — role exact (password NULL), matrix exact (2 row-lock column grants), guard exact (2 ENABLE ALWAYS statement triggers)';
END $post$;

COMMIT;
SELECT 'M6_GATEWAY_STORE_END';

-- ── APPLICATION ORDER (fail-closed) ──
--  1. Accepted trusted-boundary migration + accepted deferred ledger-read grant applied and verified.
--  2. Apply THIS file as the Owner superuser against AI-STAGING `railway` ONLY.
--  3. Do NOT set a password: the role stays credentialless until the gateway DB-credential decision
--     (M7); no gateway DSN is provisioned; the gateway is not configured or deployed.
--  Rollback (exact inverse, only from the exact applied state; refuses on any session/credential/
--  exposure/drift): DROP both guard triggers, DROP the guard function, REVOKE the grants, DROP ROLE.
