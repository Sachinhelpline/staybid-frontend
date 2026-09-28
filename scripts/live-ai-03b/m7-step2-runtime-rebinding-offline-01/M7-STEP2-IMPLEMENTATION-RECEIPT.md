# M7 Step 2 — offline runtime rebinding (V1 / 89,536 → V2 / 105,920): implementation receipt

This work was done offline, in an isolated scratchpad clone.

> **Closure-harness remediation (after the WORK closure HOLD).** The independent closure review returned
> `HOLD_M7_STEP2_CLOSURE_REVIEW` for one candidate-local finding: **both aggregate test runners failed open**.
> Section **41** records the defects, the fix, the forced-failure regression, and the real runner exit statuses.
> The runtime is **byte-identical** to the reviewed candidate (runtime manifest `9a460078…`, unchanged). Items 1–40
> keep their accepted architecture conclusions; items 6, 27, 29 and 36–39 are updated for the harness change.

**Not done:**
- no commit, push or PR;
- no Railway, AI-STAGING or CORE-PROD access;
- no credential, secret, approval signing or deployment;
- no provider call, live activation, or first real probe.

## 1. Primary status
`M7_STEP2_OFFLINE_RUNTIME_REBINDING_COMPLETE_READY_FOR_ONE_CLOSURE_REVIEW`

## 2. Baseline
Recorded in `BASELINE-IDENTITY.txt`.

| Item | Value |
|---|---|
| Repository | `Sachinhelpline/staybid-frontend` |
| Branch | `claude/live-ai-budget-01-price-catalog-inactive-artifact-01` |
| HEAD | `4f390b74132b087b757faa655bdcb73be6c14a8f` |
| Tree | `72080256d4cc2a97a2a15058931e838ebef5ec48` |
| Parent | `9270c282d5fd65e9fe49261391badfe92c777b8f` |
| Subject | "LIVE-AI: preserve accepted M7 Step 1 successor V2" |

`ls-remote` equals HEAD. The worktree was clean: no staged or untracked changes, no in-progress operation, 0 stashes.

## 3. V1 / 89,536 dependency inventory
`docs/V1-DEPENDENCY-INVENTORY.txt` lists the 64 files `git grep` found; `ARCHITECTURE-BINDING-MAP.md` classifies them:
- **A.** 19 version-bound runtime modules. A V2 successor exists for each.
  - This covers packet §5 items A–G.
  - It also covers the private-reader chain the packet did not list: `private-reader-host`, `reader-only-authority`, the serving runtime, `production-reader-authority`, `gateway-observation-caller` and `production-entrypoint`. These were bound to the V1 registry digest or V1 `source_commit`.
- **B.** Version-neutral primitives, reused by import. Test ST11 restricts this to an explicit symbol allow-list.
- **C.** Historical SQL, evidence and specs: unchanged and superseded.

The gateway application source contains no V1 binding; it loads whichever catalog/policy is active from the DB.

## 4. Successor architecture
One additive directory, `scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01/`, containing 17 runtime modules:
- `identity/` — V2 identity and the three source pins;
- `runtime/` — registry, read adapter, activation adapter, preflight, executor, executor runtime, config, authority;
- `probe/`;
- `reader/` — 6 modules;
- `tools/` — 3 read-only tools;
- `tests/`.

There is one identity boundary (`identity/v2-identity.mjs`), derived only from the Step-1 `FIXED_V2` and digest generator. No successor module imports the V1 pricing contract.

## 5. Frozen predecessors
No edit was needed; none is made.
- Every V1 binding was replaceable by an additive successor.
- The version-neutral primitives are reused unchanged (§3-B).
- No frozen file was found to be "not actually frozen".
- `FROZEN-FILE-HASH-PROOF.txt`: all 1,570 tracked files are byte-identical to HEAD (0 mismatches). Nothing is untracked outside the Step-2 directory.

## 6. Candidate files created
All files are under the Step-2 directory; the exact list with sizes and SHA-256 is in `MANIFEST.json`.
- **Runtime modules (17):** listed in `identity/RUNTIME-CONTENT-MANIFEST.json`.
- **Tools:**
  - `tools/prove-gateway-source.mjs`
  - `tools/verify-step2-preservation.mjs`
  - `tools/write-identity-artifacts.mjs`
