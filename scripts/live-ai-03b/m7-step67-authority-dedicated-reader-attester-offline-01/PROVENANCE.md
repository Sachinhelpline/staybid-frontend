# Provenance

- **Programme:** STAYBID LIVE-AI-03B · M7 · Step6/7. This is the dedicated Authority reader-attester and the
  Authority-host V2 effective-privilege / dual-client identity binding.
- **Mode:** STRICT OFFLINE BUILD. Nothing in this build:
  - connected to Railway, a live database or any attester;
  - read a variable or secret;
  - generated a production key or secret;
  - deployed, restarted or mutated anything;
  - ran ALTER ROLE, SQL03 or Phase A;
  - touched the gateway, a provider or CORE-PROD;
  - committed, pushed or opened a PR.
- **Baseline:**
  - repository `Sachinhelpline/staybid-frontend`;
  - branch `claude/live-ai-budget-01-price-catalog-inactive-artifact-01`;
  - HEAD `1f5e8f66fe5892253d4b68eab006fe3e77107ee4`, tree `ade2cf551a7fd0a2e06233f3ea5552328f784860`;
  - parent `023450821bc7dbf75165acbf3ee349a3d5984b1b` (the executor attester's deployed source commit).
- **New files only.** This package directory is NEW and untracked at the baseline. No tracked or accepted file
  was modified: `tools/check-predecessors.mjs` proves zero tracked modifications in repo mode, and test S04
  proves every imported accepted dependency equals its baseline blob.
- **Accepted dependencies:** the exact static import closure (52 files) is listed in `EVIDENCE-MANIFEST.json` with
  sha256 and git-blob values, each verified against `HEAD:<path>` when the manifest was built. They are shipped
  byte-identical in the ZIP at their repository paths.
- **Unchanged accepted code reused by the future dedicated service:**
  `private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs` and its accepted
  dependencies. They are not modified, and they are not part of this package's import closure (they run as a
  separate service). The dedicated-attester config path IS exercised offline through the accepted
  `production-config.mjs` (test C08).
- **Live target pins (non-secret):**
  - project `4ad1abb3-823a-4acf-b889-6d34ae46d7f9`;
  - environment `aa397bd7-b316-4fd8-b05a-0a5f6c5e3abc`;
  - Postgres `b7362594-a01b-4623-a982-394707a6cec2`;
  - Authority `1f7daf27-7489-410f-8969-da758459fb4d`;
  - executor attester `c74d7558-2e04-46fc-b5a1-871b5931b0cc` (deployment `52c7c0b2-…`, commit `0234508…`);
  - M5 reader attester `3a7e5f80-…` and M5 reader host `88c74a23-…`: FROZEN, pins only;
  - CORE-PROD `04c8b523-…` / `1fbd7632-…`: HARD HOLD.
- **Samples:** `samples/*.synthetic.json` come from real OFFLINE runs (loopback accepted attesters with TEST-ONLY
  per-run keys, and the mock Railway CLI). They illustrate the shape only.
