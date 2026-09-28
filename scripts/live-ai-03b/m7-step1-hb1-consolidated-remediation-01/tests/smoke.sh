#!/bin/bash
set -u; . "$(dirname "$0")/common.sh"; trap '$PGC stop "$BASE/c" >/dev/null 2>&1; rm -rf "$BASE"' EXIT
fresh
echo "server $(t 'SHOW server_version')"
echo "--- M6 verifier (post-M6)"; q -v ON_ERROR_STOP=1 < $M6VERIFY 2>&1 | grep -E "ALL HARD|ERROR" 
echo "--- 01 seed"; q -v ON_ERROR_STOP=1 < $SQLD/m7-v2-01-inactive-catalog-seed.sql 2>&1 | grep -E "NOTICE|ERROR|COMMIT"
echo "--- 02 trusted"; q -v ON_ERROR_STOP=1 < $SQLD/m7-v2-02-trusted-successor-migration.sql 2>&1 | grep -E "NOTICE|ERROR|COMMIT"
echo "--- 08 verify"; q -v ON_ERROR_STOP=1 < $SQLD/m7-v2-08-post-apply-verification.sql 2>&1 | grep -E "NOTICE|ERROR"
echo "--- M6 verifier (post-M7)"; q -v ON_ERROR_STOP=1 < $M6VERIFY 2>&1 | grep -E "ALL HARD|ERROR"
