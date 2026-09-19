-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-BUDGET-01 — INACTIVE price-catalog seed (UNAPPLIED review artifact)
--
-- ⚠ THIS SEED IS UNAPPLIED and INACTIVE. It is NOT run against any database by
--   this packet. It seeds the AI-STAGING Railway PostgreSQL ONLY, under separate
--   explicit owner authorization, via bounded Railway SSH -> in-container psql.
--   NOT a Supabase migration; must NEVER touch CORE-PROD.
--
-- Inserts EXACTLY one INACTIVE price-catalog version + two INACTIVE entries for
-- the first controlled 03B text probe intent (direct OpenAI / Standard / non-
-- regional / short-context), currency USD, model gpt-5.6-terra:
--   version: openai-gpt-5-6-terra-standard-short-v1 (status=inactive)
--   entry 1: reasoning_input_token  — unit_size 1000000, rate_micros 2000000
--   entry 2: reasoning_output_token — unit_size 1000000, rate_micros 12000000
-- NO cached-input / cache-write / STT / TTS / audio / wildcard / alternate
-- provider|model|tier|dimension / long-context / regional / Batch / Flex / Fast.
--
-- Activates NOTHING: the catalog version + entries are status='inactive'; the
-- dormant control epochs + policy remain untouched and non-authorizing.
--
-- Integrity: BEGIN -> LOCK the 13 BUDGET tables SHARE ROW EXCLUSIVE -> complete
-- fail-closed precondition (13-table foundation intact; exactly the 3 accepted
-- dormant rows present; both catalog tables empty; nothing active) -> insert 1
-- version + 2 entries -> exact postcondition (3 -> 6 total rows; catalog inactive;
-- no wildcard/alternate; controls+policy preserved) -> COMMIT. Any mismatch
-- RAISEs and rolls back.
--
-- Every timestamp is a frozen UTC literal (T0=2026-09-18T18:37:35Z,
-- verification_expires_at=2026-09-25T18:37:35Z) — no now()/CURRENT_TIMESTAMP/
-- clock_timestamp(). Digests are SHA-256 over canonical UTF-8 JSON, produced by
-- scripts/live-ai-budget-01/price-catalog-digest-gen.mjs and reproduced by
-- scripts/live-ai-budget-01/verify-price-catalog-seed.mjs.
--   source_digest  = fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3
--   catalog_digest = 453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973
--
-- Frozen predecessors (NOT modified): dpbel-foundation schema (blob
-- 5ddd43861a51c42d62e293216b702453493cd66e) + dormant control/policy seed (blob
-- e58b2e9706cfae207969817c9a856ce55e8e5cb1). Baseline commit
-- 2b69ce28230fc9d56a035846e95d8de206d5db3b.
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

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

-- ── precondition: full BUDGET foundation + exact dormant state; catalog empty ──
DO $precheck$
DECLARE
  expected text[] := ARRAY[
    'budget_control_epochs','budget_decisions','budget_envelope_allocations','budget_envelopes',
    'budget_execution_consumptions','budget_policy_versions','budget_price_catalog_entries',
    'budget_price_catalog_versions','budget_provider_reservations','budget_provider_settlements',
    'budget_reconciliations','budget_scope_counters','budget_sessions'
  ];
  zero_tables text[] := ARRAY[
    'budget_decisions','budget_envelope_allocations','budget_envelopes',
    'budget_execution_consumptions','budget_provider_reservations','budget_provider_settlements',
    'budget_reconciliations','budget_scope_counters','budget_sessions'
  ];
  t text; n bigint; total_budget int; unexpected text; total bigint := 0;
