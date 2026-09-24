# LIVE-AI-03B — PRIVATE trusted-reader host: ACCESS-CONTROL SPECIFICATION (OFFLINE)

> Scope: one concrete access-control specification for the private credential-holding reader host.
> This is a **design + offline artifact**. It provisions nothing, connects to nothing, and proves no
> live isolation. Live isolation is marked **UNPROVEN** below with the exact prerequisite. Target IDs
> are the accepted AI-STAGING identities; **no secret value or DB URL appears here**.

## 0. Verified context (read-only, 2026-09-24)
- AI-STAGING Railway project `4ad1abb3-…` "staybid-live-ai-03b-staging", environment `aa397bd7-…` "production".
- Postgres service `b7362594-…` (live). Gateway service `live-ai-03b-gateway` `dd96c7cd-…` — **undeployed** (no source, no deployment).
- Workspace `07d0d915-…` ("sachinhelpline's Projects"). Environment `sharedVariableNames: []` (no reader credential provisioned anywhere observable).
- CORE-PROD project `04c8b523-…` / Postgres `1fbd7632-…` — **excluded, never a target**.
- Reader-role **Sections I–III: APPLIED AND VERIFIED (CLOSED)** — must NOT be reapplied.
- `live_ai_03b_reader` **credential remains unset**; production-authority composition is **UNPROVISIONED**.

## 1. Intended private host = sole secret recipient
- The **private trusted-reader host** (this artifact's `private-reader-host.mjs`, a future separately-deployed
  private service/process) is the **sole** consumer of the `live_ai_03b_reader` LOGIN credential.
- It holds the `readerDbClient` **inside its own closure**; the client, the credential, a DB URL/DSN, and the
  connection token are never returned, logged, or serialized. It runs **only** the accepted immutable
  SELECT-only query registry (`CANDIDATE_REGISTRY_DIGEST`) via the frozen read adapter.
- The credential dependency (`readerDbClient`) existing in the accepted composition contract does **not**
  authorize running the credential-holding process inside the gateway. Consumption happens **only** in this
  private host.

## 2. Required separation (must ALL hold)
The credential / a `readerDbClient` / a DB URL / equivalent DB authority MUST NOT be delivered to, readable
by, or reconstructable from any of:
- the customer-facing **gateway** (`live-ai-03b-gateway` `dd96c7cd-…`);
- the **activation executor**, the **probe**, and the first-text-probe surfaces;
- any **unrelated service** in the project/workspace;
- **CORE-PROD** (`1fbd7632-…` / project `04c8b523-…`).
The private host and the gateway are **separate deployments** with separate service identities; the gateway
receives only the non-secret result of §5.

## 3. Required control over the private host (custodian obligations)
An operator/deployment authority that provisions the reader credential MUST control, and restrict to the
private host alone:
- **Host code + build**: the source/tree the private host deploys from is pinned to the accepted commit
  (`sourcePin`), and only reviewed code can consume the credential.
- **Deployment identity**: only the private-host service may mount the credential; redeploying/replacing the
  credential-consuming service is a controlled, audited action.
- **Environment variables / references / secret settings**: the reader credential is a **service-scoped**
  secret on the private host only — never a shared/environment variable, never referenced (via Railway
  variable references) by the gateway/executor/probe/unrelated services.
- **Secret provisioning path**: the credential is set **out-of-band** into the private host's secret store;
  it is never committed, never echoed, never placed in a URL/query string.

## 4. Administrative DB-credential bypass paths that MUST be excluded or explicitly controlled
Least-privilege on the reader role alone is **not** isolation if any of these remain open to a broader
operator set. Each must be excluded from everyone except the designated custodian, or explicitly controlled:
- **Railway variable read**: anyone who can read the private host's service variables can read the credential
  → restrict service-variable read to the custodian.
- **Redeploy / replace deployment**: anyone who can redeploy the private host (or point another service at the
  credential) can exfiltrate or misuse it → restrict deploy rights.
- **Project/workspace membership**: members of workspace `07d0d915-…` / the project with variable or deploy
  access are implicit credential holders → scope membership.
- **Postgres superuser / broad roles**: the credential must be `live_ai_03b_reader` only — never `postgres`,
  `pg_read_all_data`, `pg_write_all_data`, `pg_execute_server_program`, or a role that can `SET ROLE` upward.
