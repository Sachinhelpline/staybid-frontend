# M7 Step 2 — packet §19 negative matrix and §20 positive / lifecycle map → test IDs

**Suites**
- **U** = `tests/v2-unit.test.mjs` — in-memory; synthetic reviewer key per run.
- **L** = `tests/v2-localpg-lifecycle.mjs`, run via `tests/v2-localpg.test.sh` on **PostgreSQL 16.13 and 18.4**, with REAL role logins.
- **S1** = the accepted Step-1 suites (run by `tests/run-predecessor.sh`).

## §19 — every item fails closed

| # | Item | Test IDs |
|---|---|---|
| 1 | V1 approval used in V2 runtime | U PA32, EX21 (V1 read capability), L P05 (old function) |
| 2 | V1 catalog ID | U N01, AD13 |
| 3 | V1 active digest | U N02, N26 |
| 4 | V1 inactive digest | U N03, N27 |
| 5 | V1 expiry | U N04, PA06; L F04 |
| 6 | V1 one-call policy | U N05, N06, PB06; L F07 |
| 7 | 89,536 money ceiling | U N07, PB02, ST02 |
| 8 | 2-entry V1 catalog treated as V2 | U N25, PA01/PA02 |
| 9 | missing cache-write row | U PA09, AD12, N10 |
| 10 | wrong cache-write rate | U PA10, N09; L F05 |
| 11 | wrong source digest | U N08; the registry binds `source_digest` into the V2 entry count (R17/R19) |
| 12 | wrong V2 catalog digest | U PA07, AC02 |
| 13 | wrong policy digest | U N06, PB06 |
| 14 | wrong any one of the 7 ceilings | U PB01 (all 7 × ±1), PB03, PB04; L F01 (8 real DB edits) |
| 15 | more than one active catalog | U AC01, PB10; L F03 |
| 16 | more than one active policy | U PB05; L F02 |
| 17 | V1 accidentally active | U PB10; L F03 |
| 18 | V1 historical row drift | U PA04–PA06, AC05, PB11, PF04; L F04 |
| 19 | V2 stale | U PA36, PA37, PB27 |
| 20 | V2 future-dated | U PA39, N19, N24 |
| 21 | wrong service tier | U N11; gateway pin PIN B: S16, S03 |
| 22 | missing service tier | U N12; S1 `m7-gateway` R38 |
| 23 | Fast / Priority / Flex / Batch / Scale / regional | U N20 (all 8 excluded paths), N14, N15 |
| 24 | long context | U N13, N20 (`long_context`) |
| 25 | wrong AI-STAGING target | U N16, PA29 |
| 26 | any CORE-PROD identity | U N17, PA28, EX08, EX15 |
| 27 | caller-supplied SQL | U R04–R15, EX01, RD19 |
| 28 | registry digest marker with altered SQL | U R04, R05 |
| 29 | reader write authority | L A03, P07 |
| 30 | gateway-store activation authority | L P01 |
| 31 | executor direct table mutation | L B08, P06 |
| 32 | old trusted `activate_catalog` path | L P05; U ST08 |
| 33 | PUBLIC successor execute | L P02 |
| 34 | unsigned approval | U N21, N22 |
| 35 | self-approved approval | U PA33 |
| 36 | caller-supplied trust root | U N23, EX14, PA34 |
| 37 | replay | U PA26, EX19; L B05, B06, B07 |
| 38 | duplicate ledger row | U PB16 |
| 39 | wrong ledger provenance | U PB19, PB20 |
| 40 | wrong activation receipt | U PB17, PB18 |
| 41 | V1 preflight receipt used for V2 probe | U PR04, PR12; L E00 (the frozen V1 probe refuses the V2 receipt) |
| 42 | stale probe receipt | U PR05, PR06, PR13 |
| 43 | old gateway deploy commit without tier pin | U S04 (×4), PA30; L A04 |
| 44 | fabricated future Step-2 commit pin | U S06–S12, S18, S19, S21–S24; L H01 |
| 45 | second provider-bearing send | U PR15; L E02 |
| 46 | retry after send failure | U N28 |
| 47 | `spendMicros > 105920` | U PR16, PF01 |

