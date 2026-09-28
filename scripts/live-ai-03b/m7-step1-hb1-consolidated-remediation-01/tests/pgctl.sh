#!/bin/bash
# Throwaway LOCAL PostgreSQL cluster for M7 Step-1 offline evidence (copied verbatim from the M6 R2.1 harness) (unix socket only, trust auth, fsync off).
# usage: pgctl.sh start|stop|psql <dir> [psql args...]   — NEVER AI-STAGING, never live.
set -u
BIN=${M6_PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}   # M6_PGBIN: optional server build (e.g. local PostgreSQL 18 test binaries)
[ -n "${M6_PGBIN:-}" ] && export LD_LIBRARY_PATH="$M6_PGBIN/../lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cmd="$1"; dir="$2"; shift 2
run() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- env LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" "$@"; else "$@"; fi; }
case "$cmd" in
  start)
    rm -rf "$dir"; mkdir -p "$dir"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$dir"
    run "$BIN/initdb" -D "$dir/data" -A trust -U postgres -N --no-instructions >/dev/null || exit 1
    printf "local all live_ai_03b_executor scram-sha-256\nlocal all all trust\n" > /tmp/m6hba.$$ && cp /tmp/m6hba.$$ "$dir/data/pg_hba.conf" && rm -f /tmp/m6hba.$$
    [ "$(id -u)" = 0 ] && chown postgres:postgres "$dir/data/pg_hba.conf"
    run "$BIN/pg_ctl" -D "$dir/data" -l "$dir/server.log" -w -t 60 -o "-c listen_addresses='' -c unix_socket_directories=$dir -c fsync=off" start >/dev/null || exit 1 ;;
  stop) run "$BIN/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1; rm -rf "$dir" ;;
  psql) run psql -X -h "$dir" -U postgres "$@" ;;
esac
