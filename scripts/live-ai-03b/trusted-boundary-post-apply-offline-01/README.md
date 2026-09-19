# LIVE-AI-03B · trusted-boundary post-apply (OFFLINE)

**Latest packet:** `LIVE-AI-03B-P1-02-POST-APPLY-CHECK-LITERAL-SURGICAL-FIX-01`
**Disposition:** `OFFLINE_SURGICAL_FIX_COMPLETE_REVIEW_REQUIRED`

## CHECK-literal surgical fix (this pass)

The prior CHECK comparison normalized the entire `pg_get_constraintdef` with `lower(...)` +
`regexp_replace(..., '\s', '', 'g')` (+ `::text` strip). That transform reached **inside** the quoted
string literals, so `CHECK (action IN ('ACTIVATE','RESTORE'))` and `CHECK (action IN ('act ivate','restore'))`
were wrongly ACCEPTED. Corrected in **both** SQL artifacts: the check is now compared **case- and
whitespace-EXACT** against a source-grounded canonical allowlist derived from the frozen migration
`action text NOT NULL CHECK (action IN ('activate','restore'))` (a `text` column ⇒ the canonical
`CHECK (action = ANY (ARRAY['activate'::text, 'restore'::text]))` rendering, with the double-paren
variant). The RAW `pg_get_constraintdef(oid)` is compared with **no** lowercase, whitespace or `::text`
transformation, so quoted literal bytes are preserved. Uppercase, embedded-whitespace, altered,
missing, extra, reversed-operator and incompatible-boolean predicates all fail to match ⇒ rejected. An
unrecognized (version-variant) rendering fails **CLOSED** — the exact hosted-PostgreSQL rendering is a
documented future gate; the allowlist is extended ONLY on confirmed equivalence, never via a permissive
lowercase/whitespace/keyword fallback. The `consumed_at` default check (no quoted literals) and every
previously-passing check (reader public USAGE, pre-GRANT sequencing, roles, privilege matrices, exact
two-grant set) are unchanged.

> ⚠ **UNAPPLIED / OFFLINE ONLY.** Nothing here connects to Railway / AI-STAGING / CORE-PROD, applies
> any SQL/migration/grant, provisions any role/credential, activates any policy/catalog/control, calls
> a provider, or mutates git. Both SQL artifacts are reviewable proposals for a FUTURE, separately
> authorized Owner application against AI-STAGING PostgreSQL `b7362594-a01b-4623-a982-394707a6cec2`
> ONLY (never CORE-PROD `1fbd7632-...`).

## Remaining-findings remediation (this pass, R1–R4)

The independent WORK closure review closed the executor matrix, role boundary, and README/manifest
consistency, and flagged four remaining defects — all corrected here:

- **R1 — reader public-schema USAGE.** The accepted reader-role grants `USAGE ON SCHEMA public`. Both
  artifacts now **require** effective `has_schema_privilege(reader,'public','USAGE')`: Artifact A checks
  it **pre-grant** (HOLD before either grant if absent) and re-proves it **post-grant**; Artifact B
  verifies it. Table SELECT alone is no longer treated as a usable query path. Reader CREATE denial on
  public + trusted schemas is preserved. No USAGE grant is added to "repair" a missing one.
- **R2 — exact ledger CHECK + `consumed_at` default.** The keyword-substring/`ILIKE` CHECK test and the
  `LIKE 'now()%'` default prefix are replaced with **exact canonical comparison**. **(CHECK-literal fix,
  this pass:)** the CHECK is now compared **case- and whitespace-EXACT** — the RAW `pg_get_constraintdef`
  is required to be `<> ALL (accepted_check_forms)` = false with **no** lowercase/whitespace/`::text`
  transform, so quoted-literal bytes are preserved (uppercase/embedded-whitespace values are rejected).
  `consumed_at`'s default must exactly match `accepted_default_forms` (`now()`/`pg_catalog.now()`). A
  reversed operator, an extra permitted action, a boolean AND-of-inequalities, a different default
  function, `now()`+expression, or a cast-wrapped default are all rejected. No LIKE/keyword fallback.