BEGIN
  FOREACH t IN ARRAY expected LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: missing expected budget table %', t;
    END IF;
  END LOOP;
  SELECT string_agg(table_name, ',') INTO unexpected
    FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'
     AND table_name LIKE 'budget\_%' ESCAPE '\' AND NOT (table_name = ANY(expected));
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: unexpected budget table(s): %', unexpected;
  END IF;
  SELECT count(*) INTO total_budget FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE 'budget\_%' ESCAPE '\';
  IF total_budget <> 13 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: expected exactly 13 budget tables, found %', total_budget;
  END IF;

  -- exact dormant control epochs (2 rows, byte-exact)
  IF (SELECT count(*) FROM public.budget_control_epochs) <> 2 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: control epochs must be exactly 2';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_control_epochs
     WHERE scope_type='global' AND scope_key_digest='global' AND control_epoch=1
       AND enabled=false AND killed=false AND updated_at='2026-09-18T14:11:25Z'::timestamptz
       AND record_digest='26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: global dormant control row missing/mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_control_epochs
     WHERE scope_type='project' AND scope_key_digest='live-ai-03b' AND control_epoch=1
       AND enabled=false AND killed=false AND updated_at='2026-09-18T14:11:25Z'::timestamptz
       AND record_digest='be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: project dormant control row missing/mismatch';
  END IF;

  -- exact dormant policy (1 row, byte-exact)
  IF (SELECT count(*) FROM public.budget_policy_versions) <> 1 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: policy versions must be exactly 1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_policy_versions
     WHERE id='live-ai-03b-policy-v1-dormant' AND project_id='live-ai-03b' AND status='inactive'
       AND effective_from='2026-09-18T14:11:25Z'::timestamptz AND effective_until IS NULL
       AND session_money_ceiling_micros=0 AND session_provider_calls=0 AND session_execution_admissions=0
       AND subject_day_money_ceiling_micros=0 AND project_day_money_ceiling_micros=0
       AND project_month_money_ceiling_micros=0 AND global_day_money_ceiling_micros=0
       AND policy_digest='cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4'
       AND created_at='2026-09-18T14:11:25Z'::timestamptz) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: dormant policy row missing/mismatch';
  END IF;

  -- catalog tables must be empty
  IF (SELECT count(*) FROM public.budget_price_catalog_versions) <> 0 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: price_catalog_versions must be empty';
  END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_entries) <> 0 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: price_catalog_entries must be empty';
  END IF;

  -- remaining nine tables empty
  FOREACH t IN ARRAY zero_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: table % must be empty, found %', t, n;
    END IF;
  END LOOP;

  -- total exactly 3 before insert
  total := (SELECT count(*) FROM public.budget_control_epochs)
         + (SELECT count(*) FROM public.budget_policy_versions);
  FOREACH t IN ARRAY zero_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n; total := total + n;
  END LOOP;
  total := total + (SELECT count(*) FROM public.budget_price_catalog_versions)
                 + (SELECT count(*) FROM public.budget_price_catalog_entries);
  IF total <> 3 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: expected exactly 3 budget rows before insert, found %', total;
  END IF;

  -- nothing active anywhere (control / policy / catalog)
  IF EXISTS (SELECT 1 FROM public.budget_control_epochs WHERE enabled=true OR killed=true) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: no control may be enabled/killed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_policy_versions WHERE status='active') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: no active policy allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status='active') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_PRECHECK: no active catalog version allowed';
  END IF;
END
$precheck$;

-- ── insert: 1 inactive catalog version ──
INSERT INTO public.budget_price_catalog_versions
  (id, status, effective_from, effective_until, catalog_digest, created_at)
VALUES
  ('openai-gpt-5-6-terra-standard-short-v1', 'inactive',
   '2026-09-18T18:37:35Z'::timestamptz, NULL,
   '453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973',
   '2026-09-18T18:37:35Z'::timestamptz);

-- ── insert: 2 inactive catalog entries (input, output) ──
INSERT INTO public.budget_price_catalog_entries
  (id, catalog_version_id, provider, model, service_tier, billing_dimension,
   currency_code, unit_size, rate_micros, effective_from, effective_until,
   verified_at, verification_expires_at, source_id, source_digest, status, created_at)
VALUES
  ('openai-gpt-5-6-terra-standard-short-v1-reasoning-input-token-base',
   'openai-gpt-5-6-terra-standard-short-v1', 'openai', 'gpt-5.6-terra', NULL,
   'reasoning_input_token', 'USD', 1000000, 2000000,
   '2026-09-18T18:37:35Z'::timestamptz, NULL,
   '2026-09-18T18:37:35Z'::timestamptz, '2026-09-25T18:37:35Z'::timestamptz,
   'openai-api-pricing/gpt-5.6-terra/standard/short-context/v1',
   'fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3',
   'inactive', '2026-09-18T18:37:35Z'::timestamptz);

INSERT INTO public.budget_price_catalog_entries
  (id, catalog_version_id, provider, model, service_tier, billing_dimension,
   currency_code, unit_size, rate_micros, effective_from, effective_until,
   verified_at, verification_expires_at, source_id, source_digest, status, created_at)
VALUES
  ('openai-gpt-5-6-terra-standard-short-v1-reasoning-output-token-base',
   'openai-gpt-5-6-terra-standard-short-v1', 'openai', 'gpt-5.6-terra', NULL,
   'reasoning_output_token', 'USD', 1000000, 12000000,
   '2026-09-18T18:37:35Z'::timestamptz, NULL,
   '2026-09-18T18:37:35Z'::timestamptz, '2026-09-25T18:37:35Z'::timestamptz,
   'openai-api-pricing/gpt-5.6-terra/standard/short-context/v1',
   'fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3',
   'inactive', '2026-09-18T18:37:35Z'::timestamptz);

-- ── postcondition: exact 3 -> 6 transition; catalog inactive; predecessors preserved ──
DO $postcheck$
DECLARE
  n bigint; total bigint := 0; t text;
  zero_tables text[] := ARRAY[
    'budget_decisions','budget_envelope_allocations','budget_envelopes',
    'budget_execution_consumptions','budget_provider_reservations','budget_provider_settlements',
    'budget_reconciliations','budget_scope_counters','budget_sessions'
  ];
