#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/tests/interleaving-proof-gate.sh"

pass=0
fail=0

# Static guard against reintroducing R2's sticky proof composition defect.
HARNESS="$(cat "$ROOT/tests/localpg-expiry-lock-regression.sh")"
if grep -Eq '(^|[;[:space:]])(PRE_VALID|LOCK_WAIT|EXACT_BLOCKER)=' <<EOF_HARNESS
$HARNESS
EOF_HARNESS
then
  echo "FAIL sticky-proof-flags-absent R2 accumulation variable reintroduced"; fail=$((fail+1))
else
  echo "PASS sticky-proof-flags-absent"; pass=$((pass+1))
fi
if grep -q 'WITH obs AS MATERIALIZED' <<EOF_HARNESS
$HARNESS
EOF_HARNESS
then
  echo "PASS materialized-single-clock-observation-present"; pass=$((pass+1))
else
  echo "FAIL materialized-single-clock-observation-present"; fail=$((fail+1))
fi
ok(){ echo "PASS $1"; pass=$((pass+1)); }
bad(){ echo "FAIL $1 $2"; fail=$((fail+1)); }

expect_pre_pass(){
  local name="$1" row="$2" blocker="$3" expiry="$4"
  if m7_r3_pre_observation_gate "$row" "$blocker" "$expiry" >/dev/null 2>&1; then ok "$name"; else bad "$name" "expected pre gate PASS"; fi
}
expect_pre_refuse(){
  local name="$1" row="$2" blocker="$3" expiry="$4" out rc
  set +e; out="$(m7_r3_pre_observation_gate "$row" "$blocker" "$expiry" 2>&1)"; rc=$?; set -e
  if [ "$rc" -ne 0 ] && grep -q 'R3_PRE_GATE_REFUSED' <<EOF_OUT
$out
EOF_OUT
  then ok "$name"; else bad "$name" "expected pre refusal rc=$rc out=$out"; fi
}
expect_post_pass(){
  local name="$1" row="$2" activation="$3" blocker="$4" expiry="$5"
  if m7_r3_post_observation_gate "$row" "$activation" "$blocker" "$expiry" >/dev/null 2>&1; then ok "$name"; else bad "$name" "expected post gate PASS"; fi
}
expect_post_refuse(){
  local name="$1" row="$2" activation="$3" blocker="$4" expiry="$5" out rc
  set +e; out="$(m7_r3_post_observation_gate "$row" "$activation" "$blocker" "$expiry" 2>&1)"; rc=$?; set -e
  if [ "$rc" -ne 0 ] && grep -q 'R3_POST_GATE_REFUSED' <<EOF_OUT
$out
EOF_OUT
  then ok "$name"; else bad "$name" "expected post refusal rc=$rc out=$out"; fi
}
expect_completion_refuse(){
  local name="$1"; shift
  local out rc
  set +e; out="$(m7_r3_completion_gate "$@" 2>&1)"; rc=$?; set -e
  if [ "$rc" -ne 0 ] && grep -q 'R3_COMPLETION_GATE_REFUSED' <<EOF_OUT
$out
EOF_OUT
  then ok "$name"; else bad "$name" "expected completion refusal rc=$rc out=$out"; fi
}

EXP='2026-10-07T06:31:14Z'
VALID_PRE="200|300|100|active|Lock|transactionid|1|1|1|2026-10-07T06:31:04.622Z|$EXP"
VALID_POST="200|301|100|active|Lock|transactionid|1|1|1|2026-10-07T06:31:14.080Z|$EXP"

expect_pre_pass single-row-pre-conjunction "$VALID_PRE" 100 "$EXP"
expect_post_pass single-row-post-conjunction "$VALID_POST" 200 100 "$EXP"
if m7_r3_completion_gate 1 1 1 1 >/dev/null 2>&1; then ok all-required-proof-present; else bad all-required-proof-present "expected completion PASS"; fi

# Exact WORK-reproduced R2 defect: no single pre-expiry row has the conjunction.
# Row 1 is pre-expiry but not blocked. Row 2 is blocked by the exact blocker but
# only after expiry. Neither can satisfy the PRE gate, so they cannot accumulate.
SPLIT_PRE="200|300|100|active|Client|ClientRead|1|0|0|2026-10-07T06:31:04.622Z|$EXP"
SPLIT_AFTER="200|301|100|active|Lock|transactionid|0|1|1|2026-10-07T06:31:14.080Z|$EXP"
expect_pre_refuse split-pre-valid-but-not-blocked-refused "$SPLIT_PRE" 100 "$EXP"
expect_pre_refuse split-after-blocked-but-expired-refused "$SPLIT_AFTER" 100 "$EXP"
expect_completion_refuse split-observations-cannot-compose 0 1 1 1

expect_pre_refuse already-expired-cannot-pass "200|300|100|active|Lock|transactionid|0|1|1|2026-10-07T06:31:14.080Z|$EXP" 100 "$EXP"
expect_pre_refuse never-blocked-cannot-pass "200|300|100|active|Client|ClientRead|1|0|0|2026-10-07T06:31:04.622Z|$EXP" 100 "$EXP"
expect_pre_refuse wrong-blocker-cannot-pass "200|300|101|active|Lock|transactionid|1|1|1|2026-10-07T06:31:04.622Z|$EXP" 100 "$EXP"
expect_pre_refuse multiple-blockers-cannot-pass "200|300|100|active|Lock|transactionid|1|1|2|2026-10-07T06:31:04.622Z|$EXP" 100 "$EXP"
expect_pre_refuse same-backend-cannot-pass "100|300|100|active|Lock|transactionid|1|1|1|2026-10-07T06:31:04.622Z|$EXP" 100 "$EXP"
expect_pre_refuse observer-collision-cannot-pass "200|200|100|active|Lock|transactionid|1|1|1|2026-10-07T06:31:04.622Z|$EXP" 100 "$EXP"
expect_post_refuse early-release-cannot-pass "200|301|100|idle|||1|0|0|2026-10-07T06:31:14.080Z|$EXP" 200 100 "$EXP"
expect_post_refuse wrong-activation-post-cannot-pass "201|301|100|active|Lock|transactionid|1|1|1|2026-10-07T06:31:14.080Z|$EXP" 200 100 "$EXP"
expect_completion_refuse unrelated-error-cannot-pass 1 1 0 1
expect_completion_refuse dirty-rollback-cannot-pass 1 1 1 0

if [ "$fail" -ne 0 ]; then
  echo "interleaving-proof-gate-r3: $pass passed, $fail failed"
  exit 1
fi
echo "interleaving-proof-gate-r3: $pass passed, 0 failed"
