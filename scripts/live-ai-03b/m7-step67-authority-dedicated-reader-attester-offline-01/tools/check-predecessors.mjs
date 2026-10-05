#!/usr/bin/env node
// OFFLINE review tool — proves every ACCEPTED dependency this package imports is byte-identical to the accepted baseline.
//   repo mode (a .git with HEAD = baseline): git blob of the working file == blob recorded at HEAD, AND no tracked file
//             is modified (git status shows only untracked additions);
//   zip mode  (no .git): sha256 of each extracted file == EVIDENCE-MANIFEST.json acceptedDependencies (which were
//             themselves verified against the baseline commit's blobs when the manifest was built).
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { importClosure, REPO_ROOT, PACKAGE_ROOT } from "./import-closure.mjs";

export const BASELINE = Object.freeze({ head: "1f5e8f66fe5892253d4b68eab006fe3e77107ee4", tree: "ade2cf551a7fd0a2e06233f3ea5552328f784860",
  parent: "023450821bc7dbf75165acbf3ee349a3d5984b1b", branch: "claude/live-ai-budget-01-price-catalog-inactive-artifact-01" });
export const gitBlobSha1 = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from("blob " + buf.length + "\0"), buf])).digest("hex");
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const git = (args) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

export function repoMode() {
  if (!existsSync(join(REPO_ROOT, ".git"))) return false;
  try { return git(["rev-parse", "HEAD"]) === BASELINE.head; } catch { return false; }
}
export function checkPredecessors() {
  const deps = importClosure().acceptedDependencies;
  const bad = [];
  if (repoMode()) {
    for (const p of deps) {
      let head = null; try { head = git(["rev-parse", "HEAD:" + p]); } catch {}
      if (!head || head !== gitBlobSha1(readFileSync(join(REPO_ROOT, p)))) bad.push(p);
    }
    const modified = git(["status", "--porcelain", "--untracked-files=no"]);
    return { ok: bad.length === 0 && modified === "", mode: "repo", checked: deps.length, mismatched: bad, trackedModifications: modified ? modified.split("\n").length : 0 };
  }
  const mpath = join(PACKAGE_ROOT, "EVIDENCE-MANIFEST.json");
  if (!existsSync(mpath)) return { ok: false, mode: "zip", reason: "manifest_absent" };
  const m = JSON.parse(readFileSync(mpath, "utf8"));
  const want = new Map((m.files || []).filter((f) => f.role === "accepted-dependency").map((f) => [f.repoPath, f.sha256]));
  for (const p of deps) if (!existsSync(join(REPO_ROOT, p)) || want.get(p) !== sha256(readFileSync(join(REPO_ROOT, p)))) bad.push(p);
  return { ok: bad.length === 0 && want.size === deps.length, mode: "zip", checked: deps.length, mismatched: bad, manifestDependencyCount: want.size };
}
const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] || "")); } catch { return false; } })();
if (isMain) { const r = checkPredecessors(); console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1; }
