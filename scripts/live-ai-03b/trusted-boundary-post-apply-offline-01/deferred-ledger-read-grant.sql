-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — P1-02 DEFERRED LEDGER-READ GRANT (Artifact A) — UNAPPLIED / OFFLINE
--
-- ⚠ UNAPPLIED. NOT executed against any database by this packet. Reviewable, deterministic,
--   executable PostgreSQL artifact for a FUTURE, SEPARATELY AUTHORIZED Owner application against
--   AI-STAGING PostgreSQL b7362594-a01b-4623-a982-394707a6cec2 ONLY (NEVER CORE-PROD 1fbd7632-...),
--   from a securely authenticated superuser session, AFTER the accepted trusted-boundary migration
--   (…/trusted-activation-boundary-01/db/2026-09-19-p1-02-trusted-activation-boundary.sql) and the
--   accepted reader-role proposal (…/trusted-runtime-live-binding-offline-01/trusted-reader-role.sql)
--   have both been applied.
--
-- PURPOSE: execute ONLY the two deferred grants the reader-role proposal left as comments:
--     GRANT USAGE  ON SCHEMA live_ai_03b_trusted                      TO live_ai_03b_reader;
--     GRANT SELECT ON        live_ai_03b_trusted.approval_consumption TO live_ai_03b_reader;
--   The COMPLETE authorized positive grant set. No third grant, no PUBLIC grant, no REVOKE, no
--   role/schema/function/table creation, no activation/restoration invocation, no accounting write.
--
-- REMAINING-FINDINGS REMEDIATION (this pass):
--  • R1 — the reader's accepted public-schema USAGE is required (pre-grant + post-grant + verifier).
--  • R2 — the ledger CHECK is compared to an EXACT source-grounded canonical form (not keyword
--         substrings), and consumed_at default to an EXACT accepted form (not a prefix).
--  • R3 — ALL critical predecessor checks execute BEFORE either GRANT (reject the prohibited state
--         first); the post-grant block re-proves the complete end-state.
--  Previously-CLOSED behavior preserved: complete executor + reader privilege matrices across the
--  ledger + all 13 public.budget_* tables × 7 privileges, role attributes + memberships.
--
-- Catalog-level proof only — credential isolation / effective-role behaviour from a real
-- credentialed session, and the exact hosted-PostgreSQL normalization of the CHECK/default, remain
-- FUTURE credential-backed / hosted-PostgreSQL gates (footer + README).
-- ═════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ── ALL CRITICAL PRECONDITIONS (fail-fast; MUST reject the prohibited state BEFORE either GRANT) ──
DO $pre$
DECLARE
  v_reader_oid oid; v_owner_oid oid; v_exec_oid oid; v_ledger_oid oid;
  v_ledger text := 'live_ai_03b_trusted.approval_consumption';
  n bigint; t text; p text; d text; v_chk text;
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
  -- CHECK-LITERAL FIX: case- and whitespace-EXACT canonical forms, compared to the RAW
  -- pg_get_constraintdef(oid) with NO lowercase and NO whitespace/'::text' transformation, so the
  -- quoted string-literal contents are preserved byte-for-byte (a prior lower()+strip-whitespace
  -- normalization wrongly accepted 'ACTIVATE'/'RESTORE' and 'act ivate'). Derived from the accepted
  -- migration `action text NOT NULL CHECK (action IN ('activate','restore'))` (a text column ⇒ the
  -- canonical `= ANY (ARRAY[...])` rendering). Uppercase ('ACTIVATE'), embedded-whitespace
  -- ('act ivate'), altered/missing/extra actions, reversed operators and incompatible boolean
  -- predicates all fail to match ⇒ rejected. An unrecognized (e.g. version-variant) rendering fails
  -- CLOSED — the exact hosted-PostgreSQL rendering is a documented FUTURE gate; extend this set ONLY
  -- on confirmed equivalence, never via a permissive lowercase/whitespace/keyword fallback.
  accepted_check_forms text[] := ARRAY[
    'CHECK (action = ANY (ARRAY[''activate''::text, ''restore''::text]))',
    'CHECK ((action = ANY (ARRAY[''activate''::text, ''restore''::text])))'];
  accepted_default_forms text[] := ARRAY['now()','pg_catalog.now()'];
