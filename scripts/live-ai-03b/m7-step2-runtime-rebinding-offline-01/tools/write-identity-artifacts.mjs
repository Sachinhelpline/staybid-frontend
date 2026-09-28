#!/usr/bin/env node
// Regenerates identity/RUNTIME-CONTENT-MANIFEST.json and identity/STEP2-PRESERVATION-BINDING-TEMPLATE.json
// from the runtime's OWN measured bytes. OFFLINE; writes only inside this Step-2 directory. `--check`
// verifies the committed files instead (exit 1 on drift).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../identity/v2-source-identity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const m = S.measureRuntimeManifest();
const manifest = {
  contract: "Step2RuntimeContentManifestV1", domain: "staybid.live-ai.m7-step2.runtime-manifest.v1", step2_dir: S.STEP2_DIR,
  files: m.files, runtime_manifest_digest: m.digest,
  note: "PIN C binds THESE bytes. Recompute with measureRuntimeManifest(); the later preservation binding must carry this digest.",
};
const template = {
  contract: S.STEP2_BINDING_CONTRACT,
  status_now: S.STEP2_PIN_STATUS_REQUIRED,
  placeholder: S.STEP2_RUNTIME_PIN_PLACEHOLDER,
  later_binding_shape: {
    contract: S.STEP2_BINDING_CONTRACT, status: S.STEP2_PIN_STATUS_PRESERVED, provenance: S.STEP2_TRUSTED_PROVENANCE,
    commit: "<40-hex of the future Owner-reviewed preservation commit: NOT KNOWN, NOT FABRICATED>",
    tree: "<40-hex tree of that commit>",
    step2_dir_tree: `<40-hex git tree of ${S.STEP2_DIR} at that commit>`,
    runtime_manifest_digest: m.digest,
  },
  how_to_produce: `node ${S.STEP2_DIR}/tools/verify-step2-preservation.mjs --repo <clone> --commit <sha>   (read-only git)`,
  verification_rules: [
    "the commit resolves and is NONE of 9270c282 / 4f390b74 / 2b69ce28 (nor their trees)",
    "4f390b74 (PIN B) is an ancestor of the commit",
    `every path changed 4f390b74..commit is an ADDITION under ${S.STEP2_DIR} (no frozen file modified or deleted)`,
    "the sha256 of each runtime module at the commit reproduces runtime_manifest_digest = measureRuntimeManifest() of the running code",
    "the binding reaches the runtime ONLY through the Owner-controlled V2 production authority (validateProvisionedAuthorityV2 / validateReaderOnlyAuthorityV2); the provenance string alone is never authority",
    "until then every V2 consumer fails closed with step2_runtime_pin_required_after_preservation",
  ],
  expected_runtime_manifest_digest: m.digest,
};
const out = { "identity/RUNTIME-CONTENT-MANIFEST.json": manifest, "identity/STEP2-PRESERVATION-BINDING-TEMPLATE.json": template };
if (process.argv.includes("--check")) {
  let bad = 0;
  for (const [p, o] of Object.entries(out)) { let cur = ""; try { cur = readFileSync(join(ROOT, p), "utf8"); } catch {} if (cur !== JSON.stringify(o, null, 2) + "\n") { bad++; console.log("DRIFT " + p); } }
  console.log(bad ? "identity artifacts: DRIFT" : `identity artifacts: OK (runtime manifest ${m.digest})`); process.exit(bad ? 1 : 0);
}
for (const [p, o] of Object.entries(out)) writeFileSync(join(ROOT, p), JSON.stringify(o, null, 2) + "\n");
console.log(m.digest);
