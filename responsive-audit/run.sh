#!/usr/bin/env bash
# Boots the Next dev server, waits until it is actually serving, runs the
# responsive auditor with whatever args are passed, then tears the server
# down. Keeps server + audit in one process tree so the server can't be
# reaped mid-sweep. Usage: bash responsive-audit/run.sh [audit.mjs args...]
set -u
cd "$(dirname "$0")/.."

LOG=/tmp/next-dev.log
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 1
: > "$LOG"
node_modules/.bin/next dev -p 3000 > "$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill -9 $SERVER_PID 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null' EXIT

# wait up to 120s for the server to actually answer 2xx/3xx (dev compiles the
# home route on first hit, so poll the real response code, not just the port).
ready=0
for i in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3000/ 2>/dev/null)
  case "$code" in
    2*|3*) echo "server ready (HTTP $code after ${i}s)"; ready=1; break;;
  esac
  sleep 1
done
if [ "$ready" != "1" ]; then echo "SERVER FAILED TO START"; tail -20 "$LOG"; exit 1; fi

node responsive-audit/audit.mjs --base http://127.0.0.1:3000 "$@"
STATUS=$?
echo "AUDIT EXIT $STATUS"
exit $STATUS
