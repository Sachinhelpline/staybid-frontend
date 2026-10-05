#!/usr/bin/env node
// OFFLINE review tool — writes EVIDENCE-MANIFEST.json (deterministic: sorted, no timestamps). Run ONLY in repo mode at
// the baseline HEAD: every accepted dependency must equal the baseline commit's blob, else the build refuses.
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { importClosure, listPackageFiles, REPO_ROOT, PACKAGE_ROOT } from "./import-closure.mjs";
import { BASELINE, gitBlobSha1, sha256, repoMode } from "./check-predecessors.mjs";
import { PACKAGE_DIR, STEP67_VERSION } from "../src/constants.mjs";

export const MANIFEST_SCHEMA = "staybid-m7-step67-evidence-manifest-v1";
export function buildManifest() {
  if (!repoMode()) throw new Error("build_manifest_requires_repo_mode_at_baseline");
  const c = importClosure();
  const pkg = listPackageFiles().map((p) => p.slice(REPO_ROOT.length + 1)).filter((p) => p !== PACKAGE_DIR + "/EVIDENCE-MANIFEST.json").sort();
  const files = [];
  for (const p of pkg) { const b = readFileSync(join(REPO_ROOT, p)); files.push({ repoPath: p, role: "package", sha256: sha256(b), gitBlobSha1: gitBlobSha1(b), bytes: b.length }); }
  for (const p of c.acceptedDependencies) {
    const b = readFileSync(join(REPO_ROOT, p));
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD:" + p], { encoding: "utf8" }).trim();
    if (head !== gitBlobSha1(b)) throw new Error("accepted_dependency_not_byte_identical:" + p);
    files.push({ repoPath: p, role: "accepted-dependency", sha256: sha256(b), gitBlobSha1: head, bytes: b.length, baselineBlobVerified: true });
  }
  return {
    schema: MANIFEST_SCHEMA, version: STEP67_VERSION, packageDir: PACKAGE_DIR, baseline: BASELINE,
    counts: { packageFiles: files.filter((f) => f.role === "package").length, acceptedDependencies: c.acceptedDependencies.length },
    bareSpecifiers: c.bareSpecifiers, bareSpecifierNote: "node:* built-ins; 'pg' is resolved only by the accepted pg physical factories at future production run time inside the deployed Authority (repo dependency pg ^8.11.5); no offline test loads it.",
    files, liveAuthorization: "THIS_MANIFEST_GRANTS_NO_AUTHORIZATION",
  };
}
const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] || "")); } catch { return false; } })();
if (isMain) { const m = buildManifest(); writeFileSync(join(PACKAGE_ROOT, "EVIDENCE-MANIFEST.json"), JSON.stringify(m, null, 2) + "\n"); console.log(JSON.stringify(m.counts)); }
