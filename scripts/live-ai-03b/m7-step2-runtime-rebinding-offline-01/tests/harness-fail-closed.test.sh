#!/bin/bash
# LIVE-AI-03B — M7 STEP 2 — deterministic FORCED-FAILURE regression for the two aggregate runners
# (run-all-m7s2.sh, run-predecessor.sh). TEST-ONLY. No DB, no network, no live action.
#
# Anti-bypass design: the REAL runner files are copied byte-for-byte (sha256 asserted) into an isolated
# temporary mirror of the directory layout they expect, and EXECUTED there with /bin/bash. Their child
# commands (`node`, the in-script `bash <lifecycle>.test.sh`, and `git` for the predecessor bootstrap)
# resolve through a TEST-ONLY PATH shim whose exit status / output is chosen per case by SHIM_FAIL.
# Nothing in the runtime, the runners or the real repository is modified; the runners' own control
# flow decides the observable process exit status that this test asserts.
#
# usage: harness-fail-closed.test.sh [--run-all <runner>] [--predecessor <runner>]
#   (defaults: the candidate's own tests/run-all-m7s2.sh and tests/run-predecessor.sh; pointing them at
#    an older runner reproduces its fail-open behaviour — the test then exits non-zero.)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
RUN_ALL="$HERE/run-all-m7s2.sh"; PRED="$HERE/run-predecessor.sh"
while [ $# -gt 0 ]; do case "$1" in --run-all) RUN_ALL=$2; shift 2;; --predecessor) PRED=$2; shift 2;; *) echo "unknown arg $1"; exit 2;; esac; done
REALBASH=$(command -v bash); REALGIT=$(command -v git)
S2REL=scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01
W=$(mktemp -d /tmp/lai03b-m7s2-harness-XXXXXX) || exit 2
trap 'rm -rf "$W"' EXIT
PASS=0; FAILN=0
ok()  { PASS=$((PASS+1)); echo "  OK        $1"; }
bad() { FAILN=$((FAILN+1)); echo "  VIOLATION $1"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
echo "run-all under test:     $RUN_ALL  sha256=$(sha "$RUN_ALL")"
echo "predecessor under test: $PRED  sha256=$(sha "$PRED")"

# ── TEST-ONLY PATH shim ──
mkdir -p "$W/shim" "$W/pg18fake"
printf '#!/bin/sh\nexit 0\n' > "$W/pg18fake/postgres"; cp "$W/pg18fake/postgres" "$W/pg18fake/initdb"; chmod +x "$W/pg18fake/"*
cat > "$W/shim/mode.sh" <<'EOF'
# SHIM_FAIL = space-separated name=mode; prints the mode for $1 (empty = nominal contract)
mode_for() { for kv in ${SHIM_FAIL:-}; do [ "${kv%%=*}" = "$1" ] && { echo "${kv#*=}"; return; }; done; echo ""; }
EOF
cat > "$W/shim/node" <<'EOF'
#!/bin/bash
# TEST-ONLY controlled `node`: never executes JavaScript; emits the nominal child contract unless forced.
. "$(dirname "$0")/mode.sh"
tgt=""; for a in "$@"; do case "$a" in *.mjs|*.js) tgt=$(basename "$a"); break;; esac; done
num() { case "$1" in ''|*[!0-9]*) return 1;; esac; }
force() { local m; m=$(mode_for "$1"); [ -n "$m" ] && num "$m" && { echo "shim: forced failure of $1 (exit $m)"; exit "$m"; }; }
case "$tgt" in
  write-identity-artifacts.mjs) force identity; echo "identity artifacts: OK (runtime manifest shim)"; exit 0;;
  prove-gateway-source.mjs)     force gateway;  echo '{"contract":"GatewayDeploySourceProofV2","pass":true}'; exit 0;;
  v2-unit.test.mjs)             force unit; [ "$(mode_for unit)" = partial ] && { echo "m7s2-unit: 289 passed, 1 failed"; exit 0; }; echo "m7s2-unit: 290 passed, 0 failed"; exit 0;;
  v2-lifecycle-correction.test.mjs) force correction; [ "$(mode_for correction)" = partial ] && { echo "m7s2-lifecycle-correction: 112 passed, 1 failed"; exit 0; }; echo "m7s2-lifecycle-correction: 113 passed, 0 failed"; exit 0;;
  v2-preflight.mjs)             force preflight; exit 2;;
  v2-trusted-activation-executor.mjs) force executor; exit 2;;
  v2-first-text-probe.mjs)      force probe; exit 2;;
  v2-production-entrypoint.mjs) force entrypoint; echo '{"status":"unprovisioned"}'; exit 70;;
  v2-serving-runtime.mjs)       force serving; echo '{"status":"unprovisioned"}'; exit 70;;
  *) m=$(mode_for "suite:$tgt"); [ -n "$m" ] && { echo "shim suite $tgt: 0 passed, 1 failed"; exit "$m"; }; echo "shim suite $tgt: 1 passed, 0 failed"; exit 0;;
