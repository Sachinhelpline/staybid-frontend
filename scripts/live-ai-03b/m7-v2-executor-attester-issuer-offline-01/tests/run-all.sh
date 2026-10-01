#!/bin/bash
# M7 V2 EXECUTOR ATTESTATION ISSUER — canonical OFFLINE aggregate (no live action). Logs → tests/out/.
# FAIL-CLOSED: every REQUIRED check runs; the script exits 0 ONLY when all REQUIRED_CHECKS ran and none failed.
# Frozen predecessors are run READ-ONLY from this tree; the M5 check runner (which writes its own logs) runs inside a
# throwaway clone so no frozen directory is ever written. A PostgreSQL skip is a failure (never a pass).
set -u
REQUIRED_CHECKS=15
HERE=$(cd "$(dirname "$0")" && pwd) || { echo "RESULT: FAIL (harness dir)"; exit 1; }
cd "$HERE" || exit 1
mkdir -p out || exit 1
S=out/aggregate-summary.log; : > "$S"
PKG=$(cd "$HERE/.." && pwd); REPO=$(cd "$PKG/../../.." && pwd); L="$REPO/scripts/live-ai-03b"
PG18=${M7EA_PG18BIN:-/tmp/lai03b-pg18bin/bin}
T=0; F=0
record() { T=$((T+1)); [ "$1" = PASS ] || F=$((F+1)); printf '%-4s  %s  —  %s\n' "$1" "$2" "$3" >> "$S"; }
expect_exit() { local label=$1 want=$2 log=$3; shift 3; "$@" > "$log" 2>&1; local rc=$?
  if [ "$rc" -eq "$want" ]; then record PASS "$label" "exit $rc (expected $want)"; else record FAIL "$label" "exit $rc (expected $want)"; fi; }
expect_summary() { local label=$1 log=$2 want=$3; shift 3; "$@" > "$log" 2>&1; local rc=$?; local last; last=$(grep -v '^\s*$' "$log" | tail -1)
  if [ "$rc" -ne 0 ]; then record FAIL "$label" "exit $rc; ${last:0:120}"; elif [ "$last" != "$want" ]; then record FAIL "$label" "summary '${last:0:120}' (expected '$want')"; else record PASS "$label" "exit 0; $last"; fi; }
expect_line() { local label=$1 log=$2 re=$3; shift 3; "$@" > "$log" 2>&1; local rc=$?; local hit; hit=$(grep -E "$re" "$log" | tail -1)
  if [ "$rc" -eq 0 ] && [ -n "$hit" ]; then record PASS "$label" "exit 0; ${hit:0:140}"; else record FAIL "$label" "exit $rc; ${hit:-no summary line}"; fi; }
# M5: run the accepted runner in a throwaway clone of dcab7c5b (it writes its own logs). Its 06-boundary check pins the
# PRE-preservation state (B0: HEAD == f5ec5807; B1: changes are uncommitted working-tree edits), so at ANY post-
# preservation HEAD exactly B0 + B1 fail by design. Required: the 11 behavioral checks PASS, and the boundary check's
# ONLY failures are exactly B0 and B1 (every other boundary assertion — protected bytes, constants, imports — passes).
m5_in_clone() { local tmp rc=1; tmp=$(mktemp -d /tmp/m7ea-m5clone-XXXXXX) || return 1
  if git clone -q --no-hardlinks "$REPO" "$tmp/r" && git -C "$tmp/r" checkout -q dcab7c5b8884db4826d3fc9188ae042a1ed298d6 && ln -s "$REPO/node_modules" "$tmp/r/node_modules"; then
    local M="$tmp/r/scripts/live-ai-03b/m5-attester-clock-recovery-remediation-offline-01"
    bash "$M/run-checks.sh" > "$tmp/run.log" 2>&1; cat "$tmp/run.log"
    mkdir -p "$tmp/b" && git -C "$tmp/r" archive f5ec5807014442884c1d156c51a4edd1563b25bd scripts/live-ai-03b | tar -x -C "$tmp/b" && ln -s "$REPO/node_modules" "$tmp/b/node_modules"
    local bf; bf=$(M5ACR_BASELINE_TREE="$tmp/b" M5ACR_CANDIDATE_TREE="$tmp/r" M5ACR_BASELINE_REF=f5ec5807014442884c1d156c51a4edd1563b25bd node "$M/checks/boundary.check.mjs" 2>&1 | grep -oE '^  FAIL B[0-9]+' | tr -d ' ' | tr '\n' ',')
    echo "06-boundary failing assertions: $bf"
    local passes fails; passes=$(grep -c '^PASS ' "$tmp/run.log"); fails=$(grep -E '^FAIL' "$tmp/run.log" | grep -vc '06-boundary')
    if [ "$passes" -eq 11 ] && [ "$fails" -eq 0 ] && [ "$bf" = "FAILB0,FAILB1," ]; then echo "M5: 11/11 behavioral checks PASS; 06-boundary only B0+B1 (pre-preservation pins, N/A at dcab7c5b)"; rc=0; fi
  fi
  rm -rf "$tmp"; return $rc; }
