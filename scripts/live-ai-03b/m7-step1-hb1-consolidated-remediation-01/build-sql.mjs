#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 1 — deterministic SQL artifact builder (OFFLINE, no I/O except
// reading the ACCEPTED predecessor SQL from the repo and writing ./sql/*.sql).
// Every literal in the emitted SQL comes from catalog/v2-digest-gen.mjs. The three
// "derived" artifacts (one-call policy / control activation / dormant restoration) are the
// ACCEPTED first-text-probe files with an EXPLICIT, count-asserted substitution table, so the
// reviewed structure stays byte-identical except the successor literals (diffs are emitted
// into ./diffs/). `--check` rebuilds in memory and fails if any ./sql file differs.
// ─────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as G from "./catalog/v2-digest-gen.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO || "/home/user/staybid-frontend";
const KIT = path.join(REPO, "scripts/live-ai-03b/first-text-probe-activation-01");
if (G.SELF_CHECK_FAILURES.length) { console.error("predecessor self-check failed", G.SELF_CHECK_FAILURES); process.exit(2); }

const V2 = G.V2_ID;
const [E_IN, E_CW, E_OUT] = G.V2_ENTRY_IDS; // lexicographic entry-id order
const INACT = G.v2Inactive.digest, ACT = G.v2Active.digest, SRC = G.SOURCE_DIGEST_V2;
const POL = G.V2_POLICY_ID, POL_ACT = G.v2PolicyActive.digest, POL_RES = G.v2PolicyRestored.digest;
const T0 = G.T0, EXP = G.T0_PLUS_7_DAYS, CEIL = G.V2_CEILING_MICROS, BUNDLE = G.v2Bundle.digest;
const V1 = G.V1, D = G.DORMANT;
const V1_IN = V1.id + "-reasoning-input-token-base", V1_OUT = V1.id + "-reasoning-output-token-base";
const AI_PG = "b7362594-a01b-4623-a982-394707a6cec2", CORE_PG = "1fbd7632-95ad-46f3-a20c-5be5b8e44e6b";
const AI_PROJ = "4ad1abb3-823a-4acf-b889-6d34ae46d7f9", CORE_PROJ = "04c8b523-5b15-4d81-af06-8c2aa1a83499";

const BUDGET13 = ["budget_control_epochs", "budget_decisions", "budget_envelope_allocations", "budget_envelopes",
  "budget_execution_consumptions", "budget_policy_versions", "budget_price_catalog_entries", "budget_price_catalog_versions",
  "budget_provider_reservations", "budget_provider_settlements", "budget_reconciliations", "budget_scope_counters", "budget_sessions"];
const ZERO9 = ["budget_decisions", "budget_envelope_allocations", "budget_envelopes", "budget_execution_consumptions",
  "budget_provider_reservations", "budget_provider_settlements", "budget_reconciliations", "budget_scope_counters", "budget_sessions"];
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const arr = (xs) => "ARRAY[" + xs.map(q).join(",") + "]";

// ── reusable exact-row predicates (fully schema-qualified; usable inside SECURITY DEFINER) ──
function v1VersionExact() {
  return `EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE id=${q(V1.id)} AND status='inactive'
       AND effective_from=TIMESTAMPTZ ${q(V1.t0)} AND effective_until IS NULL
       AND catalog_digest=${q(V1.inactive_catalog_digest)} AND created_at=TIMESTAMPTZ ${q(V1.t0)})`;
}
function v1EntriesExact() {
  const one = (id, dim, rate) => `EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE id=${q(id)} AND catalog_version_id=${q(V1.id)}
       AND provider='openai' AND model='gpt-5.6-terra' AND service_tier IS NULL AND billing_dimension=${q(dim)}
       AND currency_code='USD' AND unit_size=1000000 AND rate_micros=${rate}
       AND effective_from=TIMESTAMPTZ ${q(V1.t0)} AND effective_until IS NULL
       AND verified_at=TIMESTAMPTZ ${q(V1.t0)} AND verification_expires_at=TIMESTAMPTZ ${q(V1.expiry)}
       AND source_id=${q(G.SOURCE_ID)} AND source_digest=${q(V1.source_digest)}
       AND status='inactive' AND created_at=TIMESTAMPTZ ${q(V1.t0)})`;
  return `(SELECT count(*) FROM public.budget_price_catalog_entries WHERE catalog_version_id=${q(V1.id)}) = 2
     AND ${one(V1_IN, "reasoning_input_token", 2000000)}
     AND ${one(V1_OUT, "reasoning_output_token", 12000000)}`;
}
function v2VersionExact(status, digest) {
  return `EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE id=${q(V2)} AND status=${q(status)}
       AND effective_from=TIMESTAMPTZ ${q(T0)} AND effective_until IS NULL
       AND catalog_digest=${q(digest)} AND created_at=TIMESTAMPTZ ${q(T0)})`;
}
function v2EntriesExact(status) {
  const one = (id, tier, dim, rate) => `EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE id=${q(id)} AND catalog_version_id=${q(V2)}
       AND provider='openai' AND model='gpt-5.6-terra' AND ${tier === null ? "service_tier IS NULL" : "service_tier=" + q(tier)}
       AND billing_dimension=${q(dim)} AND currency_code='USD' AND unit_size=1000000 AND rate_micros=${rate}
       AND effective_from=TIMESTAMPTZ ${q(T0)} AND effective_until IS NULL
       AND verified_at=TIMESTAMPTZ ${q(T0)} AND verification_expires_at=TIMESTAMPTZ ${q(EXP)}
       AND source_id=${q(G.SOURCE_ID)} AND source_digest=${q(SRC)}
       AND status=${q(status)} AND created_at=TIMESTAMPTZ ${q(T0)})`;
  return `(SELECT count(*) FROM public.budget_price_catalog_entries WHERE catalog_version_id=${q(V2)}) = 3
     AND ${one(E_IN, null, "reasoning_input_token", 2000000)}
     AND ${one(E_CW, "cache_write", "reasoning_input_token", 2500000)}
     AND ${one(E_OUT, null, "reasoning_output_token", 12000000)}`;
}
const dormantControlsExact = `EXISTS (SELECT 1 FROM public.budget_control_epochs WHERE scope_type='global' AND scope_key_digest='global'
       AND control_epoch=1 AND enabled=false AND killed=false AND record_digest=${q(D.control_global_digest)})
     AND EXISTS (SELECT 1 FROM public.budget_control_epochs WHERE scope_type='project' AND scope_key_digest='live-ai-03b'
       AND control_epoch=1 AND enabled=false AND killed=false AND record_digest=${q(D.control_project_digest)})
     AND (SELECT count(*) FROM public.budget_control_epochs) = 2`;
const dormantPolicyExact = `EXISTS (SELECT 1 FROM public.budget_policy_versions WHERE id=${q(D.policy_id)} AND project_id='live-ai-03b' AND status='inactive'
       AND effective_from=TIMESTAMPTZ ${q(D.t0)} AND effective_until IS NULL
       AND session_money_ceiling_micros=0 AND session_provider_calls=0 AND session_execution_admissions=0
       AND subject_day_money_ceiling_micros=0 AND project_day_money_ceiling_micros=0
       AND project_month_money_ceiling_micros=0 AND global_day_money_ceiling_micros=0
       AND policy_digest=${q(D.policy_digest)} AND created_at=TIMESTAMPTZ ${q(D.t0)})`;

