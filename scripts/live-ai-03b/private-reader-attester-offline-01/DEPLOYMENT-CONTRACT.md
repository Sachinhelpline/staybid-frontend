# LIVE-AI-03B — Railway deployment contract: private reader host + independent attester

> **DOCUMENT ONLY — NOTHING APPLIED.** No source attached, no service created, no variable set, nothing
> staged or deployed. This is the contract a future, separately authorized AI-STAGING preparation must follow.
> It does not prove the real Railway setup.

Target (identity reference only): AI-STAGING project `4ad1abb3-823a-4acf-b889-6d34ae46d7f9`, environment
`aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc` (display name "production"; not CORE-PROD), PostgreSQL `b7362594-…`.
CORE-PROD `04c8b523-…` / `1fbd7632-…` is excluded.

## 1. Services
| | Private reader host | Independent attester |
|---|---|---|
| Railway service | existing empty shell `88c74a23-6b01-4ec8-8600-90e23628ff72` | **NEW service (requires its own creation authorization)**, same AI-STAGING environment |
| Start command | `node scripts/live-ai-03b/private-reader-production-integration-offline-01/production-entrypoint.mjs` | `node scripts/live-ai-03b/private-reader-attester-offline-01/attester-entrypoint.mjs` |
| Replicas | 1 (one controlled reader connection) | **exactly 1**: replay protection is in-memory (`SINGLE_REPLICA_REQUIRED`) |
| Exit codes | 70 unprovisioned · 71 degraded · 72 authority recovery exhausted · 0 after SIGTERM | 70 unprovisioned · 73 observer lost and not recoverable · 0 after SIGTERM |
| Public domain / TCP proxy | **never** | **never** |

## 2. Build: prevent the accidental Next.js build and start (verified hazard)
The repository root has no `railway.json`/`railway.toml`, Dockerfile or Procfile, and `package.json` defines
`build` = `next build` and `start` = `next start`. Railway's docs state that Railpack detects Node.js, then
runs `npm install`, `npm run build` and `npm start`. For **both** services:
- **Root directory:** repository root. Both entrypoints import sibling `scripts/live-ai-03b/*` directories.
- **Install:** the dependency install must run, because the runtime needs `pg` (8.23.0 locked; a declared
  dependency). No other package is required: both entrypoints otherwise use Node built-ins only.
- **Build command:** override to a no-op. Neither service has a build step. A `next build` must never run.
- **Start command:** override to the explicit command in §1. `npm start` (`next start`) must never run.
- **Pre-deploy command:** none. No SQL and no migration run at build or deploy time.
- **Node version:** the repository pins none. Pin Node ≥ 18 (validated on 22) through Railpack's documented
  service variable or config file; confirm the exact mechanism when preparing the service.
- **Watch patterns / auto-deploy:** see §3.

## 3. Source attachment and trigger safety
- Attach with **`staged: true`** and **`commitSha` pinned** to the reviewed commit. A live attach "deploys on
  push, builds immediately" and applies to every environment. A pinned commit ignores later pushes to the
  branch.
- Review with `get-staged-changes` before any `accept-deploy`. Only an explicit, authorized `accept-deploy`
  (or redeploy) may start a build.
- Attach the attester and reader host in separate, reviewable steps. Never attach the gateway in the same step.

## 4. Configuration — NAMES and categories only (values are provisioned out of band)
**Reader host** (`88c74a23`), per the accepted `integration-config.mjs`:
| Name | Category |
|---|---|
| `LIVE_AI_03B_TRUSTED_READER_DB_URL` | SECRET — the `live_ai_03b_reader` credential only. **Never** reference `${{Postgres.DATABASE_URL}}` (superuser). |
| `LIVE_AI_03B_READER_TRANSPORT_SECRET` | SECRET — shared with the gateway only |
| `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET` | SECRET — shared with the attester only; ≥ 32 characters; must differ from the transport secret |
| `LIVE_AI_03B_READER_ATTESTER_ISSUER`, `LIVE_AI_03B_READER_ATTESTER_PUBKEY_DER_B64`, `LIVE_AI_03B_READER_ATTESTER_FINGERPRINT` | PUBLIC trust root (the attester logs its `issuer` and `keyId` at start) |
| `LIVE_AI_03B_READER_ATTESTER_HOST`, `LIVE_AI_03B_READER_ATTESTER_PORT` | the attester's `*.railway.internal` name and port |
| `LIVE_AI_03B_READER_LISTEN_MODE`=`private-network`, `…_BIND_HOST`, `…_PORT`, `…_ALLOWED_PEER_CIDRS`, `…_ALLOW_WILDCARD_BIND` | listener; peer range = the gateway's observed private range |
| MUST be absent | `LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL` (presence ⇒ refusal) |

