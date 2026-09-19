-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — FIRST-TEXT-PROBE — CONTROL ACTIVATION  (UNAPPLIED / OFFLINE)
--
-- ⚠ UNAPPLIED. NOT executed against any database by this packet.
--
-- Monotonic control-epoch semantics recovered from accepted source (budget_control_epochs
-- PRIMARY KEY (scope_type, scope_key_digest) ⇒ exactly ONE row per scope; the store reads
-- global then project FOR SHARE and refuses killed/disabled/ADVANCED-epoch). The reviewed
-- activation is therefore an in-place UPDATE of the two existing scope rows to the exact
-- valid next epoch (+1): epoch 1 → 2, enabled=true, killed=false. record_digest commits to
-- the canonical activation payload (literal from activation-digest-gen.mjs; NEVER includes
-- updated_at).
--
-- REQUIRED execution-time parameter (fail closed if ABSENT):
--   -v control_updated_at=<fresh RFC3339 UTC instant, e.g. 2026-09-22T10:15:00Z>
-- control.updated_at MUST be a FRESH EXECUTION-TIME UTC timestamp (§16) — it is the ONLY
-- authority for control freshness. This SQL NEVER uses now()/CURRENT_TIMESTAMP/
-- clock_timestamp() as a hidden updated_at, and ARTIFACT_T0 is NEVER frozen into it. The
-- supplied instant must be strict RFC3339 UTC (trailing Z) and fresh within the 15,000 ms
-- staleness policy (LIVE_AI_BUDGET_MAX_CONTROL_STALENESS_MS).
--
-- Gate order (§21): controls are enabled LAST in the FIRST-PROBE ARM phase — AFTER the
-- catalog is active AND the one-call policy is active.
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

-- ── PRECONDITION: fresh RFC3339-UTC timestamp; exact dormant control predecessor;
--    catalog + one-call policy already ARMED. Fail closed on deviation. ──
DO $$
DECLARE
  v_raw text := current_setting('live_ai_03b.control_updated_at', true);
  v_ts  timestamptz;
BEGIN
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RAISE EXCEPTION 'precondition: control_updated_at is blank (fail closed)';
  END IF;
  -- strict RFC3339 UTC: YYYY-MM-DD T HH:MM:SS[.fraction]Z (trailing Z; no offset).
  IF v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' THEN
    RAISE EXCEPTION 'precondition: control_updated_at % is not strict RFC3339 UTC (trailing Z required)', v_raw;
  END IF;
  v_ts := v_raw::timestamptz;
  IF v_ts > now() THEN
    RAISE EXCEPTION 'precondition: control_updated_at % is in the future (not fresh)', v_raw;
  END IF;
  IF now() - v_ts > interval '15000 milliseconds' THEN
    RAISE EXCEPTION 'precondition: control_updated_at % is stale (> 15000 ms staleness policy)', v_raw;
  END IF;

  -- exact dormant control predecessor (epoch 1, disabled, not killed, reviewed digests).
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='global' AND scope_key_digest='global'
      AND control_epoch=1 AND enabled=false AND killed=false
      AND record_digest='26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: dormant GLOBAL control (epoch 1) not exactly matched'; END IF;
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
      AND control_epoch=1 AND enabled=false AND killed=false
      AND record_digest='be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: dormant PROJECT control (epoch 1) not exactly matched'; END IF;

  -- armed prerequisites: catalog active + the one-call policy active (controls enabled LAST).
  PERFORM 1 FROM budget_price_catalog_versions WHERE status='active'
    AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: active catalog not present (arm catalog first)'; END IF;
  PERFORM 1 FROM budget_policy_versions WHERE id='live-ai-03b-policy-oneprobe-v1' AND status='active'
    AND policy_digest='9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: one-call active policy not present (arm policy first)'; END IF;

  RAISE NOTICE 'control-activation precondition OK; updated_at=%', v_raw;
END $$;

-- ── TRANSITION: epoch 1 → 2, enabled=true, killed=false; digest literal; fresh updated_at ──
UPDATE budget_control_epochs
   SET control_epoch = 2, enabled = true, killed = false,
       record_digest = '0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b',
       updated_at = :'control_updated_at'::timestamptz
 WHERE scope_type='global' AND scope_key_digest='global'
   AND control_epoch=1 AND enabled=false AND killed=false;

UPDATE budget_control_epochs
   SET control_epoch = 2, enabled = true, killed = false,
       record_digest = 'eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f',
       updated_at = :'control_updated_at'::timestamptz
 WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
   AND control_epoch=1 AND enabled=false AND killed=false;

-- ── POSTCONDITION: both controls epoch 2, enabled, not killed, exact digests + updated_at ──
DO $$
DECLARE
  v_raw text := current_setting('live_ai_03b.control_updated_at', true);
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM budget_control_epochs;
  IF n <> 2 THEN RAISE EXCEPTION 'postcondition: expected exactly 2 control rows, found %', n; END IF;
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='global' AND scope_key_digest='global'
      AND control_epoch=2 AND enabled=true AND killed=false
      AND record_digest='0a60f1eb2050b2d0e4ff43262e9cde12d35c8dab84c30a8ceffc36ffa357878b'
      AND updated_at = v_raw::timestamptz;
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: activated GLOBAL control not exactly matched'; END IF;
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
      AND control_epoch=2 AND enabled=true AND killed=false
      AND record_digest='eb56f2b74f1afbb82bed7316c9839201698c780c7881e3604bdc701022315a6f'
      AND updated_at = v_raw::timestamptz;
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: activated PROJECT control not exactly matched'; END IF;

  -- catalog + one-call policy remain active (unchanged by this step).
  PERFORM 1 FROM budget_price_catalog_versions WHERE status='active'
    AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: active catalog changed unexpectedly'; END IF;
  PERFORM 1 FROM budget_policy_versions WHERE id='live-ai-03b-policy-oneprobe-v1' AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: one-call active policy changed unexpectedly'; END IF;

  RAISE NOTICE 'control-activation postcondition OK — both controls epoch 2 enabled; catalog + one-call policy active';
END $$;

COMMIT;
