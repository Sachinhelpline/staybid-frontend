#!/bin/bash
# M7 Step 2 — the CANONICAL Step-2 offline evidence runner (no live action). Logs → tests/out/.
# Predecessor suites are run separately by run-predecessor.sh (long).
#
# FAIL-CLOSED (closure-harness remediation): every REQUIRED check runs, its ACTUAL exit status (and, where
# the contract needs it, its summary line) is compared with the EXACT expected outcome, and the result is
# accumulated in T (checks run) / F (checks failed). The script exits 0 ONLY when F == 0 AND all
# REQUIRED_CHECKS ran; otherwise it exits 1. No later echo/cat can change that: the final status is the
# explicit `exit` at the bottom, computed from F. `set -e` is deliberately NOT used — several checks
# EXPECT a non-zero exit (fail-closed CLIs: 2; reader entrypoints: 70) and are matched exactly.
# A PostgreSQL SKIP is a FAILURE here (this runner is the evidence for real PG16 + PG18 lifecycles).
export M7S2_LIST=1
set -u
REQUIRED_CHECKS=10
EXPECT_UNIT_LINE="m7s2-unit: 290 passed, 0 failed"
EXPECT_LIFECYCLE=60
PG18_BIN=${M7S2_PG18_BIN:-/tmp/lai03b-pg18bin/bin}   # harness config only (local PG18 test build)
HERE=$(cd "$(dirname "$0")" && pwd) || { echo "RESULT: FAIL (cannot resolve harness directory)"; exit 1; }
cd "$HERE" || { echo "RESULT: FAIL (cannot enter harness directory)"; exit 1; }
mkdir -p out || { echo "RESULT: FAIL (cannot create out/)"; exit 1; }
S=out/m7s2-summary.log
: > "$S" || { echo "RESULT: FAIL (cannot write $S)"; exit 1; }
REPO=$(cd "$HERE/../../../.." && pwd) || { echo "RESULT: FAIL (cannot resolve repository root)"; exit 1; }
T=0; F=0

record() {  # $1 PASS|FAIL  $2 label  $3 detail
  T=$((T+1)); [ "$1" = PASS ] || F=$((F+1))
  printf '%-4s  %s  —  %s\n' "$1" "$2" "$3" >> "$S"
}
# exact exit-code contract: $1 label  $2 expected exit  $3 log  $4.. command
expect_exit() {
  local label=$1 want=$2 log=$3; shift 3
  "$@" > "$log" 2>&1; local rc=$?
  if [ "$rc" -eq "$want" ]; then record PASS "$label" "exit $rc (expected exactly $want)"
  else record FAIL "$label" "exit $rc (expected exactly $want)"; fi
}
# exit 0 AND an exact summary line: $1 label  $2 log  $3 exact expected last line  $4.. command
expect_summary() {
  local label=$1 log=$2 want=$3; shift 3
  "$@" > "$log" 2>&1; local rc=$?
  local last; last=$(tail -1 "$log")
  if [ "$rc" -ne 0 ]; then record FAIL "$label" "exit $rc (expected 0); last line: ${last:0:120}"
  elif [ "$last" != "$want" ]; then record FAIL "$label" "exit 0 but summary is '${last:0:120}' (expected '$want')"
  else record PASS "$label" "exit 0; $last"; fi
}
# real PostgreSQL lifecycle: $1 label  $2 major  $3 log  $4.. command. SKIP / non-zero / wrong server major /
# missing or partial summary ⇒ FAIL. Uses the child's existing contract only: it prints "SKIPPED: …" when it
# cannot run, and "m7s2-localpg-lifecycle[PostgreSQL <version…>]: N passed, M failed" when it did.
expect_lifecycle() {
  local label=$1 major=$2 log=$3; shift 3
  "$@" > "$log" 2>&1; local rc=$?
  local sum; sum=$(grep -E '^m7s2-localpg-lifecycle\[' "$log" | tail -1)
  if grep -qE '^SKIPPED' "$log"; then record FAIL "$label" "SKIPPED (a skip is not a pass); exit $rc"
  elif [ "$rc" -ne 0 ]; then record FAIL "$label" "exit $rc (expected 0); ${sum:0:140}"
  elif [ -z "$sum" ]; then record FAIL "$label" "exit 0 but no lifecycle summary line (not a real run)"
  elif ! printf '%s\n' "$sum" | grep -qE "^m7s2-localpg-lifecycle\[PostgreSQL ${major}\.[^]]*\]: ${EXPECT_LIFECYCLE} passed, 0 failed\$"; then
    record FAIL "$label" "summary is '${sum:0:140}' (expected PostgreSQL ${major}.x: ${EXPECT_LIFECYCLE} passed, 0 failed)"
  else record PASS "$label" "exit 0; $sum"; fi
}

# A. identity artifacts   B. PIN B gateway closure proof   C. unit + §19 negative matrix
expect_exit    "A identity artifacts --check" 0 out/identity-artifacts.log node ../tools/write-identity-artifacts.mjs --check
expect_exit    "B PIN B gateway closure proof" 0 out/gateway-source-proof.log node ../tools/prove-gateway-source.mjs --repo "$REPO"
expect_summary "C unit + §19 negative matrix" out/v2-unit.log "$EXPECT_UNIT_LINE" node v2-unit.test.mjs
# D. real PG16 lifecycle   E. real PG18 lifecycle (binaries must exist — no silent fallback to PG16)
expect_lifecycle "D lifecycle PostgreSQL 16" 16 out/v2-localpg-pg16.log env -u M6_PGBIN bash v2-localpg.test.sh
if [ -x "$PG18_BIN/postgres" ] && [ -x "$PG18_BIN/initdb" ]; then
  expect_lifecycle "E lifecycle PostgreSQL 18" 18 out/v2-localpg-pg18.log env M6_PGBIN="$PG18_BIN" bash v2-localpg.test.sh
else
  record FAIL "E lifecycle PostgreSQL 18" "PostgreSQL 18 binaries unavailable at $PG18_BIN (unavailable is not a pass)"
fi
# F. fail-closed CLIs: exactly 2    G/H. reader entrypoint + serving runtime: exactly 70
expect_exit "F CLI v2-preflight.mjs" 2 out/cli-v2-preflight.log node ../runtime/v2-preflight.mjs
expect_exit "F CLI v2-trusted-activation-executor.mjs" 2 out/cli-v2-trusted-activation-executor.log node ../runtime/v2-trusted-activation-executor.mjs
expect_exit "F CLI v2-first-text-probe.mjs" 2 out/cli-v2-first-text-probe.log node ../probe/v2-first-text-probe.mjs
expect_exit "G reader production entrypoint (no env)" 70 out/reader-entrypoint.log node ../reader/v2-production-entrypoint.mjs
expect_exit "H serving runtime (no authority)" 70 out/serving-runtime.log node ../reader/v2-serving-runtime.mjs

if [ "$F" -eq 0 ] && [ "$T" -eq "$REQUIRED_CHECKS" ]; then VERDICT="RESULT: PASS ($T/$REQUIRED_CHECKS required checks)"; STATUS=0
else VERDICT="RESULT: FAIL ($F failed, $T/$REQUIRED_CHECKS required checks ran)"; STATUS=1; fi
echo "$VERDICT" >> "$S"
cat "$S"
exit "$STATUS"
