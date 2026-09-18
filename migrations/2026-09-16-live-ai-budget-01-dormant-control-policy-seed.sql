-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-BUDGET-01 — DORMANT control/policy seed (UNAPPLIED review artifact)
-- Consolidated remediation 01 — closes Control Room P1-01, P1-02, P1-03.
--
-- ⚠ THIS SEED IS UNAPPLIED. It is NOT run against any database by this packet.
--   It seeds the AI-STAGING Railway PostgreSQL ONLY, under separate explicit
--   owner authorization, via bounded Railway SSH -> in-container psql. It is
--   NOT a Supabase migration and must NEVER be applied to CORE-PROD.
--
-- It inserts EXACTLY THREE rows describing a fully DORMANT, NON-AUTHORIZING
-- control/policy configuration for project `live-ai-03b`:
--   1. global control epoch      (enabled=false, killed=false)
--   2. live-ai-03b project epoch (enabled=false, killed=false)
--   3. live-ai-03b dormant policy version (status=inactive, all ceilings 0)
--
-- No price-catalog row, no session/envelope/reservation/settlement row, no
-- other BUDGET-table DML. No UPDATE / DELETE / TRUNCATE / MERGE / ON CONFLICT.
-- Plain INSERTs fail loudly on any pre-existing conflicting key.
--
-- Integrity model (remediated):
--   BEGIN
--     -> LOCK all 13 BUDGET tables IN SHARE ROW EXCLUSIVE MODE (P1-02)
--     -> complete fail-closed precondition: exactly the 13 expected budget
--        tables exist, none missing, none unexpected, all 13 EMPTY (P1-01)
--     -> exactly three intended INSERT rows
--     -> exact final-state postcondition: 2 control rows + 1 policy row +
--        11 other tables empty = exactly 3 total rows (P1-03)
--   COMMIT
--   Any mismatch RAISEs and rolls the whole transaction back.
--
-- Every timestamp is the ONE frozen UTC literal (2026-09-18T14:11:25Z) — no
-- now()/CURRENT_TIMESTAMP/clock_timestamp() anywhere. Digests are SHA-256 over
-- canonical UTF-8 JSON, computed offline by digest-gen.mjs and reproduced by
-- verify-seed.mjs; embedded here byte-for-byte.
--
-- Frozen schema of record (NOT modified by this seed):
--   migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql
--   git blob 5ddd43861a51c42d62e293216b702453493cd66e
-- Accepted source baseline: Sachinhelpline/staybid-frontend
--   commit 2b69ce28230fc9d56a035846e95d8de206d5db3b
--   tree   87aad22d90f84f2c3b307201c3e0d3b8658b1619
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ── P1-02: concurrent-write protection — lock exactly the 13 BUDGET tables in
--    a deterministic (alphabetical) order, SHARE ROW EXCLUSIVE (reads allowed,
--    concurrent writes blocked) so the precondition -> INSERT -> postcondition
--    invariant holds until COMMIT. No schema/db-wide lock, no advisory lock. ──
LOCK TABLE
  public.budget_control_epochs,
  public.budget_decisions,
  public.budget_envelope_allocations,
  public.budget_envelopes,
  public.budget_execution_consumptions,
  public.budget_policy_versions,
  public.budget_price_catalog_entries,
  public.budget_price_catalog_versions,
  public.budget_provider_reservations,
  public.budget_provider_settlements,
  public.budget_reconciliations,
  public.budget_scope_counters,
  public.budget_sessions
IN SHARE ROW EXCLUSIVE MODE;

-- ── P1-01: complete fail-closed precondition over the whole BUDGET foundation ──
DO $precheck$
DECLARE
  expected text[] := ARRAY[
    'budget_control_epochs','budget_decisions','budget_envelope_allocations','budget_envelopes',
    'budget_execution_consumptions','budget_policy_versions','budget_price_catalog_entries',
    'budget_price_catalog_versions','budget_provider_reservations','budget_provider_settlements',
    'budget_reconciliations','budget_scope_counters','budget_sessions'
  ];
  t text;
  n bigint;
  total_budget int;
  unexpected text;
BEGIN
  -- (A/B) every one of the 13 expected tables exists
  FOREACH t IN ARRAY expected LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_PRECHECK: missing expected budget table %', t;
    END IF;
  END LOOP;

  -- (C) no UNEXPECTED public.budget_% base table
  SELECT string_agg(table_name, ',') INTO unexpected
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     AND table_name LIKE 'budget\_%' ESCAPE '\'
     AND NOT (table_name = ANY(expected));
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_PRECHECK: unexpected budget table(s): %', unexpected;
  END IF;

  -- exact-13 count (belt-and-suspenders against a missing+extra offset)
  SELECT count(*) INTO total_budget
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     AND table_name LIKE 'budget\_%' ESCAPE '\';
  IF total_budget <> 13 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_PRECHECK: expected exactly 13 budget tables, found %', total_budget;
  END IF;

  -- (D) all 13 expected tables must be EMPTY before any seed DML
  FOREACH t IN ARRAY expected LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_PRECHECK: table % must be empty before seed, found % rows', t, n;
    END IF;
  END LOOP;
