-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — FIRST-TEXT-PROBE — ONE-CALL POLICY ACTIVATION  (UNAPPLIED / OFFLINE)
--
-- ⚠ UNAPPLIED. NOT executed against any database by this packet.
--
-- Lifecycle mechanism recovered from accepted source (server/voice-gateway/
-- live-ai-budget-store.ts + migrations/2026-09-16-live-ai-budget-01-dpbel-foundation.sql):
--   • budget_policy_versions is VERSIONED (PRIMARY KEY id; no per-project uniqueness).
--   • the store selects the LATEST-EFFECTIVE ACTIVE policy:
--       WHERE status='active' AND (project_id=$1 OR project_id='*')
--         AND effective_from <= now() AND (effective_until IS NULL OR now() < effective_until)
--       ORDER BY (project_id=$1) DESC, effective_from DESC LIMIT 1
--   ⇒ the deterministic reviewed transition is an INSERT of a NEW active version, leaving
--     the reviewed DORMANT predecessor row byte-exact (so restoration returns authority to
--     dormant without ever rewriting the reviewed dormant policy). This is source-true; it
--     is NOT an assumed UPDATE.
--
-- The one-call active policy permits EXACTLY one provider call + one execution admission,
-- ≤ 89536 money micros, scoped to project live-ai-03b. NO wildcard policy. Its effective_from
-- is the frozen ARTIFACT_T0 interval boundary (deterministic; NOT a control-freshness value).
-- The policy_digest below is produced by activation-digest-gen.mjs and embedded as a literal.
--
-- Gate order (§21): this runs in the FIRST-PROBE ARM phase AFTER catalog activation and
-- BEFORE control enablement — so an active policy alone authorizes nothing (controls still
-- disabled ⇒ the store returns control_disabled).
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

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

-- ── PRECONDITION: catalog ACTIVE, controls still DISABLED, dormant policy present,
--    NO active policy yet, and ZERO prior one-probe exposure. Fail closed on deviation. ──
DO $$
DECLARE n bigint;
BEGIN
  -- reviewed catalog already ACTIVE (armed prerequisite).
  PERFORM 1 FROM budget_price_catalog_versions
    WHERE id='openai-gpt-5-6-terra-standard-short-v1' AND status='active'
      AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: reviewed ACTIVE catalog not present (activate catalog first)'; END IF;
  SELECT count(*) INTO n FROM budget_price_catalog_entries WHERE status='active';
  IF n <> 2 THEN RAISE EXCEPTION 'precondition: expected exactly 2 active catalog entries, found %', n; END IF;

  -- controls STILL dormant (policy activation precedes control enablement).
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='global' AND scope_key_digest='global'
      AND control_epoch=1 AND enabled=false AND killed=false
      AND record_digest='26136eb93212ccce1ba6f4b380dbb3f1f2ef64e3d16fa9754e287459cce525ee';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: dormant GLOBAL control not exactly matched'; END IF;
  PERFORM 1 FROM budget_control_epochs
    WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
      AND control_epoch=1 AND enabled=false AND killed=false
      AND record_digest='be70f6b477c7332a834720e4f784a7d724a6363d48cbcc590315ff2fc72cad7f';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: dormant PROJECT control not exactly matched'; END IF;

  -- dormant policy present + NO active policy yet.
  SELECT count(*) INTO n FROM budget_policy_versions;
  IF n <> 1 THEN RAISE EXCEPTION 'precondition: expected exactly 1 (dormant) policy version, found %', n; END IF;
  PERFORM 1 FROM budget_policy_versions
    WHERE id='live-ai-03b-policy-v1-dormant' AND project_id='live-ai-03b' AND status='inactive'
      AND policy_digest='cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4';
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: dormant policy not exactly matched'; END IF;
  PERFORM 1 FROM budget_policy_versions WHERE status='active';
  IF FOUND THEN RAISE EXCEPTION 'precondition: an active policy already exists'; END IF;
  -- the one-call policy id must not already exist (create-once).
  PERFORM 1 FROM budget_policy_versions WHERE id='live-ai-03b-policy-oneprobe-v1';
  IF FOUND THEN RAISE EXCEPTION 'precondition: one-call policy id already present'; END IF;

  -- ZERO prior exposure across every accounting / envelope / decision surface.
  SELECT count(*) INTO n FROM budget_sessions;               IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_sessions not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_scope_counters;         IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_scope_counters not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_envelopes;              IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_envelopes not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_envelope_allocations;   IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_envelope_allocations not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_decisions;              IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_decisions not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_provider_reservations;  IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_provider_reservations not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_provider_settlements;   IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_provider_settlements not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_execution_consumptions; IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_execution_consumptions not empty (%).', n; END IF;
  SELECT count(*) INTO n FROM budget_reconciliations;        IF n<>0 THEN RAISE EXCEPTION 'precondition: budget_reconciliations not empty (%).', n; END IF;

  RAISE NOTICE 'one-call policy activation precondition OK';
