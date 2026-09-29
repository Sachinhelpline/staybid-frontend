#!/bin/bash
# Throwaway LOCAL PostgreSQL cluster (unix socket only, trust auth, fsync off). NEVER AI-STAGING / CORE-PROD.
# usage: pgctl.sh start|stop|psql <dir> [psql args...]   (M5ACR_PGBIN selects the server build)
set -u
BIN=${M5ACR_PGBIN:?M5ACR_PGBIN required}
export LD_LIBRARY_PATH="$BIN/../lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cmd="$1"; dir="$2"; shift 2
run() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- env LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" "$@"; else "$@"; fi; }
case "$cmd" in
  start)
    rm -rf "$dir"; mkdir -p "$dir"; [ "$(id -u)" = 0 ] && chown postgres:postgres "$dir"
    run "$BIN/initdb" -D "$dir/data" -A trust -U postgres -N --no-instructions >/dev/null || exit 1
    run "$BIN/pg_ctl" -D "$dir/data" -l "$dir/server.log" -w -t 60 -o "-c listen_addresses='' -c unix_socket_directories=$dir -c fsync=off" start >/dev/null || exit 1 ;;
  stop) run "$BIN/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1; rm -rf "$dir" ;;
  psql) run psql -X -h "$dir" -U postgres "$@" ;;
esac
