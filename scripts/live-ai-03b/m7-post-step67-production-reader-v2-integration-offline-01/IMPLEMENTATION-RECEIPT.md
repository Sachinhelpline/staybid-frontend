# M7 POST-STEP67 PRODUCTION READER V2 — OFFLINE IMPLEMENTATION CANDIDATE 01

## Mode

OFFLINE ONLY.

No GitHub write.
No Railway action.
No database access or mutation.
No restart/redeploy.
No Phase A.
No SQL03.
No G4.
No G5.

## Reviewed implementation boundary

Production runtime changes are limited to exactly:

1. `src/provisioning-config.mjs`
2. `src/production-entrypoint.mjs`
3. `src/provisioner.mjs`

Tests and candidate identity/evidence are additional non-production artifacts.

## Implementation summary

### provisioning-config.mjs
- requires the accepted `LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON`;
- parses it using the accepted deployment-anchor parser;
- requires the anchor target to agree with the already validated V2 AI-STAGING project/environment/Postgres target;
- exposes only the validated `anchorClusterFingerprint`;
- requires the reader attester production host to match the accepted Railway-private service-name regex;
- loopback remains test-only.

### production-entrypoint.mjs
- removes the production reader v1 `createAttestationSourceChannel` path;
- imports and reuses the frozen `acquireReaderV2Attestation()` primitive;
- constructs a trusted reader-v2 provider without DB/network I/O at construction;
- the provider accepts exactly `{ session }`;
- the provider passes that exact session to the frozen v2 acquisition;
- there is no v1 fallback and no retry seam;
- the returned protocol must be exactly `reader-attestation-channel-v2`.

### provisioner.mjs
- replaces `readerAttestationSource` with `readerAttestationProvider`;
- opens exactly one reader physical DB connection;
- establishes one accepted reader session;
- passes the exact `rdS.session` to the provider;
- uses the v2-generated reader request nonce unchanged in the existing `bindReaderConnection()`;
- leaves the Executor attestation flow unchanged;
- leaves `bindReaderConnection()` and `checkDistinctBindings()` unchanged;
- guarded reader client is built from the same verified reader session;
- preserves one-shot semantics and fail-closed cleanup.

## Candidate source SHA256

- `src/production-entrypoint.mjs`
  `e4001c8a07c74adf263f485c49bbbff2939e56246e956058113430a5f46059eb`

- `src/provisioner.mjs`
  `f2815f3fc080fecbe79b3462a8aced689c228a68c8627cec3b3d0e45ff2723e3`

- `src/provisioning-config.mjs`
  `df4488fb4fe8555baa8b3f9b93fcf2c761d34fefd41f7c8d61d80898c17d889c`

## Baseline Git blobs for changed runtime files

- provisioning config:
  `782763180203755bc9da2ebc68b912b1e4fcddda`
- production entrypoint:
  `41de29bd8b94b1476d303b460b472e6ba3ccdcdc`
- provisioner:
  `977012d210b1a4be73cf992c44c2a5b475e3cc1f`

## Offline tests

Authoritative final command:

`node --experimental-vm-modules tests/run-all.mjs`

Final result:

`45 PASS / 0 FAIL`

The Node VM-modules warning is a local test-harness runtime warning only. It does not affect candidate production source behavior.

## Pre-freeze remediation

During stricter source-conformance verification, the accepted `parseDeploymentAnchor()` implementation was inspected directly. It already emits `anchor_*` reason codes.

An earlier candidate mapping would have double-prefixed such reasons (for example `reader_v2_anchor_anchor_malformed`) while the simplified initial harness did not model that prefix.

Before freeze:
- candidate mapping was corrected to preserve one `anchor_` prefix under `reader_v2_`;
- the test stub was aligned to accepted parser behavior;
- source identity was regenerated;
- the entire 45-case suite was rerun;
- final result remained `45 PASS / 0 FAIL`.

No live action occurred.

## Frozen-byte / import evidence

`identity/GITHUB-FROZEN-BYTE-VERIFICATION.json` records independently retrieved Git blobs for the explicitly frozen production files, frozen Step-2 runtime, frozen v2 acquisition and its accepted direct bootstrap/config dependencies.

The recorded blobs are equal across the two accepted refs checked:
- `caad383d9002a2c76a5d20b2a024dc234cb043dd`
- `6a33c653326466fb8eb21e7f42dc2a2a9648e726`

The frozen v2 acquisition blob remains:

`1a6853596c52553f5c734539e59110307659a5c9`

## Historical boundaries

Historical G4 remains immutable consumed HOLD.

SV-B remains consumed and must never be rerun.

G5 remains NOT AUTHORIZED.

This candidate grants no live authorization.
