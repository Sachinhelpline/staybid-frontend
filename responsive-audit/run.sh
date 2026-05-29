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

# wait up to 90s for the server to actually answer
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null || echo 000)
  [ "$code" != "000" ] && { echo "server ready (HTTP $code after ${i}s)"; break; }
  sleep 1
done
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null || echo 000)
if [ "$code" = "000" ]; then echo "SERVER FAILED TO START"; tail -20 "$LOG"; exit 1; fi

node responsive-audit/audit.mjs --base http://127.0.0.1:3000 "$@"
STATUS=$?
echo "AUDIT EXIT $STATUS"
exit $STATUS