const HEADER = (title, body) => `-- ═════════════════════════════════════════════════════════════════════════
-- LIVE-AI-03B — M7 STEP 1 — ${title}
-- ⚠ UNAPPLIED / OFFLINE review artifact. NOT executed against any live database by this packet.
--   AI-STAGING Postgres ${AI_PG} ONLY, under a SEPARATE explicit Owner authorization.
--   NEVER CORE-PROD (project ${CORE_PROJ} / Postgres ${CORE_PG}).
-- Generated by m7s1/build-sql.mjs from catalog/v2-digest-gen.mjs (T0=${T0}); do not hand-edit.
${body.split("\n").map((l) => "-- " + l).join("\n").replace(/-- $/gm, "--")}
-- ═════════════════════════════════════════════════════════════════════════
`;

// ════════════════════════ 01 — V2 INACTIVE catalog seed (Owner) ════════════════════════
function seedSql() {
  return HEADER("SUCCESSOR V2 INACTIVE PRICE-CATALOG SEED (Owner-applied)", `Inserts EXACTLY one INACTIVE successor catalog version + THREE INACTIVE entries:
  version ${V2}
  ${E_IN}   input  tier NULL        rate 2000000 / 1000000
  ${E_CW}   input  tier cache_write rate 2500000 / 1000000
  ${E_OUT}   output tier NULL        rate 12000000 / 1000000
V1 (${V1.id}) is PRESERVED BYTE-EXACT (never extended / refreshed / rewritten /
reactivated). Frozen literals only (no now()/CURRENT_TIMESTAMP/clock_timestamp()):
  T0 = ${T0}   verification_expires_at = ${EXP} (T0 + 7 calendar days)
  source_digest = ${SRC}
  inactive catalog_digest = ${INACT}
Precondition = the exact accepted post-M6 BUDGET state (13 tables; 2 dormant controls;
1 dormant policy; V1 = 1 inactive version + 2 inactive entries; 9 accounting tables empty;
nothing active; V2 absent). Postcondition = exact 6 → 10 rows. Any mismatch RAISEs → ROLLBACK.`) + `
\\set ON_ERROR_STOP on
BEGIN;

LOCK TABLE
${BUDGET13.map((t) => "  public." + t).join(",\n")}
IN SHARE ROW EXCLUSIVE MODE;

DO $precheck$
DECLARE
  expected text[] := ${arr(BUDGET13)};
  zero_tables text[] := ${arr(ZERO9)};
  t text; n bigint; unexpected text; total_budget int;
BEGIN
  FOREACH t IN ARRAY expected LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: missing budget table %', t; END IF;
  END LOOP;
  SELECT string_agg(table_name, ',') INTO unexpected FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE 'budget\\_%' ESCAPE '\\' AND NOT (table_name = ANY(expected));
  IF unexpected IS NOT NULL THEN RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: unexpected budget table(s): %', unexpected; END IF;
  SELECT count(*) INTO total_budget FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE 'budget\\_%' ESCAPE '\\';
  IF total_budget <> 13 THEN RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: expected 13 budget tables, found %', total_budget; END IF;

  IF NOT (${dormantControlsExact}) THEN RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: dormant control rows not exactly matched'; END IF;
  IF (SELECT count(*) FROM public.budget_policy_versions) <> 1 OR NOT (${dormantPolicyExact}) THEN
    RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: policy state is not exactly the single dormant policy (an old one-call policy must NOT be present)';
  END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_versions) <> 1 OR NOT (${v1VersionExact()}) THEN
    RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: catalog versions are not exactly the historical inactive V1';
  END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_entries) <> 2 OR NOT (${v1EntriesExact()}) THEN
    RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: catalog entries are not exactly the historical inactive V1 pair';
  END IF;
  FOREACH t IN ARRAY zero_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: table % must be empty, found %', t, n; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.budget_control_epochs WHERE enabled OR killed)
     OR EXISTS (SELECT 1 FROM public.budget_policy_versions WHERE status='active')
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive')
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive') THEN
    RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: nothing may be active/enabled/killed/revoked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE id=${q(V2)})
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE catalog_version_id=${q(V2)}) THEN
    RAISE EXCEPTION 'M7_V2_SEED_PRECHECK: V2 already present (create-once)';
  END IF;
END
$precheck$;

INSERT INTO public.budget_price_catalog_versions (id, status, effective_from, effective_until, catalog_digest, created_at)
VALUES (${q(V2)}, 'inactive', TIMESTAMPTZ ${q(T0)}, NULL, ${q(INACT)}, TIMESTAMPTZ ${q(T0)});

INSERT INTO public.budget_price_catalog_entries
  (id, catalog_version_id, provider, model, service_tier, billing_dimension, currency_code, unit_size, rate_micros,
   effective_from, effective_until, verified_at, verification_expires_at, source_id, source_digest, status, created_at)
VALUES
  (${q(E_IN)}, ${q(V2)}, 'openai', 'gpt-5.6-terra', NULL, 'reasoning_input_token', 'USD', 1000000, 2000000,
   TIMESTAMPTZ ${q(T0)}, NULL, TIMESTAMPTZ ${q(T0)}, TIMESTAMPTZ ${q(EXP)}, ${q(G.SOURCE_ID)}, ${q(SRC)}, 'inactive', TIMESTAMPTZ ${q(T0)}),
  (${q(E_CW)}, ${q(V2)}, 'openai', 'gpt-5.6-terra', 'cache_write', 'reasoning_input_token', 'USD', 1000000, 2500000,
   TIMESTAMPTZ ${q(T0)}, NULL, TIMESTAMPTZ ${q(T0)}, TIMESTAMPTZ ${q(EXP)}, ${q(G.SOURCE_ID)}, ${q(SRC)}, 'inactive', TIMESTAMPTZ ${q(T0)}),
  (${q(E_OUT)}, ${q(V2)}, 'openai', 'gpt-5.6-terra', NULL, 'reasoning_output_token', 'USD', 1000000, 12000000,
   TIMESTAMPTZ ${q(T0)}, NULL, TIMESTAMPTZ ${q(T0)}, TIMESTAMPTZ ${q(EXP)}, ${q(G.SOURCE_ID)}, ${q(SRC)}, 'inactive', TIMESTAMPTZ ${q(T0)});

DO $postcheck$
DECLARE zero_tables text[] := ${arr(ZERO9)}; t text; n bigint; total bigint;
BEGIN
  IF NOT (${dormantControlsExact}) THEN RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: dormant controls changed'; END IF;
  IF (SELECT count(*) FROM public.budget_policy_versions) <> 1 OR NOT (${dormantPolicyExact}) THEN RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: dormant policy changed'; END IF;
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: historical V1 changed'; END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_versions) <> 2 OR NOT (${v2VersionExact("inactive", INACT)}) THEN
    RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: V2 version row not exact'; END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_entries) <> 5 OR NOT (${v2EntriesExact("inactive")}) THEN
    RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: V2 entry rows not exact'; END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive')
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive') THEN
    RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: no active/revoked catalog allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE '*' IN (provider, model, billing_dimension, currency_code) OR service_tier='*'
               OR provider<>'openai' OR model<>'gpt-5.6-terra' OR currency_code<>'USD'
               OR billing_dimension NOT IN ('reasoning_input_token','reasoning_output_token')
               OR COALESCE(service_tier,'<null>') NOT IN ('<null>','cache_write')) THEN
    RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: wildcard / alternate provider|model|currency|dimension|tier present'; END IF;
  total := (SELECT count(*) FROM public.budget_control_epochs) + (SELECT count(*) FROM public.budget_policy_versions)
         + (SELECT count(*) FROM public.budget_price_catalog_versions) + (SELECT count(*) FROM public.budget_price_catalog_entries);
  FOREACH t IN ARRAY zero_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: table % must remain empty', t; END IF;
    total := total + n;
  END LOOP;
  IF total <> 10 THEN RAISE EXCEPTION 'M7_V2_SEED_POSTCHECK: expected exactly 10 budget rows, found %', total; END IF;
  RAISE NOTICE 'M7 V2 inactive seed OK — V2 inactive (3 entries); V1 historical preserved; nothing active';
END
$postcheck$;

COMMIT;
`;
}

