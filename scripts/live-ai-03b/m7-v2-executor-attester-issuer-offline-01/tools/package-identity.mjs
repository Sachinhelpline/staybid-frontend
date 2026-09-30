#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — package identity (content manifest). ⚠ NON-AUTHORITATIVE.
//
// Writes identity/PACKAGE-CONTENT-MANIFEST.json (or `--check` verifies it; exit 1 on drift). It DESCRIBES this
// package; it is never an acceptance criterion for a future preservation commit, because it lives INSIDE the package
// that commit would add (a target could change runtime + this manifest + this tool together and stay self-consistent).
// Preservation acceptance is decided ONLY by the EXTERNAL review-bundle verifier against its REVIEW-ANCHOR.json,
// which lives outside the target commit and is identified by the independently recorded bundle SHA-256.
//
//   • package_runtime_digest — over src/*.mjs (the modules the future service executes);
//   • package_content_digest — over every package file except tests/out/** and this manifest;
//   • frozen_dependencies    — every frozen module src/ imports (transitively within ../../), with its sha256.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = "scripts/live-ai-03b/m7-v2-executor-attester-issuer-offline-01";
export const MANIFEST_CONTRACT = "M7V2ExecutorAttesterIssuerContentManifestV1";
export const DOMAIN_RUNTIME = "staybid.live-ai.m7-v2-executor-attester-issuer.runtime.v1";
export const DOMAIN_CONTENT = "staybid.live-ai.m7-v2-executor-attester-issuer.content.v1";
export const MANIFEST_PATH = "identity/PACKAGE-CONTENT-MANIFEST.json";
export const BASELINE = Object.freeze({ commit: "dcab7c5b8884db4826d3fc9188ae042a1ed298d6", tree: "c5b2bb3a22e919475caa1f379f9f6cdb6a186102",
  authority_package_tree: "c22ca7cf4b67aaa374016e3da5827ca121d26726", step2_dir_tree: "bacac441271856966c9b7983c4fa1625f7a6a2d2",
  step2_pin_c: "0afe4b6bedeb12f756cc9027367d323acb264464" });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "../../..");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const canon = (v) => (Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object"
  ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v));
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
export const digestOf = (domain, files) => sha(canon({ domain, files: [...files].sort(byPath).map(({ path, sha256 }) => ({ path, sha256 })) }));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function measure() {
  const list = walk(ROOT).map((p) => relative(ROOT, p).split("\\").join("/")).filter((p) => !p.startsWith("tests/out/") && p !== MANIFEST_PATH).sort();
  const content = list.map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
  const runtime = content.filter((f) => /^src\/[^/]+\.mjs$/.test(f.path));
  // transitive frozen dependency closure (repo-relative), following only relative imports
  const deps = new Set(); const queue = runtime.map((f) => join(ROOT, f.path)); const seen = new Set();
  while (queue.length) {
    const file = queue.shift(); if (seen.has(file)) continue; seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
      const t = resolve(dirname(file), m[1]); if (!existsSync(t)) continue;
      const rel = relative(REPO, t).split("\\").join("/");
      if (!rel.startsWith(PACKAGE_DIR + "/")) deps.add(rel);
      queue.push(t);
    }
  }
  const frozen_dependencies = [...deps].sort().map((p) => ({ path: p, sha256: sha(readFileSync(join(REPO, p))) }));
  return { content, runtime, frozen_dependencies, package_runtime_digest: digestOf(DOMAIN_RUNTIME, runtime), package_content_digest: digestOf(DOMAIN_CONTENT, content) };
}

function manifest() {
  const m = measure();
  return { contract: MANIFEST_CONTRACT, authoritative: false, package_dir: PACKAGE_DIR, baseline: BASELINE,
    statement: "Additive package on top of dcab7c5b. DESCRIPTIVE ONLY: preservation acceptance is decided by the external review-bundle verifier, never by this file.",
    package_runtime_digest: m.package_runtime_digest, package_content_digest: m.package_content_digest,
    runtime_files: m.runtime, content_files: m.content, frozen_dependencies: m.frozen_dependencies };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const o = manifest(); const s = JSON.stringify(o, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    let cur = ""; try { cur = readFileSync(join(ROOT, MANIFEST_PATH), "utf8"); } catch {}
    if (cur !== s) { console.log("package identity (diagnostic): DRIFT"); process.exit(1); }
    console.log(`package identity (diagnostic): OK (runtime ${o.package_runtime_digest} · content ${o.package_content_digest} · ${o.frozen_dependencies.length} frozen deps)`);
  } else { writeFileSync(join(ROOT, MANIFEST_PATH), s); console.log(`${o.package_runtime_digest} ${o.package_content_digest}`); }
}
