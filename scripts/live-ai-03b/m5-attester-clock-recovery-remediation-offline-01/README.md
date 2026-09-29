# M5 attester clock-recovery remediation (offline) — revision v2

**Status:** revised candidate (v2), prepared offline for FOCUSED closure review. **Uncommitted** (scratch
worktree only). **Not deployed.** No Railway, restart, redeploy, DB, credential, gateway, provider, M7 SQL or 03C
action was taken.

## Revision v2 — shutdown containment (the one WORK finding)

**WORK verdict on v1 (package OFFLINE-01, sha256 `0de6cdd6…`):** HOLD for exactly one material defect. Shutdown
did not contain an active recovery or a late DB open. This was a resource-containment problem, not an authority
bypass. `checks/shutdown-old-candidate.check.mjs` reproduces it against the **exact v1 bytes** (the 5 runtime
SHA-256s are asserted). The counts are identical to WORK's:

| | opened | SQL starts | samples |
|---|---|---|---|
| at stop | 1 | 10 | 8 |
| after stop | 2 | 43 | 37 |

That is +1 late physical, +33 SQL and +29 samples after stop, with signing still not restored. Real PG16/18 also
show the late connection **installed and leaked as a live backend** (`realpg-scenario.mjs v1`).

**Fix (delta B, v1 → v2 = 4 runtime files; the entrypoint is byte-identical to v1):**

| File | Shutdown-only change |
|---|---|
| `production-db-clock.mjs` | **Monotonic CLOSED latch**, committed synchronously when `close()` begins. `run()` is the single SQL choke point and refuses once closed. `ensure()` initiates no `factory.open()` after close. A queued `takeSampleFn` caller returns `sampler_closed` without starting a sample. A **late-completing open is retired** (bounded close) and never hardened or installed, and a harden in progress aborts. `close()` is idempotent, never reopens, cancels the current sample, retires the installed physical, and does **not** await an uncooperative pending open. New counters: `opensStarted`, `sqlStarted`, `lateOpensRetired`, `refusedAfterClose`. |
| `clock-gate.mjs` | `runStartupClockGate` gains an **opt-in** `shouldAbort` hook. It is checked before each attempt and after each sample, and returns `gate_aborted` at once without consuming the remaining attempts. When the hook is absent (every pre-existing caller, including the reader), behavior is unchanged: ordinary invalid samples still get 5/30 (proven by B5). |
| `attester-bootstrap.mjs` | Recovery samples are **never started** once stopped or superseded (checked before `takeSampleFn`). The gate aborts terminally through `shouldAbort`, and the quiescence wait is abortable. `stop()` synchronously sets signing off, STOPPED and epoch++, cancels the timer and heartbeat, stops the monitor and releases waits. It then waits at most `STOP_RECOVERY_CONTAIN_MS = 2500` for an in-flight recovery (a late result is discarded) before closing the listener. A stopped recovery reports `recovery_fail {reasonClass:"stopped", nextDelayMs:null}` and schedules no backoff. `regate()` after stop is refused. STOPPED is final. |
| `production-attester.mjs` | `makeContainedAttesterStop` (exported and tested) commits `sampler.close()` (CLOSED) and `baseStop()` (STOPPED) **in the same synchronous turn**, then awaits both bounded teardowns. This replaces v1's `await baseStop(); await sampler.close()`, which left an async gap. |

**Proof (revised, `checks/shutdown.check.mjs` 29/29, counts in `logs/shutdown-revised-counts.json`).** Across the
stop boundary, opens initiated = 0, SQL starts = 0, sample starts = 0, late physical installs = 0 and signing
restorations = 0. The status stays STOPPED and signing false. Scenarios covered:

- **A:** stop during a delayed open, including an open that **never** resolves.
- **B:** stop during active recovery, with 3 of 5 gate samples consumed; the gate aborts terminally with no
  backoff.
- **C:** stop during an in-flight query; its result is discarded and the physical is retired.
- **D:** stop during backoff; the timer is cancelled and a timer that fires anyway is neutralized.
- **E:** stop during the quiescence floor; the wait is released and there is no seed.
- **F:** both latches are committed synchronously, and the sampler latch is monotonic and idempotent.

The stop bound is measured per scenario, at most 2500 ms plus the existing listener close.

**Real PG16 + PG18 (the same delayed open, with the postmaster SIGSTOPped):**

| Run | Samples | SQL | Opens | Late session | Leftover backend |
|---|---|---|---|---|---|
| v1 | 8→37 | not counted | not counted | **installed** | 1 **leaked** |
| v2 | 8→8 | 10→10 | 2→2 | retired | 0 |

There is still no pg concurrent-query warning.

