# LIVE-AI-03B · private-reader SERVING runtime (OFFLINE, complete candidate)

**Authorization:** Owner Control Room v2, 24 Sep 2026 — reader-only serving runtime, offline only.
**Disposition:** `OFFLINE_TWO_ISSUE_CORRECTION_COMPLETE_REVIEW_REQUIRED` (not accepted, not deployed).
**Correction:** two WORK v2 findings corrected in one pass — (1) private-network serving mode for the separate
gateway, (2) bounded end-to-end observation deadline with quarantine. See `CORRECTION-SUMMARY.md`.

> ⚠ **OFFLINE / UNTRACKED / NOT DEPLOYED.** No live DB, credential, Railway change, provider call or Git
> action. The accepted five private-host files and all frozen predecessors are **byte-unchanged** (hash-asserted
> in the suite). This is a genuine serving process — not a preparation-only entrypoint.

## What it does
A long-running private process that (1) establishes a **reader-only** authority with **no `executorDbClient`**
(`reader-only-authority-v1`), (2) holds the reader client privately, and (3) serves the three fixed, approved
observations over an **authenticated transport** (`reader-obs-transport-v1`) in an explicitly selected listen
mode (`unix` default · `loopback-tcp` · `private-network` for the separate gateway), returning only the
accepted value-validated `ObservationResult`. It fails closed whenever authority, proofs or the caller-auth
secret are absent. See `AUTHORITY-BOUNDARY.md` for how the executor requirement is avoided.

## Files
| File | Status | Purpose |
|---|---|---|
| `reader-only-authority.mjs` | NEW (corrected) | Versioned reader-only authority (+ declared DB statement bound, abort-gated reader view): `validateReaderOnlyAuthority`, `makeReaderOnlyHost`, `READER_PRIVILEGE_PROOF_CONTRACT`, `acquireReaderOnlyProductionAuthority` (UNPROVISIONED). |
| `observation-transport.mjs` | NEW (corrected) | Authenticated server + client; listen modes unix / loopback-tcp / private-network (`validateListenConfig`, peer allowlist); HMAC-SHA256, freshness, anti-replay, typed ops, size bounds; observation deadline + quarantine + sticky degraded. |
| `AUTHORITY-BOUNDARY.md` | NEW | Source/authority-boundary explanation. |
| `private-reader-host-runtime.mjs` | MODIFIED (corrected) | Serving lifecycle: `startServingRuntime()` (explicit listen config, limits, health, degraded watchdog) + process `main()`. |
| `runtime-config.mjs` | MODIFIED (corrected) | Non-secret config, AI-STAGING self-check, listen-mode env names + `resolveListenConfigFromEnv`, transport-secret provisioning (env name only). |
| `tests/runtime.test.mjs` | MODIFIED (corrected) | 125 integrated offline assertions (sections A–G) incl. real cross-process private-network-mode test and stalled-observation negatives. |
| `tests/independent-client.mjs` | NEW | Dependency-free independent caller process implementing the documented caller contract. |
| `CORRECTION-SUMMARY.md` | NEW | Two-issue correction summary. |
| `DEPLOYMENT-CONFIG.md` | MODIFIED | Future Railway settings (reference only) + deferred live requirements. |
| `README.md`, `EVIDENCE-MANIFEST.json` | MODIFIED | This file; hashes + results. |

## Transport contract (`reader-obs-transport-v1`)
- **Wire:** one newline-terminated JSON request per connection → one JSON response.
- **Request:** `{ v, op, args, nonce, ts, mac }`; `mac = HMAC-SHA256(secret, v\nop\nJSON(args)\nnonce\nts)`, compared timing-safe.
- **AuthN:** shared caller secret (≥16 chars, provisioned out-of-band; not a DB credential). **AuthZ:** only `op:"observe"`.
- **Typed args:** exactly `{ observation }` (string); the host accepts only `dormant|armed|ceilings`. No SQL, no URL, no free params.
- **Freshness:** `|now − ts| ≤ 30 s` → else `stale`. **Replay:** single-use nonce, 120 s TTL → `replayed`.
- **Bounds:** request ≤ 4096 B, response ≤ 65536 B, 5 s end-to-end budget, observation execution ≤ 3 s, ≤ 8 concurrent
  (quarantined work counts), quarantine 15 s → sticky `degraded`. Limits may only be tightened.
