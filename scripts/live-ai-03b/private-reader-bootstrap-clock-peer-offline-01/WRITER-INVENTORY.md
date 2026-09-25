# LIVE-AI-03B BOOTSTRAP — M1-R1 TRUST-STATE WRITER INVENTORY (§2)

Exhaustive enumeration of every candidate-local writer that can affect generation / invalidation epoch, startup
clock evidence, `gatePassedForGeneration`, monitor health, WAITING_FOR_CLOCK / WAITING_FOR_ATTESTER, authority
candidate / installed authority / AUTHORITY_READY, or invalidation/re-entry. All live in `reader-bootstrap.mjs`
unless noted; the static guard `tests/inventory.test.mjs` fails if a new writer appears.

## Root invariant (M1-R1)
> No asynchronous attempt may commit a trust-state transition unless the exact generation captured before that
> attempt remains current throughout all required checkpoints AND at the final synchronous commit. An invalidation
> destroys ALL derived clock/authority eligibility; only a completely fresh five-consecutive-sample gate under ONE
> unchanged generation may recreate clock eligibility; clock eligibility alone never confers authority (fresh
> attestation is still required).

## State variables
| Variable | Meaning |
|---|---|
| `generation` | in-memory boot/invalidation identity; rotates on every invalidation (a restart yields a new id). |
| `gatePassedForGeneration` | the generation id for which a FULL 5-sample gate passed; the ONLY clock-eligibility flag. |
| `authority` | the installed authority `{ envelope, generation, atMonoUs, requestNonce }`; bound to the acquisition's start generation. |
| `status` | lifecycle state (WAITING_FOR_CLOCK / WAITING_FOR_ATTESTER / AUTHORITY_READY / CLOCK_INVALID / STOPPED). |
| monitor `lastGood` / `invalidated` | clock freshness + invalidation latch (in `clock-gate.mjs`); drives `monitor.healthy()`. Never sets eligibility/authority. |

## Trust-producing async paths — START GEN · AWAIT POINTS · INVALIDATION POINTS · FINAL WRITE
1. **Initial startup gate (construction)** — START `bootGen`; AWAITS the 5 guarded samples via
   `runGenerationBoundGate(bootGen)`; no invalidation source active yet (monitor not created); FINAL WRITE binds
   `gatePassedForGeneration = bootGen` (snapshot) + `status = WAITING_FOR_ATTESTER`, only if `generation === bootGen`.
2. **Monitor seed + scheduler start (construction)** — `monitor.sampleOnce()` then `monitor.start()`. Sets monitor
   freshness only; NEVER writes eligibility/authority.
3. **Monitor invalidation callback (`onInvalid`)** — the sole INVALIDATION POINT. Synchronously: `authority = null`,
   `gatePassedForGeneration = null`, `generation = createBootGeneration()` (rotate), `status = WAITING_FOR_CLOCK`.
   Fires once per valid→invalid transition (latched until a good sample clears it).
4. **`runGenerationBoundGate(startGen)`** — AWAITS 5 guarded samples; each sample whose await crosses a generation
   change returns `generation_superseded` (discarded → run resets), so no pre-invalidation sample counts toward a
   post-invalidation pass; rechecks `generation === startGen` after the gate. Binds NOTHING.
5. **`regate()`** — START `startGen`; AWAITS `runGenerationBoundGate(startGen)` then `monitor.sampleOnce()` (seed);
   INVALIDATION POINTS = any await (each followed by a `generation === startGen` recheck) + a FINAL synchronous
   recheck; FINAL WRITE binds `gatePassedForGeneration = startGen` (snapshot) + `status = WAITING_FOR_ATTESTER`.
   On a superseded/failed attempt it binds nothing (leaves the invalidation callback's reset in place, or clears to
   `null` + `WAITING_FOR_CLOCK` on a same-generation gate/seed failure).
6. **`acquireAuthority()` → `doAcquire()`** — START `startGen`; requires `gatePassedForGeneration === startGen` +
   `monitor.healthy`; AWAITS pre-sample, attestation (`obtainV2Fn`), proof verify, post-sample — each followed by a
   `stillCurrent()` recheck (generation current + gate still passed + not CLOCK_INVALID); FINAL synchronous install
   guarded by `stillCurrent() && monitor.healthy()` writes `authority = { … generation: startGen … }` +
   `status = AUTHORITY_READY`. Concurrent acquisitions refused (`acquiring` flag).
7. **`authorityReady()` (read)** — true only if `status === AUTHORITY_READY` AND `authority.generation ===`
   current `generation` AND `monitor.healthy()`. A stale authority object can never read ready after a rotation.
8. **`stop()`** — `status = STOPPED`, `monitor.stop()`. No eligibility/authority write.
9. **Late results (DB sample / attestation response / proof / post-sample)** — cannot install: the per-await
   recheck + final atomic guard in `doAcquire`/`regate` discard any result whose generation is superseded.
10. **Peer-change / peer-unsafe invalidation (production only, `production-attester.mjs`)** — routes through the
    attester monitor's `invalidate()` (path 3's analogue on the attester); does not touch the reader's writers.

## Complete writer sites (guarded by `tests/inventory.test.mjs`)
- `generation =` : init (`createBootGeneration()`) · invalidation rotation (`createBootGeneration()`) — exactly 2.
- `gatePassedForGeneration =` : init `null` · construction bind `bootGen` · invalidation `null` · regate gate-fail
  `null` · regate seed-fail `null` · regate success `startGen` — exactly 6; **never `generation.id`**.
- `authority =` : init `null` · invalidation `null` · install `{ … generation: startGen … }` — exactly 3;
  **never `generation: generation.id`**.

## Conclusion
Clock/authority eligibility is created only by a snapshot-bound gate (construction or `regate()`) and a
snapshot-bound install (`doAcquire`), each verified against its captured generation through every await and at the
final synchronous commit. Invalidation destroys all eligibility and rotates the generation. Clock eligibility
(`gatePassedForGeneration`) is decoupled from monitor freshness, so no number of good monitor samples recreates it
— only a full fresh gate does, and authority additionally requires a fresh attestation.