- **Tests:**
  - `tests/v2-unit.test.mjs`
  - `tests/v2-localpg-lifecycle.mjs`
  - `tests/v2-localpg.test.sh`
  - `tests/localpg-attester.mjs`
  - `tests/helpers.mjs`
  - `tests/probe-child.mjs`
  - `tests/run-all-m7s2.sh` (fail-closed; section 41)
  - `tests/run-predecessor.sh` (fail-closed; section 41)
  - `tests/harness-fail-closed.test.sh` (deterministic forced-failure regression; section 41)
- **Documentation and evidence:**
  - this receipt
  - `README-OPERATOR.md`
  - `ARCHITECTURE-BINDING-MAP.md`
  - `LIFECYCLE-STATE-MATRIX.md`
  - `PRIVILEGE-MATRIX.json`
  - `NEGATIVE-REGRESSION-MAP.md`
  - `ROLLBACK-FAIL-CLOSED-PLAN.md`
  - `BASELINE-IDENTITY.txt`
  - `FROZEN-FILE-HASH-PROOF.txt`
  - `identity/GATEWAY-DEPLOY-SOURCE-PROOF.json`
  - `identity/STEP2-PRESERVATION-BINDING-TEMPLATE.json`
  - `identity/RUNTIME-CONTENT-MANIFEST.json`
  - `docs/V1-DEPENDENCY-INVENTORY.txt`
  - `docs/CANDIDATE-ADDITIONS.diff`
  - `tests/out/**` logs, including `tests/out/harness/` (old-runner reproduction, new-runner forced-failure run, runtime byte-freeze proof)

## 7. External-file diffs
**None.** No file outside the new directory changes. In particular, `openai-responses.ts` is not re-edited: the Step-1 pin is present at 4f390 and was proven, not modified.

## 8. V2 approval / verifier binding
The successor uses only the Step-1 `verifyApprovalV2` (Phase A) and `verifyConsumedApprovalV2` (Phase B), with the Step-1 `FIXED_V2` and `toVerifiedClaimsV2`. No alternate pricing truth exists, and no V1 verifier is used.

Rejected:
- a V1-contract envelope (PA32);
- self-approval (PA33);
- a foreign signer (PA34);
- an unsigned envelope (N21);
- a payload altered after signing (N22);
- a caller-supplied trust root (N23);
- 19 scope/target mutations (N01–N20).

No reviewer signature was generated: tests use a per-run synthetic key.

## 9. Activation adapter
It issues only two fixed statements:
- `SELECT live_ai_03b_trusted_v2.activate_catalog_v2($1::jsonb, $2)`
- `SELECT live_ai_03b_trusted_v2.restore_catalog_v2_inactive($1::jsonb, $2)`

It accepts only the exact 36-key `VerifiedApprovalClaimsV2` for the V2 catalog, bound to the execution id, and validates the `CatalogActivationReceiptV2` / `CatalogRestorationReceiptV2` shape. DB errors surface as `uncertain` with the SQLSTATE only, never retried. The old `activate_catalog` refuses V2 claims on real PG (P05).

## 10. Trusted executor V2
- One-shot.
- Secret hygiene: refuses provider, gateway, CORE and reviewer keys.
- AI-STAGING only.
- The approved read capability must have V2 provenance; a V1 capability is refused (EX21).

Sequence: Phase A → restricted activation (one-shot claimed before the call) → **committed** M6 ledger read after the transaction → `verifyConsumedApprovalV2` correlation → **activated**-state check. The stage is `V2_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED` with `probeReady:false`; the executor never emits PROBE_READY. Proven in memory (EX17–EX23) and on real PG16/18 (B00–B07).

## 11. Reader / read adapter V2
The adapter runs only the eight content-verified registry queries, with strict conversion (NULL never reads as 0).

| Observation | Requirement |
|---|---|
| Pre-activation | 2 versions / 5 entries; V1 historical exact; V2 inactive with 3 entries; 0 active; dormant policy; epoch-1 controls; zero exposure |
| Activated | V2 sole active |
| Armed | V2 sole active; policy-v2 sole active; seven ceilings; epoch 2 |

It also produces restored, exposure and ledger observations.

The private-reader chain was rebound in full. On real PG it ran end-to-end over loopback:
- the reader login with a verified `statement_timeout`;
- an **independent** attester that observes `pg_stat_activity` and the privileges itself;
- the V2 serving runtime and the V2 gateway caller.

