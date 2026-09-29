#!/bin/bash
# LIVE-AI-03B — M5 ATTESTER CLOCK-RECOVERY REMEDIATION (OFFLINE) — canonical evidence runner.
# Runs from the CANDIDATE repo tree (this directory's repo). Extracts the BASELINE bytes read-only with
# `git archive <ref> scripts/live-ai-03b` into a temp dir (never modifies the repo), then runs every required
# check. NO Railway / live DB / credential / gateway / provider. Local throwaway PostgreSQL 16 + 18 only.
# FAIL-CLOSED: exits 0 only if every required check ran AND passed; a PostgreSQL skip is a failure.
#
# The checks live under checks/*.check.* (NOT tests/*.test.mjs) on purpose: the accepted M7 Step-2
# run-predecessor.sh auto-discovers scripts/live-ai-03b/*/tests/*.test.mjs and enforces an exact 44-suite
# inventory; this evidence must not silently change that accepted inventory.
set -u
REQUIRED=12
HERE=$(cd "$(dirname "$0")" && pwd)
TREE=$(cd "$HERE/../../.." && pwd)
REF=${M5ACR_BASELINE_REF:-f5ec5807014442884c1d156c51a4edd1563b25bd}
OUT="$HERE/out"; mkdir -p "$OUT"; rm -f "$OUT"/*.log
BASE=$(mktemp -d /tmp/m5acr-base-XXXXXX); trap 'rm -rf "$BASE"' EXIT
git -C "$TREE" archive "$REF" scripts/live-ai-03b | tar -x -C "$BASE" || { echo "RESULT: FAIL (baseline extraction)"; exit 1; }
ln -s "$TREE/node_modules" "$BASE/node_modules"
# the PRIOR reviewed candidate (v1) = baseline + REMEDIATION-v1.diff (sha256 6722afde…), for the shutdown red side
V1=$(mktemp -d /tmp/m5acr-v1-XXXXXX); trap 'rm -rf "$BASE" "$V1"' EXIT
[ "$(sha256sum "$HERE/REMEDIATION-v1.diff" | cut -d' ' -f1)" = 6722afdedb3104303016eab397fa27cd0f397a2d29c43f94693168f7e29af01e ] || { echo "RESULT: FAIL (v1 diff hash)"; exit 1; }
git -C "$TREE" archive "$REF" scripts/live-ai-03b | tar -x -C "$V1" && (cd "$V1" && git apply "$HERE/REMEDIATION-v1.diff") || { echo "RESULT: FAIL (v1 reconstruction)"; exit 1; }
ln -s "$TREE/node_modules" "$V1/node_modules"
export M5ACR_BASELINE_TREE="$BASE" M5ACR_CANDIDATE_TREE="$TREE" M5ACR_BASELINE_REF="$REF" M5ACR_V1_TREE="$V1"
T=0; F=0
run() { local label="$1"; shift; local log="$OUT/$label.log"; timeout 900 "$@" > "$log" 2>&1; local rc=$?; T=$((T+1))
  local last; last=$(grep -E "passed|PASS|FAIL" "$log" | tail -1 | cut -c1-140)
  if [ $rc = 0 ]; then echo "PASS  $label  ($last)"; else F=$((F+1)); echo "FAIL($rc) $label  ($last)"; fi; }
run 01-old-defect-baseline   node "$HERE/checks/old-defect.check.mjs"
run 02-single-flight         node "$HERE/checks/single-flight.check.mjs"
run 03-recovery              node "$HERE/checks/recovery.check.mjs"
run 04-peer                  node "$HERE/checks/peer.check.mjs"
run 05-logging               node "$HERE/checks/logging.check.mjs"
run 06-boundary              node "$HERE/checks/boundary.check.mjs"
run 07-realpg-pg16-pg18      bash "$HERE/checks/realpg.check.sh"
run 11-shutdown-old-candidate-red node "$HERE/checks/shutdown-old-candidate.check.mjs"
run 12-shutdown-revised      node "$HERE/checks/shutdown.check.mjs"
FROZEN='rc=0; for t in "$@"; do echo "### $t"; node "$t" || { echo "SUITE-FAIL $t"; rc=1; }; done; [ $rc = 0 ] && echo "frozen suites: PASS ($# suites)"; exit $rc'
S="$TREE/scripts/live-ai-03b"
run 08-frozen-bootstrap-suites bash -c "$FROZEN" _ $(ls "$S"/private-reader-bootstrap-clock-peer-offline-01/tests/*.test.mjs)
run 09-frozen-observer-attester-suites bash -c "$FROZEN" _ $(ls "$S"/private-reader-attester-offline-01/tests/*.test.mjs)
run 10-frozen-production-integration bash -c "$FROZEN" _ "$S"/private-reader-production-integration-offline-01/tests/production-integration.test.mjs
echo "m5acr checks: $((T-F))/$T passed (required: $REQUIRED)"
if [ "$F" -eq 0 ] && [ "$T" -eq "$REQUIRED" ]; then echo "RESULT: PASS ($T/$REQUIRED)"; exit 0; fi
echo "RESULT: FAIL"; exit 1
