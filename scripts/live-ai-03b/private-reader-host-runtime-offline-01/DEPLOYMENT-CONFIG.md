# LIVE-AI-03B — private-reader SERVING runtime: future Railway configuration (REFERENCE ONLY, NOT APPLIED)

> Nothing here is applied. No Railway/source/config change, no deployment, no credential, no attachment to
> the existing service. These are the settings a FUTURE, separately-authorized deploy would use.

## Target (identity reference only)
- Project `4ad1abb3-823a-4acf-b889-6d34ae46d7f9` (`staybid-live-ai-03b-staging`) · env `aa397bd7-…` (display
  name "production" — this is the **AI-STAGING** project, NOT CORE-PROD) · service
  **`88c74a23-6b01-4ec8-8600-90e23628ff72`** (`live-ai-03b-private-reader-host`, empty/undeployed).
  CORE-PROD project `04c8b523-…` / PG `1fbd7632-…` excluded.

## Source / build / start
- **Source:** `Sachinhelpline/staybid-frontend`, pinned to a future commit that preserves this runtime dir
  (the five accepted private-host files are at `a4a5946d…`). Attach via `connect-service-source` — FUTURE.
- **Root directory:** repository root (relative imports of sibling accepted dirs must resolve).
- **Build:** none — pure Node ESM, Node built-ins only (`node:net`, `node:crypto`, `node:os`, `node:path`),
  no npm dependency. Node ≥ 18.
- **Start:** `node scripts/live-ai-03b/private-reader-host-runtime-offline-01/private-reader-host-runtime.mjs`
- **Networking:** **no public domain, no TCP proxy, no HTTP.** The listen mode is explicitly selected by
  `LIVE_AI_03B_READER_LISTEN_MODE` (unset ⇒ `unix`). For the separate gateway service the future mode is
  `private-network` (see "Serving the separate gateway" below). `unix` / `loopback-tcp` remain for
  intra-container / local use.
- **Readiness:** the process logs `status:"serving"` only after the reader-only authority validated, the
  listen config validated, and the listener is bound; otherwise it exits `70` (fail-closed, non-serving).
  If quarantined work never settles (sticky `degraded`) it stops and exits `71` so the platform restart
  policy recycles it (dropping its DB connections).

