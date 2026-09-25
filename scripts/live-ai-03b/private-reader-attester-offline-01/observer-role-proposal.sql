-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — INDEPENDENT ATTESTER: LEAST-PRIVILEGE OBSERVER ROLE — REVIEW PROPOSAL
--
-- ⚠ NOT APPLIED — REQUIRES SEPARATE OWNER DATABASE-CHANGE AUTHORIZATION.
--   This file is a reviewed future artifact. The guard below makes it fail immediately if run as-is.
--   It has NOT been executed against AI-STAGING (PG service b7362594-…) or any live database, and must
--   NEVER be applied to CORE-PROD (1fbd7632-… / project 04c8b523-…).
--   The offline test suite applies ONLY the body below (guard stripped) to a THROWAWAY LOCAL PostgreSQL
--   16 cluster, to prove the grants are syntactically valid and sufficient — that is not a live apply.
--
-- WHY EACH GRANT (and why nothing broader):
--   • LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS — an ordinary login role.
--     The attester REFUSES to run as a superuser (evidence-evaluator: observer_is_superuser).
--   • INHERIT — REQUIRED so the pg_read_all_stats membership is actually usable without SET ROLE; the
--     attester checks pg_has_role(current_user,'pg_read_all_stats','USAGE') (usable, not merely member).
--   • pg_read_all_stats — REQUIRED. Verified on real PostgreSQL 16: without it, pg_stat_activity shows the
--     reader's pid/usename/application_name but backend_start is NULL, so the accepted connection token
--     (sha256 over pid, backend_start, application_name) cannot be derived and nothing can be attested.
--     RISK (read visibility): the role can read ALL pg_stat_* statistics views, including other sessions'
--     query text and client addresses. It gains NO table/row data access. The attester only ever runs its
--     fixed registry, which never selects pg_stat_activity.query. pg_monitor is NOT granted (broader:
--     adds pg_read_all_settings + pg_stat_scan_tables).
--   • CONNECT on the target database — to connect. No schema CREATE, no table/sequence/function grants:
--     privilege evaluation uses has_*_privilege() and the system catalogs, readable by any role.
--   • Session defaults (statement_timeout 2s, read-only) — defence in depth; the attester ALSO sets and
--     reads both back on every connection.
--   • CONNECTION LIMIT 3 — one observer connection plus bounded reconnect headroom.
-- NOT granted: superuser, pg_monitor, pg_read_all_data, pg_write_all_data, any application-table
--   SELECT, any membership in the reader/executor/owner roles, any EXECUTE/CREATE authority.
-- Credential: set OUT OF BAND by the Owner; held ONLY by the attester service.
-- Rollback: REVOKE pg_read_all_stats FROM live_ai_03b_attester_observer;
--           REVOKE CONNECT ON DATABASE <db> FROM live_ai_03b_attester_observer;
--           DROP ROLE live_ai_03b_attester_observer;
-- ═════════════════════════════════════════════════════════════════════════

DO $guard$ BEGIN RAISE EXCEPTION 'NOT APPLIED — REQUIRES SEPARATE OWNER DATABASE-CHANGE AUTHORIZATION'; END $guard$;

-- ── BODY (proposal) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ai_03b_attester_observer') THEN
    CREATE ROLE live_ai_03b_attester_observer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
  END IF;
END $$;
GRANT pg_read_all_stats TO live_ai_03b_attester_observer;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO live_ai_03b_attester_observer', current_database()); END $$;
ALTER ROLE live_ai_03b_attester_observer SET statement_timeout = '2s';
ALTER ROLE live_ai_03b_attester_observer SET default_transaction_read_only = on;

-- ── POST-APPLICATION VERIFICATION (read-only; run and review after a separately authorized apply) ──
--   SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolconnlimit
--     FROM pg_roles WHERE rolname = 'live_ai_03b_attester_observer';     -- expect f,t,f,f,f,f,3
--   SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
--     WHERE m.member = 'live_ai_03b_attester_observer'::regrole;          -- expect exactly pg_read_all_stats
--   SELECT has_table_privilege('live_ai_03b_attester_observer', 'public.budget_decisions', 'SELECT'); -- expect f