BEGIN
  -- predecessors preserved
  IF (SELECT count(*) FROM public.budget_control_epochs) <> 2 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: control epochs must remain exactly 2';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_control_epochs
     WHERE scope_type='global' AND scope_key_digest='global' AND control_epoch=1
       AND enabled=false AND killed=false AND updated_at='2026-09-18T14:11:25Z'::timestamptz
       AND record_digest='26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: global dormant control changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_control_epochs
     WHERE scope_type='project' AND scope_key_digest='live-ai-03b' AND control_epoch=1
       AND enabled=false AND killed=false AND updated_at='2026-09-18T14:11:25Z'::timestamptz
       AND record_digest='be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: project dormant control changed';
  END IF;
  IF (SELECT count(*) FROM public.budget_policy_versions) <> 1 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: policy versions must remain exactly 1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_policy_versions
     WHERE id='live-ai-03b-policy-v1-dormant' AND project_id='live-ai-03b' AND status='inactive'
       AND effective_from='2026-09-18T14:11:25Z'::timestamptz AND effective_until IS NULL
       AND session_money_ceiling_micros=0 AND session_provider_calls=0 AND session_execution_admissions=0
       AND subject_day_money_ceiling_micros=0 AND project_day_money_ceiling_micros=0
       AND project_month_money_ceiling_micros=0 AND global_day_money_ceiling_micros=0
       AND policy_digest='cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4'
       AND created_at='2026-09-18T14:11:25Z'::timestamptz) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: dormant policy changed';
  END IF;

  -- exactly one inactive catalog version, byte-exact
  IF (SELECT count(*) FROM public.budget_price_catalog_versions) <> 1 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: expected exactly 1 catalog version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_price_catalog_versions
     WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='inactive'
       AND effective_from='2026-09-18T18:37:35Z'::timestamptz AND effective_until IS NULL
       AND catalog_digest='453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973'
       AND created_at='2026-09-18T18:37:35Z'::timestamptz) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: catalog version row mismatch';
  END IF;

  -- exactly two inactive catalog entries, byte-exact
  IF (SELECT count(*) FROM public.budget_price_catalog_entries) <> 2 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: expected exactly 2 catalog entries';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_price_catalog_entries
     WHERE id='openai-gpt-5-6-terra-standard-short-v1-reasoning-input-token-base'
       AND catalog_version_id='openai-gpt-5-6-terra-standard-short-v1'
       AND provider='openai' AND model='gpt-5.6-terra' AND service_tier IS NULL
       AND billing_dimension='reasoning_input_token' AND currency_code='USD'
       AND unit_size=1000000 AND rate_micros=2000000
       AND effective_from='2026-09-18T18:37:35Z'::timestamptz AND effective_until IS NULL
       AND verified_at='2026-09-18T18:37:35Z'::timestamptz
       AND verification_expires_at='2026-09-25T18:37:35Z'::timestamptz
       AND source_id='openai-api-pricing/gpt-5.6-terra/standard/short-context/v1'
       AND source_digest='fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3'
       AND status='inactive' AND created_at='2026-09-18T18:37:35Z'::timestamptz) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: input entry mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.budget_price_catalog_entries
     WHERE id='openai-gpt-5-6-terra-standard-short-v1-reasoning-output-token-base'
       AND catalog_version_id='openai-gpt-5-6-terra-standard-short-v1'
       AND provider='openai' AND model='gpt-5.6-terra' AND service_tier IS NULL
       AND billing_dimension='reasoning_output_token' AND currency_code='USD'
       AND unit_size=1000000 AND rate_micros=12000000
       AND effective_from='2026-09-18T18:37:35Z'::timestamptz AND effective_until IS NULL
       AND verified_at='2026-09-18T18:37:35Z'::timestamptz
       AND verification_expires_at='2026-09-25T18:37:35Z'::timestamptz
       AND source_id='openai-api-pricing/gpt-5.6-terra/standard/short-context/v1'
       AND source_digest='fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3'
       AND status='inactive' AND created_at='2026-09-18T18:37:35Z'::timestamptz) THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: output entry mismatch';
  END IF;

  -- nothing active; no wildcard; no alternate provider/model/currency; no dup dimension
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status='active')
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status='active') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: no active catalog allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_entries
     WHERE '*' IN (provider, model, billing_dimension, currency_code)
        OR service_tier = '*') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: wildcard value present';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_entries
     WHERE provider <> 'openai' OR model <> 'gpt-5.6-terra' OR currency_code <> 'USD') THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: alternate provider/model/currency present';
  END IF;
  IF (SELECT count(DISTINCT billing_dimension) FROM public.budget_price_catalog_entries) <> 2 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: duplicate/!=2 billing dimensions';
  END IF;

  -- remaining nine tables still empty
  FOREACH t IN ARRAY zero_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: table % must remain empty, found %', t, n;
    END IF;
  END LOOP;

  -- exactly six total rows across the whole foundation
  total := (SELECT count(*) FROM public.budget_control_epochs)
         + (SELECT count(*) FROM public.budget_policy_versions)
         + (SELECT count(*) FROM public.budget_price_catalog_versions)
         + (SELECT count(*) FROM public.budget_price_catalog_entries);
  FOREACH t IN ARRAY zero_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n; total := total + n;
  END LOOP;
  IF total <> 6 THEN
    RAISE EXCEPTION 'LIVE_AI_BUDGET_01_CATALOG_POSTCHECK: expected exactly 6 budget rows, found %', total;
  END IF;
END
$postcheck$;

COMMIT;
