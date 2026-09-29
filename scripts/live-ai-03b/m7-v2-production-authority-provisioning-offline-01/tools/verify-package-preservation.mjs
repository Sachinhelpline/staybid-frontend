#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — in-package preservation DIAGNOSTIC. OFFLINE, READ-ONLY git.
//
// ⚠ NON-AUTHORITATIVE (R1). This file ships INSIDE the package that a future preservation commit adds, and it reads
// its expected values from identity/PACKAGE-CONTENT-MANIFEST.json in that same package. A target commit can
// therefore change runtime + manifest + identity logic + this verifier together and stay self-consistent, so a PASS
// here proves internal consistency only. It NEVER decides preservation acceptance. The AUTHORITATIVE check is the
// external review-bundle verifier (verify-preservation-external.mjs + REVIEW-ANCHOR.json), which lives OUTSIDE the
// target commit, is identified by the independently recorded review-bundle SHA-256, and treats the target commit as
// untrusted input. See README.md §6.
//
// The preservation commit of this package does NOT exist and is NOT fabricated. As a diagnostic it checks that a
// commit X is internally consistent with this package's own manifest (never a PIN C):
//   1. X resolves, is not the baseline 0afe4b6b, and 0afe4b6b is an ancestor of X;
//   2. every path changed 0afe4b6b..X is an ADDITION under the package dir (nothing existing modified / deleted);
//   3. the Step-2 dir tree at X is unchanged (bacac441) and the preserved Step-2 verifier still re-derives PIN C;
//   4. every frozen dependency src/ imports has, at X, the recorded sha256 (identity/PACKAGE-CONTENT-MANIFEST.json);
//   5. the package runtime + content digests recomputed from the bytes AT X equal the reviewed values.
// Usage: node verify-package-preservation.mjs --repo <clone> --commit <sha>
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStep2Preservation, makeGit as makeStep2Git } from "../../m7-step2-runtime-rebinding-offline-01/tools/verify-step2-preservation.mjs";
import { PACKAGE_DIR, PACKAGE_BINDING_CONTRACT, PACKAGE_TRUSTED_PROVENANCE, BASELINE, measureFrom } from "./package-identity.mjs";

const HEX40 = /^[0-9a-f]{40}$/;
const STEP2_DIR = "scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const REVIEWED = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../identity/PACKAGE-CONTENT-MANIFEST.json"), "utf8"));

/** Pure verification over an injected read-only git interface (+ listFiles(rev, dir) → paths). */
export function verifyPackagePreservation(git, commitArg, opts) {
  const reviewed = (opts && opts.reviewed) || REVIEWED;
  const fail = (reason) => ({ ok: false, reason });
  const commit = git.revParse(`${commitArg}^{commit}`);
  if (!commit || !HEX40.test(commit)) return fail("commit_absent");
  if (commit === BASELINE.commit) return fail("commit_is_the_baseline");
  if (!git.isAncestor(BASELINE.commit, commit)) return fail("baseline_not_ancestor");
  const changes = git.diffNameStatus(BASELINE.commit, commit);
  if (changes.length === 0) return fail("no_package_additions");
  for (const c of changes) {
    if (!c.path.startsWith(PACKAGE_DIR + "/")) return fail("non_package_path_changed:" + c.path.slice(0, 160));
    if (c.status !== "A") return fail("package_path_not_additive:" + c.path.slice(0, 160));
  }
  if (git.revParse(`${commit}:${STEP2_DIR}`) !== BASELINE.step2_pin_c.step2_dir_tree) return fail("step2_tree_changed");
  const s2 = verifyStep2Preservation(git, BASELINE.step2_pin_c.commit);
  if (!s2.ok || s2.binding.runtime_manifest_digest !== BASELINE.step2_pin_c.runtime_manifest_digest) return fail("step2_pin_c_not_rederivable");
  for (const d of reviewed.frozen_dependencies) {
    let b; try { b = git.blobBytes(commit, d.path); } catch { return fail("frozen_dependency_absent:" + d.path.slice(0, 160)); }
    if (sha(b) !== d.sha256) return fail("frozen_dependency_changed:" + d.path.slice(0, 160));
  }
  const list = git.listFiles(commit, PACKAGE_DIR);
  let m;
  try { m = measureFrom(list, (p) => git.blobBytes(commit, `${PACKAGE_DIR}/${p}`), (p) => git.blobBytes(commit, p)); } catch { return fail("package_file_unreadable"); }
  if (m.package_runtime_digest !== reviewed.package_runtime_digest) return fail("package_runtime_digest_differs");
  if (m.package_content_digest !== reviewed.package_content_digest) return fail("package_content_digest_differs");
  const tree = git.revParse(`${commit}^{tree}`), dirTree = git.revParse(`${commit}:${PACKAGE_DIR}`);
  if (!HEX40.test(String(tree)) || !HEX40.test(String(dirTree))) return fail("tree_unresolvable");
  return { ok: true, binding: { contract: PACKAGE_BINDING_CONTRACT, status: "PRESERVED", provenance: PACKAGE_TRUSTED_PROVENANCE, commit, tree, package_dir_tree: dirTree,
    package_runtime_digest: m.package_runtime_digest, package_content_digest: m.package_content_digest,
    base_commit: BASELINE.commit, step2_pin_c_commit: BASELINE.step2_pin_c.commit, step2_dir_tree: BASELINE.step2_pin_c.step2_dir_tree } };
}

/** Read-only git adapter: the preserved Step-2 adapter + ls-tree listing of the package dir at a revision. */
export function makeGit(repo) {
  const g = makeStep2Git(repo);
  return { ...g, listFiles: (rev, dir) => execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", rev, "--", dir], { encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n").filter(Boolean).map((p) => p.slice(dir.length + 1)) };
}

function main(argv) {
  const at = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const repo = at("--repo"), commit = at("--commit");
  if (!repo || !commit) { process.stderr.write("usage: verify-package-preservation.mjs --repo <clone> --commit <sha>\n"); process.exit(2); }
  const r = verifyPackagePreservation(makeGit(repo), commit);
  process.stdout.write(JSON.stringify({ authoritative: false, note: "NON-AUTHORITATIVE in-package diagnostic (internal consistency only). Preservation acceptance is decided only by the external review-bundle verifier.", result: r }, null, 2) + "\n");
  process.exit(r.ok ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
