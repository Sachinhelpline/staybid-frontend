#!/bin/bash
# M7 Step-1 shared local-PG harness (THROWAWAY unix-socket cluster only; never AI-STAGING / CORE-PROD).
M7=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO=${REPO:-/home/user/staybid-frontend}
S=$REPO/scripts/live-ai-03b
PGC=$M7/tests/pgctl.sh
MIG=$S/trusted-activation-boundary-01/db/2026-09-19-p1-02-trusted-activation-boundary.sql
GRANT=$S/trusted-boundary-post-apply-offline-01/deferred-ledger-read-grant.sql
M6VERIFY=$S/trusted-boundary-post-apply-offline-01/post-application-verification.sql
GWROLE=$S/trusted-runtime-live-binding-offline-01/gateway-store-role.sql
SQLD=$M7/sql
BASE=${BASE:-$(mktemp -d /tmp/lai03b-m7s1-XXXXXX)}; [ "$(id -u)" = 0 ] && chown postgres:postgres "$BASE"
q() { $PGC psql "$BASE/c" -d railway "$@"; }
asrole() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- env LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" PGPASSWORD="${PGPASSWORD:-}" psql -X -h "$BASE/c" -U "$1" -d railway "${@:2}"; else psql -X -h "$BASE/c" -U "$1" -d railway "${@:2}"; fi; }
t() { q -tAc "$1" 2>&1; }
fresh() {   # accepted predecessor (BUDGET foundation + dormant seed + V1 seed + reader role + M4/M5 observer) + FULL M6 (migration + deferred grant + gateway-store role)
  $PGC stop "$BASE/c" >/dev/null 2>&1
  $PGC start "$BASE/c" || { echo "SKIPPED: local cluster did not start (a skip is not a pass)"; exit 2; }
  $PGC psql "$BASE/c" -d postgres -qc "CREATE DATABASE railway ENCODING 'UTF8' TEMPLATE template0;" >/dev/null || exit 2
  for f in 2026-09-16-live-ai-budget-01-dpbel-foundation.sql 2026-09-16-live-ai-budget-01-dormant-control-policy-seed.sql 2026-09-18-live-ai-budget-01-inactive-price-catalog-seed.sql; do
    q -q -v ON_ERROR_STOP=1 < "$REPO/migrations/$f" >/dev/null 2>&1 || { echo "  seed failed: $f"; exit 2; }
  done
  q -q -v ON_ERROR_STOP=1 < "$S/trusted-runtime-live-binding-offline-01/trusted-reader-role.sql" >/dev/null 2>&1 || exit 2
  q -q -v ON_ERROR_STOP=1 < "$M7/tests/seed-m5-roles.sql" >/dev/null 2>&1 || exit 2
  q -q -v ON_ERROR_STOP=1 < "$MIG" >/dev/null 2>&1 || { echo "  M6 migration failed"; exit 2; }
  q -q -v ON_ERROR_STOP=1 < "$GRANT" >/dev/null 2>&1 || { echo "  M6 deferred grant failed"; exit 2; }
  q -q -v ON_ERROR_STOP=1 < "$GWROLE" >/dev/null 2>&1 || { echo "  M6 gateway-store role failed"; exit 2; }
}
