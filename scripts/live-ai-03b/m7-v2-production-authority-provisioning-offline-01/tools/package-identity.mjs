#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — package identity (content manifest). OFFLINE, read-only
// except for writing its own two identity files (identity/PACKAGE-CONTENT-MANIFEST.json and
// identity/PACKAGE-PRESERVATION-BINDING-TEMPLATE.json). `--check` verifies them instead (exit 1 on drift).
//
// This package is NOT covered by the Step-2 PIN C (0afe4b6b) and is NOT a PIN C. Its own identity:
//   • package_runtime_digest — over src/*.mjs (the modules that execute in the future trusted entrypoint);
//   • package_content_digest — over every package file except the regenerated tests/out/** and the two
//     identity files themselves;
//   • frozen_dependencies    — every predecessor module src/ imports (path + sha256 of the bytes it runs against);
//   • baseline               — the exact commit these bytes were built on (0afe4b6b) + PIN-C binding reference.
//
// ⚠ R1: these identity files live INSIDE the package a future preservation commit adds, so they are descriptive,
// never an acceptance criterion for that commit. Preservation acceptance is decided ONLY by the external
// review-bundle verifier against its REVIEW-ANCHOR.json (outside the target commit). See README.md §6.
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = "scripts/live-ai-03b/m7-v2-production-authority-provisioning-offline-01";
export const PACKAGE_MANIFEST_CONTRACT = "V2ProductionAuthorityProvisioningContentManifestV1";
export const PACKAGE_BINDING_CONTRACT = "V2ProductionAuthorityProvisioningPreservationBindingV1";
export const PACKAGE_TRUSTED_PROVENANCE = "trusted-approved-authority-provisioning-preservation-receipt-v1";
export const PACKAGE_DOMAIN_RUNTIME = "staybid.live-ai.m7-v2-authority-provisioning.runtime.v1";
export const PACKAGE_DOMAIN_CONTENT = "staybid.live-ai.m7-v2-authority-provisioning.content.v1";
export const BASELINE = Object.freeze({
  commit: "0afe4b6bedeb12f756cc9027367d323acb264464", tree: "e7bb3733cb3206e5ad1a1b0e9121b7010741734f",
  step2_pin_c: Object.freeze({ contract: "Step2RuntimePreservationBindingV2", commit: "0afe4b6bedeb12f756cc9027367d323acb264464",
    step2_dir_tree: "bacac441271856966c9b7983c4fa1625f7a6a2d2", runtime_manifest_digest: "64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f" }),
});
const IDENTITY_FILES = new Set(["identity/PACKAGE-CONTENT-MANIFEST.json", "identity/PACKAGE-PRESERVATION-BINDING-TEMPLATE.json"]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "../../..");

const sha = (b) => createHash("sha256").update(b).digest("hex");
const canon = (v) => (Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object"
  ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v));
export const digestOf = (domain, files) => sha(canon({ domain, files: [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(({ path, sha256 }) => ({ path, sha256 })) }));

function walk(d) { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }

/** Pure-ish measurement over a byte reader `read(relPathInPackage) → Buffer` and a file list. */
export function measureFrom(list, read, readRepo) {
  const rel = list.filter((p) => !p.startsWith("tests/out/") && !IDENTITY_FILES.has(p)).sort();
  const content = rel.map((p) => ({ path: p, sha256: sha(read(p)) }));
  const runtime = content.filter((f) => /^src\/[^/]+\.mjs$/.test(f.path));
  const deps = new Set();
  for (const f of runtime) for (const m of read(f.path).toString("utf8").matchAll(/from\s+"(\.\.\/\.\.\/[^"]+)"/g)) {
    deps.add(posix.normalize(posix.join(PACKAGE_DIR, "src", m[1])));
  }
  const frozen_dependencies = [...deps].sort().map((p) => ({ path: p, sha256: sha(readRepo(p)), covered_by: p.startsWith("scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01/") ? "step2_pin_c_0afe4b6b"
    : p.startsWith("scripts/live-ai-03b/m7-v2-executor-attester-issuer-offline-01/") ? "executor_attester_issuer_preservation_02345082" : "baseline_tree_0afe4b6b" }));
  return { content, runtime, frozen_dependencies, package_runtime_digest: digestOf(PACKAGE_DOMAIN_RUNTIME, runtime), package_content_digest: digestOf(PACKAGE_DOMAIN_CONTENT, content) };
}
export function measurePackage() {
  const list = walk(ROOT).map((p) => relative(ROOT, p).split("\\").join("/"));
  return measureFrom(list, (p) => readFileSync(join(ROOT, p)), (p) => readFileSync(join(REPO, p)));
}

