# LIVE-AI-03B — M7 Step 1: consolidated HB-1 remediation — implementation receipt

**Primary status:** `M7_STEP1_HB1_CONSOLIDATED_OFFLINE_REMEDIATION_COMPLETE_READY_FOR_ONE_CLOSURE_REVIEW`

This packet was offline only. It did **not** touch any of the following:
- Railway, the AI-STAGING database or CORE-PROD;
- any live database (no mutation of any kind);
- secrets or credentials;
- the provider (no API call), gateway deployment or configuration;
- git in the accepted repository (no commit, push or PR).

The accepted repository is unchanged: HEAD `9270c282…`, tree `c46da041…`, clean. The single source change lives only in a scratchpad **clone** (`m7s1/repo`).

## 1–8. Identity and digests

| Item | Value |
|---|---|
| **T0** (frozen, `date -u`) | `2026-09-28T15:26:23Z` |
| V2 `verification_expires_at` | `2026-10-05T15:26:23Z` (T0 + 7 calendar days) |
| Pricing re-verification | **Independently retrieved again by the executor** on 2026-09-28 from official OpenAI docs. Details below. |
| V2 catalog ID | `openai-gpt-5-6-terra-standard-short-v2` |
| Entry: base input | `…-v2-reasoning-input-token-base` (tier NULL, 2,000,000 / 1,000,000) |
| Entry: cache write | `…-v2-reasoning-input-token-cache-write` (tier `cache_write`, 2,500,000 / 1,000,000) |
| Entry: base output | `…-v2-reasoning-output-token-base` (tier NULL, 12,000,000 / 1,000,000) |
| `source_digest` | `ec23657bf0c20390afec4d4f233f14300e43b136cc6f27c25d6ffc35e1d7b357` |
| Inactive `catalog_digest` | `36355fab5be8009fa66352ce678394d4963f2927a39d1a8eea63f4aa5b939b62` |
| Active `catalog_digest` | `836548ef0274f3a068c83cf4d8e952eb6388921f2064c5e29e8ec25cd7eb798b` |

**How pricing was re-verified.** Raw pages were saved and their sha256 pinned in `docs-evidence/`. A deterministic extractor pulls the embedded gpt-5.6-terra rows from the raw pricing HTML:
- Standard short context: `2 / 0.2 / 2.5 / 12`;
- Batch and Flex: `1 / 0.1 / 1.25 / 6`;
- Fast: `4 / 0.4 / 5 / 24`.

It also pulls verbatim sentences from the API reference and guides:
- *"If set to 'default', then the request will be processed with the standard pricing and performance…"*;
- *"When not set, the default behavior is 'auto'"*;
- *"Requests that don't specify a service_tier then default to Fast mode"* (when the project default is Fast);
- *"For GPT-5.6 and later, cache writes cost 1.25×…"*;
- *"Prompt caching is enabled by default…"*.

The model page (rendered) states >272K input is long-context pricing.

**How the digests are built.**
- The **source** payload keeps the accepted shape and `source_id` (the evidence class). Its `rates` array now has **three** entries in entry-id order, and it carries a fresh `verified_at = T0`. The historical two-rate V1 digest is not reused.
- The **catalog** payload uses the accepted contract (`staybid.live-ai.budget.price-catalog.v1`). It commits to all three entries, T0, the source digest and the status.
- The **active** digest is the reviewed lifecycle transition: only `status` changes; every other field is byte-preserved.
- The generator first reproduces all **13** accepted predecessor digests byte-exact: V1 source, V1 inactive and active catalog, dormant policy, the 89,536 policy (active and restored), and the four control digests. Only then does it emit anything.

## 9–13. Policy and reservation