BEGIN
  -- (1) roles exist with EXACT accepted attributes (incl. REPLICATION) + zero memberships.
  SELECT oid INTO v_owner_oid  FROM pg_roles WHERE rolname='live_ai_03b_fn_owner';
  SELECT oid INTO v_exec_oid   FROM pg_roles WHERE rolname='live_ai_03b_executor';
  SELECT oid INTO v_reader_oid FROM pg_roles WHERE rolname='live_ai_03b_reader';
  IF v_owner_oid IS NULL THEN RAISE EXCEPTION 'deferred-grant: fn_owner absent — apply the trusted-boundary migration first'; END IF;
  IF v_exec_oid  IS NULL THEN RAISE EXCEPTION 'deferred-grant: executor absent — apply the trusted-boundary migration first'; END IF;
  IF v_reader_oid IS NULL THEN RAISE EXCEPTION 'deferred-grant: reader absent — apply the reader-role proposal first'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_fn_owner'  AND rolcanlogin=false AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolbypassrls=false AND rolreplication=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: fn_owner attributes are not the accepted NOLOGIN/unprivileged shape'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_executor' AND rolcanlogin=true  AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolbypassrls=false AND rolreplication=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: executor attributes are not the accepted restricted shape'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_reader'   AND rolcanlogin=true  AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolbypassrls=false AND rolreplication=false AND rolinherit=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: reader attributes are not the accepted least-privilege shape (…/NOREPLICATION/NOINHERIT)'; END IF;
  SELECT count(*) INTO n FROM pg_auth_members WHERE member IN (v_owner_oid,v_exec_oid,v_reader_oid);
  IF n <> 0 THEN RAISE EXCEPTION 'deferred-grant: fn_owner/executor/reader hold % unexpected role membership(s)', n; END IF;

  -- (2) trusted schema + ledger existence / type / ownership.
  PERFORM 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted' AND nspowner=v_owner_oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: trusted schema missing or not owned by fn_owner'; END IF;
  SELECT c.oid INTO v_ledger_oid FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace WHERE nn.nspname='live_ai_03b_trusted' AND c.relname='approval_consumption';
  IF v_ledger_oid IS NULL THEN RAISE EXCEPTION 'deferred-grant: ledger approval_consumption absent — apply the trusted-boundary migration first'; END IF;
  PERFORM 1 FROM pg_class WHERE oid=v_ledger_oid AND relkind='r' AND relowner=v_owner_oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: approval_consumption is not an ordinary table owned by fn_owner'; END IF;

  -- (3) EXACT ledger shape (columns / types / nullability / default / constraints) — Finding 3 + R2.
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption';
  IF n <> 6 THEN RAISE EXCEPTION 'deferred-grant: ledger has % columns (expected exactly 6)', n; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='approval_id'           AND ordinal_position=1 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger approval_id shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='execution_id'          AND ordinal_position=2 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger execution_id shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='content_digest'        AND ordinal_position=3 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger content_digest shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='active_catalog_digest' AND ordinal_position=4 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger active_catalog_digest shape mismatch'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='action'                AND ordinal_position=5 AND data_type='text' AND is_nullable='NO' AND column_default IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger action shape mismatch'; END IF;
  -- R2: consumed_at default — EXACT canonical match against the accepted set (not a prefix).
  SELECT column_default INTO d FROM information_schema.columns WHERE table_schema='live_ai_03b_trusted' AND table_name='approval_consumption' AND column_name='consumed_at' AND ordinal_position=6 AND data_type='timestamp with time zone' AND is_nullable='NO';
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger consumed_at type/nullability/ordinal mismatch'; END IF;
  IF d IS NULL OR lower(regexp_replace(d,'\s','','g')) <> ALL (accepted_default_forms) THEN RAISE EXCEPTION 'deferred-grant: ledger consumed_at default is not the accepted now() (found: %)', COALESCE(d,'<null>'); END IF;
  -- PK + UNIQUE (exact) + CHECK (EXACT canonical, R2) + constraint count (no FK).
  PERFORM 1 FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (approval_id)'; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger PK is not exactly (approval_id)'; END IF;
  PERFORM 1 FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='u' AND conname='uniq_approval_execution' AND pg_get_constraintdef(oid)='UNIQUE (approval_id, execution_id)'; IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: ledger UNIQUE uniq_approval_execution missing/mismatch'; END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='c'; IF n <> 1 THEN RAISE EXCEPTION 'deferred-grant: ledger has % CHECK constraints (expected exactly 1)', n; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_chk FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='c';
  IF v_chk IS NULL OR v_chk <> ALL (accepted_check_forms) THEN
    RAISE EXCEPTION 'deferred-grant: ledger action CHECK is not the accepted canonical definition (case/whitespace-exact IN activate,restore) (definition: %)', COALESCE(v_chk,'<null>'); END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype IN ('p','u','c','f','x'); IF n <> 3 THEN RAISE EXCEPTION 'deferred-grant: ledger has % table constraints (expected exactly 3)', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=v_ledger_oid AND contype='f') THEN RAISE EXCEPTION 'deferred-grant: ledger has an unexpected FOREIGN KEY'; END IF;

  -- (4) the two SECURITY DEFINER functions exist + owned by fn_owner (prerequisite objects).
  SELECT count(*) INTO n FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted' AND pr.proname IN ('activate_catalog','restore_catalog_inactive') AND pr.prosecdef=true AND pr.proowner=v_owner_oid;
  IF n <> 2 THEN RAISE EXCEPTION 'deferred-grant: the two accepted SECURITY DEFINER trusted functions are not both present/owned by fn_owner (found %)', n; END IF;

  -- (5) R1 — reader MUST already hold the accepted public-schema USAGE (else it cannot query its
  --     allowlist; HOLD before granting rather than layering a grant over a broken reader path).
  IF NOT has_schema_privilege('live_ai_03b_reader','public','USAGE') THEN
    RAISE EXCEPTION 'deferred-grant: reader lacks accepted USAGE on public schema — HOLD (apply the reader-role proposal first; do not add a USAGE grant here)'; END IF;

  -- (6) R3 — CREATE denial BEFORE any grant: reader + executor must have NO CREATE on public/trusted.
  IF has_schema_privilege('live_ai_03b_reader','public','CREATE')            THEN RAISE EXCEPTION 'deferred-grant: reader unexpectedly holds CREATE on the public schema (pre-grant)'; END IF;
  IF has_schema_privilege('live_ai_03b_reader','live_ai_03b_trusted','CREATE') THEN RAISE EXCEPTION 'deferred-grant: reader unexpectedly holds CREATE on the trusted schema (pre-grant)'; END IF;
  IF has_schema_privilege('live_ai_03b_executor','public','CREATE')           THEN RAISE EXCEPTION 'deferred-grant: executor unexpectedly holds CREATE on the public schema (pre-grant)'; END IF;
  IF has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','CREATE') THEN RAISE EXCEPTION 'deferred-grant: executor unexpectedly holds CREATE on the trusted schema (pre-grant)'; END IF;

  -- (7) R3 — trusted-function authority BEFORE any grant: reader NONE; executor EXACTLY both EXECUTE.
  IF has_function_privilege('live_ai_03b_reader','live_ai_03b_trusted.activate_catalog(jsonb,text)','EXECUTE')
     OR has_function_privilege('live_ai_03b_reader','live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'deferred-grant: reader unexpectedly holds trusted-function EXECUTE (pre-grant)'; END IF;
  IF NOT has_function_privilege('live_ai_03b_executor','live_ai_03b_trusted.activate_catalog(jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('live_ai_03b_executor','live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'deferred-grant: executor lacks required EXECUTE on an accepted trusted function (pre-grant)'; END IF;
  IF NOT has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','USAGE') THEN
    RAISE EXCEPTION 'deferred-grant: executor lacks required USAGE on the trusted schema (pre-grant)'; END IF;

  -- (8) R3 — PUBLIC exposure BEFORE any grant: none on the trusted schema, ledger, or functions.
  IF EXISTS (SELECT 1 FROM pg_namespace nn, aclexplode(nn.nspacl) a WHERE nn.nspname='live_ai_03b_trusted' AND a.grantee=0) THEN RAISE EXCEPTION 'deferred-grant: PUBLIC holds a privilege on the trusted schema (pre-grant)'; END IF;
  IF EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid=v_ledger_oid)) a WHERE a.grantee=0) THEN RAISE EXCEPTION 'deferred-grant: PUBLIC holds a privilege on the ledger (pre-grant)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace CROSS JOIN LATERAL aclexplode(pr.proacl) a WHERE nn.nspname='live_ai_03b_trusted' AND pr.proname IN ('activate_catalog','restore_catalog_inactive') AND a.grantee=0) THEN
    RAISE EXCEPTION 'deferred-grant: PUBLIC holds trusted-function EXECUTE (pre-grant)'; END IF;

  -- (9) reject a CONFLICTING pre-existing grant: reader must NOT already hold schema USAGE / ledger SELECT.
  IF has_schema_privilege('live_ai_03b_reader','live_ai_03b_trusted','USAGE') THEN RAISE EXCEPTION 'deferred-grant: reader already has USAGE on the trusted schema (unexpected) — run the verification artifact instead'; END IF;
  IF has_table_privilege('live_ai_03b_reader',v_ledger,'SELECT') THEN RAISE EXCEPTION 'deferred-grant: reader already has SELECT on the ledger (unexpected) — run the verification artifact instead'; END IF;

  -- (10) pre-grant BOUNDARY: executor NO table/ledger privilege of ANY kind; reader = 12-table SELECT
  --      allowlist only (no writes), NOTHING on the excluded allocation table.
  FOREACH t IN ARRAY (budget_tables || ARRAY[v_ledger]) LOOP
    FOREACH p IN ARRAY all_privs LOOP
      IF has_table_privilege('live_ai_03b_executor', CASE WHEN t LIKE 'live_ai_03b_trusted.%' THEN t ELSE 'public.'||t END, p) THEN
        RAISE EXCEPTION 'deferred-grant: executor unexpectedly holds % on % (function-only authority required, pre-grant)', p, t; END IF;
    END LOOP;
  END LOOP;
  FOREACH t IN ARRAY reader_allow LOOP
    IF NOT has_table_privilege('live_ai_03b_reader','public.'||t,'SELECT') THEN RAISE EXCEPTION 'deferred-grant: reader lacks accepted SELECT on public.% (pre-grant)', t; END IF;
    FOREACH p IN ARRAY write_privs LOOP
      IF has_table_privilege('live_ai_03b_reader','public.'||t,p) THEN RAISE EXCEPTION 'deferred-grant: reader unexpectedly holds % on public.% (pre-grant)', p, t; END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY all_privs LOOP
    IF has_table_privilege('live_ai_03b_reader','public.budget_envelope_allocations',p) THEN RAISE EXCEPTION 'deferred-grant: reader unexpectedly holds % on the EXCLUDED public.budget_envelope_allocations (pre-grant)', p; END IF;
  END LOOP;

  RAISE NOTICE 'deferred-grant: ALL preconditions OK — applying exactly two reader grants';