esac
EOF
cat > "$W/shim/bash" <<EOF
#!$REALBASH
# TEST-ONLY controlled \`bash\` for the lifecycle scripts; everything else is the real bash.
. "\$(dirname "\$0")/mode.sh"
case "\${1:-}" in
  *v2-localpg.test.sh)
    if [ -n "\${M6_PGBIN:-}" ]; then n=pg18; lbl="PostgreSQL 18.4"; else n=pg16; lbl="PostgreSQL 16.13 (shim)"; fi
    m=\$(mode_for \$n)
    case "\$m" in
      skip2) echo "SKIPPED: local cluster did not start (a skip is not a pass)"; exit 2;;
      skip0) echo "SKIPPED: harness env absent (a skip is not a pass)"; exit 0;;
      nosummary) echo "• server: \$lbl"; exit 0;;
      wrongver) echo "• server: PostgreSQL 16.13 (shim)"; echo "m7s2-localpg-lifecycle[PostgreSQL 16.13 (shim)]: 60 passed, 0 failed"; exit 0;;
      partial) echo "• server: \$lbl"; echo "m7s2-localpg-lifecycle[\$lbl]: 59 passed, 0 failed"; exit 0;;
      [0-9]*) echo "• server: \$lbl"; echo "m7s2-localpg-lifecycle[\$lbl]: 59 passed, 1 failed"; exit "\$m";;
    esac
    echo "• server: \$lbl"; echo "m7s2-localpg-lifecycle[\$lbl]: 60 passed, 0 failed"; exit 0;;
  *m7-localpg.test.sh)
    m=\$(mode_for suite:m7-localpg); [ -n "\$m" ] && { echo "m7-localpg: 112 passed, 1 failed"; exit "\$m"; }
    echo "m7-localpg: 113 passed, 0 failed (shim)"; exit 0;;
esac
exec $REALBASH "\$@"
EOF
cat > "$W/shim/git" <<EOF
#!$REALBASH
# TEST-ONLY controlled \`git\` for the predecessor historical-checkout bootstrap; never touches a real repo.
. "\$(dirname "\$0")/mode.sh"
m=\$(mode_for git)
case " \$* " in
  *" clone "*) [ -n "\$m" ] && { echo "fatal: shim clone failure" >&2; exit "\$m"; }; for a in "\$@"; do last=\$a; done; mkdir -p "\$last"; exit 0;;
  *" checkout "*) exit 0;;
esac
exec $REALGIT "\$@"
EOF
chmod +x "$W/shim/"*
export PATH="$W/shim:$PATH"

