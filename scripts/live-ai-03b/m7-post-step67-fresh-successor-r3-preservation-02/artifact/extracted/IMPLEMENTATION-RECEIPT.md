# Implementation Receipt — Fresh Pricing / Catalog Successor 01 — Remediation R3

## Primary status

`R3_HARNESS_REMEDIATION_COMPLETE_HOLD_PENDING_REAL_PG16_OR_PG18_SINGLE_OBSERVATION_RUN`

## Scope lock

R3 changes only the disposable-PostgreSQL A1 proof harness, proof-gate/negative regressions, aggregate runner markers, package identity tooling, and R3 evidence/documentation. Production V3 SQL/runtime/approval, Executor Attestation V2, pricing/catalog evidence, historical rejected ZIP, and frozen V1 references remain byte-identical to R2.

## R2 review finding addressed

R2 accumulated `PRE_VALID`, `LOCK_WAIT`, and `EXACT_BLOCKER` across different observations. That allowed a pre-expiry non-blocked observation and a later post-expiry blocked observation to compose into a false pre-expiry proof.

R3 removes all accumulated PRE proof flags. The PRE gate accepts only one pipe-delimited observation row that itself carries and satisfies the complete conjunction. The PostgreSQL query samples `clock_timestamp()` once through a `MATERIALIZED` CTE and uses that exact sampled value both for the before-expiry predicate and emitted timestamp. POST uses the same one-row rule with the same activation PID and blocker PID at/after expiry.

## Negative regressions

The deterministic gate suite explicitly rejects the exact WORK-reproduced split-observation sequence and additionally rejects already-expired, never-blocked, wrong/multiple blockers, same-backend, observer collision, early release, wrong post activation, unrelated error, and dirty rollback states.

## Current build-sandbox checks

All deterministic/static/crypto checks and R3 proof-gate regressions pass. The real PostgreSQL 16/18 regression cannot execute in this sandbox because `initdb` is unavailable. Aggregate therefore intentionally remains FAIL/HOLD rather than promoting UNKNOWN to PASS.

## Required closure

A supported disposable PostgreSQL run must return `RESULT: PASS (12/12 required checks)` and emit both R3 single-observation markers, the exact mutation-boundary freshness refusal marker, and `inactive|3|0` rollback evidence.

No preservation, production integration, genuine approval, or live execution is authorized by this receipt.
