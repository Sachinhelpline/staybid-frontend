#!/bin/bash
# §23/§22 — real PostgreSQL 16 + 18 (throwaway clusters) × {OLD baseline, V1 prior candidate (shutdown red side),
# NEW revised candidate}, each mode in its own process.
# A missing server build or a cluster that will not start is UNPROVEN (exit 2) — a skip is never a pass.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
: "${M5ACR_BASELINE_TREE:?}"; : "${M5ACR_CANDIDATE_TREE:?}"; : "${M5ACR_V1_TREE:?}"
PG16=${M5ACR_PG16BIN:-/usr/lib/postgresql/16/bin}; PG18=${M5ACR_PG18BIN:-/tmp/lai03b-pg18bin/bin}
rc=0
for BIN in "$PG16" "$PG18"; do
  [ -x "$BIN/initdb" ] || { echo "UNPROVEN: no server build at $BIN"; exit 2; }
  D=$(mktemp -d /tmp/m5acr-pg-XXXXXX); [ "$(id -u)" = 0 ] && chown postgres:postgres "$D"
  export M5ACR_PGBIN="$BIN"
  bash "$HERE/pgctl.sh" start "$D/c" || { echo "UNPROVEN: cluster did not start ($BIN)"; rm -rf "$D"; exit 2; }
  bash "$HERE/pgctl.sh" psql "$D/c" -d postgres -qc "CREATE DATABASE railway ENCODING 'UTF8' TEMPLATE template0;" >/dev/null
  bash "$HERE/pgctl.sh" psql "$D/c" -d railway -qc "CREATE ROLE live_ai_03b_reader NOLOGIN;" >/dev/null
  for MODE in old v1 new; do
    PGSOCK="$D/c" node "$HERE/realpg-scenario.mjs" "$MODE" || rc=1
  done
  bash "$HERE/pgctl.sh" stop "$D/c"; rm -rf "$D"
done
exit $rc