frozen_clean() { local n; n=$(git -C "$REPO" status --porcelain --untracked-files=all | grep -v "scripts/live-ai-03b/m7-v2-executor-attester-issuer-offline-01/" | wc -l)
  echo "paths changed outside the new package: $n"; [ "$(git -C "$REPO" rev-parse HEAD)" = dcab7c5b8884db4826d3fc9188ae042a1ed298d6 ] && [ "$n" -eq 0 ]; }

# ── this package ──
expect_exit    "A package identity --check (diagnostic)"        0 out/package-identity.log node "$PKG/tools/package-identity.mjs" --check
expect_summary "B focused suite (synthetic, loopback)"            out/focused.log "m7-v2-executor-attester: 242 passed, 0 failed" node "$HERE/executor-attester.test.mjs"
expect_summary "C real PostgreSQL 16 (accepted post-Step-1 state)" out/localpg-pg16.log "m7-v2-executor-attester-localpg: 85 passed, 0 failed" node "$HERE/localpg/executor-attester-localpg.test.mjs"
expect_summary "D real PostgreSQL 18 (live AI-STAGING major)"     out/localpg-pg18.log "m7-v2-executor-attester-localpg: 85 passed, 0 failed" env M7EA_PGBIN="$PG18" node "$HERE/localpg/executor-attester-localpg.test.mjs"
expect_exit    "E production entrypoint CLI fail-closed"         70 out/cli-entrypoint.log env -i PATH="$PATH" node "$PKG/src/executor-attester-entrypoint.mjs"
# ── frozen predecessors (read-only) ──
expect_summary "F preserved M7 V2 production-authority suite"    out/pred-authority-provisioning.log "m7-v2-authority-provisioning: 231 passed, 0 failed" node "$L/m7-v2-production-authority-provisioning-offline-01/tests/authority-provisioning.test.mjs"
expect_line    "G reader production integration (reader attestation verification)" out/pred-reader-production-integration.log "passed, 0 failed" node "$L/private-reader-production-integration-offline-01/tests/production-integration.test.mjs"
expect_line    "H reader attester containment"                   out/pred-attester-containment.log "passed, 0 failed" node "$L/private-reader-attester-offline-01/tests/attester-containment.test.mjs"
expect_line    "I reader attester integration"                   out/pred-attester-integration.log "passed, 0 failed" node "$L/private-reader-attester-offline-01/tests/attester-integration.test.mjs"
expect_line    "J reader attester real PostgreSQL"               out/pred-attester-localpg.log "passed, 0 failed" node "$L/private-reader-attester-offline-01/tests/attester-localpg.test.mjs"
expect_line    "K M5 attester clock-recovery (11 behavioral checks; boundary pins N/A post-preservation; throwaway clone)" out/pred-m5-clock-recovery.log "M5: 11/11 behavioral checks PASS" m5_in_clone
expect_exit    "L Step-2 identity artifacts --check"             0 out/pred-step2-identity.log node "$L/m7-step2-runtime-rebinding-offline-01/tools/write-identity-artifacts.mjs" --check
expect_line    "M Step-2 PIN C re-derived at 0afe4b6b"           out/pred-step2-pin-c.log '"runtime_manifest_digest": "64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f"' node "$L/m7-step2-runtime-rebinding-offline-01/tools/verify-step2-preservation.mjs" --repo "$REPO" --commit 0afe4b6bedeb12f756cc9027367d323acb264464
expect_line    "N preserved authority acquisition (Step-10 bound) fails closed without trusted inputs" out/pred-authority-unprovisioned.log "executor_attestation_source_inputs_invalid" node -e "import('$L/m7-v2-production-authority-provisioning-offline-01/src/production-entrypoint.mjs').then(async m=>{const r=await m.acquireExecutorAttestationSourceV2(); console.log(JSON.stringify(r)); process.exit(r.available===false?0:1)})"
expect_line    "O no frozen file changed; HEAD = dcab7c5b"       out/frozen-clean.log "paths changed outside the new package: 0" frozen_clean

if [ "$F" -eq 0 ] && [ "$T" -eq "$REQUIRED_CHECKS" ]; then V="RESULT: PASS ($T/$REQUIRED_CHECKS required checks)"; RC=0; else V="RESULT: FAIL ($F failed, $T/$REQUIRED_CHECKS ran)"; RC=1; fi
echo "$V" >> "$S"; cat "$S"; exit "$RC"