// ═════════════════════ 02 — trusted SUCCESSOR migration (Owner superuser) ═════════════════════
const CLAIMS_KEYS = ["account_mode", "activation_bundle_digest", "ai_staging_postgres", "ai_staging_project", "approval_expiry",
  "approval_id", "approval_not_before", "base_commit", "cache_write_rate_micros", "catalog_verification_expiry", "catalog_version_id",
  "content_digest", "context_tier", "contract", "core_excluded_postgres", "core_excluded_project", "currency", "evidence_expiry",
  "evidence_verified_at", "execution_id", "inactive_catalog_digest", "active_catalog_digest", "input_rate_micros", "model",
  "one_call_money_ceiling_micros", "one_call_policy_digest", "one_call_policy_id", "output_rate_micros", "processing_mode",
  "provider", "receipt_id", "regional_uplift", "reviewer_fingerprint", "service_tier", "source_digest", "unit_size"].sort();
export { CLAIMS_KEYS };

function trustedSql() {
  const claimsCommon = (fn) => `
  IF claims_json IS NULL OR jsonb_typeof(claims_json) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '${fn}: claims must be a JSON object'; END IF;
  IF (claims_json #>> '{contract}') IS DISTINCT FROM 'VerifiedApprovalClaimsV2' THEN RAISE EXCEPTION '${fn}: claims contract mismatch (expected VerifiedApprovalClaimsV2)'; END IF;
  SELECT array_agg(k ORDER BY k COLLATE pg_catalog."C") INTO v_keys FROM jsonb_object_keys(claims_json) AS k;  -- byte order: deterministic under ANY database default collation
  IF v_keys IS DISTINCT FROM ${arr(CLAIMS_KEYS)}::text[] THEN RAISE EXCEPTION '${fn}: claims key set is not the exact VerifiedApprovalClaimsV2 shape'; END IF;
  v_approval_id := claims_json #>> '{approval_id}';
  IF v_approval_id IS NULL OR v_approval_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RAISE EXCEPTION '${fn}: approval_id missing/malformed'; END IF;
  IF p_execution_id IS NULL OR p_execution_id !~ '^[A-Za-z0-9._:-]{8,128}$' OR (claims_json #>> '{execution_id}') IS DISTINCT FROM p_execution_id THEN
    RAISE EXCEPTION '${fn}: execution_id missing/malformed or not bound to verified claims';
  END IF;
  -- no arbitrary catalog / digest / policy: every identity is the exact reviewed literal.
  IF (claims_json #>> '{catalog_version_id}') IS DISTINCT FROM ${q(V2)} THEN RAISE EXCEPTION '${fn}: catalog_version_id is not the reviewed V2'; END IF;
  IF (claims_json #>> '{inactive_catalog_digest}') IS DISTINCT FROM ${q(INACT)} THEN RAISE EXCEPTION '${fn}: inactive_catalog_digest mismatch'; END IF;
  IF (claims_json #>> '{active_catalog_digest}') IS DISTINCT FROM ${q(ACT)} THEN RAISE EXCEPTION '${fn}: active_catalog_digest mismatch'; END IF;
  IF (claims_json #>> '{ai_staging_postgres}') IS DISTINCT FROM ${q(AI_PG)} OR (claims_json #>> '{ai_staging_project}') IS DISTINCT FROM ${q(AI_PROJ)} THEN
    RAISE EXCEPTION '${fn}: target is not AI-STAGING'; END IF;
  IF (claims_json #>> '{core_excluded_postgres}') IS DISTINCT FROM ${q(CORE_PG)} OR (claims_json #>> '{core_excluded_project}') IS DISTINCT FROM ${q(CORE_PROJ)} THEN
    RAISE EXCEPTION '${fn}: CORE-PROD exclusion binding mismatch'; END IF;`;

  const activateBody = `
DECLARE
  v_keys text[]; v_approval_id text; v_now timestamptz; v_consumed_at timestamptz; n bigint;
  v_content text := claims_json #>> '{content_digest}';
  v_nbf timestamptz; v_exp timestamptz; v_evv timestamptz; v_eve timestamptz;
  rts constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$';
BEGIN${claimsCommon("activate_v2")}
  IF v_content IS NULL OR v_content !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'activate_v2: content_digest malformed'; END IF;
  IF (claims_json #>> '{source_digest}') IS DISTINCT FROM ${q(SRC)} THEN RAISE EXCEPTION 'activate_v2: source_digest mismatch'; END IF;
  IF (claims_json #>> '{catalog_verification_expiry}') IS DISTINCT FROM ${q(EXP)} THEN RAISE EXCEPTION 'activate_v2: catalog_verification_expiry does not match reviewed contract'; END IF;
  IF (claims_json #>> '{one_call_policy_id}') IS DISTINCT FROM ${q(POL)} OR (claims_json #>> '{one_call_policy_digest}') IS DISTINCT FROM ${q(POL_ACT)} THEN
    RAISE EXCEPTION 'activate_v2: successor one-call policy binding mismatch'; END IF;
  IF (claims_json #> '{one_call_money_ceiling_micros}') IS DISTINCT FROM '${CEIL}'::jsonb THEN RAISE EXCEPTION 'activate_v2: one-call money ceiling is not ${CEIL}'; END IF;
  IF (claims_json #>> '{activation_bundle_digest}') IS DISTINCT FROM ${q(BUNDLE)} THEN RAISE EXCEPTION 'activate_v2: activation_bundle_digest mismatch'; END IF;
  IF (claims_json #>> '{base_commit}') IS DISTINCT FROM ${q(G.BASE_COMMIT)} THEN RAISE EXCEPTION 'activate_v2: base_commit mismatch'; END IF;
  -- Standard / default service tier / direct / non-regional / short-context / USD / exact three rates.
  IF (claims_json #>> '{provider}') IS DISTINCT FROM 'openai' OR (claims_json #>> '{model}') IS DISTINCT FROM 'gpt-5.6-terra' THEN RAISE EXCEPTION 'activate_v2: provider/model mismatch'; END IF;
  IF (claims_json #>> '{account_mode}') IS DISTINCT FROM 'direct' THEN RAISE EXCEPTION 'activate_v2: account_mode is not direct'; END IF;
  IF (claims_json #>> '{processing_mode}') IS DISTINCT FROM 'standard' THEN RAISE EXCEPTION 'activate_v2: processing_mode is not standard'; END IF;
  IF (claims_json #>> '{service_tier}') IS DISTINCT FROM 'default' THEN RAISE EXCEPTION 'activate_v2: service_tier is not default'; END IF;
  IF (claims_json #>> '{context_tier}') IS DISTINCT FROM 'short' THEN RAISE EXCEPTION 'activate_v2: context_tier is not short'; END IF;
  IF (claims_json #> '{regional_uplift}') IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'activate_v2: regional uplift present'; END IF;
  IF (claims_json #>> '{currency}') IS DISTINCT FROM 'USD' THEN RAISE EXCEPTION 'activate_v2: currency mismatch'; END IF;
  IF (claims_json #> '{input_rate_micros}') IS DISTINCT FROM '2000000'::jsonb
     OR (claims_json #> '{cache_write_rate_micros}') IS DISTINCT FROM '2500000'::jsonb
     OR (claims_json #> '{output_rate_micros}') IS DISTINCT FROM '12000000'::jsonb
     OR (claims_json #> '{unit_size}') IS DISTINCT FROM '1000000'::jsonb THEN
    RAISE EXCEPTION 'activate_v2: reviewed rate set mismatch (input/cache_write/output/unit)'; END IF;
  IF COALESCE(claims_json #>> '{approval_not_before}','') !~ rts OR COALESCE(claims_json #>> '{approval_expiry}','') !~ rts
     OR COALESCE(claims_json #>> '{evidence_verified_at}','') !~ rts OR COALESCE(claims_json #>> '{evidence_expiry}','') !~ rts THEN
    RAISE EXCEPTION 'activate_v2: approval/evidence validity timestamps missing or not strict RFC3339 UTC'; END IF;
  v_nbf := (claims_json #>> '{approval_not_before}')::timestamptz; v_exp := (claims_json #>> '{approval_expiry}')::timestamptz;
  v_evv := (claims_json #>> '{evidence_verified_at}')::timestamptz; v_eve := (claims_json #>> '{evidence_expiry}')::timestamptz;
  IF NOT (v_nbf < v_exp AND v_evv < v_eve) THEN RAISE EXCEPTION 'activate_v2: empty approval/evidence validity interval'; END IF;
  IF v_evv < TIMESTAMPTZ ${q(T0)} OR v_eve > TIMESTAMPTZ ${q(EXP)} THEN RAISE EXCEPTION 'activate_v2: evidence window outside the V2 verification window'; END IF;

  -- SINGLE-USE: consume first (the accepted M6 ledger; 'activate' action). Replay / duplicate ⇒ fail closed.
  BEGIN
    INSERT INTO live_ai_03b_trusted.approval_consumption(approval_id, execution_id, content_digest, active_catalog_digest, action)
    VALUES (v_approval_id, p_execution_id, v_content, ${q(ACT)}, 'activate')
    RETURNING consumed_at INTO v_consumed_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'activate_v2: approval already consumed (replay rejected)';
  END;

  -- lock every catalog row for an atomic, race-free transition.
  PERFORM 1 FROM public.budget_price_catalog_versions FOR UPDATE;
  PERFORM 1 FROM public.budget_price_catalog_entries FOR UPDATE;

  -- exact predecessor: NOTHING active; exactly V1 (historical, inactive, byte-exact) + V2 (inactive, byte-exact).
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive')
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive') THEN
    RAISE EXCEPTION 'activate_v2: an active/revoked catalog version or entry already exists (no competing authority)'; END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_versions) <> 2 OR (SELECT count(*) FROM public.budget_price_catalog_entries) <> 5 THEN
    RAISE EXCEPTION 'activate_v2: unexpected catalog rows (expected exactly V1 + V2)'; END IF;
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'activate_v2: historical V1 not byte-exact'; END IF;
  IF NOT (${v2VersionExact("inactive", INACT)}) OR NOT (${v2EntriesExact("inactive")}) THEN
    RAISE EXCEPTION 'activate_v2: reviewed inactive V2 predecessor not matched'; END IF;
  -- gate order: catalog is armed FIRST — no active policy, controls still dormant.
  IF EXISTS (SELECT 1 FROM public.budget_policy_versions WHERE status='active') THEN RAISE EXCEPTION 'activate_v2: an active policy already exists (catalog must be armed first)'; END IF;
  IF NOT (${dormantControlsExact}) THEN RAISE EXCEPTION 'activate_v2: controls are not exactly dormant'; END IF;

  -- DB-CLOCK freshness at the mutation boundary (real wall clock; never caller time / transaction start).
  v_now := clock_timestamp();
  IF v_now < TIMESTAMPTZ ${q(T0)} THEN RAISE EXCEPTION 'activate_v2: V2 verified_at is in the future at DB clock (%)', v_now; END IF;
  IF NOT (v_now < TIMESTAMPTZ ${q(EXP)}) THEN RAISE EXCEPTION 'activate_v2: V2 catalog verification expired at DB clock (%) — HOLD for a fresh successor', v_now; END IF;
  IF NOT (v_now >= v_nbf AND v_now < v_exp) THEN RAISE EXCEPTION 'activate_v2: DB clock outside signed approval validity interval'; END IF;
  IF NOT (v_now >= v_evv AND v_now < v_eve) THEN RAISE EXCEPTION 'activate_v2: DB clock outside signed evidence validity interval'; END IF;

  UPDATE public.budget_price_catalog_versions SET status='active', catalog_digest=${q(ACT)}
   WHERE id=${q(V2)} AND status='inactive' AND catalog_digest=${q(INACT)};
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'activate_v2: version transition affected % rows', n; END IF;
  UPDATE public.budget_price_catalog_entries SET status='active'
   WHERE catalog_version_id=${q(V2)} AND status='inactive' AND id IN (${q(E_IN)}, ${q(E_CW)}, ${q(E_OUT)});
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 3 THEN RAISE EXCEPTION 'activate_v2: entry transition affected % rows', n; END IF;

  -- postcondition: exactly ONE applicable authority (V2, exact active shape); V1 untouched.
  IF (SELECT count(*) FROM public.budget_price_catalog_versions WHERE status='active') <> 1 OR NOT (${v2VersionExact("active", ACT)}) THEN
    RAISE EXCEPTION 'activate_v2: postcondition active version not exactly V2'; END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_entries WHERE status='active') <> 3 OR NOT (${v2EntriesExact("active")}) THEN
    RAISE EXCEPTION 'activate_v2: postcondition active entries not exactly the three V2 entries'; END IF;
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'activate_v2: postcondition historical V1 changed'; END IF;

  RETURN jsonb_build_object(
    'contract', 'CatalogActivationReceiptV2', 'catalog_version_id', ${q(V2)},
    'approval_id', v_approval_id, 'execution_id', p_execution_id, 'content_digest', v_content,
    'active_catalog_digest', ${q(ACT)}, 'action', 'activate',
    'consumed_at', to_char(v_consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;`;

  const restoreBody = `
DECLARE
  v_keys text[]; v_approval_id text; n bigint; v_consumed_at timestamptz;
  is_active boolean; is_restored boolean;
BEGIN${claimsCommon("restore_v2")}
  PERFORM 1 FROM public.budget_price_catalog_versions FOR UPDATE;
  PERFORM 1 FROM public.budget_price_catalog_entries FOR UPDATE;
  -- V1 must be historical + untouched in EVERY branch (restoration never revives V1).
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'restore_v2: historical V1 not byte-exact — HOLD'; END IF;
  is_active := (SELECT count(*) FROM public.budget_price_catalog_versions WHERE status<>'inactive') = 1
           AND (SELECT count(*) FROM public.budget_price_catalog_entries WHERE status<>'inactive') = 3
           AND ${v2VersionExact("active", ACT)} AND ${v2EntriesExact("active")};
  is_restored := NOT EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive')
           AND NOT EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive')
           AND ${v2VersionExact("inactive", INACT)} AND ${v2EntriesExact("inactive")};
  IF is_restored THEN
    -- idempotent: the exact reviewed inactive V2 state — no ledger write, no mutation.
    RETURN jsonb_build_object('contract', 'CatalogRestorationReceiptV2', 'catalog_version_id', ${q(V2)},
      'approval_id', v_approval_id, 'execution_id', p_execution_id, 'status', 'already_restored');
  END IF;
  IF NOT is_active THEN RAISE EXCEPTION 'restore_v2: neither the exact active V2 nor the exact restored state — ambiguous, HOLD'; END IF;
  BEGIN
    INSERT INTO live_ai_03b_trusted.approval_consumption(approval_id, execution_id, content_digest, active_catalog_digest, action)
    VALUES (v_approval_id || ':restore-v2', p_execution_id, '', ${q(INACT)}, 'restore')
    RETURNING consumed_at INTO v_consumed_at;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'restore_v2: restoration approval already consumed (replay rejected)';
  END;
  UPDATE public.budget_price_catalog_versions SET status='inactive', catalog_digest=${q(INACT)}
   WHERE id=${q(V2)} AND status='active' AND catalog_digest=${q(ACT)};
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'restore_v2: version transition affected % rows', n; END IF;
  UPDATE public.budget_price_catalog_entries SET status='inactive'
   WHERE catalog_version_id=${q(V2)} AND status='active' AND id IN (${q(E_IN)}, ${q(E_CW)}, ${q(E_OUT)});
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 3 THEN RAISE EXCEPTION 'restore_v2: entry transition affected % rows', n; END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive')
     OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive')
     OR NOT (${v2VersionExact("inactive", INACT)}) OR NOT (${v2EntriesExact("inactive")})
     OR NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN
    RAISE EXCEPTION 'restore_v2: postcondition is not the exact reviewed inactive state'; END IF;
  RETURN jsonb_build_object('contract', 'CatalogRestorationReceiptV2', 'catalog_version_id', ${q(V2)},
    'approval_id', v_approval_id, 'execution_id', p_execution_id, 'status', 'restored',
    'inactive_catalog_digest', ${q(INACT)},
    'consumed_at', to_char(v_consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;`;

  return HEADER("SUCCESSOR TRUSTED ACTIVATION BOUNDARY (V2) — Owner superuser migration", `Adds a NEW schema live_ai_03b_trusted_v2 (owner live_ai_03b_fn_owner, PUBLIC revoked) holding
EXACTLY two SECURITY DEFINER functions (search_path = '' ; fully schema-qualified):
  activate_catalog_v2(claims_json jsonb, p_execution_id text) RETURNS jsonb
  restore_catalog_v2_inactive(claims_json jsonb, p_execution_id text) RETURNS jsonb
EXECUTE is granted ONLY to live_ai_03b_executor (+ USAGE on the new schema). Reader / gateway-store /
PUBLIC receive NOTHING. The functions consume the EXISTING accepted M6 single-use ledger
live_ai_03b_trusted.approval_consumption (owned by fn_owner; action CHECK unchanged) — NO ledger DDL.
WHY A NEW SCHEMA (minimum safe mechanism, proven by the local-PG suite): the frozen M6 canonical
post-verifier section E requires live_ai_03b_trusted to hold EXACTLY 1 relation + 2 functions, and the
frozen M6 functions are V1-literal-bound (expired). Adding functions there breaks the frozen verifier;
replacing them rewrites frozen M6 objects. A separate schema leaves every M6 object and verifier
section byte-exact. fn_owner already holds SELECT,UPDATE on the four lifecycle tables (M6) — NO new
grant to fn_owner. The executor keeps NO direct table/ledger privilege and NO CREATE anywhere.
Freshness uses PostgreSQL's own wall clock (clock_timestamp()) at the mutation boundary.`) + `
\\set ON_ERROR_STOP on
BEGIN;

-- ── precondition: the exact accepted M6 trusted boundary exists; successor schema absent ──
DO $pre$
DECLARE v_owner oid;
BEGIN
  SELECT oid INTO v_owner FROM pg_roles WHERE rolname='live_ai_03b_fn_owner' AND NOT rolcanlogin AND NOT rolsuper;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: fn_owner absent or not the accepted NOLOGIN shape'; END IF;
  PERFORM 1 FROM pg_roles WHERE rolname='live_ai_03b_executor' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication;
  IF NOT FOUND THEN RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: executor absent or not the accepted restricted shape'; END IF;
  PERFORM 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted' AND nspowner=v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: accepted M6 trusted schema absent'; END IF;
  IF to_regclass('live_ai_03b_trusted.approval_consumption') IS NULL THEN RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: accepted M6 ledger absent'; END IF;
  IF (SELECT count(*) FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted') <> 2 THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: accepted M6 trusted schema does not hold exactly 2 functions'; END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted_v2') THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: successor schema already exists (create-once)'; END IF;
  IF NOT (has_table_privilege('live_ai_03b_fn_owner','public.budget_price_catalog_versions','SELECT') AND has_table_privilege('live_ai_03b_fn_owner','public.budget_price_catalog_versions','UPDATE')
      AND has_table_privilege('live_ai_03b_fn_owner','public.budget_price_catalog_entries','SELECT') AND has_table_privilege('live_ai_03b_fn_owner','public.budget_price_catalog_entries','UPDATE')
      AND has_table_privilege('live_ai_03b_fn_owner','public.budget_policy_versions','SELECT') AND has_table_privilege('live_ai_03b_fn_owner','public.budget_control_epochs','SELECT')) THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_PRECHECK: fn_owner lacks the accepted M6 lifecycle-table privileges'; END IF;
END $pre$;

CREATE SCHEMA live_ai_03b_trusted_v2 AUTHORIZATION live_ai_03b_fn_owner;
REVOKE ALL ON SCHEMA live_ai_03b_trusted_v2 FROM PUBLIC;
GRANT USAGE ON SCHEMA live_ai_03b_trusted_v2 TO live_ai_03b_executor;

CREATE FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(claims_json jsonb, p_execution_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$${activateBody}
$fn$;
ALTER FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(jsonb, text) OWNER TO live_ai_03b_fn_owner;
REVOKE ALL ON FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(jsonb, text) TO live_ai_03b_executor;

CREATE FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(claims_json jsonb, p_execution_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$${restoreBody}
$fn$;
ALTER FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb, text) OWNER TO live_ai_03b_fn_owner;
REVOKE ALL ON FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb, text) TO live_ai_03b_executor;

-- ── postcondition: exact successor ACL shape; M6 objects untouched ──
DO $post$
DECLARE v_owner oid := (SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_fn_owner'); v_exec oid := (SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_executor');
BEGIN
  IF (SELECT count(*) FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted_v2') <> 2
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace WHERE nn.nspname='live_ai_03b_trusted_v2') <> 0 THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_POSTCHECK: successor schema must hold exactly 2 functions and no relation'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted_v2'
             AND NOT (pr.prosecdef AND pr.proowner=v_owner AND pr.proconfig = ARRAY['search_path=""'])) THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_POSTCHECK: a successor function is not SECURITY DEFINER / fn_owner / empty search_path'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace CROSS JOIN LATERAL aclexplode(pr.proacl) a
             WHERE nn.nspname='live_ai_03b_trusted_v2' AND a.grantee NOT IN (v_owner, v_exec)) THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_POSTCHECK: a successor function is executable by a principal other than fn_owner/executor'; END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace nn CROSS JOIN LATERAL aclexplode(nn.nspacl) a WHERE nn.nspname='live_ai_03b_trusted_v2'
             AND NOT (a.grantee=v_owner OR (a.grantee=v_exec AND a.privilege_type='USAGE'))) THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_POSTCHECK: successor schema ACL is not exactly {fn_owner, executor USAGE}'; END IF;
  IF (SELECT count(*) FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted') <> 2 THEN
    RAISE EXCEPTION 'M7_TRUSTED_V2_POSTCHECK: M6 trusted schema changed'; END IF;
  RAISE NOTICE 'M7 trusted successor OK — live_ai_03b_trusted_v2 (2 SECURITY DEFINER functions, executor-only EXECUTE)';
END $post$;

COMMIT;
`;
}

