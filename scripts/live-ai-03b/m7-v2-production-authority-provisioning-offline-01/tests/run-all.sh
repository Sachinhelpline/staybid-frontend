#!/bin/bash
# M7 V2 PRODUCTION AUTHORITY PROVISIONING — canonical OFFLINE aggregate (no live action). Logs → tests/out/.
# FAIL-CLOSED: every REQUIRED check runs; its ACTUAL exit status (and, where the contract needs it, its exact summary
# line) is compared with the expected outcome; the script exits 0 ONLY when all REQUIRED_CHECKS ran and none failed.
set -u
REQUIRED_CHECKS=12
HERE=$(cd "$(dirname "$0")" && pwd) || { echo "RESULT: FAIL (cannot resolve harness directory)"; exit 1; }
cd "$HERE" || { echo "RESULT: FAIL (cannot enter harness directory)"; exit 1; }
mkdir -p out || { echo "RESULT: FAIL (cannot create out/)"; exit 1; }
S=out/aggregate-summary.log; : > "$S" || { echo "RESULT: FAIL (cannot write $S)"; exit 1; }
REPO=$(cd "$HERE/../../../.." && pwd) || { echo "RESULT: FAIL (cannot resolve repository root)"; exit 1; }
S2="$REPO/scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01"
L="$REPO/scripts/live-ai-03b"
T=0; F=0
record() { T=$((T+1)); [ "$1" = PASS ] || F=$((F+1)); printf '%-4s  %s  —  %s\n' "$1" "$2" "$3" >> "$S"; }
expect_exit() { local label=$1 want=$2 log=$3; shift 3; "$@" > "$log" 2>&1; local rc=$?
  if [ "$rc" -eq "$want" ]; then record PASS "$label" "exit $rc (expected exactly $want)"; else record FAIL "$label" "exit $rc (expected exactly $want)"; fi; }
expect_summary() { local label=$1 log=$2 want=$3; shift 3; "$@" > "$log" 2>&1; local rc=$?; local last; last=$(grep -v '^\s*$' "$log" | tail -1)
  if [ "$rc" -ne 0 ]; then record FAIL "$label" "exit $rc (expected 0); last line: ${last:0:120}"
  elif [ "$last" != "$want" ]; then record FAIL "$label" "exit 0 but summary is '${last:0:120}' (expected '$want')"
  else record PASS "$label" "exit 0; $last"; fi; }
expect_pass_line() { local label=$1 log=$2 re=$3; shift 3; "$@" > "$log" 2>&1; local rc=$?; local hit; hit=$(grep -E "$re" "$log" | tail -1)
  if [ "$rc" -eq 0 ] && [ -n "$hit" ]; then record PASS "$label" "exit 0; ${hit:0:140}"; else record FAIL "$label" "exit $rc; ${hit:-no summary line}"; fi; }

# ── this package ──
expect_exit    "A package identity --check"                0 out/package-identity.log node ../tools/package-identity.mjs --check
expect_summary "B authority-provisioning focused suite"      out/authority-provisioning.log "m7-v2-authority-provisioning: 231 passed, 0 failed" node authority-provisioning.test.mjs
expect_exit    "C production entrypoint CLI fail-closed"     2 out/cli-production-entrypoint.log node ../src/production-entrypoint.mjs
# ── preserved Step-2 (PIN C 0afe4b6b) — composed, unchanged ──
expect_exit    "D Step-2 identity artifacts --check"         0 out/step2-identity-artifacts.log node "$S2/tools/write-identity-artifacts.mjs" --check
expect_pass_line "E Step-2 PIN C re-derived at 0afe4b6b"     out/step2-pin-c-verifier.log '"runtime_manifest_digest": "64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f"' node "$S2/tools/verify-step2-preservation.mjs" --repo "$REPO" --commit 0afe4b6bedeb12f756cc9027367d323acb264464
expect_summary "F Step-2 unit + negative matrix"            out/step2-unit.log "m7s2-unit: 290 passed, 0 failed" node "$S2/tests/v2-unit.test.mjs"
expect_summary "G Step-2 lifecycle-correction suite"        out/step2-lifecycle-correction.log "m7s2-lifecycle-correction: 113 passed, 0 failed" node "$S2/tests/v2-lifecycle-correction.test.mjs"
# ── accepted predecessors whose contracts this package composes ──
expect_pass_line "H M6 trusted-executor runtime (target binding)"   out/pred-trusted-executor-runtime.log "passed, 0 failed|[0-9]+ passed" node "$L/trusted-executor-runtime-01/tests/runtime-integration.test.mjs"
expect_pass_line "I trusted-runtime live binding"                   out/pred-live-binding.log "passed, 0 failed|[0-9]+ passed" node "$L/trusted-runtime-live-binding-offline-01/tests/live-binding.test.mjs"
expect_pass_line "J reader-only authority / host runtime"           out/pred-reader-host-runtime.log "passed, 0 failed|[0-9]+ passed" node "$L/private-reader-host-runtime-offline-01/tests/runtime.test.mjs"
expect_pass_line "K reader production integration (session/attestation)" out/pred-reader-production-integration.log "passed, 0 failed|[0-9]+ passed" node "$L/private-reader-production-integration-offline-01/tests/production-integration.test.mjs"
expect_pass_line "L attester containment (reader attestation issuer)" out/pred-attester-containment.log "passed, 0 failed|[0-9]+ passed" node "$L/private-reader-attester-offline-01/tests/attester-containment.test.mjs"

if [ "$F" -eq 0 ] && [ "$T" -eq "$REQUIRED_CHECKS" ]; then VERDICT="RESULT: PASS ($T/$REQUIRED_CHECKS required checks)"; STATUS=0
else VERDICT="RESULT: FAIL ($F failed, $T/$REQUIRED_CHECKS required checks ran)"; STATUS=1; fi
echo "$VERDICT" >> "$S"; cat "$S"; exit "$STATUS"
