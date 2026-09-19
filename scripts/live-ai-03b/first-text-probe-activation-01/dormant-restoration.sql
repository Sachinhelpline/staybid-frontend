-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — FIRST-TEXT-PROBE — DORMANT RESTORATION  (UNAPPLIED / OFFLINE)
--
-- ⚠ UNAPPLIED. NOT executed against any database by this packet.
--
-- Returns AUTHORITY to dormant AFTER the one probe, while PRESERVING all durable probe
-- accounting evidence. This SQL NEVER deletes budget_sessions / budget_decisions /
-- budget_envelopes / budget_envelope_allocations / budget_provider_reservations /
-- budget_provider_settlements / budget_reconciliations / budget_execution_consumptions /
-- budget_scope_counters. No DELETE / TRUNCATE anywhere.
--
-- Required conceptual order (§18): (1) ingress gates closed OUTSIDE the DB BEFORE this SQL
-- (broker + text gate OFF; provider credential removed — see ABORT-ROLLBACK-RUNBOOK.md);
-- then in-DB: (2) controls disabled via the valid next monotonic epoch 2 → 3; (3) the
-- one-call policy made inactive/non-authorizing; (4) the catalog version + entries returned
-- inactive with the reviewed inactive digest; durable accounting retained.
--
-- REQUIRED execution-time parameter (fail closed if ABSENT):
--   -v control_updated_at=<fresh RFC3339 UTC instant>
-- Restoration control.updated_at again uses ONE fresh execution-time UTC timestamp — never
-- ARTIFACT_T0, never now()/CURRENT_TIMESTAMP/clock_timestamp() as hidden authority.
--
-- FAIL-CLOSED + IDEMPOTENCY-AWARE:
--   • exact ACTIVE predecessor (controls epoch 2 enabled; one-call policy active; catalog
--     active) ⇒ perform restoration;
--   • exact already-restored reviewed state (controls epoch 3 disabled; one-call policy
--     inactive; catalog inactive) ⇒ safely report already restored, NO destructive rewrite;
--   • ANY ambiguous / mixed state ⇒ RAISE (HOLD).
-- Digest literals are produced by activation-digest-gen.mjs.
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

\if :{?control_updated_at}
\else
\echo 'FATAL: control_updated_at not supplied — a FRESH execution-time RFC3339 UTC instant is REQUIRED (fail closed).'
\quit
\endif

BEGIN;

LOCK TABLE
  budget_control_epochs,
  budget_decisions,
  budget_envelope_allocations,
  budget_envelopes,
  budget_execution_consumptions,
  budget_policy_versions,
  budget_price_catalog_entries,
  budget_price_catalog_versions,
  budget_provider_reservations,
  budget_provider_settlements,
  budget_reconciliations,
  budget_scope_counters,
  budget_sessions
  IN SHARE ROW EXCLUSIVE MODE;

SELECT set_config('live_ai_03b.control_updated_at', :'control_updated_at', true);

DO $$
DECLARE
  v_raw text := current_setting('live_ai_03b.control_updated_at', true);
  v_ts  timestamptz;
  is_active_pred  boolean := false;
  is_restored     boolean := false;
  n_acct bigint;