Its observations are identical to the executor-side reads (A02, B04, D05, G05). No reader privilege was widened: the attester reports 12 SELECT grants and 0 write grants.

## 12. Production query registry V2
Digest `07f19f37cef62c9bd54956fc37844f5927f5ca79d668f9fe85a2d3af9bd1ee0b` (the V1 registry is `a03bc6fd…`).

It holds 8 queries. Every relation is `public.budget_*`; the ledger query alone reads `live_ai_03b_trusted.approval_consumption`.

The queries are SELECT-only, with no `;`, comment, locking clause or parameter (except the ledger lookup), and no `budget_envelope_allocations`. A supplied registry is validated by content: key set, shape, recomputed digest, marker equal to the recomputation, and byte identity (R04–R15). Test R19 proves column coverage; it is mutation-checked against the defect found in item 29.

## 13. Production authority / config V2
- `acquireProductionAuthorityV2()` returns UNPROVISIONED, with no setter or injector.
- The request allow-list is `{approvalEnvelope, suppliedEvidence, executionId}`.
- `validateProvisionedAuthorityV2` requires, and never throws without, all of: a V2 cfg, a config-pinned trust root, separate non-fixture executor/reader clients, a trusted connection proof bound to issuer and token, a privilege proof, the content-verified V2 registry, and the full V2 source pin.
- The config needs the explicit `LIVE_AI_03B_RUNTIME_CONTRACT_VERSION=V2` and refuses CORE targets and forbidden secrets in the executor env (EX06–EX10).
- Test provenance never becomes production authority (S08, RD16, EX04).

## 14. Phase-A state contract
See `LIFECYCLE-STATE-MATRIX.md`, pre-activation column. The Phase-A matrix covers 23 state mutations (PA01–PA23) plus exposure, consumption, privilege, CORE, target, source pin, V1 approval, freshness and T0 cases (PA24–PA39).

## 15. Phase-B armed-state contract
Phase B requires:
- the same approval, consumed exactly once and correlated to the ledger row and the receipt commitment;
- V2 as the sole active catalog, with 3 active entries and exact rates;
- V1 historical;
- `oneprobe-v2` `864e2481…` as the SOLE active policy, with 2 policy versions, the dormant policy preserved, and no obsolete or wildcard policy;
- controls at epoch 2, enabled, not killed, with `0a60f1eb…` / `eb56f2b7…`;
- the seven exact ceilings and zero exposure;
- the env, key, model, credential, gates-off and operator-subject checks;
- the three source pins.

Only then is `FirstProbePreflightReceiptV2` issued.

## 16. Seven ceilings
Five money ceilings are 105,920 and the two count ceilings are 1, each checked by strict integer equality. The SQL binds the row identity **and** all seven values, so a tampered row returns zero rows.
- Unit: all 7 fields × ±1, string coercion, and a missing field are rejected (PB01–PB04).
- Real DB: 8 ceiling edits are rejected (F01).

## 17. First-probe receipt identity / versioning
`FirstProbePreflightReceiptV2` is deep-frozen and carries a commitment over:
- the V2 identity: catalog, policy, 105,920, epoch-2 controls, targets, probe digest, registry digest;
- the approval: approval / execution / content digest, `consumed_at`, activation-receipt commitment;
- all three source pins;
- `issuedAt` and mode.

The probe accepts **only receipt objects issued in-process by `runPreflightV2`** (module-private `WeakSet`), after re-validating contract, mode, freshness (≤ 15 s), commitment, exact identity, the expected approval/execution, and a resolved Step-2 pin.

Refused:
- a JSON copy (PR03);
- a V1 receipt (PR04, PR12, and the frozen V1 probe refusing the V2 receipt: E00);
- a stale receipt (PR05, PR13);
- a future receipt (PR06);
- another approval or execution (PR07/PR08);
- a mode mismatch (PR09);
- another target (PR11).

## 18. 105,920 probe guard
`ok` requires accepted AND `spendMicros ≤ 105920` AND at most one provider call.

| Spend / calls | Result |
|---|---|
| 89,536 | within |
| 105,920 | within |
| 105,921 | fails |
| two calls | fail |

There is one send and no retry: a second send is refused, and a send that throws is not retried (PR14–PR18, N28, E01/E02). The probe has no http/fetch/net import and no provider URL (ST04).