END $pre$;

-- ── THE TWO AUTHORIZED POSITIVE GRANTS (the complete set; nothing else) ──
GRANT USAGE  ON SCHEMA live_ai_03b_trusted                       TO live_ai_03b_reader;
GRANT SELECT ON        live_ai_03b_trusted.approval_consumption  TO live_ai_03b_reader;

-- ── POSTCONDITIONS (fail-closed; prove the COMPLETE exact end-state) ──
DO $post$
DECLARE
  v_ledger text := 'live_ai_03b_trusted.approval_consumption';
  t text; p text;
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
BEGIN
  -- reader NOW has exactly schema USAGE + ledger SELECT; public USAGE preserved (R1).
  IF NOT has_schema_privilege('live_ai_03b_reader','live_ai_03b_trusted','USAGE') THEN RAISE EXCEPTION 'deferred-grant: post — reader lacks trusted-schema USAGE'; END IF;
  IF NOT has_table_privilege('live_ai_03b_reader',v_ledger,'SELECT') THEN RAISE EXCEPTION 'deferred-grant: post — reader lacks ledger SELECT'; END IF;
  IF NOT has_schema_privilege('live_ai_03b_reader','public','USAGE') THEN RAISE EXCEPTION 'deferred-grant: post — reader lost public-schema USAGE'; END IF;
  FOREACH p IN ARRAY write_privs LOOP
    IF has_table_privilege('live_ai_03b_reader',v_ledger,p) THEN RAISE EXCEPTION 'deferred-grant: post — reader unexpectedly holds % on the ledger', p; END IF;
  END LOOP;
  IF has_schema_privilege('live_ai_03b_reader','live_ai_03b_trusted','CREATE') THEN RAISE EXCEPTION 'deferred-grant: post — reader unexpectedly holds CREATE on the trusted schema'; END IF;
  IF has_schema_privilege('live_ai_03b_reader','public','CREATE') THEN RAISE EXCEPTION 'deferred-grant: post — reader unexpectedly holds CREATE on the public schema'; END IF;
  IF has_function_privilege('live_ai_03b_reader','live_ai_03b_trusted.activate_catalog(jsonb,text)','EXECUTE')
     OR has_function_privilege('live_ai_03b_reader','live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'deferred-grant: post — reader unexpectedly holds trusted-function EXECUTE'; END IF;
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='live_ai_03b_trusted' AND c.relname='approval_consumption' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_fn_owner');
  IF NOT FOUND THEN RAISE EXCEPTION 'deferred-grant: post — ledger ownership changed'; END IF;
  -- reader public allowlist unchanged; excluded allocation still fully denied.
  FOREACH t IN ARRAY reader_allow LOOP
    IF NOT has_table_privilege('live_ai_03b_reader','public.'||t,'SELECT') THEN RAISE EXCEPTION 'deferred-grant: post — reader lost SELECT on public.%', t; END IF;
    FOREACH p IN ARRAY write_privs LOOP
      IF has_table_privilege('live_ai_03b_reader','public.'||t,p) THEN RAISE EXCEPTION 'deferred-grant: post — reader unexpectedly holds % on public.%', p, t; END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY all_privs LOOP
    IF has_table_privilege('live_ai_03b_reader','public.budget_envelope_allocations',p) THEN RAISE EXCEPTION 'deferred-grant: post — reader holds % on the EXCLUDED allocation table', p; END IF;
  END LOOP;
  -- executor authority intact: USAGE + both EXECUTE; NO table/ledger privilege of ANY kind; NO CREATE.
  IF NOT has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','USAGE')
     OR NOT has_function_privilege('live_ai_03b_executor','live_ai_03b_trusted.activate_catalog(jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('live_ai_03b_executor','live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'deferred-grant: post — executor authority not preserved'; END IF;
  FOREACH t IN ARRAY (budget_tables || ARRAY[v_ledger]) LOOP
    FOREACH p IN ARRAY all_privs LOOP
      IF has_table_privilege('live_ai_03b_executor', CASE WHEN t LIKE 'live_ai_03b_trusted.%' THEN t ELSE 'public.'||t END, p) THEN
        RAISE EXCEPTION 'deferred-grant: post — executor unexpectedly holds % on %', p, t; END IF;
    END LOOP;
  END LOOP;
  IF has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','CREATE') OR has_schema_privilege('live_ai_03b_executor','public','CREATE') THEN
    RAISE EXCEPTION 'deferred-grant: post — executor unexpectedly holds schema CREATE'; END IF;
  -- PUBLIC still holds nothing on the trusted schema / ledger / functions.
  IF EXISTS (SELECT 1 FROM pg_namespace nn, aclexplode(nn.nspacl) a WHERE nn.nspname='live_ai_03b_trusted' AND a.grantee=0)
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE nn.nspname='live_ai_03b_trusted' AND c.relname='approval_consumption' AND a.grantee=0)
     OR EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace CROSS JOIN LATERAL aclexplode(pr.proacl) a WHERE nn.nspname='live_ai_03b_trusted' AND pr.proname IN ('activate_catalog','restore_catalog_inactive') AND a.grantee=0) THEN
    RAISE EXCEPTION 'deferred-grant: post — PUBLIC unexpectedly holds trusted-object authority'; END IF;
  RAISE NOTICE 'deferred-grant: postconditions OK — reader = public USAGE + trusted USAGE + ledger SELECT ONLY; executor function-only; allowlist intact; allocation excluded; no CREATE/EXECUTE/ownership; PUBLIC clean';
END $post$;

COMMIT;

-- ── FUTURE GATES (documented; NOT provable by this artifact) ──
--  * Effective-role proof from a real reader-credentialed READ ONLY session (SELECT succeeds; every
--    write + trusted-function EXECUTE denied); credential custody-isolation of reader/executor logins.
--  * Confirm the connection resolves to AI-STAGING Postgres b7362594-... by service identity.
--  * Hosted-PostgreSQL confirmation of the exact CHECK/default normalization at apply time — the
--    accepted_check_forms / accepted_default_forms sets are exact-match allowlists (fail-closed on an
--    unlisted rendering); if the hosted PG renders a new-but-semantically-identical canonical form, the
--    Owner confirms equivalence and extends the allowlist. This never accepts a non-listed form.