BEGIN
  -- ── PRECONDITION (idempotency-aware): detect the EXACT state + validate the fresh
  --    execution-time timestamp before ANY mutation; fail closed on an ambiguous state. ──
  -- ── detect the EXACT ACTIVE predecessor ──
  is_active_pred :=
       EXISTS (SELECT 1 FROM budget_control_epochs
                 WHERE scope_type='global' AND scope_key_digest='global'
                   AND control_epoch=2 AND enabled=true AND killed=false
                   AND record_digest='0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b')
   AND EXISTS (SELECT 1 FROM budget_control_epochs
                 WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
                   AND control_epoch=2 AND enabled=true AND killed=false
                   AND record_digest='eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f')
   AND EXISTS (SELECT 1 FROM budget_policy_versions
                 WHERE id='live-ai-03b-policy-oneprobe-v1' AND status='active'
                   AND policy_digest='9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c')
   AND EXISTS (SELECT 1 FROM budget_price_catalog_versions
                 WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='active'
                   AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8');

  -- ── detect the EXACT already-restored reviewed state ──
  is_restored :=
       EXISTS (SELECT 1 FROM budget_control_epochs
                 WHERE scope_type='global' AND scope_key_digest='global'
                   AND control_epoch=3 AND enabled=false AND killed=false
                   AND record_digest='0d2f68853d59b59b4d57d84eedb03af5e2117643c8b4bc378674f4be7dc4b707')
   AND EXISTS (SELECT 1 FROM budget_control_epochs
                 WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
                   AND control_epoch=3 AND enabled=false AND killed=false
                   AND record_digest='d26219d1e4ed6e418dd7f71ec97947b2502c004b59c7fd7c88638059139db7f4')
   AND EXISTS (SELECT 1 FROM budget_policy_versions
                 WHERE id='live-ai-03b-policy-oneprobe-v1' AND status='inactive'
                   AND policy_digest='a74a7e347f511e4c2c423fa62d3cce10559713acf903138939b59d6037b8c4d9')
   AND EXISTS (SELECT 1 FROM budget_price_catalog_versions
                 WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='inactive'
                   AND catalog_digest='453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973');

  IF is_active_pred AND is_restored THEN
    RAISE EXCEPTION 'restoration: mixed/ambiguous state (both active-predecessor and already-restored detected) — HOLD';
  END IF;

  -- ── already-restored ⇒ idempotent no-op success ──
  IF is_restored THEN
    RAISE NOTICE 'dormant-restoration: already restored (idempotent no-op); durable accounting retained';
    RETURN;
  END IF;

  -- ── neither exact state ⇒ HOLD (never guess) ──
  IF NOT is_active_pred THEN
    RAISE EXCEPTION 'restoration: expected ACTIVE predecessor not exactly matched and not already-restored — ambiguous state, HOLD';
  END IF;

  -- ── validate the fresh execution-time timestamp (restoration writes control updated_at) ──
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RAISE EXCEPTION 'restoration: control_updated_at is blank (fail closed)';
  END IF;
  IF v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' THEN
    RAISE EXCEPTION 'restoration: control_updated_at % is not strict RFC3339 UTC (trailing Z required)', v_raw;
  END IF;
  v_ts := v_raw::timestamptz;
  IF v_ts > now() THEN RAISE EXCEPTION 'restoration: control_updated_at % is in the future (not fresh)', v_raw; END IF;
  IF now() - v_ts > interval '15000 milliseconds' THEN
    RAISE EXCEPTION 'restoration: control_updated_at % is stale (> 15000 ms staleness policy)', v_raw;
  END IF;

  -- ── (2) controls disabled via the valid next monotonic epoch 2 → 3 ──
  UPDATE budget_control_epochs
     SET control_epoch=3, enabled=false, killed=false,
         record_digest='0d2f68853d59b59b4d57d84eedb03af5e2117643c8b4bc378674f4be7dc4b707',
         updated_at=v_ts
   WHERE scope_type='global' AND scope_key_digest='global'
     AND control_epoch=2 AND enabled=true AND killed=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration: GLOBAL control epoch 2->3 transition affected 0 rows'; END IF;

  UPDATE budget_control_epochs
     SET control_epoch=3, enabled=false, killed=false,
         record_digest='d26219d1e4ed6e418dd7f71ec97947b2502c004b59c7fd7c88638059139db7f4',
         updated_at=v_ts
   WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
     AND control_epoch=2 AND enabled=true AND killed=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration: PROJECT control epoch 2->3 transition affected 0 rows'; END IF;

  -- ── (3) one-call policy made inactive / non-authorizing (digest recomputed) ──
  UPDATE budget_policy_versions
     SET status='inactive',
         policy_digest='a74a7e347f511e4c2c423fa62d3cce10559713acf903138939b59d6037b8c4d9'
   WHERE id='live-ai-03b-policy-oneprobe-v1' AND status='active'
     AND policy_digest='9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c';
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration: one-call policy active->inactive affected 0 rows'; END IF;

  -- ── (4) catalog version + entries returned INACTIVE with the reviewed inactive digest ──
  UPDATE budget_price_catalog_versions
     SET status='inactive',
         catalog_digest='453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973'
   WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='active'
     AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration: catalog version active->inactive affected 0 rows'; END IF;

  UPDATE budget_price_catalog_entries
     SET status='inactive'
   WHERE catalog_version_id='openai-gpt-5-6-terra-standard-short-v1' AND status='active'
     AND id IN (
       'openai-gpt-5-6-terra-standard-short-v1-reasoning-input-token-base',
       'openai-gpt-5-6-terra-standard-short-v1-reasoning-output-token-base'
     );

  -- ── POSTCONDITION: exact dormant/restored state; accounting retained ──
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='global' AND scope_key_digest='global'
      AND control_epoch=3 AND enabled=false AND killed=false
      AND record_digest='0d2f68853d59b59b4d57d84eedb03af5e2117643c8b4bc378674f4be7dc4b707'
      AND updated_at=v_ts;
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration postcondition: GLOBAL control not restored exactly'; END IF;
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
      AND control_epoch=3 AND enabled=false AND killed=false
      AND record_digest='d26219d1e4ed6e418dd7f71ec97947b2502c004b59c7fd7c88638059139db7f4'
      AND updated_at=v_ts;
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration postcondition: PROJECT control not restored exactly'; END IF;
  PERFORM 1 FROM budget_price_catalog_versions WHERE status='active';
  IF FOUND THEN RAISE EXCEPTION 'restoration postcondition: an active catalog version remains'; END IF;
  PERFORM 1 FROM budget_price_catalog_entries WHERE status='active';
  IF FOUND THEN RAISE EXCEPTION 'restoration postcondition: an active catalog entry remains'; END IF;
  PERFORM 1 FROM budget_policy_versions WHERE status='active';
  IF FOUND THEN RAISE EXCEPTION 'restoration postcondition: an active policy remains'; END IF;
  -- the reviewed dormant policy is still present + preserved.
  PERFORM 1 FROM budget_policy_versions
    WHERE id='live-ai-03b-policy-v1-dormant' AND status='inactive'
      AND policy_digest='cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4';
  IF NOT FOUND THEN RAISE EXCEPTION 'restoration postcondition: dormant policy no longer preserved'; END IF;

  -- durable accounting retained (report the counts; NEVER deleted).
  SELECT (
    (SELECT count(*) FROM budget_sessions) +
    (SELECT count(*) FROM budget_scope_counters) +
    (SELECT count(*) FROM budget_envelopes) +
    (SELECT count(*) FROM budget_envelope_allocations) +
    (SELECT count(*) FROM budget_decisions) +
    (SELECT count(*) FROM budget_provider_reservations) +
    (SELECT count(*) FROM budget_provider_settlements) +
    (SELECT count(*) FROM budget_execution_consumptions) +
    (SELECT count(*) FROM budget_reconciliations)
  ) INTO n_acct;

  RAISE NOTICE 'dormant-restoration OK — controls epoch 3 disabled; one-call policy inactive; catalog inactive; durable accounting rows retained: %', n_acct;
END $$;

COMMIT;