## 19. Gateway deploy-source pin
PIN B = `4f390b74` / `72080256`, proven by `tools/prove-gateway-source.mjs` against the real clone (read-only git):
- 2b69ce is an ancestor of 4f390;
- the closure is `tsc -p server/voice-gateway/tsconfig.json` (`include ["*.ts"]`, rootDir `.`);
- the only closure change is `openai-responses.ts`: +7 lines, 0 removed, and exactly two code lines (the `REASONING_03B_SERVICE_TIER = "default"` constant and `service_tier: REASONING_03B_SERVICE_TIER`);
- package.json, package-lock and the broker files are unchanged;
- 33 closure files are pinned.

2b69ce (commit, tree `87aad22`, closure `8dd65435`) is explicitly rejected (S04, PA30, A04).

## 20. The three pins
- **9270c282 / c46da041** is the Step-1 derivation base.
  - It is bound in the signed bundle and checked by `activate_catalog_v2`.
  - It is never rewritten: `checkDerivationBase` rejects a rewrite (S02), and the approval rejects another base (N18).
- **4f390b74 / 72080256** is the gateway deploy source: item 19.
- **The unknown future Step-2 preservation commit** is **not fabricated**.
  - The pin is the placeholder `REQUIRED_AFTER_STEP2_PRESERVATION`, with commit and tree null. Every consumer refuses it before any I/O.
  - The later receipt is produced and verified by `tools/verify-step2-preservation.mjs`. The commit must descend from 4f390, contain additions only under this directory, and hold runtime bytes whose manifest equals the runtime's own `measureRuntimeManifest()`. The current manifest digest is `9a460078846eec885b726e7b54bdbd8a301c690b1f78a68439e151f462341998`.
  - The binding reaches the runtime only through the Owner-controlled authority.
  - See `identity/STEP2-PRESERVATION-BINDING-TEMPLATE.json` and tests S06–S24, H01.

## 21. V1 historical preservation
V1 must stay inactive, with digest `453f9287…`, 2 entries and an unextended expiry, in every state. Revival, activation or extension fails (PA04–PA06, AC05, PB10/PB11, PF04, F03/F04). Restoration never revives V1 (G01).

## 22. M6 compatibility
The frozen M6 canonical verifier PASSES in the pre-activation, activated, armed (including after tamper-revert) and restored states, on PG16 and PG18 (A00, B03, D02, F09, G04). The M6 ledger is reused: exactly one `activate` row, never deleted. M6 R2.1:
- PG18 ledger fixture 55/55.
- Static suite 81/84 at 4f390. The 3 failures are assertions pinned to HEAD `9270c282` and the pre-pin gateway closure, which the accepted Step-1 preservation commit intentionally moved. Against a read-only historical 9270c282 checkout it is **84/84**.

## 23. Privilege boundary
No grant or role is added (`PRIVILEGE-MATRIX.json`). Real-PG proofs:
- gateway_store cannot activate (P01);
- PUBLIC has no successor execute (P02);
- the reader has no execute or restore (P03/P04) and cannot write (A03, P07);
- the executor has no table or ledger DML (B08, P06);
- the old function refuses V2 claims (P05).

There is no admin/superuser fallback.

## 24. Expiry / freshness
| Case | Result | Tests |
|---|---|---|
| Before T0 | rejected | PA39 |
| Valid interval | accepted | PA35 |
| At `2026-10-05T15:26:23Z` | rejected | PA36 |
| After expiry | rejected | PA37 |
| Future evidence | rejected | N19, N24 |
| Receipt at expiry | rejected | PB27 |

T0 is unchanged (PA38). The live mutation clock stays PostgreSQL `clock_timestamp()` inside `activate_catalog_v2`.

## 25. Positive-test totals
- Unit: 59 positive/structural.
- Real-PG lifecycle: 27 positive per server (×2).

## 26. Negative-test totals
- Unit: 231.
- Real-PG lifecycle: 33 per server (×2).

Overall: unit **290/290**; lifecycle **60/60 on PostgreSQL 16.13** and **60/60 on PostgreSQL 18.4**.

## 27. Predecessor regression totals
**44/44 suites** pass (`tests/out/predecessor/`), run from a world-traversable copy of the candidate. After the
closure-harness remediation the runner itself enforces this: it exits 0 only with 0 suite failures, 0 required-setup
failures and exactly 44 suites run (section 41).

