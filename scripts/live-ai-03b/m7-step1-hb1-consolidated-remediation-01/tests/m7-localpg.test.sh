#!/bin/bash
# LIVE-AI-03B — M7 STEP 1 — REAL-PostgreSQL regression suite on a THROWAWAY LOCAL cluster (unix socket
# only; never AI-STAGING / CORE-PROD). Base state = the accepted predecessor chain + the FULL accepted M6
# boundary (migration + deferred grant + gateway-store role) = the live post-M6 shape. Drives the M7
# artifacts (sql/m7-v2-0[1-9]*.sql) with REAL role logins (executor via scram with a SYNTHETIC test-only
# password; reader / gateway-store / a PUBLIC-only role via trust) and the frozen M6 canonical verifier.
# Set M6_PGBIN=<pg18 bin> to run against a local PostgreSQL 18 build.
set -u
. "$(dirname "$0")/common.sh"
trap '$PGC stop "$BASE/c" >/dev/null 2>&1; rm -rf "$BASE"' EXIT
PASS=0; FAIL=0
okc() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "  FAIL: $1"; fi; }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
V2="openai-gpt-5-6-terra-standard-short-v2"; V1="openai-gpt-5-6-terra-standard-short-v1"
export PGPASSWORD='synthetic-test-only-executor-pw'
EXPW() { q -q -c "ALTER ROLE live_ai_03b_executor PASSWORD '$PGPASSWORD'" >/dev/null; }   # TEST-ONLY synthetic login secret
MK="node $M7/tests/mk-claims.mjs"
act()  { asrole live_ai_03b_executor -v ON_ERROR_STOP=1 -v verified_claims_json="$1" -v execution_id="$2" < "$SQLD/m7-v2-03-catalog-activation.sql" 2>&1; }
rest() { asrole live_ai_03b_executor -v ON_ERROR_STOP=1 -v verified_claims_json="$1" -v execution_id="$2" < "$SQLD/m7-v2-06-catalog-restoration.sql" 2>&1; }
app()  { q -v ON_ERROR_STOP=1 "${@:2}" < "$SQLD/$1" 2>&1; }   # stdin: psql runs as the postgres OS user
v2v()  { t "SELECT status||':'||catalog_digest FROM public.budget_price_catalog_versions WHERE id='$V2'"; }
ledg() { t "SELECT count(*) FROM live_ai_03b_trusted.approval_consumption"; }
nact() { t "SELECT (SELECT count(*) FROM public.budget_price_catalog_versions WHERE status='active')||'/'||(SELECT count(*) FROM public.budget_price_catalog_entries WHERE status='active')"; }
m6v()  { q -v ON_ERROR_STOP=1 < "$M6VERIFY" 2>&1 | grep -c "ALL HARD CHECKS PASSED"; }
m7v()  { app m7-v2-08-post-apply-verification.sql | grep -c "M7 V2 POST-APPLY VERIFICATION: ALL HARD CHECKS PASSED"; }
INACT=$(node -e 'import("'"$M7"'/catalog/v2-digest-gen.mjs").then(g=>process.stdout.write(g.v2Inactive.digest))')
ACT=$(node -e 'import("'"$M7"'/catalog/v2-digest-gen.mjs").then(g=>process.stdout.write(g.v2Active.digest))')
T0=$(cat "$M7/T0.txt")
setup() { fresh; EXPW; app m7-v2-01-inactive-catalog-seed.sql >/dev/null; app m7-v2-02-trusted-successor-migration.sql >/dev/null; }
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

echo "• server: $(fresh; t 'SHOW server_version')"

