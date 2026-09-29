# Future deployment pin notes (§25)

- **Currently deployed source:** `f48936f067a7fc087d436583a02eccb2ab53f720`, M5 tree digest `8993adff…` over 128
  files. The digest is sha256 over sorted `relpath\0sha256\n` for every file under `scripts/live-ai-03b`, as
  computed by `m5-source-pin.mjs`.
- **Revision:** v2 (shutdown containment) supersedes v1 (package OFFLINE-01 `0de6cdd6…`).
- **Baseline of this remediation:** branch `claude/live-ai-budget-01-price-catalog-inactive-artifact-01` @
  `f5ec5807014442884c1d156c51a4edd1563b25bd`. The five runtime files are identical to `f48936f0`.
- **Future preserved commit SHA:** **UNKNOWN.** No commit exists; the changes are uncommitted in scratch.
- **Future M5 tree digest:** **UNKNOWN.** It depends on the exact preserved tree, including this evidence
  directory. It is deliberately not computed or fabricated here.
- **M5 runner / `m5-runtime` pins:** any accepted runner that pins `SOURCE_PIN` or the 128-file tree digest must
  be re-pinned to the future preserved commit and digest, in a separately authorized packet. Suites that pin the
  **old** values are intentionally-old pins (classification in `PREDECESSOR-CLASSIFICATION.md`). They are not
  regressions of this fix.
- **Start command:** unchanged
  (`node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs`).
- **Environment:** no new variable, no new secret, no new dependency.
- **Operational expectations after a future deploy:**
  - a clock stall produces the markers `M5_ATTESTER_CLOCK_INVALIDATED` → `SIGNING_DISABLED` →
    `RECOVERY_SCHEDULED` → `RECOVERY_STARTED` → `RECOVERY_PASS` + `SIGNING_RESTORED`, with the first attempt
    after about 5 s;
  - a peer invalidation produces `M5_ATTESTER_PEER_INVALIDATED` with `recovery: controlled_restart_required`;
  - `M5_ATTESTER_STATE` is emitted every 60 s.
- **The reader** (`88c74a23`, deployment `0d05cc9b`, CRASHED) is unaffected by this source change. Its recovery
  remains a separately authorized controlled restart once a fixed attester is deployed.
