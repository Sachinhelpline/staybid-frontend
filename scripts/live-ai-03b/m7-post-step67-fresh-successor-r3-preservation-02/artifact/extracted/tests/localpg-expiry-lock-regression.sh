#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/tests/interleaving-proof-gate.sh"

# macOS/Linux portable PostgreSQL binary selection.
# If M7_R1_PGBIN is supplied, use exactly that reviewed local binary directory.
# Otherwise auto-detect only supported majors (18, then 16). Never fall through to PG15.
if [ -n "${M7_R1_PGBIN:-}" ]; then
  [ -d "$M7_R1_PGBIN" ] || { echo "LOCALPG_PGBIN_NOT_FOUND:$M7_R1_PGBIN"; exit 77; }
  PATH="$M7_R1_PGBIN:$PATH"
else
  for d in \
    /opt/homebrew/opt/postgresql@18/bin \
    /opt/homebrew/opt/postgresql@16/bin \
    /usr/local/opt/postgresql@18/bin \
    /usr/local/opt/postgresql@16/bin; do
    if [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && [ -x "$d/psql" ] && [ -x "$d/postgres" ]; then
      PATH="$d:$PATH"
      break
    fi
  done
fi

for b in initdb pg_ctl psql postgres; do
  command -v "$b" >/dev/null || { echo "LOCALPG_REQUIRED_BINARY_MISSING:$b"; exit 77; }
done

TMP="$(mktemp -d)"; PGDATA="$TMP/pgdata"; SOCK="$TMP/sock"; mkdir -p "$SOCK"; PORT=$((42000 + ($$ % 1000)))
BPID=""; APID=""; BLOCKER_DB_PID=""; ACTIVATION_DB_PID=""
cleanup(){
  set +e
  [ -n "$APID" ] && kill "$APID" >/dev/null 2>&1
  [ -n "$BPID" ] && kill "$BPID" >/dev/null 2>&1
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

initdb -D "$PGDATA" -A trust --no-locale -E UTF8 >/dev/null
pg_ctl -D "$PGDATA" -o "-F -k $SOCK -p $PORT" -w start >/dev/null
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -d postgres)
VNUM="$("${PSQL[@]}" -Atc "SHOW server_version_num")"; VMAJOR=$((VNUM/10000))
if [ "$VMAJOR" -ne 16 ] && [ "$VMAJOR" -ne 18 ]; then echo "LOCALPG_UNSUPPORTED_MAJOR:$VMAJOR"; exit 78; fi
OWNER="$(id -un)"
node "$ROOT/tests/make-localpg-fixture.mjs" > "$TMP/fixture.sql"
"${PSQL[@]}" -U "$OWNER" -f "$TMP/fixture.sql" >/dev/null
"${PSQL[@]}" -U "$OWNER" -f "$ROOT/sql/m7-v3-01-inactive-catalog-seed.sql" >/dev/null
"${PSQL[@]}" -U "$OWNER" -f "$ROOT/sql/m7-v3-02-trusted-successor-migration.sql" >/dev/null

BLOCKER_APP="m7_r3_blocker_$$"
ACTIVATION_APP="m7_r3_activation_$$"
CONTROL_APP="m7_r3_control_$$"

# Backend A: acquire the exact V3 catalog-version row lock and hold it.
cat > "$TMP/blocker.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SELECT id FROM public.budget_price_catalog_versions
 WHERE id='openai-gpt-5-6-terra-standard-short-v3'
 FOR UPDATE;
SELECT pg_sleep(60);
COMMIT;
SQL
PGAPPNAME="$BLOCKER_APP" "${PSQL[@]}" -U "$OWNER" -f "$TMP/blocker.sql" >"$TMP/blocker.log" 2>&1 & BPID=$!

# A is ready only when it has acquired the row lock and is sleeping.
for _ in $(seq 1 100); do
  BLOCKER_ROW="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -AtF '|' -c "SELECT pid,state,coalesce(wait_event_type,''),coalesce(wait_event,'') FROM pg_stat_activity WHERE application_name='$BLOCKER_APP';" 2>/dev/null || true)"
  IFS='|' read -r maybe_pid maybe_state maybe_wtype maybe_wevent <<EOF_ROW
$BLOCKER_ROW
EOF_ROW
  if [[ "${maybe_pid:-}" =~ ^[0-9]+$ ]] && [ "${maybe_state:-}" = "active" ] && [ "${maybe_wevent:-}" = "PgSleep" ]; then
    BLOCKER_DB_PID="$maybe_pid"
    break
  fi
  sleep 0.1
done
[ -n "$BLOCKER_DB_PID" ] || { echo "FAIL blocker backend never reached post-lock PgSleep"; cat "$TMP/blocker.log"; exit 1; }

# Derive the deadline from PostgreSQL clock. Ten seconds leaves time to prove the
# complete single-row pre-expiry conjunction even on slower Intel Macs.
EXPIRY="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -Atc "SELECT to_char((clock_timestamp() + interval '10 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');")"
node "$ROOT/tests/make-valid-claims-v3.mjs" "$EXPIRY" execution-v3-lock-race-0001 > "$TMP/claims.json"

# Backend B: activation starts asynchronously.
set +e
PGAPPNAME="$ACTIVATION_APP" "${PSQL[@]}" -U live_ai_03b_executor \
  -v verified_claims_json="$(cat "$TMP/claims.json")" \
  -v execution_id=execution-v3-lock-race-0001 \
  -f "$ROOT/sql/m7-v3-03-catalog-activation.sql" >"$TMP/activate.log" 2>&1 & APID=$!
set -e

# R3: NO sticky flags. A PRE proof is created only if ONE MATERIALIZED PostgreSQL
# observation samples one DB timestamp and simultaneously proves the complete
# conjunction: exact B, distinct observer/A/B, active Lock wait, exact sole A,
# and sampled DB time strictly before expiry.
PRE_PROVEN=0; PRE_OBS=""; PRE_GATE=""
for _ in $(seq 1 100); do
  PRE_OBS="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -AtF '|' -c "
    WITH obs AS MATERIALIZED (
      SELECT clock_timestamp() AS observed_at, pg_backend_pid() AS observer_pid
    ), act AS MATERIALIZED (
      SELECT a.pid,a.state,coalesce(a.wait_event_type,'') AS wtype,
             coalesce(a.wait_event,'') AS wevent,pg_blocking_pids(a.pid) AS blockers
        FROM pg_stat_activity a
       WHERE a.application_name='$ACTIVATION_APP'
    )
    SELECT a.pid,
           obs.observer_pid,
           $BLOCKER_DB_PID,
           a.state,
           a.wtype,
           a.wevent,
           CASE WHEN obs.observed_at < TIMESTAMPTZ '$EXPIRY' THEN 1 ELSE 0 END,
           CASE WHEN $BLOCKER_DB_PID = ANY(a.blockers) THEN 1 ELSE 0 END,
           cardinality(a.blockers),
           to_char(obs.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
           '$EXPIRY'
      FROM act a CROSS JOIN obs;" 2>/dev/null || true)"
  set +e
  PRE_GATE="$(m7_r3_pre_observation_gate "$PRE_OBS" "$BLOCKER_DB_PID" "$EXPIRY" 2>&1)"; PRE_RC=$?
  set -e
  if [ "$PRE_RC" -eq 0 ]; then
    IFS='|' read -r ACTIVATION_DB_PID PRE_OBSERVER_PID PRE_BLOCKER_PID PRE_STATE PRE_WTYPE PRE_WEVENT PRE_BEFORE PRE_EXACT PRE_COUNT PRE_AT PRE_EXPIRY_TEXT <<EOF_ROW
$PRE_OBS
EOF_ROW
    PRE_PROVEN=1
    echo "R3_PRE_EXPIRY_SINGLE_OBSERVATION_PROVEN activation_pid=$ACTIVATION_DB_PID blocker_pid=$BLOCKER_DB_PID observer_pid=$PRE_OBSERVER_PID db_observed_at=$PRE_AT expiry=$EXPIRY wait_event=$PRE_WEVENT blocker_count=$PRE_COUNT"
    break
  fi
  # Once DB expiry is reached, no later row may be repurposed as pre-expiry proof.
  expired_now="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -Atc "SELECT CASE WHEN clock_timestamp() >= TIMESTAMPTZ '$EXPIRY' THEN 1 ELSE 0 END;" 2>/dev/null || echo 1)"
  [ "$expired_now" = "0" ] || break
  sleep 0.1
done
[ "$PRE_PROVEN" -eq 1 ] || { echo "FAIL R3 no single qualifying pre-expiry observation row observation=$PRE_OBS gate=$PRE_GATE"; exit 1; }

# Hold A until the database clock crosses expiry. This loop does not contribute
# any PRE proof state; PRE is already immutable from the one qualifying row.
CROSSED_EXPIRY=0
for _ in $(seq 1 200); do
  crossed="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -Atc "SELECT CASE WHEN clock_timestamp() >= TIMESTAMPTZ '$EXPIRY' THEN 1 ELSE 0 END;" 2>/dev/null || echo 0)"
  if [ "$crossed" = "1" ]; then CROSSED_EXPIRY=1; break; fi
  sleep 0.1
done
[ "$CROSSED_EXPIRY" -eq 1 ] || { echo "FAIL database clock never crossed expiry"; exit 1; }

# R3 POST proof is also one MATERIALIZED observation row. It must show the SAME
# activation PID B still actively Lock-waiting on the SAME sole blocker A at/after
# expiry, with a distinct observer backend. Only after this gate passes may A be released.
POST_OBS="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -AtF '|' -c "
  WITH obs AS MATERIALIZED (
    SELECT clock_timestamp() AS observed_at, pg_backend_pid() AS observer_pid
  ), act AS MATERIALIZED (
    SELECT a.pid,a.state,coalesce(a.wait_event_type,'') AS wtype,
           coalesce(a.wait_event,'') AS wevent,pg_blocking_pids(a.pid) AS blockers
      FROM pg_stat_activity a
     WHERE a.application_name='$ACTIVATION_APP' AND a.pid=$ACTIVATION_DB_PID
  )
  SELECT a.pid,
         obs.observer_pid,
         $BLOCKER_DB_PID,
         a.state,
         a.wtype,
         a.wevent,
         CASE WHEN obs.observed_at >= TIMESTAMPTZ '$EXPIRY' THEN 1 ELSE 0 END,
         CASE WHEN $BLOCKER_DB_PID = ANY(a.blockers) THEN 1 ELSE 0 END,
         cardinality(a.blockers),
         to_char(obs.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
         '$EXPIRY'
    FROM act a CROSS JOIN obs;" 2>/dev/null || true)"
set +e
POST_GATE="$(m7_r3_post_observation_gate "$POST_OBS" "$ACTIVATION_DB_PID" "$BLOCKER_DB_PID" "$EXPIRY" 2>&1)"; POST_RC=$?
set -e
[ "$POST_RC" -eq 0 ] || { echo "FAIL R3 no single qualifying post-expiry observation row observation=$POST_OBS gate=$POST_GATE"; exit 1; }
IFS='|' read -r POST_PID POST_OBSERVER_PID POST_BLOCKER_PID POST_STATE POST_WTYPE POST_WEVENT POST_EXPIRED POST_EXACT POST_COUNT POST_AT POST_EXPIRY_TEXT <<EOF_ROW
$POST_OBS
EOF_ROW
POST_PROVEN=1
echo "R3_POST_EXPIRY_SINGLE_OBSERVATION_PROVEN activation_pid=$POST_PID blocker_pid=$POST_BLOCKER_PID observer_pid=$POST_OBSERVER_PID db_observed_at=$POST_AT expiry=$EXPIRY wait_event=$POST_WEVENT blocker_count=$POST_COUNT"

# Release exact blocker A only after valid PRE + POST single-row proofs.
RELEASED="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -Atc "SELECT CASE WHEN pg_terminate_backend($BLOCKER_DB_PID) THEN 1 ELSE 0 END;" 2>/dev/null || echo 0)"
[ "$RELEASED" = "1" ] || { echo "FAIL exact blocker release failed pid=$BLOCKER_DB_PID"; exit 1; }
set +e
wait "$BPID"; BRC=$?
wait "$APID"; ARC=$?
set -e
BPID=""; APID=""
[ "$ARC" -ne 0 ] || { echo "FAIL activation unexpectedly succeeded after expiry-crossing lock wait"; cat "$TMP/activate.log"; exit 1; }

# This exact race should resume after the blocking FOR UPDATE and hit the first
# mutation-boundary fresh-clock refusal. A generic/unrelated error is not enough.
FRESHNESS_REFUSAL=0
if grep -Fq 'activate_v3: mutation-boundary freshness failed' "$TMP/activate.log"; then FRESHNESS_REFUSAL=1; fi
[ "$FRESHNESS_REFUSAL" -eq 1 ] || { echo "FAIL exact mutation-boundary freshness refusal absent"; cat "$TMP/activate.log"; exit 1; }
echo "R3_FRESHNESS_REFUSAL_PROVEN activation_rc=$ARC blocker_rc=$BRC error=mutation-boundary-freshness-failed"

STATE="$(PGAPPNAME="$CONTROL_APP" "${PSQL[@]}" -U "$OWNER" -Atc "SELECT (SELECT status FROM public.budget_price_catalog_versions WHERE id='openai-gpt-5-6-terra-standard-short-v3')||'|'||(SELECT count(*) FROM public.budget_price_catalog_entries WHERE catalog_version_id='openai-gpt-5-6-terra-standard-short-v3' AND status='inactive')||'|'||(SELECT count(*) FROM live_ai_03b_trusted.approval_consumption WHERE approval_id='approval-v3-lock-race-0001');")"
ROLLBACK_CLEAN=0
[ "$STATE" = 'inactive|3|0' ] && ROLLBACK_CLEAN=1
[ "$ROLLBACK_CLEAN" -eq 1 ] || { echo "FAIL rollback state=$STATE"; exit 1; }
echo "R3_ROLLBACK_PROVEN state=$STATE"

m7_r3_completion_gate "$PRE_PROVEN" "$POST_PROVEN" "$FRESHNESS_REFUSAL" "$ROLLBACK_CLEAN" >/dev/null

echo "A1_R3_LOCALPG_SINGLE_OBSERVATION_INTERLEAVING_PASS state=$STATE activation_rc=$ARC pg_major=$VMAJOR activation_pid=$ACTIVATION_DB_PID blocker_pid=$BLOCKER_DB_PID pre_observer_pid=$PRE_OBSERVER_PID post_observer_pid=$POST_OBSERVER_PID expiry=$EXPIRY"
