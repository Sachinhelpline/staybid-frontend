#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.." || exit 3
mkdir -p tests/out
T=0; F=0
run(){ name="$1"; shift; "$@" >"tests/out/${name}.log" 2>&1; rc=$?; if [ $rc -eq 0 ]; then echo "PASS $name"; T=$((T+1)); else echo "FAIL $name rc=$rc"; cat "tests/out/${name}.log"; F=$((F+1)); fi; }
run digest node src/v3-digest-gen.mjs
run sql-check node tools/build-sql.mjs --check
run core node tests/core.test.mjs
run predecessor node tests/predecessor-compat.test.mjs
run sql-static node tests/sql-static.test.mjs
run runtime-static node tests/runtime-static.test.mjs
run evidence-static node tests/evidence-static.test.mjs
run executor-attestation-v2 node tests/executor-attestation-v2.test.mjs
run historical-rejected-identity node tests/historical-rejected-identity.test.mjs
run secret-scan node tools/secret-scan.mjs
run interleaving-proof-gate bash tests/interleaving-proof-gate.test.sh
run localpg-expiry-lock bash tests/localpg-expiry-lock-regression.sh
if [ -f tests/out/localpg-expiry-lock.log ]; then
  grep -E '^(R3_PRE_EXPIRY_SINGLE_OBSERVATION_PROVEN|R3_POST_EXPIRY_SINGLE_OBSERVATION_PROVEN|R3_FRESHNESS_REFUSAL_PROVEN|R3_ROLLBACK_PROVEN|A1_R3_LOCALPG_SINGLE_OBSERVATION_INTERLEAVING_PASS)' tests/out/localpg-expiry-lock.log || true
fi
SYNTAX_FAIL=0
for f in src/*.mjs tools/*.mjs tests/*.mjs; do node --check "$f" >/dev/null 2>&1 || { echo "FAIL syntax $f"; SYNTAX_FAIL=1; }; done
for f in tests/*.sh; do bash -n "$f" >/dev/null 2>&1 || { echo "FAIL syntax $f"; SYNTAX_FAIL=1; }; done
if [ $SYNTAX_FAIL -ne 0 ]; then F=$((F+1)); fi
if [ $F -eq 0 ] && [ $T -eq 12 ]; then echo "RESULT: PASS (12/12 required checks)"; exit 0; fi
echo "RESULT: FAIL (pass=$T fail=$F required=12)"; exit 1