- **Volume / backup access**: read access to the Postgres volume (`postgres-volume`) or a backup snapshot
  bypasses role privileges entirely → restrict.
- **Connection-string / DATABASE_URL variables** that embed a superuser must not be mounted on the host.

## 5. Permitted (non-secret) communication with the gateway
- The gateway may receive **only** a strict, value-validated, non-secret `ObservationResult` — an exact
  allowlisted shape: top-level `kind`/`phase`/`ok`/`registryDigest`/`pgService`/`mode`/`observation` on
  success, or `kind`/`phase`/`ok`/`code` on failure. It is re-validated at the boundary by
  `assertOutwardMessage` (aka `assertNonSecretResult`) / `deliverToGateway` / `toGatewayMessage`, which
  enforce: exact top-level + per-phase key sets; every leaf a **safe scalar** (finite number, boolean, or a
  string matching `^[A-Za-z0-9_.\-]{1,128}$` — forbidding `:`/`/`/`@`/whitespace, so a URL/DSN/credential
  embedded in *any* permitted field is rejected by **content**, not merely by field name); no function, no
  `.query`-shaped object, no cycle; JSON-pure.
- **Outward failures carry ONLY a fixed, finite, non-secret `code`** (`ERROR_CODES`) — never a raw DB-driver
  exception message, stack, connection string, concatenated adapter reason, or echoed caller input.
- The gateway can **never** obtain a query capability, arbitrary SQL, the client, the credential, or a DB
  URL. Cross-process transfer is a serialized message only (no live object handoff).

## 6. Offline-establishable vs. requires live deployment/access evidence
**Establishable offline (this artifact):**
- The credential-consumption point is singular and private (closure-held; no getter; `Object.freeze` handle).
- No arbitrary SQL: only the fixed, digest-pinned registry runs; the request contract accepts only an
  observation name (no echo of caller input); a substituted-SQL authority fails closed.
- Fail-closed unprovisioned default; malformed/untrusted/test-fixture/wrong-target/unpinned authority → closed.
- The gateway result boundary is a strict **value-based** allowlist: it excludes client/credential/URL/token
  egress even when embedded in an otherwise-permitted field, and outward failures carry only fixed codes.
- A raw DB-driver exception message / stack is never forwarded outward (remediated leak path 1).
- No mutation and no network/db-driver import in the host source.

**Requires separate LIVE deployment/access evidence (NOT provable here):**
- That the credential is actually provisioned **only** on the private host and on no shared/other service
  (Railway variable-scope evidence).
- That deploy/variable-read/membership rights are actually restricted to the custodian (Railway RBAC + audit).
- That the runtime connection terminates at PG `b7362594-…` by service identity and never CORE-PROD.
- That the reader role's **effective** privileges are SELECT-only with no superuser/bypass membership
  (credential-backed Section V run against AI-STAGING).
- That no superuser DATABASE_URL / volume / backup bypass is mounted anywhere reachable.

## 7. Isolation status — **UNPROVEN offline**
Operator isolation is **NOT** established merely because the host is private, separately named, or in
AI-STAGING. With the reader credential unset and the gateway undeployed, the current permission model **cannot
yet be shown** to exclude an operator who can (a) read the private host's service variables, (b) redeploy /
repoint the credential-consuming service, or (c) hold a broader Postgres role / volume / backup path. Until
those are restricted and evidenced, isolation is **UNPROVEN**.

**Exact prerequisite to close it:** an Owner-controlled provisioning + access-control decision. Reader-role
**Sections I–III are already APPLIED AND VERIFIED (CLOSED) and must NOT be reapplied**; the remaining,
separately-authorized steps are: (1) provision the `live_ai_03b_reader` credential as a **private-host-only,
service-scoped** secret in a custody-isolated store; (2) restrict variable-read + deploy + membership on the
private host to the designated custodian and exclude every §4 bypass path; (3) deploy the private host so it
constructs an authority passing `validateProvisionedAuthority()`; then run the credential-backed effective-
privilege verification + Railway RBAC/scope evidence. **Offline code/tests do NOT establish live Railway RBAC,
credential custody, runtime isolation, or deployment safety** — those, together with credential provisioning,
access-control mutation, private-host deployment, trusted-boundary migration and activation, remain SEPARATE
future Owner authorization boundaries. This is a decision + authorized action, **not** resolvable by more
read-only or offline evidence.
