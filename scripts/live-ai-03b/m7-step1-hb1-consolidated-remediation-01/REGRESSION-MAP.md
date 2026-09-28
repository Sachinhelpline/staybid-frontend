# M7 Step 1 — regression map (packet §16 A–I, §17 items 1–56 → tests)

**Suite abbreviations**
- **C** = `tests/m7-contract.test.mjs`
- **GW** = `tests/m7-gateway.test.mjs` (in-memory, plus the real-loader E2E inside PG)
- **PG** = `tests/m7-localpg.test.sh`, run on PostgreSQL 16.13 **and** 18.4
- **Pred** = the accepted predecessor suites, run on the scratchpad clone

## §16 cache-write accounting

The real `createBudgetCore` from the unchanged accepted gateway is run twice: against the in-memory V2 catalog, and against the V2 catalog loaded by the **real** `loadStagingPriceCatalog` from local PG.

| Case | Expectation | Test IDs |
|---|---|---|
| A | reservation = 105,920; 32,768 base input + 2,000 output settles at 89,536 | GW `A1–A3` |
| B | all cache-write input: actual 105,920 = reservation | GW `B1–B2` |
| C | partial cache write charged exactly: 94,536 | GW `C1–C2` |
| D | cached tokens with no cached tier: the full 105,920 is retained, never below the published bill | GW `D1–D2` |
| E | missing cache-write row is rejected | C `C05`, A `05b`, PG §5; GW `E1` shows it would under-reserve |
| F | cache-write rate < 2.5 is rejected | C `C06`, A `05`, PG §4/§5; GW `F1` |
| G | malformed rate is rejected | C `C06c–e`; GW `G1–G2` (the validator drops the row, so it must be rejected upstream) |
| H | over-cap usage still triggers revoke | GW `H1–H2` |
| I | 256-case grid: no charge above the reservation and none below the published bill | GW `I1–I3` |

## §17 items 1–56

| # | Item | Test IDs |
|---|---|---|
| 1 | V1 activation rejected | PG §2 (M6 function, DB clock) |
| 2 | V1 extension | PG §2 (executor denied), PG §5 (V2 refuses an extended V1), seed precheck |
| 3 | V2 inactive seed | C `C03`, PG §1 |
| 4 | V2 activation | C `C04`, PG §7 |
| 5 | missing cache-write row | C `C05`, PG §5 |
| 6 | wrong cache-write rate | C `C06*`, A `05`, PG §4/§5 |
| 7 | cached tier absent | GW `D1–D2` |
| 8–10 | base input, output, unit size | C `C08–C10`, A `08–10`, PG §5 |
| 11 | catalog ID | C `C11`, A `11`, PG §4 |
| 12 | entry ID | C `C12` |
| 13 | duplicate entry | C `C13*`, PG §5 |
| 14 | overlapping catalog | PG §5 |
| 15 / 30 | V1 and V2 active together | PG §5, §7, §8 |
| 16 | stale | C `C16`, A `16*`, PG §12 |
| 17 | future | C `C17`, A `17*`, PG §12 |
| 18 | source digest | C `D08–D10`, `C18`, A `18`, PG §4/§5 |
| 19 | catalog digest | C `C19*`, A `19*`, PG §5 |
| 20 | policy digest | C `P20`, A `20`, PG §4 |
| 21 | 89,536 policy | C `P21`, A `21`, PG §4/§8 |
| 22 | 105,920 policy | C `P22`, PG §8 |
| 23–25 | 5 money ceilings / 1 call / 1 admission | C `P23–P25b`, PG §8 |
| 26 | ceiling ±1 | C `P26` (all 7 fields), PG §8 (control-activation guard) |
| 27 | missing anchor | A `27*` |
| 28 | self-approval | A `28*`, PG §4 (`approved:true`) |
| 29 | receipt/anchor ID | A `29` |
| 30 | digest mismatch | A `30*` |
| 31–36 | processing mode, regional, Fast/Priority, Batch, Flex, long context | A `31–36`, `3x`; PG §4 |
| 37 | `service_tier: "default"` sent | GW `R37*` |
| 38 | missing `service_tier` | GW `R38` |
| 39 | unexpected tier | GW `R39*`, A `39` |
| 40 | executor writes | PG §2 |
| 41 | reader | PG §3 |
| 42 | gateway-store | PG §3 |
| 43 | PUBLIC | PG §3 |
| 44 | trusted activation | PG §7 |
| 45 | replay | A `45*`, PG §7, §10 |
| 46 | atomicity | PG §6 |
| 47 | restoration | PG §9, §10 |
| 48 | V1 never revived | PG §9, §10 |
| 49 | evidence preserved | PG §9, §10 |
| 50 | owner | PG §11 |
| 51 | `search_path` | PG §11 |
| 52 | privilege widening | PG §11 |
| 53 | CORE-PROD target | A `53*`, B `06`, PG §4 |
| 54 / 55 | no secret or provider authority | C `S05–S09`, PG §14, GW `R55` |
| 56 | M6 unaffected | PG (the frozen M6 canonical verifier passes before M7, after `01+02`, while armed, and after restoration); M6 R2.1 static 84/84 and fixture 55/55; Pred |
