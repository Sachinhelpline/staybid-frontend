# LIVE-AI-03B · genuine independent ATTESTER (OFFLINE candidate)

**Authorization:** Owner, 24 Sep 2026 — one bounded offline implementation of the genuine attester.
**Disposition:** `OFFLINE_GENUINE_ATTESTER_IMPLEMENTATION_COMPLETE_REVIEW_REQUIRED`. Not deployed, not
Git-preserved, not live-reader-ready, not provider-ready. Untracked; no Git, Railway, live database, credential,
key, provider or CORE-PROD operation.

This is the Owner-controlled authority that the accepted reader host (`../private-reader-production-integration-offline-01`,
commit `5dadda60`, unchanged) asks for proof over `reader-attestation-channel-v1`. For each request it
independently measures the reader's live session and effective privileges through a least-privilege observer.
It signs an `AiStagingReaderAttestationV1` only when that measured state is clean and bound to an
Owner-issued deployment anchor.

**Request-lifecycle containment correction (v4, supersedes v3/v2).** An application-visible timeout is not
underlying-work termination, and dropping a late *response* does not stop the *work*. Request **authority** and
computation **lifetime** are ONE bounded lifecycle, carried by an absolute request context threaded through
auth → observer coordinator (queue, open, evidence) → the **pre-sign authority gate** → response. An expired or
caller-abandoned request never enters the queue, opens a connection, runs evidence, reaches `signer.issue`,
increments `signed`, or emits a proof.
**Caller-timeline safety (v4, two layers).** The accepted caller starts its 4000 ms timer at its *connect* —
earlier than the attester's context, which starts at *accept* — and its connect timer clears at TCP-handshake
completion, so an established connection can sit in the accept backlog while a busy event loop defers accept
(`T_accept − T_connect` is NOT bounded by the connect timeout). Two layers keep authority ending before the
caller can expire: (1) an **accept-anchored budget** `total − connect − margin = 4000 − 1500 − 600 = 1900 ms`
(both caller constants imported; a fail-closed load-time assert covers the relation), for the normal
prompt-accept case; and (2) a **caller-timeline tightening** that, after the request HMAC is verified, shortens
the context to the caller's own remaining lifetime from the authenticated `ts`
(`tightenRemaining(total − max(0, now − ts) − margin)`) — this ties authority to the caller's connect and closes
the accept-backlog gap. The tightening only ever *shortens* the window (never extends it), so a skewed/fast
caller clock or a crafted `ts` cannot keep authority longer. Proven with the actual accepted caller (transit-delay
relay) and a deterministic old-`ts` refusal, not just constants.
**Open-cancellation (v4).** Cancellation now propagates INTO `provider()` open: a cancel/expiry while the open
is unresolved abandons that generation, the late-returned connection is destroyed and never admitted as
`current`, and the next request opens a fresh re-validated connection. Keeps all v2/v3 corrections (single
active collection, bounded queue with expiry, invalidation on a stalled statement/setup, stale-result
rejection, pre-sign gate, bounded one-outstanding open). See the budgets and guarantees in
`DEPLOYMENT-CONTRACT.md` §8.

