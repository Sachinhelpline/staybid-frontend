-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — P1-02 POST-APPLICATION READ-ONLY VERIFICATION (Artifact B) — UNAPPLIED / OFFLINE
--
-- ⚠ UNAPPLIED + READ-ONLY. NOT executed against any database by this packet. It is a reviewable,
--   bounded, NON-MUTATING PostgreSQL verifier for FUTURE use by the Owner AFTER the trusted-boundary
--   migration, the reader-role proposal, and the deferred ledger-read grant (Artifact A) have all
--   been applied to AI-STAGING PostgreSQL b7362594-a01b-4623-a982-394707a6cec2 ONLY (NEVER CORE-PROD
--   1fbd7632-...).
--
-- It performs NO mutation: no GRANT/REVOKE, no DML/DDL, no function invocation, no negative-write
-- attempt, no COMMIT. It runs inside a READ ONLY transaction with a finite statement timeout and
-- ends with ROLLBACK, so it can never commit a pending migration. Every material security mismatch
-- RAISEs (fail-closed); each satisfied check emits a NOTICE for the audit log.
--
-- CONSOLIDATED MATERIAL REMEDIATION (this pass): executor + reader privilege denial now enumerate
-- the COMPLETE table-privilege set {SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER} across
-- the approval ledger AND all 13 accepted public BUDGET tables (Findings 1/2); the EXACT accepted
-- ledger shape — columns, types, nullability, defaults, PK/UNIQUE/CHECK — is verified (Finding 3);
-- and role attributes + memberships incl. REPLICATION are checked (Finding 4). Absence-of-authority
-- is evaluated as EFFECTIVE privilege via has_*_privilege() (which folds in PUBLIC, membership,
-- ownership, superuser) plus explicit PUBLIC (grantee 0) ACL inspection on the trusted objects.
--
-- SCOPE OF PROOF (honest): CATALOG-LEVEL privilege facts only. Effective runtime least-privilege and
-- credential ISOLATION (that the reader/executor login credentials are custody-separated and behave
-- as expected from a real credentialed session) remain FUTURE credential-backed gates (footer + README).
--
-- Expected identities recovered from accepted source:
--   trusted-activation-boundary-01/db/2026-09-19-p1-02-trusted-activation-boundary.sql
--   trusted-runtime-live-binding-offline-01/trusted-reader-role.sql
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET statement_timeout = '15s';
SET idle_in_transaction_session_timeout = '30s';
SET default_transaction_read_only = on;

BEGIN READ ONLY;

DO $verify$
DECLARE
  v_owner_oid oid; v_exec_oid oid; v_reader_oid oid; v_ledger_oid oid;
  v_ledger text := 'live_ai_03b_trusted.approval_consumption';
  n bigint; t text; p text; d text;
  budget_tables text[] := ARRAY[
    'budget_policy_versions','budget_control_epochs','budget_price_catalog_versions',
    'budget_price_catalog_entries','budget_sessions','budget_scope_counters','budget_envelopes',
    'budget_envelope_allocations','budget_decisions','budget_provider_reservations',
    'budget_provider_settlements','budget_execution_consumptions','budget_reconciliations'];
  reader_allow text[] := ARRAY[
    'budget_policy_versions','budget_control_epochs','budget_price_catalog_versions','budget_price_catalog_entries',
    'budget_envelopes','budget_provider_reservations','budget_provider_settlements','budget_execution_consumptions',
    'budget_decisions','budget_reconciliations','budget_scope_counters','budget_sessions'];
  all_privs text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  write_privs text[] := ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_chk text;
  -- CHECK-LITERAL FIX: case- and whitespace-EXACT canonical forms, compared to the RAW
  -- pg_get_constraintdef(oid) with NO lowercase and NO whitespace/'::text' transformation, so quoted
  -- string-literal contents are preserved byte-for-byte (a prior lower()+strip-whitespace normalization
  -- wrongly accepted 'ACTIVATE'/'RESTORE' and 'act ivate'). Derived from the accepted migration
  -- `action text NOT NULL CHECK (action IN ('activate','restore'))` (a text column ⇒ the canonical
  -- `= ANY (ARRAY[...])` rendering). Uppercase, embedded-whitespace, altered/missing/extra actions,
  -- reversed operators and incompatible boolean predicates all fail to match ⇒ rejected. An
  -- unrecognized (version-variant) rendering fails CLOSED — the exact hosted-PostgreSQL rendering is a
  -- documented FUTURE gate; extend ONLY on confirmed equivalence, never via a permissive fallback.
  accepted_check_forms text[] := ARRAY[
    'CHECK (action = ANY (ARRAY[''activate''::text, ''restore''::text]))',
    'CHECK ((action = ANY (ARRAY[''activate''::text, ''restore''::text])))'];
  accepted_default_forms text[] := ARRAY['now()','pg_catalog.now()'];
