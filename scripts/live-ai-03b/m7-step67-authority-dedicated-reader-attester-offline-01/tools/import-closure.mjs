#!/usr/bin/env node
// OFFLINE review tool — static ES-module import closure of this package (src/, controller/, tests/, tools/).
// Returns repo-relative paths split into PACKAGE files and ACCEPTED dependency files (outside the package).
// Bare specifiers (node:*, pg) are reported separately; nothing is executed.
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..", "..");
const SPEC = /(?:^|[^\w$.])(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']|(?:^|[^\w$.])import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[^\w$.])import\s*["']([^"']+)["']/gm;
const VALID_SPEC = /^(node:[a-z_/]+|\.{1,2}\/[A-Za-z0-9_./-]+\.mjs|[a-z@][a-z0-9@/._-]*)$/;
const toRepo = (abs) => relative(REPO_ROOT, abs).split(sep).join("/");

export function listPackageFiles(root = PACKAGE_ROOT) {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n), st = statSync(p);
      if (st.isDirectory()) { if (n !== "node_modules" && n !== "dist") walk(p); }
      else if (!n.endsWith(".zip")) out.push(p);
    }
  })(root);
  return out;
}

export function importClosure(entries = listPackageFiles().filter((p) => p.endsWith(".mjs"))) {
  const seen = new Set(), bare = new Set(), queue = entries.map((p) => resolve(p));
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(SPEC)) {
      const s = m[1] || m[2] || m[3];
      if (!s || !VALID_SPEC.test(s)) continue;   // ignore text that merely looks like an import inside a string / regex literal
      if (!s.startsWith(".")) { bare.add(s); continue; }
      const t = resolve(dirname(f), s);
      if (!seen.has(t)) queue.push(t);
    }
  }
  const all = Array.from(seen).map((p) => realpathSync(p)).sort();
  const pkgPrefix = realpathSync(PACKAGE_ROOT) + sep;
  return {
    packageFiles: all.filter((p) => p.startsWith(pkgPrefix)).map(toRepo),
    acceptedDependencies: all.filter((p) => !p.startsWith(pkgPrefix)).map(toRepo),
    bareSpecifiers: Array.from(bare).sort(),
  };
}

const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] || "")); } catch { return false; } })();
if (isMain) console.log(JSON.stringify(importClosure(), null, 2));