| Item | Value |
|---|---|
| Successor policy ID | `live-ai-03b-policy-oneprobe-v2` |
| `policy_digest` (active) | `864e24817b2f98d741495bb403c20ada31cd4f27db3d9dfe1c50bb7d99ad9245` |
| `policy_digest` (restored) | `833e5b963bbba37e6e6759e60269246ba8c61949257f5bb9edf49cc82829da79` |
| Money ceilings (five fields) = **105,920** | `session_money_ceiling_micros`, `subject_day_money_ceiling_micros`, `project_day_money_ceiling_micros`, `project_month_money_ceiling_micros`, `global_day_money_ceiling_micros` |
| Count ceilings (two fields) | `session_provider_calls = 1`, `session_execution_admissions = 1` |
| Verified worst-case reservation | **105,920 micros** = 32,768 × 2,500,000 / 1e6 (81,920) + 2,000 × 12,000,000 / 1e6 (24,000) |
| Activation bundle digest (v2) | `d6f40fc53dd6002fbed4990603aeddabe3bfff39b6a81aadc9e57dd6ef618e1e` |

The reservation figure is proven by the real accepted `createBudgetCore`, both in-memory and on the catalog loaded by the **real** `loadStagingPriceCatalog` from local PostgreSQL 16 and 18.

## 14–15. Cache-write handling and the budget core

**§16 A–I all pass**, using the accepted gateway core **unchanged**:

| Case | Result |
|---|---|
| A | reserve 105,920; settle 89,536 |
| B | full cache write: 105,920 = reservation = published bill |
| C | partial cache write: exact 94,536 |
| D | cached tier absent: the full 105,920 is retained, which is ≥ the published bill |
| E / F / G | missing, low or malformed cache-write rate: rejected by the V2 contract, the approval verifier and the DB activation. The tests show the gateway *would* under-reserve (89,536, or the row being dropped), which is why these are rejected upstream. |
| H | over-cap usage: revoke preserved |
| I | 256-case grid: no charge above 105,920 and none below the published bill |

**Budget accounting core changed: NO.** `live-ai-budget-authority.ts`, `-pricing.ts`, `-store.ts`, `live-ai-staging-main.ts` and `live-ai-03b-controller.ts` are byte-identical to accepted (test G00). Adding the `cache_write` row by itself makes the reservation 105,920.

## 16. The `service_tier` source change

**`server/voice-gateway/openai-responses.ts`, +7 lines, in the clone only** (`diffs/service-tier-pin.diff`):
- a new constant `REASONING_03B_SERVICE_TIER = "default"`;
- `service_tier: REASONING_03B_SERVICE_TIER` added to the 03B `runReasoning03bProviderCall` request body.

**Unchanged:** endpoint, model, reasoning effort, `max_output_tokens`, `store`/`background`/`stream` = false, `tools=[]`, truncation, the JSON schema, zero retries, and the admission contract and its digest.

**Tests:** R37g proves that the only body difference from the accepted request is the added field. R38 shows the accepted body is rejected by the first-probe request contract because it has no tier. R39 rejects `auto`, `flex`, `priority`, `fast`, `scale`, `ultrafast`, and any extra field.

**Legacy path:** `createDefaultReasoningCall` is not reachable in staging, because the composition injects `budget: null` and so has no key.

## 17. Trusted successor mechanism (minimum safe)

**What it is:** a new schema `live_ai_03b_trusted_v2`, owned by `live_ai_03b_fn_owner` with PUBLIC revoked. It holds exactly two `SECURITY DEFINER` functions, `activate_catalog_v2(jsonb,text)` and `restore_catalog_v2_inactive(jsonb,text)`, with `search_path = ''`.
- **Only `live_ai_03b_executor`** gets USAGE and EXECUTE. The reader, gateway-store and PUBLIC get nothing.
- The functions consume the **existing** M6 ledger `live_ai_03b_trusted.approval_consumption`. There is no ledger DDL, and fn_owner gets no new grant.

**Why a new schema, derived from source:**
- The frozen M6 canonical post-verifier (section E) requires `live_ai_03b_trusted` to hold **exactly 2** functions, so adding V2 functions there would break it.
- The frozen M6 functions are V1-literal-bound and expired, so reusing them would mean rewriting frozen objects.
- A separate schema keeps every M6 object byte-exact. The M6 canonical verifier passes before M7, after `01`+`02`, while the catalog is armed, and after restoration, on both PostgreSQL 16 and 18.