# ── run-all mirror (layout the runner expects: <step2>/{tests,tools,runtime,probe,reader}) ──
ALLM="$W/all/$S2REL"; mkdir -p "$ALLM/tests" "$ALLM/tools" "$ALLM/runtime" "$ALLM/probe" "$ALLM/reader"
cp "$RUN_ALL" "$ALLM/tests/run-all-m7s2.sh"
[ "$(sha "$ALLM/tests/run-all-m7s2.sh")" = "$(sha "$RUN_ALL")" ] || { echo "mirror copy mismatch"; exit 2; }
run_all_case() {  # $1 name  $2 expected: 0|nonzero  $3 attribution (nonzero: label prefix of the ONE failed check; 0: "-")  $4.. env
  local name=$1 want=$2 attr=$3; shift 3
  env "$@" M7S2_PG18_BIN="${PG18OVERRIDE:-$W/pg18fake}" M6_PGBIN= "$REALBASH" "$ALLM/tests/run-all-m7s2.sh" > "$W/out.$name.log" 2>&1; local rc=$?
  if { [ "$want" = 0 ] && [ $rc -eq 0 ]; } || { [ "$want" = nonzero ] && [ $rc -ne 0 ]; }; then ok "run-all $name → exit $rc (expected $want)"
  else bad "run-all $name → exit $rc (expected $want)"; sed 's/^/        | /' "$W/out.$name.log" | tail -14; fi
  # attribution: the failure is the INTENDED check (not an incidental one); the success case is a full 11/11 PASS
  if [ "$want" = 0 ]; then
    if grep -q "^RESULT: PASS (11/11 required checks)" "$W/out.$name.log" && ! grep -q "^FAIL" "$W/out.$name.log"; then ok "run-all $name attribution: RESULT: PASS (11/11), no FAIL line"
    else bad "run-all $name attribution: expected RESULT: PASS (11/11) and no FAIL line"; fi
  else
    local fl; fl=$(grep "^FAIL" "$W/out.$name.log")
    if [ "$(printf '%s\n' "$fl" | grep -c .)" = 1 ] && printf '%s\n' "$fl" | grep -q "^FAIL  $attr" && grep -q "^RESULT: FAIL" "$W/out.$name.log"; then ok "run-all $name attribution: exactly one FAIL on '$attr'; RESULT: FAIL"
    else bad "run-all $name attribution: expected exactly one FAIL on '$attr' + RESULT: FAIL (got: ${fl:-none})"; fi
  fi
}
echo "── run-all-m7s2.sh ──"
run_all_case RA1-all-contracts-satisfied 0 - SHIM_FAIL=
run_all_case RA2-gateway-proof-fails nonzero "B " SHIM_FAIL="gateway=1"
run_all_case RA3a-unit-fails nonzero "C " SHIM_FAIL="unit=1"
run_all_case RA3b-unit-exit0-but-1-failed nonzero "C " SHIM_FAIL="unit=partial"
run_all_case RA3c-lifecycle-correction-fails nonzero "I " SHIM_FAIL="correction=1"
run_all_case RA3d-lifecycle-correction-exit0-but-1-failed nonzero "I " SHIM_FAIL="correction=partial"
run_all_case RA4a-PG16-SKIPPED-exit2 nonzero "D " SHIM_FAIL="pg16=skip2"
run_all_case RA4b-PG18-SKIPPED-exit0 nonzero "E " SHIM_FAIL="pg18=skip0"
PG18OVERRIDE="$W/does-not-exist" run_all_case RA4c-PG18-binaries-unavailable nonzero "E " SHIM_FAIL=
run_all_case RA4d-PG18-run-reports-PG16 nonzero "E " SHIM_FAIL="pg18=wrongver"
run_all_case RA4e-PG16-no-lifecycle-summary nonzero "D " SHIM_FAIL="pg16=nosummary"
run_all_case RA4f-PG18-59-of-60 nonzero "E " SHIM_FAIL="pg18=partial"
run_all_case RA4g-PG16-exit1 nonzero "D " SHIM_FAIL="pg16=1"
run_all_case RA5a-preflight-CLI-exit9 nonzero "F CLI v2-preflight" SHIM_FAIL="preflight=9"
run_all_case RA5b-executor-CLI-exit0 nonzero "F CLI v2-trusted-activation-executor" SHIM_FAIL="executor=0"
run_all_case RA5c-probe-CLI-exit9 nonzero "F CLI v2-first-text-probe" SHIM_FAIL="probe=9"
run_all_case RA6a-reader-entrypoint-exit9 nonzero "G " SHIM_FAIL="entrypoint=9"
run_all_case RA6b-serving-runtime-exit0 nonzero "H " SHIM_FAIL="serving=0"
run_all_case RA7-first-check-fails-all-later-pass nonzero "A " SHIM_FAIL="identity=1"
# RA7 also: the later PASS lines are present, yet the final verdict line must not read as success.
if grep -q "PASS" "$W/out.RA7-first-check-fails-all-later-pass.log" && ! tail -3 "$W/out.RA7-first-check-fails-all-later-pass.log" | grep -qE "RESULT: PASS|^ALL_DONE$"; then ok "run-all RA7 later PASS lines do not produce a success verdict"
else bad "run-all RA7 later PASS lines do not produce a success verdict"; fi

