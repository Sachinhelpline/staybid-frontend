#!/bin/bash
# M7 Step 2 — predecessor regression runner. Runs every ACCEPTED suite (repo live-ai / budget / voice suites,
# every frozen scripts/live-ai-03b/*/tests suite incl. the V1 runtime + private-reader chain, and the M7
# Step-1 suites) from a WORLD-TRAVERSABLE COPY of the candidate clone (so initdb, running as the postgres
# OS user, can traverse it and so no suite writes into the reviewed tree). NO network / provider / live DB.
#
# FAIL-CLOSED (closure-harness remediation): suite failures (NF) and required-setup failures (SF) are both
# counted; a fatal setup failure (output dir / copy of the candidate) aborts immediately with exit 3. The
# runner exits 0 ONLY when F == NF + SF == 0 AND exactly EXPECT_SUITES suites ran (the accepted inventory —
# a silently shrinking/growing inventory is a failure, never a green summary); otherwise it exits 1.
set -u
EXPECT_SUITES=44   # 18 repo + 20 frozen scripts/live-ai-03b + 6 Step-1 (accepted inventory; do not weaken)
PG18_BIN=${M7S2_PG18_BIN:-/tmp/lai03b-pg18bin/bin}   # harness config only (local PG18 test build)
fatal() { echo "SETUP-FAIL  $1"; echo "RESULT: FAIL (required setup failed: $1)"; exit 3; }
HERE=$(cd "$(dirname "$0")" && pwd) || fatal "resolve harness directory"
SRC=$(cd "$HERE/../../../.." && pwd) || fatal "resolve candidate root"
OUT="$HERE/out/predecessor"; mkdir -p "$OUT" || fatal "create $OUT"; rm -f "$OUT"/*.log
COPY=$(mktemp -d /tmp/lai03b-m7s2-pred-XXXXXX) || fatal "mktemp copy dir"
HIST=""
trap 'rm -rf "$COPY" ${HIST:+"$HIST"}' EXIT
chmod 755 "$COPY" || fatal "chmod copy dir"
cp -a "$SRC/." "$COPY/" || fatal "copy candidate tree"
chmod -R a+rX "$COPY" 2>/dev/null
cd "$COPY" || fatal "enter copy"
T=0; F=0; N=0; NF=0; SF=0
run() {  # $1 label  $2.. command   (one predecessor SUITE)
  local label="$1"; shift; local log="$OUT/$(echo "$label" | tr '/ ' '__').log"
  timeout 1500 "$@" > "$log" 2>&1; local rc=$?; T=$((T+1)); N=$((N+1))
  local last; last=$(grep -E -i "passed|failed|✓|ok\b|PASS" "$log" | tail -1 | cut -c1-150)
  if [ $rc = 0 ]; then echo "PASS  $label  ($last)"; else F=$((F+1)); NF=$((NF+1)); echo "FAIL($rc) $label  ($last)"; fi
}
setup_step() {  # $1 label  $2.. command   (REQUIRED setup, not a suite; failure is counted, never ignored)
  local label="$1"; shift
  "$@" > "$OUT/setup.log" 2>&1; local rc=$?; T=$((T+1))
  if [ $rc = 0 ]; then echo "SETUP-OK    $label"; else F=$((F+1)); SF=$((SF+1)); echo "SETUP-FAIL($rc) $label"; sed 's/^/    | /' "$OUT/setup.log" | tail -5; fi
  return $rc
}
for f in tests/live-ai/live-ai.test.js tests/live-ai/live-ai-conversation.test.js tests/live-ai/live-ai-gateway.test.js tests/live-ai/live-ai-audio.test.js tests/live-ai/live-ai-ic02.test.js tests/live-ai/live-ai-03a.test.js tests/live-ai/live-ai-03b.test.js tests/live-ai/live-ai-03b-p1-negmut.test.js tests/live-ai/live-ai-03b-teardown-negmut.test.js tests/live-ai/live-ai-03b-staging-authority.test.js tests/live-ai/live-ai-03b-staging-runtime.test.js tests/live-ai/live-ai-owner-preview.test.js tests/budget/live-ai-budget-01.test.js tests/budget/live-ai-budget-01.pg.test.js tests/voice/voice-gateway.test.js tests/voice/voice-gateway-security.test.js tests/voice/voice-provider.test.js tests/voice/voice-router.test.js; do
  run "$f" node "$f"
done
for f in $(cd scripts/live-ai-03b && find . -path ./m7-step1-hb1-consolidated-remediation-01 -prune -o -path ./m7-step2-runtime-rebinding-offline-01 -prune -o -path '*/tests/*.test.mjs' -print | sort); do
  run "scripts/live-ai-03b/${f#./}" node "scripts/live-ai-03b/${f#./}"
done
S1=scripts/live-ai-03b/m7-step1-hb1-consolidated-remediation-01
# The preserved Step-1 gateway suite compares a CANDIDATE gateway (with the service_tier pin) against the
# then-ACCEPTED gateway (without it). It was authored in the Step-1 scratch layout (a sibling repo/ dir).
# At 4f390 the faithful inputs are: candidate = this 4f390 tree (M7_CLONE); historical pre-pin = a read-only
# checkout of the derivation base 9270c282 (REPO). No Step-1 file is modified.
HIST=$(mktemp -d /tmp/lai03b-m7s2-hist9270-XXXXXX) || fatal "mktemp historical dir"
chmod 755 "$HIST" || fatal "chmod historical dir"
setup_step "historical 9270c282 checkout for the Step-1 gateway comparison" \
  bash -c 'git clone -q --no-checkout "$1" "$2/r" && git -C "$2/r" checkout -q 9270c282d5fd65e9fe49261391badfe92c777b8f && ln -s "$1/node_modules" "$2/r/node_modules" && chmod -R a+rX "$2"' _ "$SRC" "$HIST"
run "$S1/catalog/v2-digest-gen.mjs" node "$S1/catalog/v2-digest-gen.mjs"
run "$S1/build-sql.mjs --check" node "$S1/build-sql.mjs" --check
run "$S1/tests/m7-contract.test.mjs" node "$S1/tests/m7-contract.test.mjs"
run "$S1/tests/m7-gateway.test.mjs" env M7_CLONE="$COPY" REPO="$HIST/r" node "$S1/tests/m7-gateway.test.mjs"
run "$S1/tests/m7-localpg.test.sh (PG16)" env -u M6_PGBIN M7_CLONE="$COPY" REPO="$HIST/r" bash "$S1/tests/m7-localpg.test.sh"
run "$S1/tests/m7-localpg.test.sh (PG18)" env M7_CLONE="$COPY" REPO="$HIST/r" M6_PGBIN="$PG18_BIN" bash "$S1/tests/m7-localpg.test.sh"
echo "predecessor suites: $((N-NF))/$N passed; suite failures: $NF; required-setup failures: $SF; expected inventory: $EXPECT_SUITES"
if [ "$F" -eq 0 ] && [ "$N" -eq "$EXPECT_SUITES" ]; then echo "RESULT: PASS ($N/$EXPECT_SUITES suites, 0 setup failures)"; exit 0; fi
[ "$N" -eq "$EXPECT_SUITES" ] || echo "INVENTORY-FAIL  ran $N suites, expected exactly $EXPECT_SUITES"
echo "RESULT: FAIL"
exit 1
