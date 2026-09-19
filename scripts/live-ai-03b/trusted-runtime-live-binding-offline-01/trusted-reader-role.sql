-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — P1-02 TRUSTED READ-ONLY READER ROLE — REVIEW PROPOSAL (UNAPPLIED)
--
-- ⚠ UNAPPLIED. This SQL is NOT executed by this packet against any database. It is a
--   reviewable least-privilege proposal for a SEPARATE, restricted, read-only trusted
--   reader identity, for future independent review + separately authorized application by
--   the Owner against AI-STAGING PostgreSQL b7362594-a01b-4623-a982-394707a6cec2 ONLY
--   (NEVER CORE-PROD 1fbd7632-...). Apply order + prerequisites are recorded below.
--
-- The reader is NOT postgres, NOT pg_write_all_data, NOT the trusted executor
-- (live_ai_03b_executor), NOT the gateway, NOT the probe operator, NOT a database owner,
-- and holds NO privileged/fallback membership. It has SELECT-only on exactly the objects
-- the four reviewed read queries + the accepted catalog/ledger observations read. It has
-- NO CREATE/INSERT/UPDATE/DELETE/TRUNCATE, NO broad database authority, and NO
-- SECURITY DEFINER execution grant.
--
-- Object identities are recovered from accepted source:
--   migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql (13 budget_% tables)
--   scripts/live-ai-03b/trusted-activation-boundary-01/db/2026-09-19-p1-02-trusted-activation-boundary.sql
--     (trusted schema + approval_consumption ledger — ABSENT until that migration is applied)
--
-- Effective role safety CANNOT be inferred from role names or GRANT text alone — the
-- post-application verification queries (Section V) must be run and reviewed on the live DB.
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
BEGIN;

-- ── I. role identity (LOGIN, least privilege; credential provisioned OUT OF BAND) ──
-- The reader password/credential is set separately by the Owner and stored ISOLATED from
-- the executor, gateway, probe and CORE-PROD credentials. Do NOT set a password literal here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ai_03b_reader') THEN
    CREATE ROLE live_ai_03b_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
-- explicitly NO membership in any privileged role (postgres / pg_write_all_data / fn_owner / executor).
-- (No GRANT <privileged_role> TO live_ai_03b_reader anywhere.)

-- ── II. schema usage (public; trusted schema conditionally when it exists) ──
GRANT USAGE ON SCHEMA public TO live_ai_03b_reader;

-- ── III. SELECT-only object grants (exactly the observed read set) ──
-- policy + control (dormant/armed + ceilings), catalog (dormant/armed catalog):
GRANT SELECT ON
  public.budget_policy_versions,
  public.budget_control_epochs,
  public.budget_price_catalog_versions,
  public.budget_price_catalog_entries
  TO live_ai_03b_reader;
-- zero-exposure accounting tables (count-only observation):
GRANT SELECT ON
  public.budget_envelopes,
  public.budget_provider_reservations,
  public.budget_provider_settlements,
  public.budget_execution_consumptions,
  public.budget_decisions,
  public.budget_reconciliations,
  public.budget_scope_counters,
  public.budget_sessions
  TO live_ai_03b_reader;
-- NO grant on budget_envelope_allocations (not in the reviewed observation set).
-- NO INSERT/UPDATE/DELETE/TRUNCATE grant anywhere; NO GRANT ... ON ALL TABLES (explicit only).

-- ── IV. committed approval-consumption ledger SELECT (Phase-B) — CONDITIONAL/FUTURE ──
-- The trusted schema + ledger are created by the trusted-boundary migration, which is
-- currently UNAPPLIED (preflight: trusted schema / functions / ledger ABSENT). When that
-- migration has been applied, add (in a SEPARATE reviewed step):
--   GRANT USAGE ON SCHEMA live_ai_03b_trusted TO live_ai_03b_reader;
--   GRANT SELECT ON live_ai_03b_trusted.approval_consumption TO live_ai_03b_reader;
-- The reader gets SELECT only — NO INSERT/UPDATE/DELETE on the ledger, and NO EXECUTE on
-- live_ai_03b_trusted.activate_catalog / restore_catalog_inactive (execution is the
-- executor's authority alone). These two statements are intentionally NOT emitted here
-- because the objects do not yet exist; emitting them now would fail closed.

COMMIT;

-- ── V. POST-APPLICATION VERIFICATION (run + review on the live AI-STAGING DB; read-only) ──
-- effective attributes: must be LOGIN, NOT superuser, NOT bypassrls, NOT createrole/createdb.
--   SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
--     FROM pg_roles WHERE rolname='live_ai_03b_reader';
-- no privileged memberships:
--   SELECT r.rolname AS member_of FROM pg_auth_members m
--     JOIN pg_roles r ON r.oid=m.roleid
--     WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_reader');   -- expect ZERO rows
-- effective table privileges are SELECT-only (no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER):
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--     WHERE grantee='live_ai_03b_reader' ORDER BY table_name, privilege_type;
-- no function EXECUTE on the trusted activation functions:
--   SELECT routine_name, privilege_type FROM information_schema.role_routine_grants
--     WHERE grantee='live_ai_03b_reader';   -- expect ZERO rows for activate_catalog/restore_catalog_inactive
-- no write to a canary (must ERROR permission denied when run AS live_ai_03b_reader):
--   INSERT INTO public.budget_decisions (id,acquisition_key,budget_class,gateway_session_digest,project_id,decision,detail)
--     VALUES ('canary','k','EXECUTION_ADMISSION','g','live-ai-03b','REFUSED','canary');  -- MUST be denied

-- ── APPLICATION ORDER + PREREQUISITES (fail-closed) ──
--  1. Apply the accepted foundation migration (13 budget_% tables) — done in AI-STAGING.
--  2. Apply this reader-role proposal (Sections I–III) as the Owner, from a securely linked
--     superuser session against AI-STAGING b7362594-... ONLY.
--  3. Provision the reader LOGIN credential OUT OF BAND, isolated from executor/gateway/probe/CORE.
--  4. Apply the trusted-boundary migration; THEN apply Section IV's two ledger grants (separate step).
--  5. Run Section V verification; a non-SELECT-only or privileged result ⇒ HOLD (do not use the reader).
--  Rollback: REVOKE the grants + DROP ROLE live_ai_03b_reader; (leaves data + other roles untouched).