# ── predecessor mirror (a tiny synthetic SRC tree; the frozen-suite inventory is taken from the REAL repo) ──
REPOROOT=$(cd "$HERE/../../../.." && pwd)
PSRC="$W/pred/src"; mkdir -p "$PSRC/$S2REL/tests"
cp "$PRED" "$PSRC/$S2REL/tests/run-predecessor.sh"
[ "$(sha "$PSRC/$S2REL/tests/run-predecessor.sh")" = "$(sha "$PRED")" ] || { echo "mirror copy mismatch"; exit 2; }
( cd "$REPOROOT/scripts/live-ai-03b" && find . -path ./m7-step1-hb1-consolidated-remediation-01 -prune -o -path ./m7-step2-runtime-rebinding-offline-01 -prune -o -path '*/tests/*.test.mjs' -print ) | while read -r f; do mkdir -p "$PSRC/scripts/live-ai-03b/$(dirname "$f")"; : > "$PSRC/scripts/live-ai-03b/$f"; done
FROZEN_N=$(cd "$PSRC/scripts/live-ai-03b" && find . -path '*/tests/*.test.mjs' | wc -l)
echo "── run-predecessor.sh (frozen live-ai-03b suites discovered from the real repo: $FROZEN_N) ──"
pred_case() {  # $1 name  $2 expected  $3 attribution regex (ERE) that must appear in the output  $4.. env
  local name=$1 want=$2 attr=$3; shift 3
  env "$@" M7S2_PG18_BIN="$W/pg18fake" "$REALBASH" "$PSRC/$S2REL/tests/run-predecessor.sh" > "$W/pout.$name.log" 2>&1; local rc=$?
  if { [ "$want" = 0 ] && [ $rc -eq 0 ]; } || { [ "$want" = nonzero ] && [ $rc -ne 0 ]; }; then ok "predecessor $name → exit $rc (expected $want) :: $(grep -E 'predecessor suites:' "$W/pout.$name.log" | tail -1)"
  else bad "predecessor $name → exit $rc (expected $want)"; sed 's/^/        | /' "$W/pout.$name.log" | tail -8; fi
  if grep -qE "$attr" "$W/pout.$name.log"; then ok "predecessor $name attribution: /$attr/"; else bad "predecessor $name attribution: /$attr/ not found"; fi
}
pred_case PR8-all-suites-pass 0 "^RESULT: PASS \\(44/44 suites, 0 setup failures\\)" SHIM_FAIL=
pred_case PR9a-one-repo-suite-fails nonzero "^FAIL\\(1\\) tests/live-ai/live-ai-03b.test.js" SHIM_FAIL="suite:live-ai-03b.test.js=1"
pred_case PR9b-frozen-V1-runtime-suite-fails nonzero "^FAIL\\(1\\) scripts/live-ai-03b/trusted-executor-runtime-01/tests/runtime-integration.test.mjs" SHIM_FAIL="suite:runtime-integration.test.mjs=1"
pred_case PR9c-step1-localpg-fails nonzero "^FAIL\\(1\\) .*m7-localpg.test.sh \\(PG16\\)" SHIM_FAIL="suite:m7-localpg=1"
pred_case PR10-historical-checkout-bootstrap-fails nonzero "^SETUP-FAIL\\(128\\) historical 9270c282 checkout" SHIM_FAIL="git=128"
# PR11: the suite inventory silently shrinking (one frozen suite file disappears) must not read as green.
rm -f "$(find "$PSRC/scripts/live-ai-03b" -path '*/tests/*.test.mjs' | sort | head -1)"
pred_case PR11-suite-inventory-shrinks nonzero "^INVENTORY-FAIL  ran 43 suites, expected exactly 44" SHIM_FAIL=

echo "harness-fail-closed: $PASS passed, $FAILN failed"
[ "$FAILN" -eq 0 ]