// ═══════════════════════ 03 / 06 — executor invocation contracts ═══════════════════════
function invocationSql(kind) {
  const fn = kind === "activate" ? "activate_catalog_v2" : "restore_catalog_v2_inactive";
  const title = kind === "activate" ? "V2 CATALOG ACTIVATION — trusted executor invocation contract" : "V2 CATALOG RESTORATION — trusted executor invocation contract";
  return HEADER(title, `The ONLY authorized path: the restricted executor role invokes
  live_ai_03b_trusted_v2.${fn}(verified_claims_json, execution_id)
with the VerifiedApprovalClaimsV2 object emitted by approval/approval-verify-v2.mjs AFTER successful
Ed25519 verification against the independently pinned reviewer trust root. This file performs NO raw
catalog UPDATE and confers NO operator authority. Fails closed unless run as live_ai_03b_executor.
REQUIRED: -v verified_claims_json='<VerifiedApprovalClaimsV2>'  -v execution_id='<approval-bound nonce>'`) + `
\\set ON_ERROR_STOP on
\\if :{?verified_claims_json}
\\else
\\echo 'FATAL: verified_claims_json not supplied (fail closed).'
\\quit
\\endif
\\if :{?execution_id}
\\else
\\echo 'FATAL: execution_id not supplied (fail closed).'
\\quit
\\endif
BEGIN;
DO $$
BEGIN
  IF current_user <> 'live_ai_03b_executor' THEN
    RAISE EXCEPTION 'v2-${kind}: not the restricted trusted executor role (current_user=%)', current_user;
  END IF;
END $$;
SELECT live_ai_03b_trusted_v2.${fn}(:'verified_claims_json'::jsonb, :'execution_id');
COMMIT;
`;
}