- **R3 — pre-grant security sequencing.** **All** critical predecessor checks now execute **before**
  either `GRANT`: reader public USAGE, reader/executor CREATE denial (public + trusted), reader
  trusted-function EXECUTE denial, executor required EXECUTE + USAGE, PUBLIC trusted-function/schema/
  ledger exposure, exact ledger shape/CHECK/default, role attributes + memberships, and the full
  reader/executor table matrices. The post-grant block still re-proves the complete end-state.
- **R4 — substantive negative tests.** The suite **replays the candidate's own acceptance predicate**
  for the CHECK/default logic: it extracts `accepted_check_forms`/`accepted_default_forms` from the
  actual SQL and applies the SQL's own normalization to negative + positive examples (reversed operator,
  extra action, incompatible boolean, wrong/expression/cast default → rejected; legitimate → accepted).
  For sequencing it locates the first executable `GRANT` in the actual SQL and asserts every mandatory
  predecessor check occurs before it. Privilege/CREATE/EXECUTE/USAGE/PUBLIC use static coverage + this
  ordering proof.

Previously-CLOSED behavior preserved: complete executor + reader privilege matrices (all 13
`public.budget_*` tables + ledger × 7 privileges), role attributes + memberships, exact column/PK/UNIQUE
shape, README/manifest consistency.

## Artifact A — `deferred-ledger-read-grant.sql`
One `ON_ERROR_STOP` `BEGIN`…`COMMIT`: comprehensive fail-fast **preconditions** (everything above,
pre-grant) → the two authorized grants → fail-closed **postconditions** proving the complete exact
end-state. The complete positive grant set is exactly:
```
GRANT USAGE  ON SCHEMA live_ai_03b_trusted                       TO live_ai_03b_reader;
GRANT SELECT ON        live_ai_03b_trusted.approval_consumption  TO live_ai_03b_reader;
```

## Artifact B — `post-application-verification.sql`
`BEGIN READ ONLY` + `default_transaction_read_only=on` + finite `statement_timeout`, ends `ROLLBACK`;
no GRANT/REVOKE/DML/DDL/function-invocation/negative-write. Independently re-proves the full matrices,
exact ledger shape incl. R2 canonical CHECK/default, reader public USAGE (R1), role attributes, trusted
functions (SECURITY DEFINER + empty `search_path`), no-unexpected-objects, PUBLIC exposure; prints an
informational (non-failing) lifecycle readout.

**Honest scope:** catalog-level proof only. Effective runtime least-privilege, credential isolation,
and the exact hosted-PostgreSQL normalization of the CHECK/default (the accepted-forms sets are
fail-closed exact-match allowlists) remain **FUTURE credential-backed / hosted-PostgreSQL gates**.

## Tests
```
node tests/boundary-post-apply.test.mjs   # 107 assertions, 0 failed — offline
```
Static coverage + **acceptance-predicate replay** (CHECK/default, using the SQL's own extracted
allowlist + normalization) + **pre-grant execution-ordering** analysis over the actual SQL bytes.
**Not** hosted-PostgreSQL execution or effective-role proof.

## Files
- `deferred-ledger-read-grant.sql` — Artifact A (executable, unapplied)
- `post-application-verification.sql` — Artifact B (read-only, unapplied)
- `tests/boundary-post-apply.test.mjs` — offline structural + coverage + replay tests (107 assertions)
- `EVIDENCE-MANIFEST.json` — sha256 + bytes + provenance
- `README.md`

## Future live gates (not done here)
Hosted-PostgreSQL dialect/execution validation (incl. confirming the exact CHECK/default canonical
rendering, extending the fail-closed allowlist only on confirmed equivalence); controlled backup +
read-only prestate; reader LOGIN credential out-of-band + custody-isolated; effective-role
credential-backed proof (reader SELECT succeeds; every write + trusted-function EXECUTE denied);
connection→service-identity confirmation to AI-STAGING `b7362594-...`. Application of either artifact
needs separate Owner authorization.
