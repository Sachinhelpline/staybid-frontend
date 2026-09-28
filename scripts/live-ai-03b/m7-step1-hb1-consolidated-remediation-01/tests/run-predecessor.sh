#!/bin/bash
# Runs the ACCEPTED predecessor gateway / live-ai / budget / voice suites against the scratchpad CLONE
# (HEAD 9270c282 + the ONE service_tier diff). NO network / provider / DB (the .pg suite uses a throwaway local cluster).
cd "$(dirname "$0")/../repo" || exit 2
LOG=../tests/out/predecessor; mkdir -p $LOG
T=0; F=0
for f in tests/live-ai/live-ai.test.js tests/live-ai/live-ai-conversation.test.js tests/live-ai/live-ai-gateway.test.js tests/live-ai/live-ai-audio.test.js tests/live-ai/live-ai-ic02.test.js tests/live-ai/live-ai-03a.test.js tests/live-ai/live-ai-03b.test.js tests/live-ai/live-ai-03b-p1-negmut.test.js tests/live-ai/live-ai-03b-teardown-negmut.test.js tests/live-ai/live-ai-03b-staging-authority.test.js tests/live-ai/live-ai-03b-staging-runtime.test.js tests/live-ai/live-ai-owner-preview.test.js tests/budget/live-ai-budget-01.test.js tests/budget/live-ai-budget-01.pg.test.js tests/voice/voice-gateway.test.js tests/voice/voice-gateway-security.test.js tests/voice/voice-provider.test.js tests/voice/voice-router.test.js; do
  n=$(basename $f .js); timeout 900 node $f > $LOG/$n.log 2>&1; rc=$?; T=$((T+1))
  last=$(grep -E -i "passed|failed|✓|ok" $LOG/$n.log | tail -1 | cut -c1-140)
  if [ $rc = 0 ]; then echo "PASS  $f  ($last)"; else F=$((F+1)); echo "FAIL($rc) $f  ($last)"; fi
done
echo "predecessor suites: $((T-F))/$T passed"