// ═══════════════ 04 / 05 / 07 — derived from the ACCEPTED first-text-probe kit ═══════════════
function subst(text, rules, name) {
  let out = text;
  for (const [from, to, count] of rules) {
    const n = out.split(from).length - 1;
    if (n !== count) throw new Error(`${name}: substitution '${from.slice(0, 60)}' expected ${count} occurrence(s), found ${n}`);
    out = out.split(from).join(to);
  }
  return out;
}
function derivedPolicy() {
  const src = fs.readFileSync(path.join(KIT, "one-call-policy-activation.sql"), "utf8");
  const v1Guard = `  -- M7: the historical V1 catalog stays inactive + byte-exact (never revived), and the OLD
  --     89536 one-call policy must NOT exist (it is obsolete under HB-1; never re-used).
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'precondition: historical V1 catalog not byte-exact inactive'; END IF;
  PERFORM 1 FROM budget_policy_versions WHERE id='live-ai-03b-policy-oneprobe-v1' OR session_money_ceiling_micros=89536;
  IF FOUND THEN RAISE EXCEPTION 'precondition: the obsolete 89536 one-call policy is present (HOLD)'; END IF;
  -- M7: the exact V2 active shape (three entries incl. cache_write) is the ONLY active catalog.
  IF NOT (${v2EntriesExact("active")}) THEN RAISE EXCEPTION 'precondition: V2 active entries not exact'; END IF;

  -- controls STILL dormant (policy activation precedes control enablement).`;
  const body = subst(src, [
    [V1.active_catalog_digest, ACT, 2], ["live-ai-03b-policy-oneprobe-v1", POL, 3], [G.ONECALL_V1.active_digest, POL_ACT, 2],
    ["'openai-gpt-5-6-terra-standard-short-v1'", q(V2), 1],
    ["IF n <> 2 THEN RAISE EXCEPTION 'precondition: expected exactly 2 active catalog entries", "IF n <> 3 THEN RAISE EXCEPTION 'precondition: expected exactly 3 active catalog entries", 1],
    ["89536, 1, 1,\n  89536, 89536, 89536, 89536,", `${CEIL}, 1, 1,\n  ${CEIL}, ${CEIL}, ${CEIL}, ${CEIL},`, 1],
    ["session_money_ceiling_micros=89536 AND", `session_money_ceiling_micros=${CEIL} AND`, 1],
    ["subject_day_money_ceiling_micros=89536 AND project_day_money_ceiling_micros=89536", `subject_day_money_ceiling_micros=${CEIL} AND project_day_money_ceiling_micros=${CEIL}`, 1],
    ["project_month_money_ceiling_micros=89536 AND global_day_money_ceiling_micros=89536", `project_month_money_ceiling_micros=${CEIL} AND global_day_money_ceiling_micros=${CEIL}`, 1],
    ["≤ 89536 money micros", `≤ ${CEIL} money micros (FIVE money ceilings = ${CEIL}; TWO count ceilings = 1)`, 1],
    [G.ONECALL_V1.t0, T0, 3],
    ["89536", "<<NO-89536-MAY-REMAIN>>", 0],
    ["standard-short-v1", "<<NO-V1-MAY-REMAIN>>", 0],
    // insertion LAST so its intentional V1 / 89536 references are never re-substituted.
    ["  -- controls STILL dormant (policy activation precedes control enablement).", v1Guard, 1],
  ], "one-call-policy");
  return HEADER("SUCCESSOR ONE-CALL POLICY ACTIVATION (Owner; derived from the accepted kit)", `Derived from the ACCEPTED first-text-probe-activation-01/one-call-policy-activation.sql by an
explicit count-asserted substitution table (build-sql.mjs derivedPolicy): V1 catalog → V2
(${ACT}); 2 → 3 active entries; policy id → ${POL};
money ceilings 89536 → ${CEIL} (FIVE money fields) — session_provider_calls = 1 and
session_execution_admissions = 1 unchanged; policy_digest → ${POL_ACT};
effective_from/created_at → T0 ${T0}. Adds a V1-historical + obsolete-89536 guard.`) + body;
}
function derivedControl() {
  const src = fs.readFileSync(path.join(KIT, "control-activation.sql"), "utf8");
  const ctlGuard = `  -- M7: the armed successor policy carries EXACTLY the reviewed ceilings — FIVE money ceilings = ${CEIL},
  --     session_provider_calls = 1, session_execution_admissions = 1 — and is the ONLY active policy
  --     (a tampered/over/under ceiling with an unchanged stored digest is rejected here).
  PERFORM 1 FROM budget_policy_versions WHERE id=${q(POL)} AND project_id='live-ai-03b' AND status='active'
      AND effective_from=TIMESTAMPTZ ${q(T0)} AND effective_until IS NULL
      AND session_money_ceiling_micros=${CEIL} AND session_provider_calls=1 AND session_execution_admissions=1
      AND subject_day_money_ceiling_micros=${CEIL} AND project_day_money_ceiling_micros=${CEIL}
      AND project_month_money_ceiling_micros=${CEIL} AND global_day_money_ceiling_micros=${CEIL}
      AND policy_digest=${q(POL_ACT)};
  IF NOT FOUND THEN RAISE EXCEPTION 'precondition: successor one-call policy ceilings/identity not exact'; END IF;
  IF (SELECT count(*) FROM budget_policy_versions WHERE status='active') <> 1 THEN RAISE EXCEPTION 'precondition: more than one active policy'; END IF;
  IF (SELECT count(*) FROM budget_price_catalog_versions WHERE status='active') <> 1 OR NOT (${v2VersionExact("active", ACT)}) OR NOT (${v2EntriesExact("active")})
     OR (SELECT count(*) FROM budget_price_catalog_entries WHERE status='active') <> 3 THEN
    RAISE EXCEPTION 'precondition: the exact V2 active catalog is not the only applicable authority'; END IF;
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'precondition: historical V1 not byte-exact inactive'; END IF;

  RAISE NOTICE 'control-activation precondition OK; updated_at=%', v_raw;`;
  const body = subst(src, [
    [V1.active_catalog_digest, ACT, 2], ["live-ai-03b-policy-oneprobe-v1", POL, 2], [G.ONECALL_V1.active_digest, POL_ACT, 1],
    ["standard-short-v1", "<<NO-V1-MAY-REMAIN>>", 0], ["oneprobe-v1", "<<NO-V1-POLICY-MAY-REMAIN>>", 0],
    // insertion LAST: exact successor ceilings + single active policy + exact V2 active shape + V1 historical.
    ["  RAISE NOTICE 'control-activation precondition OK; updated_at=%', v_raw;", ctlGuard, 1],
  ], "control-activation");
  return HEADER("SUCCESSOR CONTROL ACTIVATION (Owner; derived from the accepted kit)", `Derived from the ACCEPTED control-activation.sql by an explicit count-asserted substitution:
ONLY the armed-prerequisite literals change (V2 active catalog digest ${ACT}; successor policy
${POL} / ${POL_ACT}) + an inserted EXACT-ceiling / single-authority / V1-historical precondition.
The control epoch 1→2 transition and both activation record digests
(0a60f1eb… / eb56f2b7…) are byte-identical to the accepted artifact (controls never commit catalog/policy).`) + body;
}
function derivedRestoration() {
  const src = fs.readFileSync(path.join(KIT, "dormant-restoration.sql"), "utf8");
  const ids1 = `     AND id IN (\n       'openai-gpt-5-6-terra-standard-short-v1-reasoning-input-token-base',\n       'openai-gpt-5-6-terra-standard-short-v1-reasoning-output-token-base'\n     );`;
  const ids2 = `     AND id IN (\n       ${q(E_IN)},\n       ${q(E_CW)},\n       ${q(E_OUT)}\n     );`;
  const v1Keep = `  -- M7: the historical V1 catalog is NEVER revived and stays byte-exact inactive.
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'restoration postcondition: historical V1 not byte-exact inactive'; END IF;
  -- the reviewed dormant policy is still present + preserved.`;
  const body = subst(src, [
    [ids1, ids2, 1],
    [V1.active_catalog_digest, ACT, 2], ["live-ai-03b-policy-oneprobe-v1", POL, 3], [G.ONECALL_V1.active_digest, POL_ACT, 2],
    [G.ONECALL_V1.restored_digest, POL_RES, 2],
    [V1.inactive_catalog_digest, INACT, 2],
    ["'openai-gpt-5-6-terra-standard-short-v1'", q(V2), 4],
    ["standard-short-v1", "<<NO-V1-MAY-REMAIN>>", 0], ["oneprobe-v1", "<<NO-V1-POLICY-MAY-REMAIN>>", 0],
    // insertion LAST so its intentional V1 references are never re-substituted.
    ["  -- the reviewed dormant policy is still present + preserved.", v1Keep, 1],
  ], "dormant-restoration");
  return HEADER("SUCCESSOR DORMANT RESTORATION (Owner; derived from the accepted kit)", `Derived from the ACCEPTED dormant-restoration.sql by an explicit count-asserted substitution:
V2 catalog (active ${ACT} → inactive ${INACT}; the THREE V2 entry ids), successor
policy ${POL} (active ${POL_ACT} → restored ${POL_RES}); control epoch 2→3 digests
unchanged. Adds a V1-never-revived postcondition. NO DELETE / TRUNCATE; durable accounting retained.
Idempotency-aware: exact active predecessor ⇒ restore; exact restored ⇒ no-op; anything else ⇒ HOLD.`) + body;
}