# ═════════ 1. seed + trusted successor apply on the exact post-M6 state ═════════
fresh; EXPW
okc "PRE the frozen M6 canonical verifier passes on the post-M6 base (#56)" '[ "$(m6v)" = 1 ]'
out=$(app m7-v2-01-inactive-catalog-seed.sql); okc "01 exact 3-row inactive V2 seed accepted (#3)" 'has "$out" "M7 V2 inactive seed OK" && has "$out" COMMIT'
okc "01 V2 inactive with the reviewed digest" '[ "$(v2v)" = "inactive:$INACT" ]'
okc "01 exactly 3 V2 entries (base in / cache_write in / base out)" '[ "$(t "SELECT string_agg(COALESCE(service_tier,'"'"'-'"'"')||'"'"'@'"'"'||billing_dimension||'"'"'='"'"'||rate_micros, '"'"','"'"' ORDER BY id) FROM public.budget_price_catalog_entries WHERE catalog_version_id='"'"'$V2'"'"'")" = "-@reasoning_input_token=2000000,cache_write@reasoning_input_token=2500000,-@reasoning_output_token=12000000" ]'
okc "01 all three V2 entries: verified_at=T0, expiry=T0+7d" '[ "$(t "SELECT count(*) FROM public.budget_price_catalog_entries WHERE catalog_version_id='"'"'$V2'"'"' AND verified_at='"'"'$T0'"'"'::timestamptz AND verification_expires_at='"'"'$T0'"'"'::timestamptz + interval '"'"'7 days'"'"'")" = 3 ]'
okc "01 V1 historical rows untouched (expiry 2026-09-25T18:37:35Z, inactive)" '[ "$(t "SELECT count(*) FROM public.budget_price_catalog_entries WHERE catalog_version_id='"'"'$V1'"'"' AND status='"'"'inactive'"'"' AND verification_expires_at='"'"'2026-09-25T18:37:35Z'"'"'::timestamptz")" = 2 ]'
out=$(app m7-v2-01-inactive-catalog-seed.sql); okc "01 re-run fails closed (create-once) and changes nothing" 'has "$out" "ERROR" && [ "$(t "SELECT count(*) FROM public.budget_price_catalog_entries")" = 5 ]'
out=$(app m7-v2-02-trusted-successor-migration.sql); okc "02 trusted successor applied (2 SECURITY DEFINER fns, executor-only)" 'has "$out" "M7 trusted successor OK" && has "$out" COMMIT'
out=$(app m7-v2-02-trusted-successor-migration.sql); okc "02 re-run fails closed (create-once)" 'has "$out" "ERROR"'
okc "08 successor post-apply verifier passes" '[ "$(m7v)" = 1 ]'
okc "M6 canonical verifier STILL passes after the successor (M6 boundary not weakened) (#56)" '[ "$(m6v)" = 1 ]'
okc "M6 trusted schema still holds exactly 2 functions (frozen)" '[ "$(t "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='"'"'live_ai_03b_trusted'"'"'")" = 2 ]'

# ═════════ 2. V1 historical: cannot activate, cannot be extended ═════════
NB=$(date -u -d '-10 min' +%Y-%m-%dT%H:%M:%SZ); NE=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
V1CL='{"contract":"VerifiedApprovalClaimsV1","approval_id":"v1-appr-test-0001","execution_id":"v1-exec-test-0001","content_digest":"'$(printf 'a%.0s' {1..64})'","active_catalog_digest":"616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8","inactive_catalog_digest":"453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973","catalog_verification_expiry":"2026-09-25T18:37:35Z","approval_not_before":"'$NB'","approval_expiry":"'$NE'","evidence_verified_at":"'$NB'","evidence_expiry":"'$NE'"}'
out=$(asrole live_ai_03b_executor -v ON_ERROR_STOP=1 -c "SELECT live_ai_03b_trusted.activate_catalog('$V1CL'::jsonb,'v1-exec-test-0001')" 2>&1)
okc "V1 (expired) activation via the frozen M6 trusted fn fails closed at the DB clock (#1)" 'has "$out" "catalog verification expired" && [ "$(nact)" = "0/0" ] && [ "$(ledg)" = 0 ]'
out=$(asrole live_ai_03b_executor -c "UPDATE public.budget_price_catalog_entries SET verification_expires_at='2026-12-31T00:00:00Z' WHERE catalog_version_id='$V1'" 2>&1)
okc "executor cannot extend V1 expiry in place (no table privilege) (#2/#40)" 'has "$out" "permission denied"'
out=$(asrole live_ai_03b_executor -c "UPDATE public.budget_price_catalog_versions SET status='active' WHERE id='$V2'" 2>&1)
okc "executor direct catalog mutation denied (#40)" 'has "$out" "permission denied" && [ "$(v2v)" = "inactive:$INACT" ]'
out=$(asrole live_ai_03b_executor -c "INSERT INTO live_ai_03b_trusted.approval_consumption VALUES ('x','y','z','w','activate')" 2>&1)
okc "executor direct ledger write denied" 'has "$out" "permission denied"'
out=$(asrole live_ai_03b_executor -c "CREATE FUNCTION live_ai_03b_trusted_v2.x() RETURNS int LANGUAGE sql AS 'select 1'" 2>&1)
okc "executor cannot CREATE in the successor schema" 'has "$out" "permission denied"'

# ═════════ 3. who may execute (reader / gateway-store / PUBLIC) ═════════
C0=$($MK appr-acl-00000001 exec-acl-00000001)
out=$(asrole live_ai_03b_reader -c "SELECT live_ai_03b_trusted_v2.activate_catalog_v2('$C0'::jsonb,'exec-acl-00000001')" 2>&1)
okc "reader activation denied (#41)" 'has "$out" "permission denied"'
out=$(asrole live_ai_03b_gateway_store -c "SELECT live_ai_03b_trusted_v2.activate_catalog_v2('$C0'::jsonb,'exec-acl-00000001')" 2>&1)
okc "gateway-store activation denied (#42)" 'has "$out" "permission denied"'
q -q -c "CREATE ROLE m7_public_probe LOGIN" >/dev/null
out=$(asrole m7_public_probe -c "SELECT live_ai_03b_trusted_v2.activate_catalog_v2('$C0'::jsonb,'exec-acl-00000001')" 2>&1)
okc "PUBLIC (a role with no grants) activation denied (#43)" 'has "$out" "permission denied"'
out=$(asrole m7_public_probe -c "SELECT live_ai_03b_trusted_v2.restore_catalog_v2_inactive('$C0'::jsonb,'exec-acl-00000001')" 2>&1)
okc "PUBLIC restoration denied (#43)" 'has "$out" "permission denied"'
out=$(asrole live_ai_03b_gateway_store -c "UPDATE public.budget_price_catalog_versions SET status='active' WHERE id='$V2'" 2>&1)
okc "gateway-store direct catalog activation denied (#42)" 'has "$out" "permission denied" || has "$out" "live_ai_03b"'
okc "no ACL/claims attempt consumed an approval or activated anything" '[ "$(ledg)" = 0 ] && [ "$(nact)" = "0/0" ]'