BEGIN
  -- ── A. roles exist with the EXACT accepted attributes (Finding 4; incl. REPLICATION) ──
  SELECT oid INTO v_owner_oid  FROM pg_roles WHERE rolname='live_ai_03b_fn_owner';
  SELECT oid INTO v_exec_oid   FROM pg_roles WHERE rolname='live_ai_03b_executor';
  SELECT oid INTO v_reader_oid FROM pg_roles WHERE rolname='live_ai_03b_reader';
  IF v_owner_oid IS NULL OR v_exec_oid IS NULL OR v_reader_oid IS NULL THEN RAISE EXCEPTION 'verify: a required role is absent (fn_owner/executor/reader)'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_fn_owner' AND rolcanlogin=false AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolbypassrls=false AND rolreplication=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'verify: fn_owner is not the accepted NOLOGIN/unprivileged shape'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_executor' AND rolcanlogin=true AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolbypassrls=false AND rolreplication=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'verify: executor attributes are not the accepted restricted shape'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_reader' AND rolcanlogin=true AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolbypassrls=false AND rolreplication=false AND rolinherit=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'verify: reader attributes are not the accepted least-privilege shape (…/NOREPLICATION/NOINHERIT)'; END IF;
  -- no unexpected memberships (no inherited/privileged authority) on any of the three.
  SELECT count(*) INTO n FROM pg_auth_members WHERE member IN (v_owner_oid,v_exec_oid,v_reader_oid);
  IF n <> 0 THEN RAISE EXCEPTION 'verify: fn_owner/executor/reader hold % unexpected membership(s)', n; END IF;
  RAISE NOTICE 'verify OK: role attributes + zero memberships';

  -- ── B. trusted schema + ledger existence / type / ownership ──
  PERFORM 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted' AND nspowner=v_owner_oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'verify: trusted schema missing or not owned by fn_owner'; END IF;
  SELECT c.oid INTO v_ledger_oid FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace
    WHERE nn.nspname='live_ai_03b_trusted' AND c.relname='approval_consumption';
  IF v_ledger_oid IS NULL THEN RAISE EXCEPTION 'verify: ledger approval_consumption missing'; END IF;
  PERFORM 1 FROM pg_class WHERE oid=v_ledger_oid AND relkind='r' AND relowner=v_owner_oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger is not an ordinary table owned by fn_owner'; END IF;
  RAISE NOTICE 'verify OK: trusted schema + ledger existence/type/ownership';

  -- ── C. EXACT ledger shape (Finding 3): columns / types / nullability / defaults / constraints ──
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption';
  IF n <> 6 THEN RAISE EXCEPTION 'verify: ledger has % columns (expected exactly 6)', n; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='approval_id'           AND ordinal_position=1 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger approval_id shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='execution_id'          AND ordinal_position=2 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger execution_id shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='content_digest'        AND ordinal_position=3 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger content_digest shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='active_catalog_digest' AND ordinal_position=4 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger active_catalog_digest shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='action'                AND ordinal_position=5 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger action shape mismatch'; END IF;
  SELECT column_default INTO d FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='consumed_at' AND ordinal_position=6 AND data_type='timestamp with time zone' AND is_nullable='NO';
  IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger consumed_at type/nullability/ordinal mismatch'; END IF;
  -- R2: consumed_at default — EXACT canonical match (not a prefix); reject no-default/other-function/now()+expr/cast.
  IF d IS NULL OR lower(regexp_replace(d,'\s','','g')) <> ALL (accepted_default_forms) THEN RAISE EXCEPTION 'verify: ledger consumed_at default is not the accepted now() (found %)', COALESCE(d,'<null>'); END IF;
  PERFORM 1 FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (approval_id)'; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger PK is not exactly (approval_id)'; END IF;
  PERFORM 1 FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='u' AND conname='uniq_approval_execution' AND pg_get_constraintdef(oid)='UNIQUE (approval_id, execution_id)'; IF NOT FOUND THEN RAISE EXCEPTION 'verify: ledger UNIQUE uniq_approval_execution missing/mismatch'; END IF;
  -- R2: EXACT canonical CHECK comparison — reject reversed operators, extra actions, incompatible boolean logic.
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='c'; IF n <> 1 THEN RAISE EXCEPTION 'verify: ledger has % CHECK constraints (expected exactly 1)', n; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_chk FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='c';
  IF v_chk IS NULL OR v_chk <> ALL (accepted_check_forms) THEN RAISE EXCEPTION 'verify: ledger action CHECK is not the accepted canonical definition (case/whitespace-exact IN activate,restore) (definition: %)', COALESCE(v_chk,'<null>'); END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype IN ('p','u','c','f','x'); IF n <> 3 THEN RAISE EXCEPTION 'verify: ledger has % table constraints (expected exactly 3)', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='f') THEN RAISE EXCEPTION 'verify: ledger has an unexpected FOREIGN KEY'; END IF;
  RAISE NOTICE 'verify OK: exact ledger shape (6 cols + types + nullability + defaults + PK/UNIQUE/CHECK)';

  -- ── D. trusted functions: identity, owner, SECURITY DEFINER, EMPTY search_path ──
  FOREACH t IN ARRAY ARRAY['activate_catalog','restore_catalog_inactive'] LOOP
    PERFORM 1 FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace
      WHERE nn.nspname='live_ai_03b_trusted' AND pr.proname=t AND pr.prosecdef=true AND pr.proowner=v_owner_oid
        AND 'search_path=' = ANY(COALESCE(pr.proconfig, ARRAY[]::text[]));
    IF NOT FOUND THEN RAISE EXCEPTION 'verify: trusted function % missing / not SECURITY DEFINER / not fn_owner / no empty search_path', t; END IF;
  END LOOP;
  RAISE NOTICE 'verify OK: trusted functions (SECURITY DEFINER + empty search_path + fn_owner)';

  -- ── E. no UNEXPECTED objects in the trusted schema (exactly 1 table + 2 functions) ──
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace WHERE nn.nspname='live_ai_03b_trusted' AND c.relkind IN ('r','v','m','p','f');
  IF n <> 1 THEN RAISE EXCEPTION 'verify: trusted schema holds % relations (expected exactly 1)', n; END IF;
  SELECT count(*) INTO n FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted';
  IF n <> 2 THEN RAISE EXCEPTION 'verify: trusted schema holds % functions (expected exactly 2)', n; END IF;
  RAISE NOTICE 'verify OK: no unexpected trusted-schema objects';

  -- ── F. executor: USAGE + both EXECUTE; NO privilege of ANY kind on the ledger or any of 13 BUDGET tables ──
  IF NOT has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','USAGE') THEN RAISE EXCEPTION 'verify: executor lacks trusted-schema USAGE'; END IF;
  IF NOT has_function_privilege('live_ai_03b_executor','live_ai_03b_trusted.activate_catalog(jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('live_ai_03b_executor','live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'verify: executor lacks EXECUTE on a trusted function'; END IF;
  FOREACH t IN ARRAY (budget_tables || ARRAY[v_ledger]) LOOP
    FOREACH p IN ARRAY all_privs LOOP
      IF has_table_privilege('live_ai_03b_executor', CASE WHEN t LIKE 'live_ai_03b_trusted.%' THEN t ELSE 'public.'||t END, p) THEN
        RAISE EXCEPTION 'verify: executor unexpectedly holds % on % (function-only authority required)', p, t; END IF;
    END LOOP;
  END LOOP;
  IF has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','CREATE') OR has_schema_privilege('live_ai_03b_executor','public','CREATE') THEN
    RAISE EXCEPTION 'verify: executor unexpectedly holds schema CREATE'; END IF;
  RAISE NOTICE 'verify OK: executor authority (EXECUTE-only; no table/ledger privilege of any kind; no CREATE)';

  -- ── G. reader public allowlist: SELECT on exactly the 12; NO write of any kind; NOTHING on allocations ──
  FOREACH t IN ARRAY reader_allow LOOP
    IF NOT has_table_privilege('live_ai_03b_reader','public.'||t,'SELECT') THEN RAISE EXCEPTION 'verify: reader lacks accepted SELECT on public.%', t; END IF;
    FOREACH p IN ARRAY write_privs LOOP
      IF has_table_privilege('live_ai_03b_reader','public.'||t,p) THEN RAISE EXCEPTION 'verify: reader unexpectedly holds % on public.%', p, t; END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY all_privs LOOP
    IF has_table_privilege('live_ai_03b_reader','public.budget_envelope_allocations',p) THEN RAISE EXCEPTION 'verify: reader holds % on the EXCLUDED public.budget_envelope_allocations', p; END IF;
  END LOOP;
  RAISE NOTICE 'verify OK: reader public allowlist (12 SELECT; all 7 privileges denied on the excluded allocation table; no writes)';

  -- ── H. reader deferred ledger grant: USAGE + SELECT only; NO write; NO CREATE; NO trusted-function EXECUTE ──
  -- R1: the accepted reader public-schema USAGE (its query path) must be present.
  IF NOT has_schema_privilege('live_ai_03b_reader','public','USAGE') THEN RAISE EXCEPTION 'verify: reader lacks accepted USAGE on the public schema'; END IF;
  IF NOT has_schema_privilege('live_ai_03b_reader','live_ai_03b_trusted','USAGE') THEN RAISE EXCEPTION 'verify: reader lacks trusted-schema USAGE (deferred grant not applied)'; END IF;
  IF NOT has_table_privilege('live_ai_03b_reader',v_ledger,'SELECT') THEN RAISE EXCEPTION 'verify: reader lacks ledger SELECT (deferred grant not applied)'; END IF;
  FOREACH p IN ARRAY write_privs LOOP
    IF has_table_privilege('live_ai_03b_reader',v_ledger,p) THEN RAISE EXCEPTION 'verify: reader unexpectedly holds % on the ledger', p; END IF;
  END LOOP;
  IF has_schema_privilege('live_ai_03b_reader','live_ai_03b_trusted','CREATE') OR has_schema_privilege('live_ai_03b_reader','public','CREATE') THEN
    RAISE EXCEPTION 'verify: reader unexpectedly holds schema CREATE'; END IF;
  IF has_function_privilege('live_ai_03b_reader','live_ai_03b_trusted.activate_catalog(jsonb,text)','EXECUTE')
     OR has_function_privilege('live_ai_03b_reader','live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'verify: reader unexpectedly holds trusted-function EXECUTE'; END IF;
  RAISE NOTICE 'verify OK: reader deferred ledger grant (USAGE + SELECT only; no write; no CREATE; no EXECUTE)';

  -- ── I. PUBLIC / default exposure: none on the trusted schema, ledger, or functions ──
  IF EXISTS (SELECT 1 FROM pg_namespace nn, aclexplode(nn.nspacl) a WHERE nn.nspname='live_ai_03b_trusted' AND a.grantee=0) THEN RAISE EXCEPTION 'verify: PUBLIC holds a trusted-schema privilege'; END IF;
  IF EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid=v_ledger_oid)) a WHERE a.grantee=0) THEN RAISE EXCEPTION 'verify: PUBLIC holds a ledger privilege'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace CROSS JOIN LATERAL aclexplode(pr.proacl) a
               WHERE nn.nspname='live_ai_03b_trusted' AND pr.proname IN ('activate_catalog','restore_catalog_inactive') AND a.grantee=0) THEN
    RAISE EXCEPTION 'verify: PUBLIC holds trusted-function EXECUTE'; END IF;
  RAISE NOTICE 'verify OK: no PUBLIC/default exposure on trusted objects';

  RAISE NOTICE '───────────────────────────────────────────────';
  RAISE NOTICE 'POST-APPLICATION CATALOG VERIFICATION: ALL HARD CHECKS PASSED';
  RAISE NOTICE 'NOTE: catalog-level proof only — credential isolation / effective-role behaviour from a real credentialed session is a FUTURE credential-backed gate (see footer).';