// ═══════════════════════ 08 — post-apply verifier (READ ONLY) ═══════════════════════
function postVerifySql() {
  return HEADER("SUCCESSOR POST-APPLY VERIFIER (READ ONLY; UNAPPLIED)", `Proves, after the Owner applies 01 (V2 inactive seed) + 02 (trusted successor):
  A. successor schema/functions/ACL exact (fn_owner; SECURITY DEFINER; search_path=""; EXECUTE only
     fn_owner+executor; schema USAGE only executor; no PUBLIC; no relation in the schema);
  B. executor has NO privilege on any BUDGET table / the ledger and NO CREATE anywhere relevant;
  C. reader + gateway-store hold NO USAGE / EXECUTE on the successor (no activation authority);
  D. V2 exact INACTIVE (3 entries) + V1 historical byte-exact + nothing active + policy/controls dormant;
  E. the accepted M6 boundary is unchanged (the frozen M6 canonical post-verifier must ALSO pass).
Performs NO mutation (BEGIN READ ONLY … ROLLBACK).`) + `
\\set ON_ERROR_STOP on
SET statement_timeout = '15s';
SET default_transaction_read_only = on;
BEGIN READ ONLY;
DO $verify$
DECLARE
  v_owner oid := (SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_fn_owner');
  v_exec oid := (SELECT oid FROM pg_roles WHERE rolname='live_ai_03b_executor');
  budget_tables text[] := ${arr(BUDGET13)};
  privs text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  fns text[] := ARRAY['live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)','live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)'];
  t text; p text; r text; f text;
BEGIN
  IF v_owner IS NULL OR v_exec IS NULL THEN RAISE EXCEPTION 'v2-verify: fn_owner/executor absent'; END IF;
  -- A
  PERFORM 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted_v2' AND nspowner=v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'v2-verify: successor schema missing or not owned by fn_owner'; END IF;
  IF (SELECT count(*) FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted_v2') <> 2 THEN RAISE EXCEPTION 'v2-verify: successor schema must hold exactly 2 functions'; END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace WHERE nn.nspname='live_ai_03b_trusted_v2') <> 0 THEN RAISE EXCEPTION 'v2-verify: successor schema holds a relation'; END IF;
  FOREACH f IN ARRAY fns LOOP
    PERFORM 1 FROM pg_proc WHERE oid=f::regprocedure AND prosecdef AND proowner=v_owner AND proconfig = ARRAY['search_path=""'] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql');
    IF NOT FOUND THEN RAISE EXCEPTION 'v2-verify: % not SECURITY DEFINER / fn_owner / exact empty search_path', f; END IF;
    IF EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=f::regprocedure)) a WHERE a.grantee NOT IN (v_owner, v_exec)) THEN RAISE EXCEPTION 'v2-verify: % executable by an unexpected principal (incl. PUBLIC)', f; END IF;
    IF (SELECT proacl FROM pg_proc WHERE oid=f::regprocedure) IS NULL THEN RAISE EXCEPTION 'v2-verify: % has default ACL (PUBLIC EXECUTE)', f; END IF;
    IF NOT has_function_privilege('live_ai_03b_executor', f, 'EXECUTE') THEN RAISE EXCEPTION 'v2-verify: executor lacks EXECUTE on %', f; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace nn CROSS JOIN LATERAL aclexplode(nn.nspacl) a WHERE nn.nspname='live_ai_03b_trusted_v2'
             AND NOT (a.grantee=v_owner OR (a.grantee=v_exec AND a.privilege_type='USAGE'))) THEN RAISE EXCEPTION 'v2-verify: successor schema ACL not exactly {fn_owner, executor USAGE}'; END IF;
  -- B
  FOREACH t IN ARRAY budget_tables LOOP FOREACH p IN ARRAY privs LOOP
    IF has_table_privilege('live_ai_03b_executor','public.'||t,p) THEN RAISE EXCEPTION 'v2-verify: executor holds % on public.%', p, t; END IF;
  END LOOP; END LOOP;
  FOREACH p IN ARRAY privs LOOP IF has_table_privilege('live_ai_03b_executor','live_ai_03b_trusted.approval_consumption',p) THEN RAISE EXCEPTION 'v2-verify: executor holds % on the ledger', p; END IF; END LOOP;
  IF has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted_v2','CREATE') OR has_schema_privilege('live_ai_03b_executor','live_ai_03b_trusted','CREATE')
     OR has_schema_privilege('live_ai_03b_executor','public','CREATE') THEN RAISE EXCEPTION 'v2-verify: executor holds schema CREATE'; END IF;
  -- C
  FOREACH r IN ARRAY ARRAY['live_ai_03b_reader','live_ai_03b_gateway_store'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      IF has_schema_privilege(r,'live_ai_03b_trusted_v2','USAGE') OR has_schema_privilege(r,'live_ai_03b_trusted_v2','CREATE') THEN RAISE EXCEPTION 'v2-verify: % holds successor-schema privilege', r; END IF;
      FOREACH f IN ARRAY fns LOOP IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION 'v2-verify: % holds EXECUTE on %', r, f; END IF; END LOOP;
      FOREACH t IN ARRAY ARRAY['budget_price_catalog_versions','budget_price_catalog_entries'] LOOP
        FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
          IF has_table_privilege(r,'public.'||t,p) THEN RAISE EXCEPTION 'v2-verify: % holds % on public.% (catalog write = activation authority)', r, p, t; END IF;
        END LOOP;
      END LOOP;
    ELSE RAISE EXCEPTION 'v2-verify: expected role % absent', r; END IF;
  END LOOP;
  -- D
  IF NOT (${v1VersionExact()}) OR NOT (${v1EntriesExact()}) THEN RAISE EXCEPTION 'v2-verify: historical V1 not byte-exact inactive'; END IF;
  IF NOT (${v2VersionExact("inactive", INACT)}) OR NOT (${v2EntriesExact("inactive")}) THEN RAISE EXCEPTION 'v2-verify: V2 not exactly the reviewed inactive seed'; END IF;
  IF (SELECT count(*) FROM public.budget_price_catalog_versions) <> 2 OR (SELECT count(*) FROM public.budget_price_catalog_entries) <> 5 THEN RAISE EXCEPTION 'v2-verify: unexpected catalog rows'; END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive') OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive') THEN RAISE EXCEPTION 'v2-verify: an active/revoked catalog exists'; END IF;
  IF (SELECT count(*) FROM public.budget_policy_versions) <> 1 OR NOT (${dormantPolicyExact}) THEN RAISE EXCEPTION 'v2-verify: policy not exactly dormant'; END IF;
  IF NOT (${dormantControlsExact}) THEN RAISE EXCEPTION 'v2-verify: controls not exactly dormant'; END IF;
  IF EXISTS (SELECT 1 FROM live_ai_03b_trusted.approval_consumption WHERE active_catalog_digest IN (${q(ACT)}, ${q(INACT)})) THEN RAISE EXCEPTION 'v2-verify: a V2 approval was already consumed (not the fresh pre-activation state)'; END IF;
  RAISE NOTICE 'M7 V2 POST-APPLY VERIFICATION: ALL HARD CHECKS PASSED (run the frozen M6 canonical post-verifier as well)';
END $verify$;
ROLLBACK;
`;
}