**Repo suites (18):**
- live-ai, conversation, gateway, audio;
- ic02 291, 03a 175, 03b 249, p1-negmut 10, teardown-negmut 10, staging-authority 59, staging-runtime 66, owner-preview;
- budget 210, budget PG 80;
- voice gateway / security / provider, router 646.

**Frozen live-ai-03b suites (20):** attester ×3, bootstrap ×11, reader host, serving runtime, production integration, post-apply, **V1 trusted-executor runtime**, live-binding.

**Step 1 (6):**
- generator self-check;
- `build-sql --check`;
- contract 139;
- gateway 45;
- localpg PG16 113 and PG18 113.

The Step-1 gateway and localpg suites compare a candidate (with the pin) against a historical (pre-pin) gateway. They were authored for the Step-1 scratch layout. At 4f390 the runner supplies the faithful inputs through their existing env hooks (`M7_CLONE` = the 4f390 tree, `REPO` = a read-only 9270c282 checkout); no Step-1 file is changed. A first run without those inputs failed only on the missing sibling `repo/` layout (41/44). That is recorded here and is not a regression.

In addition: M6 R2.1 (item 22).

## 28. Disposable PostgreSQL results
Throwaway unix-socket clusters (PG16.13 and PG18.4) were built from the accepted predecessor chain, the full M6 boundary, and Step-1 `01`+`02`.

- **Logins:** REAL role logins. The executor uses scram with a SYNTHETIC test-only password; the reader uses trust.
- **Owner steps:** `04`, `05`, `07` were applied through psql as the Owner.
- **Result:** 60/60 on each server. Step-1 localpg: 113/113 on each server.

The local cluster stands in for AI-STAGING. The attested target ids are the contract ids, TEST-ONLY.

## 29. Material findings found and fixed
Four findings, all fixed within scope:
1. **The armed-state query omitted the V2 entry and rate columns.**
   - It was masked by row-level fixtures and caught by the real-PG lifecycle.
   - Fixed. Test R19 (column coverage for every phase) was added and mutation-proven.
2. **`validateProvisionedAuthorityV2` could throw on a malformed cfg** instead of failing closed.
   - Fixed. EX04b added.
3. **Harness only:** the Step-1 suite layout was supplied through its env hooks (item 27).
4. **Harness only (superseded by section 41):** the original packet only corrected how `run-all` *printed* the CLI
   exit codes. That did not make the runner fail closed. The independent closure review found both aggregate
   runners fail open; section 41 is the actual fix.

## 30. Remaining material blockers
**None** for this offline scope. Non-material, documented constraints:
- The production authority is UNPROVISIONED by design.
- The preflight and the probe must run in one process within 15 s (a deliberate receipt binding).
- The postflight gate/credential/count observations are injected by the Owner harness, as in V1.
- The V2 window closes at **2026-10-05T15:26:23Z**. The live sequence must finish before then, or HOLD for a fresh successor.

## 31. Accepted repo unchanged
`/home/user/staybid-frontend` is at HEAD `4f390b74…`, tree `72080256…`, with status clean (`FROZEN-FILE-HASH-PROOF.txt`). No commit, push or PR was made.

## 32. Railway / live DB
Not accessed. Only local throwaway clusters were used.

## 33. Credentials / secrets
None accessed or created. The test-only synthetic executor password and transport secrets are literals in tests, not credentials. The reviewer, attester and probe keys are generated per run and never persisted.

## 34. Deployment
None.

## 35. Provider calls
None. The probe used an injected synthetic broker only.

## 36–39. ZIP
The superseded original package was `LIVE-AI-M7-STEP2-RUNTIME-REBINDING-EVIDENCE.zip` (sha256 `50089b3a…`). The
current package is `LIVE-AI-M7-STEP2-HARNESS-REMEDIATION-EVIDENCE.zip`, containing the complete remediated candidate. Its size, SHA-256 and the manifest member/hash verification are reported in the final chat report: a file cannot contain its own hash. `MANIFEST.json` inside lists every member with its size and SHA-256.

## 40. Recommended next governance boundary
1. **One Owner closure review** of this Step-2 package.
2. If accepted, a separate **"M7 Step 2 — reviewed candidate preservation commit"** packet:
   - add this directory byte-for-byte on top of `4f390b74`, as additions only;
   - run `tools/verify-step2-preservation.mjs` and `tests/run-all-m7s2.sh` on the preserved commit.

   Push only under its own authorization.