**What activation binds to** (the exact 36-key `VerifiedApprovalClaimsV2`, compared in `COLLATE "C"` byte order):
- the exact V2 ID, inactive and active digests, the three exact entries, and the fresh source digest;
- the successor policy ID and digest and the 105,920 ceiling;
- `service_tier` default, standard, direct, non-regional, short context, the exact three rates, USD;
- AI-STAGING as the target and the CORE-PROD exclusion;
- the bundle and base commit;
- DB-clock freshness (`clock_timestamp()`) against T0 and T0+7d and the signed windows;
- the exact predecessor state: V1 byte-exact historical, V2 exact inactive, exactly 2 versions and 5 entries, nothing active, no active policy, dormant controls.

**Atomicity and replay:** the single-use ledger is consumed first, and replays fail closed. Any later failure rolls everything back (§6 test).

## 18. V1 preservation

The previous HOLD claim was **independently re-verified and holds**:
- the runtime store and loader select only `status='active'` and load entries only for the selected version;
- V1 and its entries are inactive, and their verification expired at `2026-09-25T18:37:35Z`;
- the M6 V1 function fails at the DB clock (tested).

V1 is therefore kept **physically unchanged**. The seed, activation, policy, control and restoration steps all require V1 to be byte-exact and historical, and every one of them fails closed if V1 was extended or activated.

## 19. Approval binding

The accepted P1-02 two-authority model is preserved:
- **A.** A supplied receipt (`approval/SUPPLIED-EVIDENCE-RECEIPT-CANDIDATE.json`, digest `5754ef94…`). It is a candidate, not authority.
- **B.** An **independently approved anchor**: a reviewer Ed25519 signature over `canonicalize(PricingEvidenceApprovalV2)`, verified only against an independently pinned reviewer key. `approval/INDEPENDENT-APPROVAL-ANCHOR-TEMPLATE.json` is **unsigned**, has placeholders, and is tested never to verify. `INDEPENDENT_APPROVED_ANCHOR = REQUIRED BEFORE LIVE ACTIVATION`. No approval was fabricated.

The verifier:
- rejects self-approval, `approved:true`, a substituted fingerprint, and receipt or digest mismatch;
- rejects Fast, Priority, Flex, Batch, Scale, regional, long-context, non-direct and non-standard;
- rejects a missing or wrong cache-write rate, the old 89,536 policy and digest, `calls≠1`, stale or future windows, and CORE-PROD targets;
- has Phase A (unused) and Phase B (consumed, ledger-correlated) paths.

## 20. Restoration

- **`07` (Owner, derived from the accepted kit):**
  - moves controls from epoch 2 to 3 (disabled), then sets the successor policy inactive with the restored digest, then returns V2 to the exact inactive digest;
  - idempotent (an already-restored state is a no-op), and any mixed state is a HOLD;
  - never runs DELETE or TRUNCATE, never revives V1, and preserves accounting and ledger rows.
- **`06` (executor, trusted):**
  - works only from the exact active state; the exact restored state returns `already_restored`;
  - has its own single-use ledger row, and a mixed state is a HOLD;
  - V1 is untouched.

## 21. Files

All files are new under `m7s1/`:
- **Catalog tooling:** `catalog/v2-digest-gen.mjs`, `v2-digests.json`, `v2-catalog-contract.mjs`.
- **SQL:** `build-sql.mjs` and `sql/m7-v2-01…09`.
- **Approval:** `approval/pricing-approval-contract-v2.mjs`, `approval-verify-v2.mjs`, `first-probe-request-contract.mjs`, `make-candidate-artifacts.mjs`, and the candidate receipt and anchor template.
- **Evidence:** `docs-evidence/` (raw HTML, extractor, record).
- **Docs:** `PRIVILEGE-MATRIX.json`, `README-OPERATOR.md`, `ROLLBACK-FAIL-CLOSED-PLAN.md`, `REGRESSION-MAP.md`, `SOURCE-PINS.txt`, `IDENTITY.txt`.
- **Tests:** `tests/*`.
- **Diffs:** `diffs/` — the service-tier pin, and the derived `04`/`05`/`07` against the accepted kit.

**Changed:** one clone file (`server/voice-gateway/openai-responses.ts`). The accepted repository is unchanged.

## 22–23. Tests

