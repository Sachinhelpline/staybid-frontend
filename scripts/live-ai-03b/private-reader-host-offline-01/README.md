# LIVE-AI-03B · PRIVATE trusted-reader host (OFFLINE implementation + access-control spec)

**Packet:** `LIVE-AI-03B PRIVATE TRUSTED-READER HOST — OFFLINE IMPLEMENTATION AND ACCESS-CONTROL SPECIFICATION`
**Disposition:** `OFFLINE_PRIVATE_HOST_IMPLEMENTATION_AND_SPEC_COMPLETE_REVIEW_REQUIRED`

> ⚠ **OFFLINE / UNPROVISIONED / UNTRACKED.** No live DB / Railway / Supabase / CORE-PROD access or
> mutation. No credential generated or provisioned. No SQL run, no trusted-boundary migration, no
> reader-role reapplication. No git commit/push/PR/merge, no branch change, no deployment/activation,
> no provider call. This directory is a NEW isolated candidate OUTSIDE the frozen accepted source; it
> does not edit any accepted file and is not wired into the frozen production entrypoint.

## Why this exists
It resolves the reader-credential custody **HOLD** by giving the accepted architecture the one thing it
lacked as an implementable object: a **private, credential-holding reader host** that is the *sole*
consumer of the `live_ai_03b_reader` credential and is **separate** from the customer-facing gateway,
the activation executor, the probe, unrelated services and CORE-PROD. The accepted contracts already
support this without any change — `validateProvisionedAuthority()` forbids caller-injected clients and
lists `readerDbClient` among the authority-supplied (not caller) fields, and the frozen read adapter
holds the client privately and runs only the digest-pinned SELECT-only registry. **No frozen contract
change was required** (contract-recovery blocker: none). Reader-role Sections I–III are **already applied
and verified (CLOSED)** — this artifact never reapplies them and the credential remains unset.

## Consolidated remediation (this pass — two confirmed outward leak paths)
- **Leak 1 — raw DB exception outward.** `observe()` no longer forwards a driver exception's `e.message`
  (which can carry a connection string). All outward failures now use a **finite fixed non-secret code set**
  (`ERROR_CODES`); no `e.message`, stack, concatenated adapter reason, or echoed caller input crosses.
- **Leak 2 — value-blind boundary.** The former name-only + JSON-round-trip guard accepted a connection URL
  inside an otherwise-permitted string field. The boundary is now a **strict value-based allowlist**
  (`assertOutwardMessage`): exact top-level + per-phase key sets, and every leaf a **safe scalar** (finite
  number / boolean / string matching `^[A-Za-z0-9_.\-]{1,128}$`, forbidding `:`/`/`/`@`/whitespace ⇒ no
  URL/DSN/credential by content). The SAME boundary guards `observe()`, `toGatewayMessage()` and
  `deliverToGateway()` on success AND failure paths.

## Files
- `private-reader-host.mjs` — the private host: sole credential-consumption point (`readerDbClient` held
  in closure, never returned); fixed-registry SELECT-only observations via the frozen adapter; finite fixed
  `ERROR_CODES`; strict value-based outward boundary (`assertOutwardMessage`, aliased `assertNonSecretResult`);
  fail-closed `UNPROVISIONED` default; `deliverToGateway`/`toGatewayMessage` boundaries; production factory
  (never satisfiable by real trust offline) + an explicit offline test factory.
- `ACCESS-CONTROL-SPEC.md` — the §3 access-control specification (sole recipient, required separation,
  custody control, admin bypass paths to exclude, permitted non-secret gateway comms, offline-vs-live,
  and the UNPROVEN-isolation prerequisite; §7 corrected: Sections I–III already applied).
- `tests/private-reader-host.test.mjs` — 54 offline assertions (synthetic clients/authorities, mock rows),
  incl. value-based negatives for both leak paths.
- `EVIDENCE-MANIFEST.json` — sha256 + bytes for every file here.

## Boundaries the implementation enforces
- **Sole credential consumer**: the client is closure-private; the host handle exposes only
  `id`/`mode`/`available` + `observe`/`toGatewayMessage` — no client/credential getter.
- **No arbitrary SQL**: only the accepted immutable registry runs; the request contract accepts only an
  `observation` name; a substituted-SQL authority fails closed (`assertSuppliedRegistry`).
- **Gateway gets only non-secret data**: `assertOutwardMessage` enforces an exact value-validated allowlist —
  rejects any function, `.query`-shaped object, forbidden-named field, non-fixed code, and any string leaf
  containing `:`/`/`/`@`/whitespace (so a URL/DSN/credential can't ride inside a permitted field); outward
  failures carry only a fixed `code`; cross-process transfer is a serialized message, not a live handle.
- **Fail-closed**: unprovisioned by default; missing/`__testFixture`/wrong-target/unpinned/tampered
  authority → closed; the production path additionally needs a trusted connection-identity proof that
  cannot exist offline.

## Tests
```
node tests/private-reader-host.test.mjs      # 54 passed, 0 failed — offline
```
Covers: fail-closed unprovisioned (fixed codes); invalid/untrusted authority → closed; arbitrary-SQL/
injection rejected without echoing input; accepted SELECT-only behavior (no DML/DDL/semicolon; only registry
SQL executed); **leak 1** — a throwing driver's exception (with a sentinel URL) yields only
`observation_error` and never leaks the URL; **leak 2** — a sentinel URL in a `reason` field, inside a
permitted observation field, or a non-fixed/URL-bearing code is rejected by `assertOutwardMessage` /
`deliverToGateway` / `toGatewayMessage`; gateway cannot receive a credential/DB client/URL/token; all outward
failures use only `ERROR_CODES`; structural production wiring + no mutation + no network/db-driver import.
**NOT** live-PostgreSQL, credential, or runtime-isolation proof.

## Honest limits (see ACCESS-CONTROL-SPEC.md §6–§7)
The offline artifact proves *structure and boundaries*. Operator isolation is **UNPROVEN** offline: with
the credential unset and the gateway undeployed, the permission model cannot yet be shown to exclude an
operator who can read the host's variables, redeploy the credential-consuming service, or hold a broader
Postgres/volume/backup path. Closing it is an Owner provisioning + access-control decision (spec §7), not
a further offline step.
