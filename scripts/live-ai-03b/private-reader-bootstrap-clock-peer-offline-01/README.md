# LIVE-AI-03B · OFFLINE BOOTSTRAP / CLOCK-GATE / PRIVATE-PEER (OFFLINE candidate)

**Authorization:** Owner (Sachin Tomer) — Roadmap Milestone 1, one bounded offline implementation milestone.
**Disposition:** `OFFLINE_BOOTSTRAP_CLOCK_PRIVATE_PEER_IMPLEMENTATION_COMPLETE_REVIEW_REQUIRED` — not deployed,
not live-ready, not provider-ready. Untracked; **no Git, Railway, database, SQL, credential, signing-key,
provider or CORE-PROD operation** was performed by this milestone.

This milestone adds a **clock-gated bootstrap layer** on top of the accepted, byte-unchanged predecessors. It
proves — offline, with real crypto and real loopback sockets over a synthetic cluster — that neither the reader
nor the attester can act on a stale, stepped, or unbounded clock, that the attester never mints a signature
before a full authority+clock gate passes, and that the reader is *running but not serving* until it has proven
a fresh clock bracket around a genuine attestation. Live wiring (real DB clock session, observer credential,
DNS peer resolver, gateway listener) is a **separate future authorized gate**; every production entrypoint here
fails closed (exit 70).

## The three clock domains (never cross-subtracted)
| Domain | Source | Role |
|---|---|---|
| local **WALL** | `Date.now()` (ms) | may step; bracketed, never trusted for RTT |
| local **MONOTONIC** | `performance.now()` (µs) | never steps; the ONLY RTT source |
| database **WALL** | `clock_timestamp()` (µs) | the SHARED reference; its offset cancels in the reader↔attester pairwise difference |

A sample's conservative interval `I = [wallSendLo − db, wallRecvHi − db]` (integer µs). A wall-vs-monotonic
disagreement inside a sample is a detected **clock step** and fails the sample closed — a step is never hidden
inside a wide interval.

## Frozen thresholds (architecture constants — `clock-interval.mjs`)
RTT ≤ 100 ms · wall must not go backward · wall-vs-monotonic discrepancy ≤ 10 ms · sample uncertainty E ≤ 10 ms ·
startup = **5 consecutive** valid samples + conservative hull · per-service |interval| ≤ 250 ms · reader↔attester
pairwise ≤ 500 ms · accepted ceiling 600 ms (**100 ms reserve**) · runtime monitor probe every 1 s · max cached
sample age 2 s · reader bracket tolerance = 2·RTT + 1·discrepancy = 210 ms.

## Files (all NEW; no predecessor edited)
| File | Purpose |
|---|---|
| `clock-interval.mjs` | PURE interval math + all frozen thresholds (`evaluateSample`, `hull`, `serviceGateOk`, `pairwiseInterval`, `takeSample`). |
| `db-clock-probe.mjs` | The ONE fixed read-only clock+fingerprint SQL; re-derives the anchored cluster fingerprint on every probe (accepted algorithm). |
| `clock-gate.mjs` | Startup gate (5 consecutive + hull) + runtime monitor (1 s probe, 2 s staleness, invalidation latch). |
| `private-peer-resolver.mjs` | Railway private-DNS → EXACT-host (/32,/128) allowlist; validate-before-swap refresh; fail-closed. |
| `attestation-channel-v2.mjs` | Clock-gated attestation channel v2: HMAC covers reader clock evidence + boot generation; `preSignClockGuard`; exact-host peer gate. |
| `bootstrap-state.mjs` | State machine, process-boot generation nonce, v2 socket client. |
| `reader-bootstrap.mjs` | Reader lifecycle: startup gate → WAITING_FOR_ATTESTER → clock BRACKET around a verified proof → AUTHORITY_READY. Never serves. |
| `attester-bootstrap.mjs` | Attester lifecycle: startup gate → BOOTSTRAP_LISTENING → signing gated on monitor freshness + pre-sign guard; regate after invalidation. |
| `production-config.mjs` | Versioned reader/attester production config loaders: exact env NAMES, anchored AI-STAGING target, executor/foreign-credential refusal, production option-key whitelist. |
| `production-db-clock.mjs` | Production DIRECT-PostgreSQL clock sampler (reuses accepted `makePgPhysicalFactory`); fixed clock query only; read-only + statement_timeout; reconnect-on-death. |
| `production-reader.mjs` / `production-attester.mjs` | Real fail-closed composition roots (M1-R2): validate config → build real adapters → start the bootstrap; offline-test boundary for synthetic deps. |
| `bootstrap-entrypoint-reader.mjs` / `bootstrap-entrypoint-attester.mjs` | Production entrypoints; compose from `process.env`; fail closed (exit 70) when unprovisioned. The permanent `live_wiring_is_a_future_gate` stub is REMOVED. |
| `tests/*.test.mjs` | offline assertions (see below). |
| `tests/fixtures/synthetic-env.mjs` | Controllable shared DB clock + accepted synthetic cluster + real Ed25519 signer + accepted observer/anchor/trust-root. |
| `README.md`, `DEPLOYMENT-CONTRACT.md`, `SELF-REVIEW.md`, `WRITER-INVENTORY.md`, `EVIDENCE-MANIFEST.json` | Documentation + evidence (WRITER-INVENTORY = the M1-R1 trust-state writer enumeration). |

