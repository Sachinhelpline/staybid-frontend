# Predecessor regression classification (§23/§24) — revision v2

Every run used the **revised v2** candidate, taken from a world-readable copy of the scratch tree (runtime bytes
identical to the reviewed v2). No suite writes into the reviewed tree. The v1 results are kept in
`logs/v1-review/`.

| Runner / suite | v2 result | Log |
|---|---|---|
| M7 Step-2 `run-predecessor.sh`: 18 repo + 20 frozen `scripts/live-ai-03b/*/tests` + 6 Step-1 (exact inventory **44**). Includes bootstrap (11), attester (3: containment, integration, **real-PG localpg**), production integration, private-reader host + serving runtime, and the trusted boundary/runtime/binding suites | **44/44 PASS** | `logs/13-m7s2-run-predecessor-44.log` |
| M7 Step-2 `run-all-m7s2.sh` (10 required, real PG16 + PG18) | **10/10 PASS** | `logs/14-m7s2-run-all-10.log` |
| M7 Step-2 `harness-fail-closed.test.sh` | **47/47 PASS** | `logs/15-m7s2-harness-fail-closed-47.log` |
| M5 orchestrator `source-pin.selftest.mjs` (deployment-side scratch artifact, run against a v2 tree snapshot) | **23/23 PASS** | `logs/16-…` |
| M5 orchestrator `wrapper.selftest.mjs` (drives the REAL reader and attester bootstraps of the v2 tree) | **36/36 PASS** | `logs/17-…` |
| Frozen bootstrap (11) / observer-attester (3) / production-integration (1), run directly by `run-checks.sh` | **all PASS** | `logs/08…10-*.log` |

**Coverage of the §23 list:**
- **Bootstrap, attester, reader:** `reader-bootstrap` is exercised by lifecycle, race, regate and production.
- **Production integration:** covered.
- **Observer:** attester-integration and localpg exercise the accepted observer coordinator.
- **Private peer:** `network.test.mjs`.
- **v2 channel:** signing-authority, lifecycle and race.
- **M5 orchestrator / static checks:** the two self-tests above.

No suite in the list was skipped or unavailable.

**Inventory preserved.** The new checks live under `checks/*.check.*`, so exactly 44 suites still run.

**Intentionally-old pins.**
- No tracked repo file pins `f48936f0…` or `8993adff…`.
- The deployment-side `m5-runtime/m5-source-pin.mjs` hardcodes `SOURCE_PIN = f48936f0…`. It is an
  **intentionally-old pin**: it identifies what is deployed today, not this candidate. Its self-test passes
  because it computes the digest of whatever tree it is given. It must be re-pinned to the future preserved commit
  and tree digest (both **UNKNOWN**) in a separately authorized packet.
- No frozen expectation was rewritten.

**Evidence-only fix (disclosed, not a frozen suite):** in this packet's own `checks/recovery.check.mjs`, the G1 wait
predicate now also waits for `clock_invalidated`. That fixes a test race: `signingReady()` goes false,
fail-closed, at the 2 s staleness age, up to one scheduler tick before the event. The assertion is unchanged.