| Suite | Result |
|---|---|
| `tests/m7-contract.test.mjs` | **139/139** |
| `tests/m7-gateway.test.mjs` (in-memory; compiles the candidate and accepted gateways) | **45/45** |
| `tests/m7-localpg.test.sh` on disposable **PostgreSQL 16.13** | **113/113** |
| `tests/m7-localpg.test.sh` on disposable **PostgreSQL 18.4** | **113/113** |
| Nested E2E (real `loadStagingPriceCatalog` + §16 on the loaded V2), PG16 / PG18 | **62/62** each |
| Predecessor suites on the clone | **18/18** |
| M6 R2.1 static | **84/84** |
| M6 R2.1 PG18 ledger fixture | **55/55** |
| Generator self-check, `build-sql --check`, candidate `--check`, pricing extractor | all pass |

The predecessor suites run on the clone are: live-ai (12 suites, including 03B 249/249, staging-authority 59, staging-runtime 66, owner-preview 961), budget-01 210, budget-01 PG 80, and voice gateway / security / provider / router.

`budget-01 PG` first failed only because `initdb`, running as the postgres OS user, could not traverse the scratchpad path. A rerun from a world-traversable copy of the same clone passed 80/80. That is logged in `tests/out/predecessor-summary.log`.

## 24. Material findings

All of these are in scope and were repaired together in this packet.
1. **HB-1:** fixed with the 3-row V2 catalog and the 105,920 successor policy.
2. The frozen M6 verifier's exact function count makes the old schema unusable for V2, so a new schema is used.
3. **Self-review:** the claims key-set comparison used the database's default collation, which could differ on the hosted DB and fail a genuine activation closed. It is now pinned to `COLLATE "C"` on both sides.
4. The accepted control activation checked the policy only by ID, status and **stored** digest. A tampered ceiling with an unchanged stored digest would have passed. The successor `05` now requires exactly five money ceilings of 105,920, two count ceilings of 1, a single active policy, the exact V2 shape and V1 historical (§8 tests ±1 on three fields).

**Next-boundary prerequisites.** These are outside Step-1 scope and fail closed today:
- **The executor, reader and preflight runtime stack is V1-bound.** The `FIXED` importers of `pricing-approval-contract.mjs`, `production-read-queries.mjs`, `first-probe-preflight-postflight.mjs`, and the 89,536 `withinCeiling` in `first-text-probe.mjs` all reject V2 state until they are rebound in M7 Step 2.
- **The gateway must be deployed from a commit that contains the pin** (deploy gate R37/R38).

**Advisory:** the Responses response's `service_tier` value is not validated.

## 25–29. Boundaries

- **25.** The M6 frozen files are unchanged; sha256 values are in `SOURCE-PINS.txt`:
  - migration `2987d3ff…`;
  - deferred grant `480648b4…`;
  - post-verifier `88252d78…`;
  - gateway-store role `a1d0e590…`;
  - reader role, R2 runner `fbd1e1d3…`, R2.1 runner `6b7a63dc…`;
  - V1 seed `64e0ded5…`;
  - the accepted approval contract and kit files;
  - gateway sources.
- **26.** Repo/Git: unchanged. HEAD `9270c282…` equals the remote; 0 porcelain lines; no commit, push or PR.
- **27.** Railway and the live DB: not accessed. Only throwaway local unix-socket clusters were used.
- **28.** Secrets and credentials: none accessed or generated for live use. Test-only artifacts, never persisted in the package: synthetic executor login password, ephemeral in-process Ed25519 test keys, `synthetic-test-key-not-a-secret` with a fake fetch.
- **29.** Provider: no API call. Only public documentation pages were fetched.

## 34. Exact next boundary

After one independent closure review of this package, the next step is a **separate Owner authorization** for:
1. the preservation commit of the reviewed M7 Step-1 artifacts plus the one-line gateway pin (no push unless separately authorized);
2. then **M7 Step 2**, offline: rebind the executor, reader and preflight runtime stack to V2.

Only after that come the live AI-STAGING applies of `01`+`02` with the `08` and M6 verifiers, the independent signed anchor, trusted activation, policy, controls and the probe. Each of those is its own authorized boundary.