3. Only after that, the separately authorized live sequence in `README-OPERATOR.md`: gateway deploy from 4f390, authority provisioning, Step-1 `01`/`02`, genuine reviewer approval, activation, Owner arm, Phase B and the single probe.

All of it must finish before 2026-10-05T15:26:23Z. No 03C.

## 41. Closure-harness remediation (after the WORK closure HOLD)

**Primary status for this remediation:** `M7_STEP2_HARNESS_REMEDIATION_COMPLETE_READY_FOR_FOCUSED_CLOSURE_REVIEW`.

### 41.1 The WORK finding
The independent closure review returned `HOLD_M7_STEP2_CLOSURE_REVIEW`. Its only material candidate-local finding was
that **the aggregate test harness fails open**. No runtime-authority defect was found.

Two exact defects in the reviewed runners:
1. **`tests/run-all-m7s2.sh`** printed results but never turned them into its exit status:
   - the identity check was unchecked;
   - the gateway proof used `cmd && echo PASS || echo FAIL`;
   - unit and both PostgreSQL lifecycles printed their summaries regardless of status;
   - the CLI codes (2 / 70) were printed, not enforced;
   - the script ended with `echo ALL_DONE; cat`, so it **always exited 0**.
2. **`tests/run-predecessor.sh`** incremented `F` on failures but ended with a plain `echo` and no `F == 0` gate. The
   historical 9270c282 checkout ran outside any failure accounting.

