#!/bin/bash
# M7 Step 1 — the COMPLETE offline regression (run once for the closure package). No live action.
set -u; cd "$(dirname "$0")"; mkdir -p out; S=out/m7s1-summary.log; : > $S
node ../catalog/v2-digest-gen.mjs > out/v2-digest-gen.log 2>&1 && echo "generator: predecessor self-check OK, worst case 105920" >> $S || echo "generator: FAILED" >> $S
node ../build-sql.mjs --check >> $S 2>&1
node ../approval/make-candidate-artifacts.mjs --check >> $S 2>&1
node ../docs-evidence/extract-pricing.mjs > out/extract-pricing.log 2>&1 && echo "pricing evidence extractor: standard-short row 2/0.2/2.5/12 + service_tier/caching sentences found in raw official HTML" >> $S || echo "pricing extractor FAILED" >> $S
node m7-contract.test.mjs > out/m7-contract.log 2>&1; echo "contract: $(tail -1 out/m7-contract.log)" >> $S
node m7-gateway.test.mjs > out/m7-gateway.log 2>&1; echo "gateway (in-memory): $(tail -1 out/m7-gateway.log)" >> $S
bash m7-localpg.test.sh > out/m7-localpg-pg16.log 2>&1; echo "localpg PG16: $(tail -1 out/m7-localpg-pg16.log)" >> $S
M6_PGBIN=/tmp/lai03b-pg18bin/bin bash m7-localpg.test.sh > out/m7-localpg-pg18.log 2>&1; echo "localpg PG18: $(tail -1 out/m7-localpg-pg18.log)" >> $S
echo "ALL_DONE" >> $S; cat $S