# ═════════ 4. DB-side claims negatives (each must fail, consume nothing, change nothing) ═════════
mkdir -p "$M7/tests/out"; REASONS="$M7/tests/out/negative-reasons-$(t 'SHOW server_version_num').log"; : > "$REASONS"
neg() { local o; o=$(act "$($MK "$2" "$3" "$4")" "$3"); echo "$1 :: $(echo "$o" | grep -m1 ERROR)" >> "$REASONS"; okc "$1" 'has "$o" "ERROR" && ! has "$o" "syntax error" && [ "$(ledg)" = 0 ] && [ "$(v2v)" = "inactive:$INACT" ]'; }
neg "wrong contract rejected"                        appr-neg-00000001 exec-neg-00000001 '{"contract":"VerifiedApprovalClaimsV1"}'
neg "extra claim key (approved:true) rejected (#28)" appr-neg-00000002 exec-neg-00000002 '{"approved":true}'
neg "missing claim key rejected"                     appr-neg-00000003 exec-neg-00000003 '{"__delete":["cache_write_rate_micros"]}'
neg "arbitrary catalog ID rejected (#31)"            appr-neg-00000004 exec-neg-00000004 '{"catalog_version_id":"'$V1'"}'
neg "arbitrary caller inactive digest rejected (#32)" appr-neg-00000005 exec-neg-00000005 '{"inactive_catalog_digest":"'$(printf 'b%.0s' {1..64})'"}'
neg "arbitrary caller active digest rejected (#32)"  appr-neg-00000006 exec-neg-00000006 '{"active_catalog_digest":"616cc481e8cc342462445da5ededa142ec4450f38805edd91ed798554f3c24f8"}'
neg "old one-call policy digest rejected (#20/#21)"  appr-neg-00000007 exec-neg-00000007 '{"one_call_policy_digest":"9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c"}'
neg "89536 ceiling claim rejected (#21)"             appr-neg-00000008 exec-neg-00000008 '{"one_call_money_ceiling_micros":89536}'
neg "Priority/Fast service tier rejected (#33)"      appr-neg-00000009 exec-neg-00000009 '{"service_tier":"priority"}'
neg "Flex service tier rejected (#35)"               appr-neg-00000010 exec-neg-00000010 '{"service_tier":"flex"}'
neg "Batch processing mode rejected (#34)"           appr-neg-00000011 exec-neg-00000011 '{"processing_mode":"batch"}'
neg "regional uplift rejected (#32)"                 appr-neg-00000012 exec-neg-00000012 '{"regional_uplift":true}'
neg "long-context rejected (#36)"                    appr-neg-00000013 exec-neg-00000013 '{"context_tier":"long"}'
neg "wrong cache-write rate rejected (#6)"           appr-neg-00000014 exec-neg-00000014 '{"cache_write_rate_micros":2400000}'
neg "CORE-PROD target rejected (#53)"                appr-neg-00000015 exec-neg-00000015 '{"ai_staging_postgres":"1fbd7632-95ad-46f3-a20c-5be5b8e44e6b"}'
neg "expired approval window rejected"               appr-neg-00000016 exec-neg-00000016 '{"approval_expiry":"2026-09-28T15:27:00Z","approval_not_before":"2026-09-28T15:26:30Z"}'
neg "evidence window outliving V2 rejected"          appr-neg-00000017 exec-neg-00000017 '{"evidence_expiry":"2026-10-06T00:00:00Z"}'
neg "wrong source digest rejected (#18)"             appr-neg-00000018 exec-neg-00000018 '{"source_digest":"fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3"}'
o=$(act "$($MK appr-neg-00000019 exec-neg-00000019)" "exec-neg-other-19"); okc "execution id not bound to claims rejected" 'has "$o" "not bound" && [ "$(ledg)" = 0 ]'
o=$(act "$($MK "appr'; DROP TABLE x; --" exec-neg-00000020)" exec-neg-00000020); okc "malformed / injection-shaped approval id rejected" 'has "$o" "ERROR" && [ "$(ledg)" = 0 ]'

# ═════════ 5. predecessor-state negatives (tamper → activation fails closed → revert) ═════════
pneg() { q -q -c "$2" >/dev/null 2>&1; local o; o=$(act "$($MK "$4" "$5")" "$5"); echo "$1 :: $(echo "$o" | grep -m1 ERROR)" >> "$REASONS"; okc "$1" 'has "$o" "ERROR" && ! has "$o" "syntax error" && [ "$(ledg)" = 0 ] && [ "$(nact)" != "1/3" ]'; q -q -c "$3" >/dev/null 2>&1; }
CWID="$V2-reasoning-input-token-cache-write"
pneg "missing cache-write row rejected (#5)" "CREATE TABLE public.m7_test_bak AS SELECT * FROM public.budget_price_catalog_entries WHERE id='$CWID'; DELETE FROM public.budget_price_catalog_entries WHERE id='$CWID'" "INSERT INTO public.budget_price_catalog_entries SELECT * FROM public.m7_test_bak; DROP TABLE public.m7_test_bak" appr-pre-00000001 exec-pre-00000001
pneg "wrong cache-write rate rejected (#6)" "UPDATE public.budget_price_catalog_entries SET rate_micros=2400000 WHERE id='$CWID'" "UPDATE public.budget_price_catalog_entries SET rate_micros=2500000 WHERE id='$CWID'" appr-pre-00000002 exec-pre-00000002
pneg "wrong base input rate rejected (#8)" "UPDATE public.budget_price_catalog_entries SET rate_micros=1900000 WHERE id='$V2-reasoning-input-token-base'" "UPDATE public.budget_price_catalog_entries SET rate_micros=2000000 WHERE id='$V2-reasoning-input-token-base'" appr-pre-00000003 exec-pre-00000003
pneg "wrong output rate rejected (#9)" "UPDATE public.budget_price_catalog_entries SET rate_micros=11000000 WHERE id='$V2-reasoning-output-token-base'" "UPDATE public.budget_price_catalog_entries SET rate_micros=12000000 WHERE id='$V2-reasoning-output-token-base'" appr-pre-00000004 exec-pre-00000004
pneg "wrong unit size rejected (#10)" "UPDATE public.budget_price_catalog_entries SET unit_size=1000 WHERE id='$V2-reasoning-output-token-base'" "UPDATE public.budget_price_catalog_entries SET unit_size=1000000 WHERE id='$V2-reasoning-output-token-base'" appr-pre-00000005 exec-pre-00000005
pneg "duplicate V2 entry rejected (#13)" "INSERT INTO public.budget_price_catalog_entries SELECT id||'-dup', catalog_version_id, provider, model, service_tier, billing_dimension, currency_code, unit_size, rate_micros, effective_from, effective_until, verified_at, verification_expires_at, source_id, source_digest, status, created_at FROM public.budget_price_catalog_entries WHERE id='$CWID'" "DELETE FROM public.budget_price_catalog_entries WHERE id='$CWID-dup'" appr-pre-00000006 exec-pre-00000006
pneg "overlapping active authority rejected (#14)" "INSERT INTO public.budget_price_catalog_versions VALUES ('rogue-active','active',now(),NULL,'x',now())" "DELETE FROM public.budget_price_catalog_versions WHERE id='rogue-active'" appr-pre-00000007 exec-pre-00000007
pneg "simultaneously active V1 + V2 rejected (V1 active pre-state) (#15/#30)" "UPDATE public.budget_price_catalog_versions SET status='active' WHERE id='$V1'" "UPDATE public.budget_price_catalog_versions SET status='inactive' WHERE id='$V1'" appr-pre-00000008 exec-pre-00000008
pneg "V1 expiry extended in place ⇒ V2 activation refuses (#2)" "UPDATE public.budget_price_catalog_entries SET verification_expires_at='2026-12-31T00:00:00Z' WHERE catalog_version_id='$V1'" "UPDATE public.budget_price_catalog_entries SET verification_expires_at='2026-09-25T18:37:35Z' WHERE catalog_version_id='$V1'" appr-pre-00000009 exec-pre-00000009
pneg "stored source digest tamper rejected (#18)" "UPDATE public.budget_price_catalog_entries SET source_digest='fda6f4a834b2277bd0ace30738cda1e8f75c0f8bc523ddbd11c966c4da52beb3' WHERE id='$CWID'" "UPDATE public.budget_price_catalog_entries SET source_digest=(SELECT source_digest FROM public.budget_price_catalog_entries WHERE id='$V2-reasoning-input-token-base') WHERE id='$CWID'" appr-pre-00000010 exec-pre-00000010
pneg "stored catalog digest tamper rejected (#19)" "UPDATE public.budget_price_catalog_versions SET catalog_digest='tampered' WHERE id='$V2'" "UPDATE public.budget_price_catalog_versions SET catalog_digest='$INACT' WHERE id='$V2'" appr-pre-00000011 exec-pre-00000011
pneg "an already-active policy (wrong gate order) rejected" "UPDATE public.budget_policy_versions SET status='active' WHERE id='live-ai-03b-policy-v1-dormant'" "UPDATE public.budget_policy_versions SET status='inactive' WHERE id='live-ai-03b-policy-v1-dormant'" appr-pre-00000012 exec-pre-00000012
pneg "controls not dormant rejected" "UPDATE public.budget_control_epochs SET enabled=true WHERE scope_type='global'" "UPDATE public.budget_control_epochs SET enabled=false WHERE scope_type='global'" appr-pre-00000013 exec-pre-00000013
okc "after every revert the exact reviewed pre-activation state is restored (08 verifier)" '[ "$(m7v)" = 1 ]'

# ═════════ 6. atomicity: a failure AFTER the ledger consume / mid-transition rolls back EVERYTHING (#46) ═════════
q -q -c "CREATE FUNCTION public.m7_test_boom() RETURNS trigger LANGUAGE plpgsql AS \$\$BEGIN RAISE EXCEPTION 'm7 test-only injected mid-transition failure'; END\$\$; CREATE TRIGGER m7_test_boom BEFORE UPDATE ON public.budget_price_catalog_entries FOR EACH ROW EXECUTE FUNCTION public.m7_test_boom();" >/dev/null
o=$(act "$($MK appr-atom-0000001 exec-atom-0000001)" exec-atom-0000001)
okc "mid-transition failure (after version UPDATE + ledger INSERT) ⇒ whole transaction rolled back (#46)" 'has "$o" "injected mid-transition failure" && [ "$(ledg)" = 0 ] && [ "$(v2v)" = "inactive:$INACT" ] && [ "$(nact)" = "0/0" ]'
q -q -c "DROP TRIGGER m7_test_boom ON public.budget_price_catalog_entries; DROP FUNCTION public.m7_test_boom();" >/dev/null
okc "the failed approval was NOT consumed (can still be used once)" '[ "$(t "SELECT count(*) FROM live_ai_03b_trusted.approval_consumption WHERE approval_id='"'"'appr-atom-0000001'"'"'")" = 0 ]'

# ═════════ 7. exact trusted activation (#44), replay (#45), E2E loader + accounting ═════════
CL=$($MK appr-live-0000001 exec-live-0000001)
o=$(act "$CL" exec-live-0000001)
okc "exact trusted successor activation allowed as the real executor login under valid claims (#44)" 'has "$o" "CatalogActivationReceiptV2" && has "$o" "COMMIT"'
okc "V2 now the ONLY active authority: 1 version / 3 entries, active digest" '[ "$(nact)" = "1/3" ] && [ "$(v2v)" = "active:$ACT" ]'
okc "V1 still historical inactive + unextended" '[ "$(t "SELECT status FROM public.budget_price_catalog_versions WHERE id='"'"'$V1'"'"'")" = inactive ] && [ "$(t "SELECT count(*) FROM public.budget_price_catalog_entries WHERE catalog_version_id='"'"'$V1'"'"' AND status='"'"'inactive'"'"' AND verification_expires_at='"'"'2026-09-25T18:37:35Z'"'"'")" = 2 ]'
okc "exactly one consumed ledger row (action activate, V2 active digest)" '[ "$(t "SELECT count(*) FROM live_ai_03b_trusted.approval_consumption WHERE approval_id='"'"'appr-live-0000001'"'"' AND action='"'"'activate'"'"' AND active_catalog_digest='"'"'$ACT'"'"'")" = 1 ]'
o=$(act "$CL" exec-live-0000001); okc "replay of the same approval rejected (#45)" 'has "$o" "replay rejected" && [ "$(ledg)" = 1 ]'
o=$(act "$($MK appr-live-0000002 exec-live-0000002)" exec-live-0000002); okc "a second (fresh) approval while V2 active rejected — no competing/duplicate authority" 'has "$o" "ERROR" && [ "$(ledg)" = 1 ] && [ "$(nact)" = "1/3" ]'
o=$(asrole live_ai_03b_executor -v ON_ERROR_STOP=1 -c "SELECT live_ai_03b_trusted.activate_catalog('$V1CL'::jsonb,'v1-exec-test-0001')" 2>&1)
okc "V1 cannot be activated alongside active V2 (#30)" 'has "$o" "ERROR" && [ "$(nact)" = "1/3" ]'
okc "M6 canonical verifier passes in the armed-catalog state" '[ "$(m6v)" = 1 ]'
o=$(M7_PG_SOCKET="$BASE/c" node "$M7/tests/m7-gateway.test.mjs" 2>&1 | tail -2)
okc "E2E: REAL loadStagingPriceCatalog loads exactly V2 (3 rows) + §16 A–I accounting on the loaded catalog" 'has "$o" "m7-gateway:" && has "$o" " 0 failed"'
echo "$o" | sed 's/^/    /'

# ═════════ 8. successor one-call policy (04) + control activation (05) ═════════
q -q -c "INSERT INTO public.budget_policy_versions VALUES ('live-ai-03b-policy-oneprobe-v1','live-ai-03b','inactive','2026-09-19T05:41:50Z',NULL,89536,1,1,89536,89536,89536,89536,'9927a920975c4e03f5cbf3adee23c34bb7396a032b00b029ba5a2c7ac0c8ec1c','2026-09-19T05:41:50Z')" >/dev/null
o=$(app m7-v2-04-one-call-policy-activation.sql); okc "04 refuses while the obsolete 89536 policy exists (#21)" 'has "$o" "ERROR" && [ "$(t "SELECT count(*) FROM public.budget_policy_versions WHERE status='"'"'active'"'"'")" = 0 ]'
q -q -c "DELETE FROM public.budget_policy_versions WHERE id='live-ai-03b-policy-oneprobe-v1'" >/dev/null
o=$(app m7-v2-04-one-call-policy-activation.sql); okc "04 exact successor 105920 policy inserted active (#22)" 'has "$o" "postcondition OK" && has "$o" COMMIT'
okc "04 FIVE money ceilings = 105920; calls = 1; admissions = 1 (#23–#25)" '[ "$(t "SELECT session_money_ceiling_micros||'"'"','"'"'||subject_day_money_ceiling_micros||'"'"','"'"'||project_day_money_ceiling_micros||'"'"','"'"'||project_month_money_ceiling_micros||'"'"','"'"'||global_day_money_ceiling_micros||'"'"'|'"'"'||session_provider_calls||'"'"','"'"'||session_execution_admissions FROM public.budget_policy_versions WHERE id='"'"'live-ai-03b-policy-oneprobe-v2'"'"' AND status='"'"'active'"'"'")" = "105920,105920,105920,105920,105920|1,1" ]'
o=$(app m7-v2-04-one-call-policy-activation.sql); okc "04 re-run fails closed (create-once)" 'has "$o" "ERROR"'
for fld in session_money_ceiling_micros project_month_money_ceiling_micros session_provider_calls; do
  for val in "+1" "-1"; do
    q -q -c "UPDATE public.budget_policy_versions SET $fld=$fld$val WHERE id='live-ai-03b-policy-oneprobe-v2'" >/dev/null
    o=$(app m7-v2-05-control-activation.sql -v control_updated_at="$(now_utc)"); okc "05 refuses a tampered ceiling ($fld $val) behind an unchanged stored digest (#26)" 'has "$o" "ceilings/identity not exact" && [ "$(t "SELECT count(*) FROM public.budget_control_epochs WHERE enabled")" = 0 ]'
    q -q -c "UPDATE public.budget_policy_versions SET $fld=$fld$( [ "$val" = "+1" ] && echo "-1" || echo "+1") WHERE id='live-ai-03b-policy-oneprobe-v2'" >/dev/null
  done
done
q -q -c "UPDATE public.budget_price_catalog_versions SET status='active' WHERE id='$V1'" >/dev/null
o=$(app m7-v2-05-control-activation.sql -v control_updated_at="$(now_utc)"); okc "05 refuses when V1 is also active (simultaneous authority) (#30)" 'has "$o" "ERROR" && [ "$(t "SELECT count(*) FROM public.budget_control_epochs WHERE enabled")" = 0 ]'
q -q -c "UPDATE public.budget_price_catalog_versions SET status='inactive' WHERE id='$V1'" >/dev/null
o=$(app m7-v2-05-control-activation.sql -v control_updated_at="$(now_utc)"); okc "05 control activation (epoch 1→2) with exact successor prerequisites" 'has "$o" "postcondition OK" && [ "$(t "SELECT string_agg(control_epoch||'"'"':'"'"'||enabled, '"'"','"'"' ORDER BY scope_type)")" != x ] && [ "$(t "SELECT count(*) FROM public.budget_control_epochs WHERE enabled AND control_epoch=2")" = 2 ]'

# ═════════ 9. durable evidence + dormant restoration (07) ═════════
q -q -c "INSERT INTO public.budget_sessions VALUES ('m7-test-bs','m7-test-gwdigest','m7-test-subject','live-ai-03b',now()); INSERT INTO public.budget_decisions VALUES ('m7-test-dec','m7-test-acq','PROVIDER_SPEND','m7-test-gwdigest','live-ai-03b','live-ai-03b-policy-oneprobe-v2','$V2','ADMITTED','m7 synthetic evidence',now())" >/dev/null
o=$(app m7-v2-07-dormant-restoration.sql -v control_updated_at="$(now_utc)")
okc "07 dormant restoration: controls epoch 3 disabled, policy + V2 inactive (#47)" 'has "$o" "dormant-restoration OK" && [ "$(nact)" = "0/0" ] && [ "$(v2v)" = "inactive:$INACT" ] && [ "$(t "SELECT count(*) FROM public.budget_control_epochs WHERE control_epoch=3 AND NOT enabled")" = 2 ]'
okc "07 V1 never revived; historical + unextended (#48)" '[ "$(t "SELECT count(*) FROM public.budget_price_catalog_versions WHERE id='"'"'$V1'"'"' AND status='"'"'inactive'"'"' AND catalog_digest='"'"'453f928762b8e6cddedac8618786d008cb7a3d57ffefab9d0cfe3cda52c4c973'"'"'")" = 1 ]'
okc "07 accounting evidence + consumed approval ledger preserved (#49)" '[ "$(t "SELECT (SELECT count(*) FROM public.budget_sessions)+(SELECT count(*) FROM public.budget_decisions)")" = 2 ] && [ "$(ledg)" = 1 ]'
okc "07 successor policy restored with the reviewed restored digest" '[ "$(t "SELECT status||'"'"':'"'"'||policy_digest FROM public.budget_policy_versions WHERE id='"'"'live-ai-03b-policy-oneprobe-v2'"'"'")" = "inactive:833e5b963bbba37e6e6759e60269246ba8c61949257f5bb9edf49cc82829da79" ]'
o=$(app m7-v2-07-dormant-restoration.sql -v control_updated_at="$(now_utc)"); okc "07 idempotent re-run: already restored, no rewrite" 'has "$o" "already restored" && [ "$(ledg)" = 1 ]'
okc "M6 canonical verifier passes after restoration" '[ "$(m6v)" = 1 ]'

# ═════════ 10. trusted restoration path (06) + idempotency + ambiguous-state HOLD ═════════
setup
o=$(act "$($MK appr-rst-0000001 exec-rst-0000001)" exec-rst-0000001); okc "06-flow: activation ok" 'has "$o" "CatalogActivationReceiptV2"'
RC=$($MK appr-rst-0000001 exec-rst-0000001)
q -q -c "UPDATE public.budget_price_catalog_entries SET status='inactive' WHERE id='$CWID'" >/dev/null
o=$(rest "$RC" exec-rst-0000001); okc "06 ambiguous/mixed state ⇒ HOLD (fail closed, nothing consumed)" 'has "$o" "ambiguous, HOLD" && [ "$(ledg)" = 1 ]'
q -q -c "UPDATE public.budget_price_catalog_entries SET status='active' WHERE id='$CWID'" >/dev/null
o=$(rest "$RC" exec-rst-0000001); okc "06 trusted restoration returns the exact reviewed inactive V2 (#47)" 'has "$o" "\"status\": \"restored\"" && [ "$(nact)" = "0/0" ] && [ "$(v2v)" = "inactive:$INACT" ]'
okc "06 restoration consumed its own single-use ledger row; activation row preserved (#49)" '[ "$(ledg)" = 2 ] && [ "$(t "SELECT count(*) FROM live_ai_03b_trusted.approval_consumption WHERE action='"'"'restore'"'"' AND approval_id='"'"'appr-rst-0000001:restore-v2'"'"'")" = 1 ]'
o=$(rest "$RC" exec-rst-0000001); okc "06 re-run is idempotent (already_restored; no new ledger row)" 'has "$o" "already_restored" && [ "$(ledg)" = 2 ]'
okc "06 V1 never revived (#48)" '[ "$(t "SELECT status FROM public.budget_price_catalog_versions WHERE id='"'"'$V1'"'"'")" = inactive ]'
o=$(act "$($MK appr-rst-0000001 exec-rst-0000001)" exec-rst-0000001); okc "re-activation with the consumed approval after restore rejected (replay)" 'has "$o" "replay rejected"'
okc "08 verifier refuses the post-lifecycle state (a V2 approval already consumed — not a fresh pre-activation state)" '[ "$(m7v)" = 0 ]'

# ═════════ 11. boundary drift is detected (owner / search_path / privilege widening) (#50–#52) ═════════
setup
FN="live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)"
drift() { q -q -c "$2" >/dev/null 2>&1; okc "$1" '[ "$(m7v)" = 0 ]'; q -q -c "$3" >/dev/null 2>&1; }
drift "wrong function owner rejected by the verifier (#50)" "ALTER FUNCTION $FN OWNER TO postgres" "ALTER FUNCTION $FN OWNER TO live_ai_03b_fn_owner"
drift "non-empty search_path rejected (#51)" "ALTER FUNCTION $FN SET search_path = public" "ALTER FUNCTION $FN SET search_path = ''"
drift "SECURITY INVOKER downgrade rejected" "ALTER FUNCTION $FN SECURITY INVOKER" "ALTER FUNCTION $FN SECURITY DEFINER"
drift "EXECUTE granted to the reader rejected (#52)" "GRANT EXECUTE ON FUNCTION $FN TO live_ai_03b_reader" "REVOKE EXECUTE ON FUNCTION $FN FROM live_ai_03b_reader"
drift "EXECUTE granted to PUBLIC rejected (#52)" "GRANT EXECUTE ON FUNCTION $FN TO PUBLIC" "REVOKE EXECUTE ON FUNCTION $FN FROM PUBLIC"
drift "schema USAGE granted to gateway-store rejected (#52)" "GRANT USAGE ON SCHEMA live_ai_03b_trusted_v2 TO live_ai_03b_gateway_store" "REVOKE USAGE ON SCHEMA live_ai_03b_trusted_v2 FROM live_ai_03b_gateway_store"
drift "schema CREATE granted to the executor rejected (#52)" "GRANT CREATE ON SCHEMA live_ai_03b_trusted_v2 TO live_ai_03b_executor" "REVOKE CREATE ON SCHEMA live_ai_03b_trusted_v2 FROM live_ai_03b_executor"
drift "direct catalog UPDATE granted to the executor rejected (#52)" "GRANT UPDATE ON public.budget_price_catalog_versions TO live_ai_03b_executor" "REVOKE UPDATE ON public.budget_price_catalog_versions FROM live_ai_03b_executor"
drift "catalog write granted to gateway-store rejected (#52)" "GRANT UPDATE ON public.budget_price_catalog_entries TO live_ai_03b_gateway_store" "REVOKE UPDATE ON public.budget_price_catalog_entries FROM live_ai_03b_gateway_store"
drift "extra function in the successor schema rejected" "CREATE FUNCTION live_ai_03b_trusted_v2.extra() RETURNS int LANGUAGE sql AS 'select 1'" "DROP FUNCTION live_ai_03b_trusted_v2.extra()"
okc "after reverting every drift the verifier passes again" '[ "$(m7v)" = 1 ] && [ "$(m6v)" = 1 ]'

# ═════════ 12. stale (#16) / future verified_at (#17) at the DB clock (literal-shifted TEST copies) ═════════
EXPLIT=$(node -e 'import("'"$M7"'/catalog/v2-digest-gen.mjs").then(g=>process.stdout.write(g.T0_PLUS_7_DAYS))')
for mode in stale future; do
  fresh; EXPW; app m7-v2-01-inactive-catalog-seed.sql >/dev/null
  if [ $mode = stale ]; then
    sed "s/IF NOT (v_now < TIMESTAMPTZ '$EXPLIT') THEN/IF NOT (v_now < TIMESTAMPTZ '2026-09-28T00:00:00Z') THEN/" "$SQLD/m7-v2-02-trusted-successor-migration.sql" > "$BASE/shift.sql"
  else
    sed "s/IF v_now < TIMESTAMPTZ '$T0' THEN RAISE EXCEPTION 'activate_v2: V2 verified_at is in the future/IF v_now < TIMESTAMPTZ '2099-01-01T00:00:00Z' THEN RAISE EXCEPTION 'activate_v2: V2 verified_at is in the future/" "$SQLD/m7-v2-02-trusted-successor-migration.sql" > "$BASE/shift.sql"
  fi
  okc "$mode: test copy differs from the reviewed migration by exactly one line" '[ "$(diff "$SQLD/m7-v2-02-trusted-successor-migration.sql" "$BASE/shift.sql" | grep -c "^>")" = 1 ]'
  q -v ON_ERROR_STOP=1 < "$BASE/shift.sql" >/dev/null 2>&1
  o=$(act "$($MK appr-clk-0000001 exec-clk-0000001)" exec-clk-0000001)
  if [ $mode = stale ]; then okc "stale V2 (DB clock ≥ verification expiry) rejected at the mutation boundary (#16)" 'has "$o" "verification expired at DB clock" && [ "$(ledg)" = 0 ] && [ "$(nact)" = "0/0" ]'
  else okc "future verified_at (DB clock < T0) rejected (#17)" 'has "$o" "verified_at is in the future" && [ "$(ledg)" = 0 ] && [ "$(nact)" = "0/0" ]'; fi
done

# ═════════ 13. successor rollback (09): pre-activation only; never after a V2 consumption ═════════
setup
o=$(app m7-v2-09-successor-rollback.sql); okc "09 pre-activation rollback removes only the successor schema" 'has "$o" "successor rollback OK" && [ "$(t "SELECT count(*) FROM pg_namespace WHERE nspname='"'"'live_ai_03b_trusted_v2'"'"'")" = 0 ] && [ "$(m6v)" = 1 ] && [ "$(v2v)" = "inactive:$INACT" ]'
app m7-v2-02-trusted-successor-migration.sql >/dev/null
act "$($MK appr-rb-00000001 exec-rb-00000001)" exec-rb-00000001 >/dev/null
o=$(app m7-v2-09-successor-rollback.sql); okc "09 refuses after a V2 approval was consumed (HOLD; use restoration)" 'has "$o" "ERROR" && [ "$(t "SELECT count(*) FROM pg_namespace WHERE nspname='"'"'live_ai_03b_trusted_v2'"'"'")" = 1 ] && [ "$(ledg)" = 1 ]'

# ═════════ 14. no secret / provider authority introduced (#54/#55) ═════════
okc "M7 artifacts create/alter NO role and set NO password (only this TEST sets a synthetic executor pw)" '! grep -Eiq "CREATE ROLE|ALTER ROLE|PASSWORD" "$SQLD"/m7-v2-0*.sql'
okc "M7 SQL grants nothing to PUBLIC / reader / gateway-store" '! grep -Eiq "GRANT[^;]*TO (PUBLIC|live_ai_03b_reader|live_ai_03b_gateway_store)" "$SQLD"/m7-v2-0*.sql'

echo "m7-localpg: $PASS passed, $FAIL failed ($(t 'SHOW server_version' | cut -d' ' -f1); throwaway local cluster)"
[ "$FAIL" = 0 ]