- **Errors:** fixed codes only (`unauthenticated`, `stale`, `replayed`, `unknown_op`, `bad_args`, `bad_request`, `request_too_large`, `response_too_large`, `busy`, `timeout`, `unavailable`, `peer_not_allowed`, `internal`) — never raw errors, stacks, credentials or URLs.
- **Binding (explicit mode):** `unix` socket (default); `loopback-tcp` restricted to `127.0.0.1`/`::1`;
  `private-network` = literal private IP (or `::`/`0.0.0.0` only with explicit acknowledgement) + mandatory
  private peer-CIDR allowlist. Public / loopback-in-private / hostname / unacknowledged-wildcard binds are refused.
  The address filter is not authentication — HMAC is always required.

## Lifecycle
| Condition | Result |
|---|---|
| no authority (production default) | `unprovisioned`, no listener, exit 70 |
| authority invalid / synthetic in production mode | `host_unavailable`, no listener |
| transport secret absent/short | `transport_secret_absent`, no listener |
| invalid / public / unacknowledged-wildcard / unfiltered listen config | `listen_config_invalid`, no listener |
| bind failure | `transport_error`, no listener |
| all valid | `serving`; `ready()` true only once listening + host valid |
| quarantined work never settles (> 15 s) | `degraded`: new work `unavailable`, `ready()` false, watchdog → entrypoint exits 71 (restart) |
| `stop()` | listener closed; `ready()` false; further observations fail closed |

## Reproduce (offline, no secrets, no network)
```
cd scripts/live-ai-03b/private-reader-host-runtime-offline-01
for f in reader-only-authority.mjs observation-transport.mjs private-reader-host-runtime.mjs runtime-config.mjs; do node --check "$f"; done
node --check tests/independent-client.mjs
node tests/runtime.test.mjs                  # 125 passed, 0 failed, 0 skipped
node private-reader-host-runtime.mjs; echo $? # {"status":"unprovisioned",...}  70
# compatibility regressions (accepted, unchanged):
node ../private-reader-host-offline-01/tests/private-reader-host.test.mjs      # 54 passed
node ../trusted-runtime-live-binding-offline-01/tests/live-binding.test.mjs    # 82 passed
```

## Honest limits (offline cannot prove these)
- No genuine connection-identity or reader-privilege proof exists offline; synthetic `TEST-ONLY` proofs are used
  only under an explicit test boundary and are rejected in production mode.
- The validator is structural (like the accepted one); genuine trust comes from the deployment's independent proof
  sources at the live gate.
- **Topology:** `private-network` mode is implemented and tested cross-process on ONE machine (this sandbox has no
  RFC1918/ULA interface, so the interface's /24 is declared private under the explicit test boundary only). That
  proves protocol reachability + enforcement, **not Railway isolation**; the actual private addresses, DNS name,
  allowlist and no-public-exposure are live verifications (DEPLOYMENT-CONFIG.md).
- **Deadline:** the timeout response and abort gate do not terminate an in-flight DB statement (no cancellation
  interface exists in the accepted client contract). Termination relies on the DB-side `statement_timeout`
  declared as `statementTimeoutMs` — a deferred live requirement; quarantine + degraded bound the damage if it
  is not honoured.
- Response-size bound is enforced by constant; the fixed observations are far below it, so an oversize response is
  not reachable with valid data offline.
- Deferred live requirements are listed in `DEPLOYMENT-CONFIG.md`.