**Evidence-only fix (disclosed):** the v1 `recovery` check G1 had a test race. `signingReady()` already turns
false, fail-closed, at the 2 s staleness age, up to one tick **before** the watchdog emits `clock_invalidated`.
The wait now waits for both. The assertion is unchanged; it failed intermittently in about 1 of 3 runs before and
is stable now.

---

# Original v1 design receipt (still valid for the non-shutdown behaviour)

## The defect (classification B, proven again here against the baseline bytes)

In deployed source `f48936f0` (runtime files identical at `f5ec5807`), a transient stall of the attester's
clock DB session left the attester **permanently unable to sign** until someone restarted it:

1. **Overlapping probes.** The 1 s monitor used `setInterval` with no in-flight guard. A probe abandoned at its
   2 s deadline kept running on the one persistent `pg` client, and new probes queued behind it on the same
   session. At three or more overlapping probes, `pg` 8.23 emits its concurrent-query `DeprecationWarning`, and
   only once per process.
2. **Permanent signing latch.** Any invalid sample called `onInvalid`, which set `signingReady = false`. The
   monitor's own latch cleared on the next good sample. `signingReady` was reset only by `regate()`, and nothing
   in production called it.
3. **Silent.** Production passed a no-op logger, so nothing reported the stuck state. Every reader request got
   the fast `unavailable` frame (line 145), which is the 40× `attestation_unavailable` the reader crash showed.
4. **Healable peer latch.** Peer invalidations went through the same monitor latch, so a clock regate would have
   restored them.

`checks/old-defect.check.mjs` (12/12) and `checks/realpg-scenario.mjs old` (8/8 on PG16 **and** PG18, real `pg`
driver) reproduce all four against the **unmodified baseline bytes**.

## The fix (five allowed runtime files; every other runtime file is byte-identical)

| File | Change |
|---|---|
| `clock-gate.mjs` | **Single-flight monitor.** The scheduler never launches a probe while one is unresolved. A skipped tick is never a sample; it runs only the independent freshness **watchdog**, so a stalled probe still fails closed within `MAX_SAMPLE_AGE_MS`. Adds `tick()` and the stats `inFlight` / `launchedTicks` / `skippedTicks`. `runStartupClockGate` is unchanged. |
| `production-db-clock.mjs` | **Connection-level single-flight.** Samples are serialized, and RTT is measured only after a sample holds the slot. A probe still **unresolved** at its deadline, or one whose query failed at the driver, **retires** its physical: it is marked dead and detached, `close()` is bounded to 2 s, and the next probe opens a fresh, re-hardened read-only session. A cancel token stops a late `open()` from issuing an abandoned query. Harden steps are bounded and re-check retirement. For the **reader's** over-physical sampler, a sample fails closed with the unchanged reason `db_probe_failed` **without querying** while a prior probe is unresolved or the session is dead, and resumes on the same session once it settles. |
| `attester-bootstrap.mjs` | **Invalidation + bounded automatic recovery.** See below. |
| `production-attester.mjs` | Peer supervisor → `invalidatePeer(...)` (the sticky latch). `autoRecover: true`, `heartbeatMs: 60000`. |
| `bootstrap-entrypoint-attester.mjs` | **Safe production logger.** `makeSafeAttesterLogger` re-emits allowlisted events as `M5_ATTESTER_<EVENT> {json}` markers (the accepted runner marker grammar). Only allowlisted keys pass. Values must be booleans, finite numbers, null, or single-case identifiers up to 48 characters; anything else becomes `<redacted>` (long hex runs and IPs included). The original startup JSON line is unchanged, and a `M5_ATTESTER_STARTUP` marker is added after it. |

### Attester state machine (clock)

- **Invalidation** (any monitor failure or staleness):
  - `signingReady = false`, `status = CLOCK_INVALID`, the generation rotates, and the invalidation epoch bumps;
  - `clock_invalidated` + `signing_disabled` are emitted;
  - the recovery controller schedules an attempt.
- **Recovery controller** (opt-in `autoRecover`; the production composition enables it; frozen deterministic
  tests keep the default `false`):
  - Attempts are **serialized** (`recovery_in_flight` is refused; there is never a second timer while one is
    pending or running).
  - Backoff is deterministic: **5 s, 10 s, 20 s, 40 s, 60 s, then 60 s**. The attempt counter resets on success.
  - Each attempt is one complete startup-grade gate of at most 30 samples, so there is no tight loop.
  - A failed **startup** gate is recovered the same way. This is an intentional behavior change: the listener
    stays up with signing off, and it no longer waits for a restart.