## Provisioning inputs (names only; values supplied out-of-band — NOT set here)
| Input | Purpose | Where |
|---|---|---|
| reader-only authority | `readerDbClient` (live_ai_03b_reader), connection-identity proof, reader-privilege proof, pinned trust root, registry, source pin | Constructed by a future deployment module replacing `acquireReaderOnlyProductionAuthority()` (UNPROVISIONED today) |
| `LIVE_AI_03B_READER_TRANSPORT_SECRET` | caller-auth HMAC secret (≥16 chars) shared ONLY with the permitted downstream caller; not a DB credential | service-scoped secret on `88c74a23` only |
| `LIVE_AI_03B_READER_SOCKET` | optional socket path override (`unix` mode) | service env |
| `LIVE_AI_03B_READER_LISTEN_MODE` | `unix` (default) \| `loopback-tcp` \| `private-network` | service env |
| `LIVE_AI_03B_READER_BIND_HOST` | literal IP; `::` / `0.0.0.0` only together with the acknowledgement below | service env |
| `LIVE_AI_03B_READER_PORT` | decimal port 1–65535 (deliberately NOT Railway's public `PORT`) | service env |
| `LIVE_AI_03B_READER_ALLOWED_PEER_CIDRS` | comma-separated private CIDRs of the permitted caller(s) — mandatory in `private-network` | service env |
| `LIVE_AI_03B_READER_ALLOW_WILDCARD_BIND` | exactly `true` to acknowledge a wildcard bind (never inferred) | service env |

The reader credential must be **service-scoped on `88c74a23` only** — never a shared/env variable, never
referenced by the gateway, executor, probe or any other service (ACCESS-CONTROL-SPEC §4/§7).

## Serving the separate gateway (Finding 1 — offline design; LIVE topology verification deferred)
A Unix socket / loopback listener is reachable only inside one container, so the gateway service
`dd96c7cd-02c1-4d02-89eb-7e217930ebfa` cannot reach it. The corrected runtime therefore offers an explicitly
selected **`private-network`** mode that serves the SAME authenticated protocol over TCP on the project's
private network.

**Listener rules enforced in code (`validateListenConfig`, fail closed before any bind):**
- Bind is a literal private IP (RFC 1918 IPv4 or RFC 4193 `fc00::/7` IPv6) — loopback, public, documentation
  and hostname binds are refused. A wildcard (`::` / `0.0.0.0`) is accepted ONLY with
  `LIVE_AI_03B_READER_ALLOW_WILDCARD_BIND=true`; it is never inferred or defaulted.
- A non-empty peer allowlist (≤16 CIDRs), each inside a private range and no broader than it (`0.0.0.0/0`,
  `::/0`, over-broad supernets refused), is mandatory and is checked per connection before any request
  byte is processed (`peer_not_allowed`).
- The address/peer filter is **defence-in-depth only — it is NOT authentication.** Every request still
  requires the HMAC caller secret, freshness, a single-use nonce, the single approved op and exact typed
  args; limits and fixed failure codes are unchanged.

**Caller contract (gateway side — FUTURE implementation, separately authorized):**
1. Connect TCP to `<reader-service private hostname>:<LIVE_AI_03B_READER_PORT>` (Railway private DNS name
   of service `88c74a23`; name to be confirmed live).
2. Send ONE newline-terminated JSON line `{ v:"reader-obs-transport-v1", op:"observe", args:{observation},
   nonce, ts, mac }` where `observation ∈ {dormant, armed, ceilings}`, `nonce` = 8–128 random chars used once,
   `ts` = caller epoch ms (within ±30 s of the host), `mac = hex(HMAC-SHA256(secret, v⏎op⏎JSON(args)⏎nonce⏎ts))`.
3. Read ONE JSON line: `{ok:true, message}` (message already passed the accepted outward boundary) or
   `{ok:false, code}` with a fixed code (`unauthenticated`, `stale`, `replayed`, `unknown_op`, `bad_args`,
   `bad_request`, `request_too_large`, `response_too_large`, `busy`, `timeout`, `unavailable`,
   `peer_not_allowed`, `internal`). Treat every non-ok as "no observation" — never retry-storm; back off on
   `busy`/`timeout`/`unavailable`.
4. The secret is `LIVE_AI_03B_READER_TRANSPORT_SECRET`, provisioned to exactly the host and the gateway.
   `tests/independent-client.mjs` is a dependency-free reference caller implementing this contract.

**Deployment-level prerequisites (must ALL hold before private-network serving; none done here):**
- NO public domain and NO TCP proxy on `88c74a23`, ever; the observation port is never exposed publicly.
- Host and gateway in the SAME AI-STAGING project/environment (`4ad1abb3…` / `aa397bd7…`); never CORE-PROD.
- Observe the gateway's actual private address range live and set `ALLOWED_PEER_CIDRS` to the narrowest
  range that covers it (Railway private networking is expected to be IPv6 ULA — to be verified, not assumed).
- Prefer a literal private bind if the host's private address is stable; otherwise bind `::` with the explicit
  acknowledgement (the allowlist + HMAC remain mandatory).
- Live verification that the listener is reachable from the gateway ONLY and not from the public internet or
  from other services outside the allowlist. **The offline cross-process test proves protocol reachability
  and enforcement on one machine; it does NOT prove Railway network isolation.**

## Observation deadline (Finding 2) — what is bounded where
- **Transport (implemented):** end-to-end budget 5 s per connection; observation execution capped at 3 s
  (tighten-only limits). On expiry the caller gets `timeout` promptly and the observation's abort signal fires.
- **Reader host (implemented):** an abort gate refuses every further reader query for an aborted observation
  and discards a late result. It does NOT cancel a statement already in flight — the accepted adapter's client
  contract (`query(sql, params)`) has no cancellation interface, and none is invented. A timeout response is
  not evidence that the database work stopped.
- **Quarantine (implemented):** a slot is released only when the underlying observation actually settles, so
  unsettled work keeps counting against `maxConcurrent` (8); excess work gets `busy`. Unsettled work older than
  15 s ⇒ sticky `degraded`: new work is refused (`unavailable`), `ready()` is false, the watchdog fires and the
  entrypoint exits `71` for a platform restart.
- **Database (DEFERRED LIVE requirement):** the deployment's authority constructor must open the reader
  connection with a DB-side per-statement bound (PostgreSQL `statement_timeout`) ≤ 2000 ms and declare the same
  value as `readerDbClient.statementTimeoutMs` (validated 1–2000; missing ⇒ `host_unavailable`). With that bound
  an in-flight statement is expected to end ≤ 2 s after the deadline and the slot frees well inside the
  quarantine window. Offline this is a validated declaration only; whether it is enforced must be verified live
  (e.g. the reader session's effective `statement_timeout`). Setting it at role level would be a DB change
  requiring its own authorization.

## Status of the previous serving blocker
The prior candidate recorded two missing interfaces (authority injection; serving transport). Within this
offline authorization both are now implemented as **versioned, bounded** interfaces:
`reader-only-authority-v1` (no executor) and `reader-obs-transport-v1` (authenticated loopback socket).
What remains is **live**: constructing the genuine authority/proofs and secret at deployment time.

## Deferred LIVE readiness requirements (separate Owner authorizations; none done here)
1. Workspace/token custody attestation (Option A) — no non-Owner-held Railway token/integration.
2. Provision `live_ai_03b_reader` credential + transport secret as service-scoped secrets on `88c74a23`.
3. Implement the deployment's authority constructor (replacing `acquireReaderOnlyProductionAuthority`) that
   produces a **genuine** connection-identity proof and reader-privilege proof from independent read-only
   sources (role, target service identity, effective grants = 12 SELECT / 0 write, forbidden object, freshness).
4. Hosted-PostgreSQL validation that the fixed registry queries behave as expected on AI-STAGING.
5. Private-network topology verification for the gateway (mode + allowlist implemented offline; the actual
   Railway private addresses, DNS name, reachability-from-gateway-only and no-public-exposure are LIVE checks).
5a. Enforce + verify the reader connection's DB-side `statement_timeout` (≤ 2000 ms) matching the declared
   `statementTimeoutMs`; implement the gateway caller per the contract above (separate authorization).
6. Attach source + deploy the service; verify fail-closed and serving behaviour live.
7. Trusted-boundary migration (UNAPPLIED) and the first controlled real AI TEXT test — separate gates.