END
$precheck$;

-- ── row 1: GLOBAL control epoch (dormant, non-authorizing) ──
INSERT INTO public.budget_control_epochs
  (scope_type, scope_key_digest, control_epoch, enabled, killed, updated_at, record_digest)
VALUES
  ('global', 'global', 1, false, false,
   '2026-09-18T14:11:25Z'::timestamptz,
   '26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee');

-- ── row 2: live-ai-03b PROJECT control epoch (dormant, non-authorizing) ──
INSERT INTO public.budget_control_epochs
  (scope_type, scope_key_digest, control_epoch, enabled, killed, updated_at, record_digest)
VALUES
  ('project', 'live-ai-03b', 1, false, false,
   '2026-09-18T14:11:25Z'::timestamptz,
   'be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f');

-- ── row 3: live-ai-03b DORMANT policy version (inactive, all seven ceilings 0) ──
INSERT INTO public.budget_policy_versions
  (id, project_id, status, effective_from, effective_until,
   session_money_ceiling_micros, session_provider_calls, session_execution_admissions,
   subject_day_money_ceiling_micros, project_day_money_ceiling_micros,
   project_month_money_ceiling_micros, global_day_money_ceiling_micros,
   policy_digest, created_at)
VALUES
  ('live-ai-03b-policy-v1-dormant', 'live-ai-03b', 'inactive',
   '2026-09-18T14:11:25Z'::timestamptz, NULL,
   0, 0, 0,
   0, 0,
   0, 0,
   'cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4',
   '2026-09-18T14:11:25Z'::timestamptz);

-- ── P1-03: exact complete final-state postcondition ──
DO $postcheck$
DECLARE
  cnt bigint;
  n bigint;
  total bigint := 0;
  t text;
  other_tables text[] := ARRAY[
    'budget_decisions','budget_envelope_allocations','budget_envelopes',
    'budget_execution_consumptions','budget_price_catalog_entries',
    'budget_price_catalog_versions','budget_provider_reservations',
    'budget_provider_settlements','budget_reconciliations',
    'budget_scope_counters','budget_sessions'
  ];
BEGIN
  -- (A) exactly two control rows, each byte-exact
  SELECT count(*) INTO cnt FROM public.budget_control_epochs;
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: expected exactly 2 control rows, found %', cnt;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_control_epochs
     WHERE scope_type = 'global' AND scope_key_digest = 'global'
       AND control_epoch = 1 AND enabled = false AND killed = false
       AND updated_at = '2026-09-18T14:11:25Z'::timestamptz
       AND record_digest = '26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee'
  ) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: global control row missing/mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_control_epochs
     WHERE scope_type = 'project' AND scope_key_digest = 'live-ai-03b'
       AND control_epoch = 1 AND enabled = false AND killed = false
       AND updated_at = '2026-09-18T14:11:25Z'::timestamptz
       AND record_digest = 'be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f'
  ) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: project control row missing/mismatch';
  END IF;

  -- (B) exactly one policy row, byte-exact, and no wildcard policy
  SELECT count(*) INTO cnt FROM public.budget_policy_versions;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: expected exactly 1 policy row, found %', cnt;
  END IF;

  IF EXISTS (SELECT 1 FROM public.budget_policy_versions WHERE project_id = '*') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: wildcard policy present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_policy_versions
     WHERE id = 'live-ai-03b-policy-v1-dormant'
       AND project_id = 'live-ai-03b'
       AND status = 'inactive'
       AND effective_from = '2026-09-18T14:11:25Z'::timestamptz
       AND effective_until IS NULL
       AND session_money_ceiling_micros = 0
       AND session_provider_calls = 0
       AND session_execution_admissions = 0
       AND subject_day_money_ceiling_micros = 0
       AND project_day_money_ceiling_micros = 0
       AND project_month_money_ceiling_micros = 0
       AND global_day_money_ceiling_micros = 0
       AND policy_digest = 'cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4'
       AND created_at = '2026-09-18T14:11:25Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: dormant policy row missing/mismatch';
  END IF;

  -- (C) the OTHER 11 budget tables must remain exactly empty
  FOREACH t IN ARRAY other_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: table % must remain empty, found % rows', t, n;
    END IF;
  END LOOP;

  -- (D) exactly three total rows across the whole 13-table BUDGET foundation
  SELECT (SELECT count(*) FROM public.budget_control_epochs)
       + (SELECT count(*) FROM public.budget_policy_versions)
    INTO total;
  FOREACH t IN ARRAY other_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    total := total + n;
  END LOOP;
  IF total <> 3 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_SEED_POSTCHECK: expected exactly 3 total budget rows, found %', total;
  END IF;
END
$postcheck$;

COMMIT;