// ═══════════════════════ 09 — successor rollback (pre-activation only) ═══════════════════════
function rollbackSql() {
  return HEADER("SUCCESSOR TRUSTED-BOUNDARY ROLLBACK (Owner; PRE-ACTIVATION ONLY)", `Removes ONLY the successor schema + its two functions, and ONLY while no V2 approval has ever been
consumed and V2 is exactly inactive. NEVER touches the M6 schema/ledger/functions, NEVER deletes a
ledger row, NEVER touches V1/V2 catalog rows (an inactive V2 seed is inert and simply expires at
${EXP}; it is never deleted). After any V2 activation, use restoration (06/07) instead — FAIL CLOSED.`) + `
\\set ON_ERROR_STOP on
BEGIN;
DO $rb$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted_v2') THEN RAISE EXCEPTION 'successor rollback: schema absent (nothing to roll back)'; END IF;
  IF EXISTS (SELECT 1 FROM live_ai_03b_trusted.approval_consumption WHERE active_catalog_digest IN (${q(ACT)}, ${q(INACT)})) THEN
    RAISE EXCEPTION 'successor rollback: a V2 approval was consumed — use restoration, never remove the boundary (HOLD)'; END IF;
  IF EXISTS (SELECT 1 FROM public.budget_price_catalog_versions WHERE status<>'inactive') OR EXISTS (SELECT 1 FROM public.budget_price_catalog_entries WHERE status<>'inactive') THEN
    RAISE EXCEPTION 'successor rollback: a catalog is active — restore first (HOLD)'; END IF;
  IF (SELECT count(*) FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted_v2') <> 2
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace nn ON nn.oid=c.relnamespace WHERE nn.nspname='live_ai_03b_trusted_v2') THEN
    RAISE EXCEPTION 'successor rollback: successor schema holds unexpected objects (HOLD)'; END IF;
END $rb$;
DROP FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(jsonb, text);
DROP FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb, text);
DROP SCHEMA live_ai_03b_trusted_v2 RESTRICT;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='live_ai_03b_trusted_v2') THEN RAISE EXCEPTION 'successor rollback: schema still present'; END IF;
  IF (SELECT count(*) FROM pg_proc pr JOIN pg_namespace nn ON nn.oid=pr.pronamespace WHERE nn.nspname='live_ai_03b_trusted') <> 2 THEN RAISE EXCEPTION 'successor rollback: M6 schema changed'; END IF;
  RAISE NOTICE 'successor rollback OK — M6 boundary + ledger + catalog rows untouched';
END $post$;
COMMIT;
`;
}