## §20 — positive / lifecycle

| Item | Test IDs |
|---|---|
| A. post-seed pre-activation V2 state accepted | U PA00, AD04; L A00–A02 |
| B. valid signed-test V2 approval → restricted activation → exact ledger consumption → Phase-B correlation | U EX17; L B00–B04 |
| C. armed V2 state accepted only when exact | U PB00; L D00–D05 (+ C00: refused before the arm) |
| D. first-probe V2 receipt accepted | U PR00–PR02; L D06 |
| E. one synthetic broker send maximum | U PR14/PR15; L E01/E02 |
| F. 89,536 within · 105,920 within · 105,921 fails | U PR17 · PR14 · PR16 |
| G. restored/dormant V2 state cannot send another probe | L G00–G07 (G06: no receipt after restoration) |
| H. frozen M6 canonical verifier PASS in every state | L A00, B03, D02, F09, G04 (PG16 + PG18) |
| Reader chain over loopback | U RD27–RD29; L H00–H03 plus A02/B04/D05/G05 (REAL PG reader + independent attester + V2 gateway caller) |

## Closure-harness remediation — aggregate runners fail closed

**Suite:** **H** = `tests/harness-fail-closed.test.sh`. It copies the REAL runners byte-for-byte (sha256 asserted)
into an isolated mirror and executes them with a TEST-ONLY `PATH` shim for `node`, the in-script `bash`, and `git`.
The shim chooses child exit codes and output per case; nothing in the runtime or the real repo is touched.

| Case | Forced condition | Required runner outcome | Test ID |
|---|---|---|---|
| 1 | every required child meets its contract | run-all exits 0; `RESULT: PASS (10/10 required checks)` | H RA1 |
| 2 | gateway proof exits 1 | run-all ≠ 0; the one FAIL is check B | H RA2 |
| 3 | unit exits 1 / exits 0 with "289 passed, 1 failed" | ≠ 0; FAIL on C | H RA3a, RA3b |
| 4 | PG16 SKIPPED (exit 2) · PG18 SKIPPED (exit 0) · PG18 binaries missing · PG18 run reports PG16 · no summary · 59/60 · exit 1 | ≠ 0; FAIL on D or E | H RA4a–RA4g |
| 5 | an expected-2 CLI exits 9 or 0 | ≠ 0; FAIL on that F check | H RA5a–RA5c |
| 6 | a reader expected-70 exits 9 or 0 | ≠ 0; FAIL on G or H | H RA6a, RA6b |
| 7 | the FIRST check fails, all later checks PASS | ≠ 0; final verdict is `RESULT: FAIL` | H RA7 (+ verdict check) |
| 8 | every predecessor suite passes | run-predecessor exits 0; `RESULT: PASS (44/44 suites, 0 setup failures)` | H PR8 |
| 9 | one repo suite / the frozen V1 runtime suite / the Step-1 localpg suite fails | ≠ 0; the FAIL line names that suite | H PR9a–PR9c |
| 10 | the historical 9270c282 checkout bootstrap fails (git exit 128) | ≠ 0; `SETUP-FAIL(128)` | H PR10 |
| 11 | the suite inventory shrinks to 43 | ≠ 0; `INVENTORY-FAIL` | H PR11 |

Every failing case also asserts **attribution**. For run-all: exactly one FAIL, on the intended check, and a `RESULT: FAIL` verdict. For run-predecessor: the output must contain the named `FAIL(<rc>) <suite>` / `SETUP-FAIL(128)` / `INVENTORY-FAIL` line (PR9c forces the Step-1 localpg suite, so both its PG16 and PG18 runs fail). Old-runner reproduction
(the reviewed candidate's runners): 16/16 forced run-all failures and 5/5 forced predecessor failures exited **0**.
New runners: all 47 regression checks pass.

