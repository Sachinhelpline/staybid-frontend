# LIVE-AI-03B-B — two-issue consolidated OFFLINE correction (review required)

**Authorization:** Owner (Sachin Tomer) — private-reader serving runtime, two-issue offline correction.
**Outcome:** `OFFLINE_TWO_ISSUE_CORRECTION_COMPLETE_REVIEW_REQUIRED`. Offline only — no Git, Railway, live DB,
credential, deployment, provider or CORE-PROD operation. Accepted/frozen predecessor files byte-unchanged.

## Finding 1 — separate gateway cannot reach a Unix-socket / loopback listener
**Correction.** New explicitly selected `private-network` listen mode in `observation-transport.mjs`
(`validateListenConfig`), wired through `startServingRuntime({ listen })` and env names in `runtime-config.mjs`
(`LIVE_AI_03B_READER_LISTEN_MODE`, `_BIND_HOST`, `_PORT`, `_ALLOWED_PEER_CIDRS`, `_ALLOW_WILDCARD_BIND`).
- `unix` (still the default) and `loopback-tcp` are preserved unchanged in behaviour.
- Private bind must be a literal RFC 1918 / RFC 4193 IP; wildcard only with an explicit boolean acknowledgement;
  loopback, public, documentation and hostname binds refused; port 0 only inside the test boundary.
- Mandatory private peer-CIDR allowlist (≤16, no `/0`, no supernet broader than its private range), enforced
  per connection before request processing (`peer_not_allowed`). **Not authentication** — HMAC, freshness,
  single-use nonce, the single approved op, typed args, size limits and fixed codes all still apply.
- Runtime validates the listen config before binding (`listen_config_invalid`, no listener).
- Caller contract + deployment prerequisites (no public domain / TCP proxy, same AI-STAGING env, observed
  narrowest allowlist, live isolation verification) documented in `DEPLOYMENT-CONFIG.md`;
  `tests/independent-client.mjs` is a dependency-free reference caller.

**Evidence (section F, 44 assertions).** Config negatives (absent/unknown mode, unacknowledged wildcard ×3,
public IPv4/IPv6, RFC 5737 refused in production, loopback ×2, hostname, missing bind, missing/empty allowlist,
`0.0.0.0/0`, `::/0`, over-broad, public peer, malformed CIDRs, port 0/invalid, simulated ranges outside the test
boundary); env parsing; runtime refusal. **Real cross-process:** the runtime serves on this machine's
non-loopback interface; an independent child process (separate pid, own protocol implementation) gets an
authenticated observation; invalid MAC / missing MAC → `unauthenticated`; unapproved op → `unknown_op`; stale →
`stale`; replay → `replayed`; a peer outside the allowlist → `peer_not_allowed` with the host never invoked; an
allowlisted address without the secret → `unauthenticated`; after `stop()` the child gets `ECONNREFUSED`.
**Limit:** this sandbox has no private interface, so its /24 is declared private only under the test boundary
(production validation refuses it — asserted). Local connectivity does NOT prove Railway isolation.

## Finding 2 — observation execution had no deadline
**Correction.**
- Transport: end-to-end budget (5 s) plus an observation-execution deadline (3 s) around `host.observe()`; on
  expiry the caller receives the fixed code `timeout` promptly and the observation's `AbortSignal` fires.
- Quarantine: the concurrency slot is released only when the underlying observation settles — a timeout is
  never treated as proof the DB work stopped. Unsettled work counts against `maxConcurrent` (`busy` beyond it).
  Unsettled work older than 15 s ⇒ sticky `degraded` (`unavailable`, `ready()` false, watchdog → exit 71).
- Reader host: an AsyncLocalStorage abort gate over the SAME reader client refuses every further query of an
  aborted observation and discards a late result; `__testFixture` copied through (accepted production refusal
  intact). The accepted adapter is NOT edited and no cancellation API is invented — an in-flight statement is
  not cancelled by this gate.
- Underlying DB bound: `readerDbClient.statementTimeoutMs` (1–2000 ms) is now REQUIRED by
  `validateReaderOnlyAuthority` — the declared DB-side `statement_timeout` the deployment must enforce on the
  reader connection. Enforcement is a **deferred live requirement** (offline = validated declaration only).
- Limits may only be tightened; failure codes are fixed.

**Evidence (section G, 19 assertions).** Bound ordering; missing/oversized/zero/fractional/string statement
bound → invalid; runtime `host_unavailable`; loosening limits refused; pre-aborted observation issues zero
queries. DB-bounded stall → `timeout` within the deadline window, slot stays quarantined, released after the
simulated DB bound, exactly one query issued, recovery succeeds. Late-resolving result → discarded, next query
refused, slot freed. Never-settling work → repeated `timeout`s, capacity held at `maxConcurrent` then `busy`,
reader invoked only per admitted observation, then `unavailable` + degraded + not ready + watchdog once, and
`stop()` completes promptly with the listener closed.

## Preserved (unchanged)
Reader-only authority (no `executorDbClient`, executor proof rejected), accepted adapter, target binding,
pinned registry digest, outward boundary, synthetic-vs-genuine provenance distinction, fail-closed production
acquisition (`UNPROVISIONED`, exit 70), no new privileged proof issuer, no public domain/HTTP.

## Deferred (live, separately authorized)
Railway private-network topology/isolation verification + allowlist values; gateway caller implementation;
DB-side `statement_timeout` enforcement + verification; plus all previously listed live requirements.