export const ARTIFACTS = {
  "sql/m7-v2-01-inactive-catalog-seed.sql": seedSql,
  "sql/m7-v2-02-trusted-successor-migration.sql": trustedSql,
  "sql/m7-v2-03-catalog-activation.sql": () => invocationSql("activate"),
  "sql/m7-v2-04-one-call-policy-activation.sql": derivedPolicy,
  "sql/m7-v2-05-control-activation.sql": derivedControl,
  "sql/m7-v2-06-catalog-restoration.sql": () => invocationSql("restore"),
  "sql/m7-v2-07-dormant-restoration.sql": derivedRestoration,
  "sql/m7-v2-08-post-apply-verification.sql": postVerifySql,
  "sql/m7-v2-09-successor-rollback.sql": rollbackSql,
};

function main() {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const [rel, fn] of Object.entries(ARTIFACTS)) {
    const out = fn(); const p = path.join(HERE, rel);
    if (check) { const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; if (cur !== out) { console.error("DRIFT: " + rel); bad++; } }
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, out); }
  }
  if (check) { console.log(bad ? `build-sql --check: ${bad} drifted` : "build-sql --check: all SQL artifacts reproduce byte-exact"); process.exit(bad ? 1 : 0); }
  console.log("wrote", Object.keys(ARTIFACTS).length, "SQL artifacts");
}
if (import.meta.url === `file://${process.argv[1]}`) main();