**Attester** (new service), per `attester-config.mjs`:
| Name | Category |
|---|---|
| `LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL` | SECRET — the `live_ai_03b_attester_observer` credential only (see `observer-role-proposal.sql`). Never the superuser URL: the attester refuses to run as superuser. |
| `LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64` | SECRET — Ed25519 signing key (PKCS#8 DER, base64). **Held only by the attester.** It never goes to the reader host or gateway, and is never logged or returned. |
| `LIVE_AI_03B_ATTESTER_ISSUER` | non-secret issuer id; no `TEST-ONLY-` prefix |
| `LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET` | SECRET — the same value as the reader host's; with no one else |
| `LIVE_AI_03B_ATTESTER_BIND_HOST`, `…_PORT`, `…_ALLOWED_PEER_CIDRS`, `…_ALLOW_WILDCARD_BIND` | listener, validated by the ACCEPTED private-network contract. Peer range = the reader host's observed private range. |
| `LIVE_AI_03B_ATTESTER_DEPLOYMENT_ANCHOR` | Owner-issued `AiStagingDeploymentAnchorV1` JSON (see §5). No anchor ⇒ the attester does not start. |
| `LIVE_AI_03B_ATTESTER_PROOF_LIFETIME_MS` | optional; default 120000; maximum 300000 |
| MUST be absent | `LIVE_AI_03B_TRUSTED_READER_DB_URL`, `LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL`, `LIVE_AI_03B_READER_TRANSPORT_SECRET` (presence ⇒ refusal) |

## 5. Deployment anchor (the Railway ⇄ database binding)
Nothing inside PostgreSQL knows a Railway service id, so the attester never infers the target from
`DATABASE_URL`, the database name, `postgres.railway.internal`, reachability or its own `RAILWAY_*`
variables. Before the attester can sign, the Owner must issue the anchor:
`{ contract:"AiStagingDeploymentAnchorV1", domain, projectId, environmentId, pgServiceId, clusterFingerprint, issuedAtMs, verifiedBy }`.
`clusterFingerprint` = sha256 over the canonical `{ datname, database OID, live_ai_03b_reader role OID,
encoding }` as the observer sees them. The Owner obtains these values through a separately authorized,
read-only check against the Railway PostgreSQL service `b7362594-…`. The attester re-measures the
fingerprint on **every** request and refuses to sign on any mismatch. A mismatch means a swapped or different
database, or a recreated reader role.

## 6. Values unknown until authorized live preparation
- The private IPv4/IPv6 ranges and both services' `*.railway.internal` names, needed for the two peer allowlists.
- The real cluster fingerprint values for the anchor.
- Whether the hosted PostgreSQL 18 allows `set_config` of `statement_timeout` and
  `default_transaction_read_only` for both roles, and grants `pg_read_all_stats` to a non-superuser as it does
  on stock PostgreSQL. Verified here only on a throwaway local PostgreSQL 16.
- The `MAINTAIN` privilege evaluation on PostgreSQL 18 (the guard is verified on 16; the 17+ branch is
  untested offline).
- The Railpack Node-version variable name.

## 7. Stop and rollback criteria (for the future live step)
Stop at once and do not proceed if:
- either service logs any status other than `serving`;
- a build runs `next build`;
- a public domain or TCP proxy appears;
- the attester runs with more than one replica;
- `get-staged-changes` shows anything beyond the reviewed fields.

Rollback: remove the staged source or the deployment, and revoke the observer role per
`observer-role-proposal.sql`. The reader role (Sections I–III) is **not** touched.

## 8. Request-lifecycle containment (v3) — request authority == computation lifetime
An application-visible timeout is NOT underlying-work termination: a `Promise.race()` that returns leaves the
losing `pg` operation alive on the wire, and dropping a late *response* does not stop the *work*. The attester
therefore makes request authority and computation lifetime ONE bounded lifecycle, carried by an absolute
request context threaded through every stage. The budgets are source constants (`attestation-server.mjs`,
`observer-connection.mjs`); exact values may be retuned in review, but the guarantees and the caller invariant
below are the contract.

**Accepted caller reconciliation (v4 — different timer origins, two-layer bound).** The only permitted caller
is the accepted reader-host adapter (`attestation-source-channel.mjs`). Its total-timeout timer
(`CHANNEL_TOTAL_TIMEOUT_MS = 4000 ms`) starts at the caller's OUTBOUND CONNECT and includes the connection phase
(up to `CHANNEL_CONNECT_TIMEOUT_MS = 1500 ms`); the caller resolves a response only on socket close (FIN), and
carries `ts` = its own clock, set just before it dials, inside the HMAC-authenticated request. The attester's
request context starts LATER, at the server's ACCEPT. The two clocks do NOT start together, so a purely
accept-anchored budget is not enough — the caller's connect timer clears at TCP-handshake completion, not when
the server's accept callback runs, so an established connection can sit in the accept backlog while a busy
single-replica event loop defers accept; `T_accept − T_connect` is NOT bounded by the connect timeout. Two
layers together make authority end before the caller can expire:

1. **Accept-anchored budget (normal case).**
   `ATTESTER_REQUEST_BUDGET_MS = CHANNEL_TOTAL_TIMEOUT_MS − CHANNEL_CONNECT_TIMEOUT_MS − ATTESTER_RESPONSE_MARGIN_MS
   = 4000 − 1500 − 600 = 1900 ms` from accept. Both caller constants are IMPORTED (no magic numbers), and the
   fail-closed load-time assertion
   `ATTESTER_REQUEST_BUDGET_MS + ATTESTER_RESPONSE_MARGIN_MS + CHANNEL_CONNECT_TIMEOUT_MS ≤ CHANNEL_TOTAL_TIMEOUT_MS`
   refuses to load an unsafe configuration if the accepted constants change.
2. **Caller-timeline tightening via the authenticated `ts` (closes the accept-backlog gap).** After the request
   HMAC is verified, the server tightens the context to the caller's OWN remaining lifetime:
   `ctx.tightenRemaining(CHANNEL_TOTAL_TIMEOUT_MS − max(0, now − ts) − ATTESTER_RESPONSE_MARGIN_MS)`. This ties
   the deadline to the caller's connect (≈ `ts`), so however long accept was deferred, authority ends at about
   `ts + (total − margin)` — before the caller's `ts + total`. `tightenRemaining` only moves the deadline
   EARLIER (`min`), and `max(0, now − ts)` means a caller whose clock runs ahead never EXTENDS the window (it
   falls back to the accept-anchored budget). So the tightening can only ever SHORTEN authority — it cannot be
   abused, via clock skew or a crafted `ts`, to keep authority longer. A caller already past its safe window
   yields a non-positive remaining ⇒ the request is refused with no observer work and no signature.

The server-side deadline (both layers) is the PRIMARY authority boundary; socket-close (caller disconnect)
cancellation is supplementary defence-in-depth, never relied upon alone. The accepted adapter is not modified.

| Bound | Constant | Value | Meaning |
|---|---|---|---|
| Accepted caller total (frozen) | `CHANNEL_TOTAL_TIMEOUT_MS` | 4000 ms | the immutable reader-side channel timeout; imported, never modified |
| Accepted caller connect (frozen) | `CHANNEL_CONNECT_TIMEOUT_MS` | 1500 ms | the immutable reader-side connect timeout; imported — the connection-phase allowance already inside the 4000 ms |
| Response margin | `ATTESTER_RESPONSE_MARGIN_MS` | 600 ms | reserved for response write + network + scheduling under the caller cap |
| **Absolute request budget** | `ATTESTER_REQUEST_BUDGET_MS` | 1900 ms | = total − connect − margin; the request-context deadline (from accept) covering the WHOLE lifecycle (read → auth → queue → open → evidence → evaluate → sign → response); on expiry the context is CANCELLED (work stops), not merely the response. Safe against the caller's earlier-started timer for any permitted connect/transit delay |
| Read phase | `ATTESTER_READ_DEADLINE_MS` | 800 ms | the request newline must fully arrive within this window |
| Observer open/validate | `OBSERVER_OPEN_DEADLINE_MS` | 1500 ms | bounds acquiring + validating an observer, capped by request remaining |
| Per-observation | `OBSERVER_OBSERVATION_DEADLINE_MS` | 2000 ms | whole per-request evidence collection, capped by request remaining; on expiry the connection is invalidated |
| Per-statement (client) | `OBSERVER_QUERY_DEADLINE_MS` | 1500 ms | wall-clock cap per statement, capped by request remaining; on expiry the observer is marked dead and the connection invalidated |
| Per-statement (DB) | `OBSERVER_STATEMENT_TIMEOUT_MS` | 1500 ms | `statement_timeout` set + read back — independent defence-in-depth |
| Cleanup | `OBSERVER_CLEANUP_DEADLINE_MS` | 1000 ms | bounded teardown of an invalidated physical connection |
| Shutdown | `ATTESTER_SHUTDOWN_DEADLINE_MS` | 3000 ms | bounded drain/containment on `close()` |
| Observer active | `OBSERVER_MAX_ACTIVE` | 1 | one evidence collection at a time on the single physical observer |
| Observer queue | `OBSERVER_MAX_QUEUED` | 3 | bounded queue behind the active one; beyond it ⇒ `busy` (1+3 == channel `ATTESTER_MAX_CONCURRENT` 4) |

Guarantees:
- **One absolute request context.** Created at connection accept, carrying an immutable absolute deadline,
  cancellation state and identity, threaded through the handler, the observer coordinator (queue, open,
  evidence), the pre-sign gate and the response. `live()` is the single source of truth for "still
  authorised"; the per-statement and per-observation deadlines are additionally capped by the request's
  remaining lifetime.
- **Queue entries carry the context.** An already-expired request is rejected before enqueue; an entry that
  expires while queued is skipped at hand-over and never acquires the observer, opens a connection, or runs
  evidence. The queue stays explicitly bounded.
- **Active expiry / cancellation stops the work.** If authority expires or the caller disconnects while
  evidence is active, the observation is aborted, the physical connection invalidated, and capacity held until
  teardown is contained. No late result becomes authoritative.
- **Pre-sign authority gate.** Immediately before `signer.issue()` the request is rechecked; `signed` rises
  ONLY after a successful signature for a request still live at that instant. A handler that keeps running past
  the response deadline therefore cannot sign or increment `signed`.
- **Caller-timeline tightening.** After the request HMAC is verified, the context is tightened to the caller's
  own remaining lifetime derived from the authenticated `ts` (`tightenRemaining(total − max(0, now − ts) −
  margin)`). This closes the accept-backlog gap (accept can be deferred beyond the connect timeout): authority
  ends at about the caller's own `ts + total − margin`, not at `accept + budget`. It only ever SHORTENS the
  window and never extends it, so a skewed/fast caller clock or a crafted `ts` cannot keep authority longer.
- **Caller disconnect (supplementary).** A socket close before the response cancels the request context (a
  normal close after a successful response is not treated as an error). This is defence-in-depth; the
  caller-safe server-side deadline is the primary boundary and does not depend on observing the caller's close.
- **Delivery-boundary pre-sign guard (supplementary).** Immediately before `signer.issue()` the server also
  checks the caller socket is still alive (`!sock.destroyed`); if the caller's close/RST was already processed,
  it refuses rather than mint a proof the caller can never receive. Synchronous, so it catches the case where
  the close won the race against the observation result even though the 'close' macrotask has not yet run
  `ctx.cancel`. It does not, by itself, close the race when the observation result wins (see the limitation).
- **Cancellation propagates INTO the open.** Observer open is governed by BOTH the (remaining-capped) open
  deadline AND request cancellation: `acquireObserver` races `provider()` against a cancellation signal wired
  to the request context. If the request is cancelled or expires while `provider()` is unresolved, the open
  generation is abandoned — the returned connection is NEVER admitted as `current`, is destroyed (a resolution
  still in flight is disposed by the open's `.then` via the `abandoned` flag; one already resolved is disposed
  by the pre-current `ctx.live()` check), and the next request opens a fresh, fully re-validated connection.
- **Observer-open containment.** `provider()` open is bounded and at most ONE outstanding at a time — a second
  is refused (not started) while one is abandoned-but-unsettled. A connection returned late after abandonment
  is destroyed, never admitted; a late error is consumed safely. Repeated timeouts/cancels cannot accumulate opens.
- **Stalled statement/setup containment.** A statement or session setup that breaches its wall-clock deadline
  marks the observer dead and destroys the physical connection (`client.end()` + best-effort socket destroy),
  marking dead FIRST so it is never reused even if teardown stalls (bounded by the cleanup deadline). The slot
  stays occupied until teardown completes, so capacity is not released while orphaned DB work exists.
- **Stale results are never signed.** A late completion from an invalidated/dead observer, or one whose
  observation generation no longer matches, or one for an expired request, is discarded.
- **Recovery is bounded and fail-closed.** A fresh connection is fully re-validated (statement_timeout,
  read-only, capability self-check) before evidence resumes; recovery exhaustion fails closed (exit 73).
- **Shutdown is bounded.** `close()` stops admitting, destroys sockets (which cancels their in-flight request
  contexts), cancels queued contexts, drains/contains the coordinator within the shutdown deadline, and closes
  the listener — never an unbounded wait; clean exit 0 on a normal shutdown.
- **`statement_timeout` is defence-in-depth only.** It does NOT bound client-side queueing, a socket/driver
  stall, or an operation not yet executing server-side; the lifecycle bounds those.

⚠ **Honest runtime limitation (never-settling open).** A JavaScript Promise cannot be forcibly terminated, so a
*never-settling* `provider()` open (or a synthetic never-settling `pg` operation) cannot be cancelled in place.
The design therefore BOUNDS the number of such unresolved operations to ONE (a second is never started), fails
every request closed while it persists, and ensures shutdown does not start more and returns within its
deadline; it does not pretend the stuck Promise was terminated.

⚠ **Honest runtime limitation (caller-timeline clock).** The caller-timeline tightening trusts the
HMAC-authenticated `ts` only to SHORTEN the window (never to extend it), so it cannot be abused. Its
effectiveness at closing the accept-backlog gap depends on the reader-host↔attester clock skew being small
relative to the response margin (both are Railway containers, expected NTP-synced to well under the 600 ms
margin; gross skew is separately bounded to ±30 s by the freshness check). If the caller's clock runs ahead
beyond the margin, the tightening yields nothing and the attester falls back to the accept-anchored 1900 ms
budget — which, combined with a >2 s event-loop stall AND winning the DB-result-vs-socket-close race, is the
only residual path to a proof MINTED just after the caller's window. That residual proof is undeliverable (the
caller already destroyed its socket) and unreplayable (single-use nonce; the caller uses a fresh nonce per
call); no DELIVERABLE or REPLAYABLE post-expiry proof is reachable. A full elimination would require either a
server service-account monotonic handshake timestamp (not exposed by Node) or a protocol change to the frozen
caller — both out of scope.

⚠ These bounds are proven offline against controllable stall physicals + a throwaway local PostgreSQL 16
(`tests/attester-containment.test.mjs`, `tests/attester-localpg.test.mjs`). Hosted PostgreSQL 18 behaviour of
`set_config`/`pg_read_all_stats` and the exact socket teardown of the deployed `pg` build remain PENDING LIVE
VERIFICATION (§6).