- **Re-enable** requires all of the following, in order:
  1. A **fresh 5-consecutive-sample gate**. Every sample is bound to the epoch captured at the start, and any
     interleaved monitor failure resets the run.
  2. The conservative hull within bounds.
  3. The **quiescence floor**: no re-enable before `lastInvalidation + V2_REQUEST_BUDGET_MS (1900) + 250 ms`.
     Any request accepted before the invalidation has then lost its authority window (the ctx deadline and the
     server budget timer), so **no pre-invalidation request can be signed after recovery**, whatever the backoff.
  4. A fresh monitor seed, carrying the same fingerprint enforcement on every probe.
  5. A final synchronous recheck of epoch, stopped state, peer latch and monitor health.
  6. A **fresh generation**.
- **Pre-sign interval gating.** `attesterClockInterval` is offered only while signing is enabled. A request that
  raced an invalidation therefore cannot pick up a monitor interval that healed before the full recovery.
- **Peer latch** (`peer_unsafe` / `peer_identity_changed`):
  - sticky, `status = PEER_INVALID`;
  - cancels any pending clock recovery and is **never** restored by clock recovery or `regate()`
    (`peer_invalid`);
  - requires a controlled restart (`recovery: "controlled_restart_required"`).

### What is unchanged

- Every frozen constant (RTT 100 ms; discrepancy 10 ms; service 250 ms; pairwise 500 ms; ceiling 600 ms; 5/30
  samples; 1 s cadence; 2 s maximum age).
- The v2 request budget and wire codes.
- HMAC, Ed25519, anchor, observer and reader privileges; the exact-host peer allowlist.
- The `ATTESTER_BOOTSTRAP_VERSION` string; exit codes 70 and 74.
- **No protocol change.** The gateway stays absent and the provider stays dormant.
- Reader files are byte-identical, and the reader has no auto-recovery (§12). The reader's clock sampler lives in
  `production-db-clock.mjs`, and its only change is "no query behind unresolved work", with the same reason
  string.

## Evidence (all offline)

**v1 table (historical; v1 logs in `logs/v1-review/`).** v2 results: `bash run-checks.sh` → **12/12**
(`logs/01…12-*.log`). Old-defect 12, single-flight 29, recovery 42, peer 14, logging 16, boundary **13** (+ delta B),
real PG **18** new + **4** v1-red + 8 old per version, shutdown **old-candidate red 7** + **revised 29**, and the
frozen suites.

`bash run-checks.sh` (v1) → see `logs/v1-review/`:

| Check | Result |
|---|---|
| old-defect (baseline bytes) | 12/12 |
| single-flight + dead-session (deterministic) | 29/29 |
| recovery (auto-regate PASS + failure regressions) | 42/42 |
| peer | 14/14 |
| logging | 16/16 |
| boundary | 12/12 |
| real PostgreSQL 16 + 18, real `pg` | OLD 8/8 + NEW 14/14 on each version |
| frozen bootstrap, observer/attester and production-integration suites | all PASS |

The M7 Step-2 predecessor runner (44 suites), `run-all-m7s2.sh` (10) and the harness regression (47) were also
run from a copy of the candidate tree. See `logs/` and `FUTURE-DEPLOYMENT-PIN-NOTES.md`.

## Residual notes (honest)

- A reader crash can make the reader's `.railway.internal` peer resolve unsafe or change identity, which sets the
  attester's sticky **peer** latch. That latch needs a controlled attester restart. This is fail-closed as the
  packet requires.
- A retired socket whose peer is frozen (SIGSTOP) is marked dead immediately and never queried again. The OS
  socket itself is released when the peer resumes or TCP fails; close is awaited for at most 2 s. Retirement
  happens at most once per probe, and probes are bounded by the 1 s cadence.
- `hull_bound_exceeded` cannot occur with internally consistent samples (frozen clock test C3). The recovery
  check exercises the gate's independent hull check with a synthetic inconsistent sample.
- Deployment requires a new source pin. See `FUTURE-DEPLOYMENT-PIN-NOTES.md`.
- **(v2) Stop bound.** `stop()` waits at most `STOP_RECOVERY_CONTAIN_MS` (2500 ms) for an in-flight recovery, then
  runs the pre-existing listener close (coordinator shutdown ≤ 3000 ms plus server close ≤ 1000 ms, unchanged).
  An uncooperative external open or query cannot be cancelled at the driver. It is **detached**: nothing starts
  after it, and its late result is retired or discarded. Measured stop times in the checks run from 30 to 300 ms.
- **(v2) Late session to a frozen postmaster or backend.** It is retired the moment it completes, and its OS socket
  is released by the bounded close. The real-PG checks show 0 leftover backends after stop.