## Files (all NEW)
| File | Purpose |
|---|---|
| `attester-entrypoint.mjs` | **Production entrypoint** + `startAttesterService()`: config → signer → anchor → observer → channel. Fail-closed. |
| `attester-config.mjs` | Deployment-owned config (env NAMES), foreign-credential refusal, accepted private-network listener validation. |
| `evidence-queries.mjs` | The **complete fixed SQL registry** (catalog/privilege metadata + the reader's own session row only). |
| `observer-connection.mjs` | One least-privilege observer connection (registry-only SQL, statement_timeout + read-only set and read back, lazy `pg`, self-invalidating on a stalled statement) **+ the absolute request context** (`makeRequestContext`) **and the bounded, lifecycle-aware observer coordinator** (single active collection, bounded queue with expiry, per-observation deadline capped by request remaining, connection invalidation, stale/expired-result rejection, bounded one-outstanding open with late-connection disposal, fresh re-validation). |
| `evidence-evaluator.mjs` | Independent measurement and evaluation into the accepted payload fields; token re-derived with the accepted `connectionTokenFor`. |
| `target-binding.mjs` | Railway target via an Owner-issued deployment anchor, matched to the observed cluster fingerprint. |
| `signing-adapter.mjs` | Ed25519 signer from the attester's own secret; builds the accepted payload itself (no caller payload). |
| `attestation-server.mjs` | The accepted channel: HMAC, ±30 s window, bounded single-use nonces, exact args, bounded channel concurrency, one **absolute request context** per connection (budget < the 4000 ms caller cap), a **pre-sign authority gate**, **caller-disconnect** cancellation, a **bounded shutdown**, fixed codes. |
| `observer-role-proposal.sql` | **NOT APPLIED** least-privilege observer-role proposal (a guard makes it non-executable as-is). |
| `DEPLOYMENT-CONTRACT.md` | Railway contract for the reader host AND the attester (document only); §8 documents the resource-containment budgets. |
| `tests/attester-integration.test.mjs` | 107 integrated offline assertions, including the full chain through both production entrypoints. |
| `tests/attester-containment.test.mjs` | 50 assertions: the v2 resource-containment findings + the v3 request-lifecycle matrix + the **v4 caller-timeline & open-cancellation** tests (transit-delay relay with the actual accepted caller proving no post-expiry signature without relying on close propagation; cancel-during-open disposal + fresh next open; caller-safe expiry during open; connect-allowance invariant; authenticated-ts caller-timeline refusal closing the accept-backlog gap; delivery-boundary pre-sign guard). |
| `tests/attester-localpg.test.mjs` | 25 assertions on a **throwaway local PostgreSQL** cluster (real SQL and privilege semantics). |
| `tests/fixtures/*` | Synthetic shared cluster, harness-only `pg` hook and driver. |

## Reproduce (offline)
```
cd scripts/live-ai-03b/private-reader-attester-offline-01
for f in *.mjs tests/*.mjs tests/fixtures/*.mjs; do node --check "$f"; done
node tests/attester-integration.test.mjs     # 107 passed, 0 failed, 0 skipped
node tests/attester-containment.test.mjs     # 50 passed, 0 failed, 0 skipped (v2 containment + v3 lifecycle + v4 caller-timeline/open-cancel)
node tests/attester-localpg.test.mjs         # 25 passed (throwaway local PostgreSQL); SKIPPED if no binaries — a skip is not a pass
env -i PATH="$PATH" node attester-entrypoint.mjs; echo $?   # unprovisioned, 70
# accepted suites (unchanged):
node ../private-reader-production-integration-offline-01/tests/production-integration.test.mjs  # 157
node ../private-reader-host-runtime-offline-01/tests/runtime.test.mjs                           # 125
```
`attester-localpg.test.mjs` needs PostgreSQL server binaries (`/usr/lib/postgresql/*/bin`). It creates a
Unix-socket-only cluster (trust auth, fsync off) in a temporary directory and removes it on exit. As root it
runs the PostgreSQL binaries through `runuser -u postgres`.

## Evidence status
| Claim | Status |
|---|---|
| Accepted production integration (17), serving runtime and frozen predecessors byte-unchanged | INDEPENDENTLY VERIFIED (hash-asserted) |
| Real attester entrypoint + accepted reader-host entrypoint + gateway, full chain | SYNTHETICALLY TESTED (shared synthetic cluster; harness-only `pg`/DNS/peer-address simulation) |
| Resource containment: serialized + bounded observer work, connection invalidation on a stalled query/setup, no unbounded post-timeout accumulation, stale result never signed, bounded recovery + shutdown | SYNTHETICALLY TESTED (controllable stall physicals; `attester-containment.test.mjs`) |
| Request lifecycle: authority == computation lifetime — absolute request context, expiry before enqueue / while queued / active, pre-sign gate, caller disconnect, bounded one-outstanding open with late-connection disposal, budget < the 4000 ms accepted caller cap, `signed` frozen after expiry | SYNTHETICALLY TESTED (lifecycle matrix + accepted caller; `attester-containment.test.mjs`) |
| Evidence SQL executes and privilege semantics are correct (PUBLIC, NOINHERIT membership, routines, sequences, DB CREATE, `pg_read_all_stats` visibility) | VERIFIED ON A THROWAWAY LOCAL PostgreSQL 16 — not AI-STAGING |
| The attester re-derives the same connection token as the accepted reader code | VERIFIED ON LOCAL PostgreSQL 16 |
| Observer-role proposal valid and sufficient; non-executable as-is | VERIFIED ON LOCAL PostgreSQL 16 — **NOT APPLIED** to any live database |
| Railway target identity (anchor issuance) | PENDING LIVE VERIFICATION — interface implemented, fails closed without an anchor |
| Hosted PostgreSQL 18 behaviour (`set_config`, `pg_read_all_stats`, MAINTAIN) | PENDING LIVE VERIFICATION |
| Attester service, keys, credentials, deployment | NOT AUTHORIZED (not done) |

## Honest limits
- **Detection latency.** A privilege change is caught at the next attestation, which happens at renewal or at
  a new connection. A proof already issued stays valid until it expires (default 120 s, maximum 300 s). The
  accepted reader host renews at half-life.
- **Containment, not cancellation.** PostgreSQL / node-postgres offers no reliable per-query cancel from the
  same client, so a stalled statement is contained by **invalidating (destroying) the physical connection**,
  not by cancelling the query in place. The connection is marked dead first, so it is never reused even if
  driver teardown itself stalls (the teardown is bounded by the cleanup deadline). Its slot stays occupied
  until teardown completes, so admission capacity is never released while orphaned DB work still exists.
- **Serialized observer work.** Exactly one evidence collection runs on the single physical observer at a
  time, with a bounded queue; requests beyond that are answered `busy`. Channel concurrency (4) and observer
  concurrency (1 active + 3 queued) are separate controls, so four channel requests never become four
  concurrent DB operations behind one connection.
- **Request authority == computation lifetime.** One absolute request context (budget 1900 ms = caller total
  4000 − connect 1500 − margin 600, so it is safe against the caller's earlier-started timer) is threaded
  through the whole path; an expired or caller-abandoned request never opens a connection, runs evidence,
  reaches signing, or increments `signed`. `signed` rises only after a successful signature for a still-live
  request. Cancellation propagates into observer open, so a connection opened under lost authority is destroyed,
  never admitted or reused.
- **Caller-timeline residual (honest, cannot be fully closed offline).** The caller-safe deadline uses the
  caller's authenticated wall-clock `ts`, but the caller's real 4000 ms expiry is a *monotonic* timer, and the
  reader-host↔attester clock skew is unobservable from `ts` alone. The fix is caller-safe under the deployment
  precondition that skew ≤ the 600 ms response margin (Railway same-environment NTP satisfies this by orders of
  magnitude). The theoretical residual — a caller wall-clock lead > 600 ms AND a > 2.1 s event-loop stall AND
  winning the DB-result-vs-close race — yields a proof that is MINTED but UNDELIVERABLE (caller socket already
  destroyed) and UNREPLAYABLE (single-use nonce; fresh nonce per call): nil practical impact, confirmed by two
  independent reviewers. Full theoretical closure needs a frozen-caller protocol field (a monotonic/shared
  reference) or an enforced tighter clock-sync SLA — both out of scope here (see DEPLOYMENT-CONTRACT.md §8).
- **Never-settling open (honest bound, not cancellation).** A JavaScript Promise cannot be forcibly
  terminated, so a `provider()` open that never settles cannot be cancelled in place. It is BOUNDED to one
  outstanding at a time (a second is never started), every request fails closed while it persists, and shutdown
  does not start more and still returns within its deadline — the stuck Promise is not pretended to be
  terminated. A never-settling open at startup fails closed (the service never reports serving).
- **Reader statement_timeout.** The attester cannot observe another session's settings (`pg_settings` is
  per-session, verified). The reader host verifies its own timeout; the attested payload makes no claim about it.
- **TEMPORARY.** The PostgreSQL PUBLIC default `TEMPORARY` on the database is recorded, not signed as a claim.
  Accepted Sections I–III do not revoke it, and the reader's read-only sessions reject `CREATE TEMP TABLE`.
- **Reviewed scope.** Privileges are measured in schemas `public` and `live_ai_03b_trusted`, plus role
  attributes, memberships, database-level CREATE and prohibited-role reachability. Other object classes (large
  objects, foreign servers, languages) are outside the reviewed scope.
- **Single replica.** Replay protection is in-memory. The attester must run as exactly one replica.