### 41.2 The remediation (harness only)
- **`run-all-m7s2.sh`** accumulates `T`/`F` explicitly over **10 REQUIRED checks**, each compared with its exact
  contract:
  - A: the identity `--check` exits 0;
  - B: the PIN B proof exits 0;
  - C: unit exits 0 AND its summary is exactly `m7s2-unit: 290 passed, 0 failed`;
  - D/E: the PostgreSQL 16 / 18 lifecycles (see below);
  - F: the three fail-closed CLIs exit **exactly 2**;
  - G/H: the reader entrypoint and serving runtime exit **exactly 70**.

  For D/E, the output must have **no `SKIPPED` marker** (the child's existing contract), exit 0, and a summary
  `m7s2-localpg-lifecycle[PostgreSQL <major>.…]: 60 passed, 0 failed` with the **right major version**. PG18
  binaries must exist before the run; missing binaries are a FAIL, never a silent PG16 fallback. The PG16 run
  explicitly unsets `M6_PGBIN`.

  The script prints `RESULT: PASS (10/10 required checks)` and **exits 0 only if F == 0 and T == 10**. Otherwise it
  prints `RESULT: FAIL (…)` and exits 1. `ALL_DONE` was removed. `set -e` is not used, because several checks expect
  a non-zero exit.
- **`run-predecessor.sh`** counts suite failures (NF) and required-setup failures (SF) separately:
  - Fatal setup (output directory, mktemp, copying the candidate, entering the copy) exits **3** at once.
  - The historical 9270c282 checkout is a counted `setup_step` (`SETUP-FAIL(<rc>)`).
  - It **exits 0 only if NF + SF == 0 and exactly 44 suites ran.** Otherwise it prints `INVENTORY-FAIL` / `RESULT: FAIL` and exits 1.
  - The suite inventory, `run()`, `timeout` and per-suite logging are unchanged.
- **`M7S2_PG18_BIN`** is a harness-only override of the local PG18 test-build path; the default is unchanged. No
  runtime, authority or production bypass was added.

### 41.3 Deterministic forced-failure regression — `tests/harness-fail-closed.test.sh`
- **Method:** it copies the REAL runner files byte-for-byte (sha256 asserted) into an isolated temporary mirror and
  executes them with `/bin/bash`. `node`, the in-script `bash <lifecycle>` and `git` resolve through a TEST-ONLY
  `PATH` shim whose exit status and output are set per case.
- **What it asserts:** the runner's **observable process exit status**, plus **attribution**: for run-all, exactly
  one FAIL on the intended check and a `RESULT: FAIL` verdict; for predecessor, the named FAIL / SETUP-FAIL /
  INVENTORY-FAIL line.
- **Cases:**
  - RA1: everything nominal → run-all exits 0;
  - RA2: gateway;
  - RA3a/b: unit, including exit 0 with 1 failed;
  - RA4a–g: PG16 skip (exit 2), PG18 skip (exit 0), PG18 binaries missing, PG18 reporting PG16, no summary, 59/60, exit 1;
  - RA5a–c: CLI 9 / 0 / 9;
  - RA6a/b: reader 9 / 0;
  - RA7: the first check fails while all later ones pass;
  - PR8: all predecessor suites pass → exit 0;
  - PR9a–c: a repo suite, the frozen V1 runtime suite, or the Step-1 localpg suite fails;
  - PR10: historical-checkout bootstrap fails;
  - PR11: the inventory shrinks to 43.

  The frozen-suite inventory in the predecessor mirror is discovered from the real repository.
- **Old runners (the reviewed candidate's bytes, extracted from the superseded ZIP; sha256 `01fab33f…` / `fd38204e…`):**
  the regression **exits 1 — 5 passed, 42 violations**. All 16 forced run-all failures and all 5 forced predecessor
  failures exited **0**. This reproduces the WORK finding (`tests/out/harness/OLD-runners-reproduction.log`).
- **New runners:** the regression **exits 0 — 47/47**. Every forced failure exits 1 and is attributed to the intended
  check; the nominal cases exit 0 (`tests/out/harness/NEW-runners-forced-failure.log`).

### 41.4 Real success path (this environment)
- **`bash tests/run-all-m7s2.sh`: exit 0**, `RESULT: PASS (10/10 required checks)`:
  - identity PASS; PIN B proof PASS;
  - unit 290/290;
  - PostgreSQL 16.13: 60/60; PostgreSQL 18.4: 60/60;
  - CLIs exit 2 / 2 / 2; readers 70 / 70.
- **`bash tests/run-predecessor.sh`:** **exit 0**, `RESULT: PASS (44/44 suites, 0 setup failures)`. The historical 9270c282 checkout is `SETUP-OK`. There
  are 18 repo suites, 20 frozen live-ai-03b suites (including the V1 trusted-executor runtime), and 6 Step-1 checks:
  - generator self-check;
  - `build-sql --check`;
  - contract 139/139;
  - gateway 45/45;
  - localpg PostgreSQL 16.13 113/113 and 18.4 113/113.

  Logs: `tests/out/predecessor/`, `tests/out/predecessor-summary.log`.
- **M6 R2.1 (rerun):**
  - PG18 ledger fixture: 55/55.
  - Static suite at 9270c282 (read-only historical checkout): 84/84.
  - Static suite at 4f390: 81/84. The 3 failures are the assertions pinned to HEAD 9270c282 and the pre-pin gateway
    closure, exactly as in item 22; they are unchanged by this remediation.

  The frozen M6 canonical verifier also PASSES in every lifecycle state on PG16 and PG18 (run-all D/E).

### 41.5 Byte-freeze
- **Runtime manifest:** `9a460078846eec885b726e7b54bdbd8a301c690b1f78a68439e151f462341998` before and after. All 17
  runtime members are sha256-identical to the reviewed ZIP (`tests/out/harness/RUNTIME-BYTE-FREEZE-PROOF.txt`).
- **Code-level Step-2 changes versus the reviewed candidate:** exactly `tests/run-all-m7s2.sh` (changed),
  `tests/run-predecessor.sh` (changed) and `tests/harness-fail-closed.test.sh` (added).
- **Evidence-only refreshes:** this receipt, `NEGATIVE-REGRESSION-MAP.md`, `README-OPERATOR.md`,
  `FROZEN-FILE-HASH-PROOF.txt`, `docs/CANDIDATE-ADDITIONS.diff`, `MANIFEST.json` and `tests/out/**`. Also added:
  `docs/HARNESS-REMEDIATION.diff`, the focused unified diff of the 3 harness files against the reviewed candidate.
- **Frozen bytes:** every tracked file in the clone is byte-identical to HEAD 4f390b74, covering the Step-1 package,
  the M6 artifacts, V1 history and `openai-responses.ts` (`FROZEN-FILE-HASH-PROOF.txt`).
- **Not done:** no runtime, SQL, identity, reader, executor, preflight, probe, authority, source-pin, gateway,
  Step-1 or frozen edit; no commit, push or live action.