**Database-clock target (M1-R3):** the clock source is a **direct, bounded, read-only PostgreSQL session** to the
exact deployment-anchor-bound AI-STAGING Railway PostgreSQL service `b7362594-a01b-4623-a982-394707a6cec2`
(`clock_timestamp()`), the SAME anchored clock for reader and attester. **No Supabase, no PostgREST, no `SB_URL`,
no HTTP clock source.** Reader uses its reader credential; attester uses its observer credential.

## Core security invariants (all TESTED)
1. NO real attester signature before the clock gate passes (§28: `signed` stays 0 across every failure case).
2. No reader observation listener before a valid authority+clock (+ a later gateway boundary): `serving()` is always false here.
3. No gateway dependency · 4. no provider dependency · 5. no public domain · 6. no TCP proxy · 7. no executor DB credential in reader/attester.
8. Restart invalidates prior clock evidence (new in-memory boot generation).
9. The anchor proves identity only, never clock safety (a valid anchor with a stale/broken clock never signs).
10. Any clock / DNS / authority failure fails closed.

## Reproduce (offline; no secrets; no network beyond local loopback)
```
cd scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01
for f in *.mjs tests/*.mjs tests/fixtures/*.mjs; do node --check "$f"; done
node tests/clock.test.mjs             # 43 passed
node tests/db-probe.test.mjs          # 13 passed
node tests/network.test.mjs           # 29 passed
node tests/signing-authority.test.mjs # 28 passed
node tests/lifecycle.test.mjs         # 36 passed  (incl. spawned entrypoints exit 70)
node tests/preservation.test.mjs      # 21 passed  (frozen predecessors byte-unchanged)
node tests/race.test.mjs              # 13 passed  (M1-R1 acquisition invalidation / re-entry race)
node tests/regate.test.mjs            # 27 passed  (M1-R1 final: re-gate / gate-eligibility generation lifecycle)
node tests/inventory.test.mjs         # 13 passed  (M1-R1 final: trust-state writer invariant coverage)
node tests/production.test.mjs        # 31 passed  (M1-R2 production composition / config / entrypoints)
node tests/target-contract.test.mjs  # 20 passed  (M1-R3 direct-PostgreSQL clock target; no Supabase/PostgREST/SB_URL)
env -i PATH="$PATH" node bootstrap-entrypoint-attester.mjs; echo $?   # config incomplete, exit 70
env -i PATH="$PATH" node bootstrap-entrypoint-reader.mjs;   echo $?   # config incomplete, exit 70
```

## Evidence status
| Claim | Status |
|---|---|
| Frozen predecessors byte-unchanged | INDEPENDENTLY VERIFIED (hash-asserted, §26) |
| Attester never signs before the full authority+clock gate; exactly one sig on a valid request | SYNTHETICALLY TESTED (§28) |
| Clock interval math / step detection / bounds / hull / pairwise | SYNTHETICALLY TESTED (§27) |
| Fixed DB clock probe + fingerprint re-check + fail-closed | SYNTHETICALLY TESTED (§27b) |
| Private-DNS → exact-peer resolver, validate-before-swap, HMAC still required | SYNTHETICALLY TESTED (§29) |
| Full lifecycle: bracket, monitor invalidation, regate, restart non-authoritative | SYNTHETICALLY TESTED (§30) |
| Reader invalidation / re-entry race: generation-bound acquisition, no late install, full re-gate required | SYNTHETICALLY TESTED (§M1-R1, barrier-controlled) |
| Re-gate is generation-bound: invalidation at any sample/seed/pre-bind aborts; no pre-invalidation sample counts; 1/4/5 samples never recreate eligibility; clock eligibility ≠ authority | SYNTHETICALLY TESTED (§M1-R1 final, barrier-controlled) |
| Trust-state writer invariant coverage (no hidden same-family writer; never bind eligibility/authority to the current generation) | STATICALLY GUARDED (§M1-R1 final; WRITER-INVENTORY.md) |
| Production composition roots: config validation, executor/foreign refusal, option-key rejection, direct-pg adapter, offline-test composition | SYNTHETICALLY TESTED (§M1-R2) |
| Direct-PostgreSQL clock target; no Supabase/PostgREST/SB_URL clock dependency | SYNTHETICALLY TESTED (§M1-R3) |
| Entrypoints fail closed (exit 70) on missing config; permanent stub removed | SYNTHETICALLY TESTED (spawned) |
| Live DB clock session / reader+observer credentials / DNS peer resolution / gateway listener | NOT AUTHORIZED (future gate) — PENDING LIVE VERIFICATION |
| Hosted PostgreSQL `clock_timestamp()` precision + latency | PENDING LIVE VERIFICATION |

**Honest boundary:** every assertion here is against a synthetic controllable cluster + real loopback sockets.
This is NOT evidence about live AI-STAGING. See `DEPLOYMENT-CONTRACT.md` for the future live gate.