END $verify$;

-- ── J. LIFECYCLE-DEPENDENT INFORMATIONAL READOUT (non-failing; state varies by phase) ──
DO $info$
DECLARE a bigint; d bigint; ctrl bigint; expo bigint;
BEGIN
  SELECT count(*) INTO a FROM public.budget_policy_versions WHERE status='active';
  SELECT count(*) INTO d FROM public.budget_policy_versions WHERE status='inactive';
  SELECT count(*) INTO ctrl FROM public.budget_control_epochs WHERE enabled=true;
  SELECT (SELECT count(*) FROM public.budget_envelopes)
       + (SELECT count(*) FROM public.budget_provider_reservations)
       + (SELECT count(*) FROM public.budget_provider_settlements)
       + (SELECT count(*) FROM public.budget_execution_consumptions)
       + (SELECT count(*) FROM public.budget_decisions)
       + (SELECT count(*) FROM public.budget_reconciliations)
       + (SELECT count(*) FROM public.budget_scope_counters)
       + (SELECT count(*) FROM public.budget_sessions) INTO expo;
  RAISE NOTICE 'info (lifecycle-dependent): active_policies=% inactive_policies=% enabled_controls=% accounting_exposure_rows=%', a, d, ctrl, expo;
END $info$;

ROLLBACK;

-- ── FUTURE CREDENTIAL-BACKED VERIFICATION GATES (NOT provable by catalog inspection) ──
--  * From a real reader-credentialed READ ONLY session: SELECT the ledger succeeds; every write +
--    trusted-function EXECUTE is DENIED (effective-role proof).
--  * Prove reader/executor login credentials are custody-isolated from each other and from
--    postgres/gateway/probe (catalog cannot prove credential storage/custody).
--  * Prove the runtime connection resolves to AI-STAGING Postgres b7362594-... by service identity.
--  * Hosted-PostgreSQL dialect/execution validation of this verifier (offline proves structure only).
--  * Any lifecycle-specific assertion of dormant/armed policy/control + zero-exposure belongs to a
--    phase-specific verification packet (section J is informational here).
