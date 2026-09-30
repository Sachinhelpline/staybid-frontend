-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER: DISTINCT LEAST-PRIVILEGE OBSERVER ROLE — REVIEW PROPOSAL
--
-- ⚠ NOT APPLIED — REQUIRES SEPARATE OWNER DATABASE-CHANGE AUTHORIZATION.
--   The guard below makes this file fail immediately if run as-is. It has NOT been executed against AI-STAGING
--   (PG service b7362594-…) or any live database, and must NEVER be applied to CORE-PROD (1fbd7632-… / 04c8b523-…).
--   The offline suite applies ONLY the body (guard stripped) to a THROWAWAY LOCAL PostgreSQL cluster built from the
--   accepted post-Step-1 migrations, to prove the grants are valid and SUFFICIENT — that is not a live apply.
--
-- CAPABILITY — IDENTICAL to the accepted reader-attester observer (private-reader-attester-offline-01/
-- observer-role-proposal.sql); NO new privilege class is introduced:
--   • LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS, CONNECTION LIMIT 3;
--   • pg_read_all_stats — REQUIRED: without it pg_stat_activity.backend_start of the executor's session is NULL and
--     the accepted connection token (sha256 over pid, backend_start, application_name) cannot be re-derived;
--   • CONNECT on the target database. Everything else is measured through has_*_privilege() + system catalogs,
--     which any role may read. NO table/sequence/function/schema grant, NO membership in the executor, reader,
--     owner or gateway roles, NO pg_monitor / pg_read_all_data.
--   • session defaults (statement_timeout 2s, read-only) — defence in depth; the issuer also SETs and reads both back.
--
-- WHY A DISTINCT ROLE (preferred) rather than the shared reader-attester observer (a documented future option only):
--   separate credential custody per authority plane, so revoking/rotating one attester never affects the other. The
--   shared role is technically sufficient (the offline suite proves both measure the accepted state CLEAN) and its
--   effective authority would NOT widen — but sharing a credential couples two independent authority planes.
-- The issuer REFUSES to run as: a superuser, the executor, the reader, a member of the executor/reader, or with any
-- membership other than exactly pg_read_all_stats.
-- Rollback: REVOKE pg_read_all_stats FROM live_ai_03b_executor_attester_observer;
--           REVOKE CONNECT ON DATABASE <db> FROM live_ai_03b_executor_attester_observer;
--           DROP ROLE live_ai_03b_executor_attester_observer;
-- ═════════════════════════════════════════════════════════════════════════

DO $guard$ BEGIN RAISE EXCEPTION 'NOT APPLIED — REQUIRES SEPARATE OWNER DATABASE-CHANGE AUTHORIZATION'; END $guard$;

-- ── BODY (proposal) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ai_03b_executor_attester_observer') THEN
    CREATE ROLE live_ai_03b_executor_attester_observer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
  END IF;
END $$;
GRANT pg_read_all_stats TO live_ai_03b_executor_attester_observer;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO live_ai_03b_executor_attester_observer', current_database()); END $$;
ALTER ROLE live_ai_03b_executor_attester_observer SET statement_timeout = '2s';
ALTER ROLE live_ai_03b_executor_attester_observer SET default_transaction_read_only = on;

-- ── POST-APPLICATION VERIFICATION (read-only; after a separately authorized apply) ──
--   SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolconnlimit
--     FROM pg_roles WHERE rolname = 'live_ai_03b_executor_attester_observer';   -- expect f,t,f,f,f,f,3
--   SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
--     WHERE m.member = 'live_ai_03b_executor_attester_observer'::regrole;       -- expect exactly pg_read_all_stats