END $$;

-- ── INSERT the deterministic ONE-CALL active policy (new version; dormant row preserved) ──
INSERT INTO budget_policy_versions (
  id, project_id, status, effective_from, effective_until,
  session_money_ceiling_micros, session_provider_calls, session_execution_admissions,
  subject_day_money_ceiling_micros, project_day_money_ceiling_micros,
  project_month_money_ceiling_micros, global_day_money_ceiling_micros,
  policy_digest, created_at
) VALUES (
  'live-ai-03b-policy-oneprobe-v1', 'live-ai-03b', 'active',
  TIMESTAMPTZ '2026-09-19T05:41:50Z', NULL,
  89536, 1, 1,
  89536, 89536, 89536, 89536,
  '9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c',
  TIMESTAMPTZ '2026-09-19T05:41:50Z'
);

-- ── POSTCONDITION: exactly one active (one-call) policy; dormant preserved; no exposure ──
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM budget_policy_versions WHERE status='active';
  IF n <> 1 THEN RAISE EXCEPTION 'postcondition: expected exactly 1 active policy, found %', n; END IF;
  PERFORM 1 FROM budget_policy_versions
    WHERE id='live-ai-03b-policy-oneprobe-v1' AND project_id='live-ai-03b' AND status='active'
      AND effective_from = TIMESTAMPTZ '2026-09-19T05:41:50Z' AND effective_until IS NULL
      AND session_money_ceiling_micros=89536 AND session_provider_calls=1 AND session_execution_admissions=1
      AND subject_day_money_ceiling_micros=89536 AND project_day_money_ceiling_micros=89536
      AND project_month_money_ceiling_micros=89536 AND global_day_money_ceiling_micros=89536
      AND policy_digest='9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c';
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: one-call active policy not exactly matched'; END IF;
  -- no wildcard project policy was created.
  PERFORM 1 FROM budget_policy_versions WHERE project_id='*';
  IF FOUND THEN RAISE EXCEPTION 'postcondition: a wildcard policy exists (forbidden)'; END IF;
  -- the dormant policy is preserved byte-exact.
  PERFORM 1 FROM budget_policy_versions
    WHERE id='live-ai-03b-policy-v1-dormant' AND status='inactive'
      AND policy_digest='cf5ae64ff17eca76ac3f19c4dd2b5157a1b9bb601f765978e24eb47bbc2308c4';
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: dormant policy no longer preserved'; END IF;
  SELECT count(*) INTO n FROM budget_policy_versions;
  IF n <> 2 THEN RAISE EXCEPTION 'postcondition: expected exactly 2 policy versions, found %', n; END IF;

  -- catalog still active; controls still dormant; accounting still empty.
  PERFORM 1 FROM budget_price_catalog_versions WHERE status='active'
    AND catalog_digest='616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8';
  IF NOT FOUND THEN RAISE EXCEPTION 'postcondition: active catalog no longer present'; END IF;
  PERFORM 1 FROM budget_control_epochs WHERE enabled=true OR control_epoch<>1;
  IF FOUND THEN RAISE EXCEPTION 'postcondition: a control is no longer dormant'; END IF;
  SELECT count(*) INTO n FROM budget_envelopes;   IF n<>0 THEN RAISE EXCEPTION 'postcondition: budget_envelopes not empty'; END IF;
  SELECT count(*) INTO n FROM budget_decisions;   IF n<>0 THEN RAISE EXCEPTION 'postcondition: budget_decisions not empty'; END IF;

  RAISE NOTICE 'one-call policy activation postcondition OK — one active policy; controls dormant; catalog active; zero exposure';
END $$;

COMMIT;