function artifacts() {
  const m = measurePackage();
  const manifest = {
    contract: PACKAGE_MANIFEST_CONTRACT, package_dir: PACKAGE_DIR, baseline: BASELINE,
    statement: "Additive package. The preserved Step-2 bytes (PIN C 0afe4b6b, runtime manifest 64c70317…) are imported, never modified; this package is NOT covered by PIN C and is NOT a PIN C.",
    package_runtime_digest: m.package_runtime_digest, package_content_digest: m.package_content_digest,
    runtime_files: m.runtime, content_files: m.content, frozen_dependencies: m.frozen_dependencies,
  };
  const template = {
    contract: PACKAGE_BINDING_CONTRACT, status_now: "REQUIRED_AFTER_AUTHORITY_PACKAGE_PRESERVATION",
    placeholder: { contract: PACKAGE_BINDING_CONTRACT, status: "REQUIRED_AFTER_AUTHORITY_PACKAGE_PRESERVATION", commit: null, tree: null, package_dir_tree: null },
    later_binding_shape: {
      contract: PACKAGE_BINDING_CONTRACT, status: "PRESERVED", provenance: PACKAGE_TRUSTED_PROVENANCE,
      commit: "<40-hex of the future Owner-reviewed preservation commit of THIS package: NOT KNOWN, NOT FABRICATED>",
      tree: "<40-hex tree of that commit>", package_dir_tree: `<40-hex git tree of ${PACKAGE_DIR} at that commit>`,
      package_runtime_digest: m.package_runtime_digest, package_content_digest: m.package_content_digest,
      base_commit: BASELINE.commit, step2_pin_c_commit: BASELINE.step2_pin_c.commit, step2_dir_tree: BASELINE.step2_pin_c.step2_dir_tree,
    },
    authoritative_verifier: "EXTERNAL review bundle only: verify-preservation-external.mjs + its fixed sibling REVIEW-ANCHOR.json, run FROM the independently recorded review bundle (never from the target commit). The target commit is untrusted input and cannot define its own acceptance criteria.",
    how_to_produce: "node <verified review bundle>/verify-preservation-external.mjs --repo <clone> --commit <sha>   (read-only git; no other arguments or override environment accepted)",
    in_package_diagnostic: `node ${PACKAGE_DIR}/tools/verify-package-preservation.mjs --repo <clone> --commit <sha>   (NON-AUTHORITATIVE: internal consistency only)`,
    verification_rules: [
      "AUTHORITATIVE: the external verifier compares the target commit against the externally anchored reviewed bytes (exact file set, per-file SHA-256, runtime/content/manifest digests, frozen dependencies, baseline tree + package subtree); the in-package rules below are diagnostic only",
      `${BASELINE.commit.slice(0, 8)} (the reviewed baseline = Step-2 PIN C) is an ancestor of the commit, and the commit is not ${BASELINE.commit.slice(0, 8)} itself`,
      `every path changed ${BASELINE.commit.slice(0, 8)}..commit is an ADDITION under ${PACKAGE_DIR} (no existing file modified or deleted)`,
      `the Step-2 dir tree at the commit is still ${BASELINE.step2_pin_c.step2_dir_tree.slice(0, 8)} and the preserved Step-2 verifier still re-derives PIN C ${BASELINE.step2_pin_c.commit.slice(0, 8)} unchanged`,
      "every frozen dependency imported by src/ has, at the commit, exactly the recorded sha256",
      "package_runtime_digest and package_content_digest recomputed from the bytes at the commit equal the reviewed values",
      "this binding is NOT a PIN C and never satisfies verifyStep2RuntimePin; it identifies only this additive authority-provisioning package",
    ],
  };
  return { "identity/PACKAGE-CONTENT-MANIFEST.json": manifest, "identity/PACKAGE-PRESERVATION-BINDING-TEMPLATE.json": template, m };
}

function main(argv) {
  const out = artifacts(); const m = out.m; delete out.m;
  if (argv.includes("--check")) {
    let bad = 0;
    for (const [p, o] of Object.entries(out)) { let cur = ""; try { cur = readFileSync(join(ROOT, p), "utf8"); } catch {} if (cur !== JSON.stringify(o, null, 2) + "\n") { bad++; console.log("DRIFT " + p); } }
    console.log(bad ? "package identity: DRIFT" : `package identity: OK (runtime ${m.package_runtime_digest} · content ${m.package_content_digest})`);
    process.exit(bad ? 1 : 0);
  }
  for (const [p, o] of Object.entries(out)) writeFileSync(join(ROOT, p), JSON.stringify(o, null, 2) + "\n");
  console.log(`${m.package_runtime_digest} ${m.package_content_digest}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
