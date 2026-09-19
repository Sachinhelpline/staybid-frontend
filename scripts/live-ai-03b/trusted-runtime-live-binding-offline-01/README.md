# LIVE-AI-03B · trusted-runtime live-binding (OFFLINE)

**Latest packet:** `LIVE-AI-03B-P1-02-VERIFIED-SCHEMA-PRODUCTION-AUTHORITY-OFFLINE-INTEGRATION-CONSOLIDATED-MATERIAL-REMEDIATION-01`
**Disposition:** `OFFLINE_REMEDIATION_COMPLETE_REVIEW_REQUIRED`

> ⚠ **OFFLINE ONLY.** This directory performs **no** live database / Railway / Supabase /
> Vercel / CORE-PROD access or mutation. It applies **no** SQL/migration/role/grant, provisions
> **no** credential/secret/signing-key/approval, and activates **no** deployment/gateway/catalog/
> policy/control. It does **not** modify the frozen 19+14 accepted files and does **not** make the
> frozen production entrypoint reachable — the frozen production authority stays UNPROVISIONED.

## Consolidated material remediation (this packet)

The independent WORK closure review reproduced two material offline defects; both are corrected here
in one bounded pass, within this eight-file candidate directory only:

- **Finding 1 — exact policy/object binding.** The four reviewed queries are now bound to the exact
  accepted `public.`-qualified objects, policy identities, digests and GLOBAL policy cardinality
  recovered from accepted source (dormant-control-policy-seed, one-call-policy-activation,
  control-activation, inactive-price-catalog-seed, foundation schema, first-probe `EXPECT`):
  - `dormantPolicyControl`: active-policy absence is measured **globally** (`WHERE status='active'`,
    no project filter) so a wildcard (`project_id='*'`) or foreign-project active policy is visible;
    `dormant_policy_present` is bound to the exact dormant policy id `live-ai-03b-policy-v1-dormant`
    + project + inactive + `policy_digest` **and** the accepted single-policy-row cardinality.
  - `armedPolicyControl`: `one_call_policy_digest` is bound to the exact one-call policy id
    `live-ai-03b-policy-oneprobe-v1` + project + active **and** to exactly-one-globally-active-policy;
    any extra/duplicate/foreign active policy collapses it to NULL ⇒ the frozen `predecessorArmedState`
    rejects. The adapter-discarded `active_policy_count` field is not emitted (§5.M).
  - `ceilings`: read from the SAME exact one-call identity + digest.
  - every relation is `public.`-qualified (no `search_path` resolution).
- **Finding 2 — SQL bytes must match the approved registry.** `production-authority-composition.mjs`
  now validates the **actual supplied** query map via `assertSuppliedRegistry`: it reconstructs the
  full registry from the supplied reviewed SQL + the frozen catalog/ledger queries, recomputes the
  canonical digest, and requires it to equal the pinned `CANDIDATE_REGISTRY_DIGEST`; the supplied
  `__registryDigest` marker must equal that recomputed digest; each supplied query must be
  byte-identical to the pinned constant. The reproduced WORK attack (a copied correct digest carrying
  fabricated constant-returning SQL) now fails closed. The previous bug — verifying the module-DEFAULT
  registry while trusting a different supplied map — is removed.

`trusted-reader-role.sql` passed WORK's offline review as an unapplied proposal and is preserved
unchanged (the two corrections did not require a compatible change to it).

## Files
- `production-read-queries.mjs` — Task A: the four bound queries + registry + digest + integrity +
  `assertSuppliedRegistry` (Finding-2 authority check).
- `trusted-reader-role.sql` — Task B: unapplied least-privilege reader-role proposal (unchanged).
- `production-authority-composition.mjs` — Task C: fail-closed composition; validates supplied SQL
  content (Finding 2).
- `tests/live-binding-fixture.mjs` — TEST-only in-memory fixture (null-aware overrides for 0-row cases).
- `tests/live-binding.test.mjs` — the automated suite (portable relative paths).
- `future-live-gates.json` — remaining live-only prerequisites.
- `EVIDENCE-MANIFEST.json` — sha256 of every file in this directory.

## Tests

```
node tests/live-binding.test.mjs
```

82 checks: (1) registry integrity + **static Finding-1 binding assertions** (the exact id/digest/
global-cardinality/`public.` bindings are in the actual SQL bytes); (2) query→observation via the
frozen `makeTrustedReadAdapter` + frozen `checks` — positive **and** the full §6 negative matrix
(wildcard/foreign active in Phase A; missing/wrong-id/wrong-digest/duplicate dormant; extra/duplicate/
foreign active + wrong id/digest + wrong control digest/epoch in Phase B; different-identity ceilings;
nonzero exposure; simulated subquery-cardinality error); (3) end-to-end via the frozen
`runTrustedExecutorTest` with the real registry → `CATALOG_ACTIVATION_AND_PHASE_B_COMPLETE`; (4)
composition fail-closed + validator bar + the §8 Finding-2 substituted-query attack matrix.

Compatibility: the frozen `trusted-executor-runtime-01/tests/runtime-integration.test.mjs` still
passes (66/66) unchanged.

**Database execution is a disposable in-memory fixture only — NOT live PostgreSQL dialect/catalog
validation.** Hosted-PostgreSQL scalar-subquery/boolean/NULL semantics remain a FUTURE LIVE gate.

## Remaining live-only gates
See `future-live-gates.json`: fresh Railway identities, connection→service proof, CORE non-target,
source prestate, credential isolation, trust-root config, reader-role application, hosted-dialect
validation, and composed-authority provisioning — all OPEN, Owner/future-packet work.
