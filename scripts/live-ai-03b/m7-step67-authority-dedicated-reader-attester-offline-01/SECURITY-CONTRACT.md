# Security contract: M7 Step6/7 dedicated reader-attester V2 (offline candidate)

## Secret custody

| Holder | May hold | Must NEVER hold |
|---|---|---|
| **Authority** `live-ai-03b-v2-authority` | the 2 existing DB references (executor and reader credentials, by reference); the executor-attester public values, host, port and channel secret (by reference); the dedicated-attester public values, host, port and channel secret (by reference); the anchor (by reference) | any attester **signing key**; any attester **observer DB URL**; deployment signing custody; any superuser credential; `PGPASSWORD`/`PGUSER` |
| **Dedicated attester** | the NEW signing key and NEW channel secret (generated in P3); the observer URL and anchor (references to M5); its public custody (pubkey, fingerprint) | the executor DB URL (refused by the accepted attester config), the M5 signing key, the M5 channel secret |
| **M5 attester / reader host** | unchanged | (no new reference ever points INTO them except the two read-only references in AD-2) |

The Authority side enforces this at load time (`screenStep67Forbidden`, which covers accepted names plus
patterns `/SIGNING_KEY/`, `/PKCS8/`, `/OBSERVER_DB_URL/`, `/PRIVATE_KEY/`, `/SUPERUSER/` and
`/^PG(PASSWORD|USER)$/`). It is also enforced statically (`validatePlans`, test S07) and by tests C03 and C07.

## Fail-closed properties (each proven by a test)

| # | Property | Test |
|---|---|---|
| 1 | Executor effective-privilege drift (attester-observed, or signed-but-drifted: superuser, routines) ⇒ HOLD | E03 E04 E05 |
| 2 | Reader write drift (attester-observed, or signed) ⇒ HOLD | E06 E07 |
| 3 | Same physical connection, backend pid or application name ⇒ HOLD | E08 E09 E10 |
| 4 | Shared token, nonce or bound token, and role swaps refused by the accepted distinctness check | E11 |
| 5 | Proof substitution (other nonce, reader↔executor swap, connection-token swap) ⇒ HOLD | E12 E13 E14 |
| 6 | Reconnect before binding, or underneath a bound proof ⇒ HOLD | E15 E16 |
| 7 | Bad signature, untrusted issuer, untrusted key (M5-style substitution) ⇒ HOLD | E17 E18 E19 |
| 8 | Stale, expired or future-dated proofs ⇒ HOLD | E20 E21 E22 |
| 9 | CORE-PROD target in either proof ⇒ HOLD | E23 |
| 10 | v1 caller refused by the v2 attester | E24 |
| 11 | Clock gate failure, bad HMAC, peer refusal, DB clock skew > 5 s, wrong session roles ⇒ HOLD | E25–E29 |
| 12 | Config: pins, M5-key reuse, forbidden secrets, shared credentials, secrets, destinations or issuers, any missing name | C01–C06 |
| 13 | Railway-resolved plans satisfy the production Step6/7 loader and the **accepted** attester loader | C07 C08 |
| 14 | Plan negatives, new identity per run, verifier and seam contracts, one-shot locks, entrypoint fail-closed, receipt leak guard | C09–C18 |
| 15 | Controller: dry-run makes zero calls; gates; full P0→P9 with stdin-only secrets; one-shot; partial write; frozen-target refusals; P7/P8 negatives | K01–K14 |
| 16 | Static: no SQL, no activation, no Phase A, no SQL03, no gateway/provider, no v1 caller, no secrets, no model id; accepted deps byte-identical | S01–S09 |

## Receipts

`assertReceiptSafe` allows only allowlisted keys and short identifier strings. The only long hex it permits is in
the three public fingerprint fields and the manifest and commit pins. It refuses:

- long hex runs;
- base64-shaped runs of 40 or more characters;
- JWT shapes;
- mixed-case random runs (keys, secrets);
- credentialed URLs (by charset).

Every receipt carries `liveAuthorization: "THIS_RECEIPT_GRANTS_NO_AUTHORIZATION"`.
