#!/bin/bash
# LIVE-AI-03B — M7 STEP 2 — REAL-PostgreSQL lifecycle driver on a THROWAWAY LOCAL cluster (unix socket only;
# never AI-STAGING / CORE-PROD). Reuses the accepted Step-1 harness (common.sh / pgctl.sh) UNCHANGED:
# base = accepted predecessor chain + FULL M6 boundary; then the Step-1 artifacts 01 (inactive V2 seed) +
# 02 (trusted_v2 successor); then runs the Node lifecycle A–H with REAL role logins.
# Set M6_PGBIN=<pg18 bin> to run against a local PostgreSQL 18 build.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
export REPO=${REPO:-$(cd "$HERE/../../../.." && pwd)}
S1T=$(cd "$HERE/../../m7-step1-hb1-consolidated-remediation-01/tests" && pwd)
. "$S1T/common.sh"
trap '$PGC stop "$BASE/c" >/dev/null 2>&1; rm -rf "$BASE"' EXIT
export PGPASSWORD='synthetic-test-only-executor-pw'
fresh
q -q -c "ALTER ROLE live_ai_03b_executor PASSWORD '$PGPASSWORD'" >/dev/null   # TEST-ONLY synthetic login secret
for f in m7-v2-01-inactive-catalog-seed.sql m7-v2-02-trusted-successor-migration.sql; do
  q -v ON_ERROR_STOP=1 < "$SQLD/$f" > /dev/null 2>&1 || { echo "  setup failed: $f"; exit 2; }
done
LABEL="PostgreSQL $(t 'SHOW server_version')"
echo "• server: $LABEL"
chmod 755 "$BASE" "$BASE/c" 2>/dev/null
BASE="$BASE" PGC="$PGC" SQLD="$SQLD" M6VERIFY="$M6VERIFY" PGLABEL="$LABEL" node "$HERE/v2-localpg-lifecycle.mjs"
