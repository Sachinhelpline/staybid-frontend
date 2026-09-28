#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — PIN C verifier: how the LATER Step-2 preservation receipt is verified.
// OFFLINE, READ-ONLY git. No network, no write, no commit. The Step-2 preservation commit does NOT exist
// yet and is NOT fabricated here; this tool is what the Owner runs AFTER that commit exists.
// A candidate commit X is accepted only if ALL hold:
//   1. X resolves to a commit and is NONE of the non-Step-2 commits (9270c282 / 4f390b74 / 2b69ce28);
//   2. the gateway deploy source 4f390b74 is an ANCESTOR of X (the runtime is preserved on top of PIN B);
//   3. every path changed between 4f390b74 and X is an ADDITION under the Step-2 directory (no frozen
//      predecessor file — M1–M6, M7 Step 1, V1 runtime, gateway closure — is modified or deleted);
//   4. the Step-2 runtime module bytes at X hash to EXACTLY the manifest this runtime measures of itself
//      (measureRuntimeManifest) — i.e. the commit preserves THESE reviewed bytes;
// and then emits the Step2RuntimePreservationBindingV1 the Owner-controlled authority supplies to the runtime.
// Usage: node verify-step2-preservation.mjs --repo <clone> --commit <sha>
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DERIVATION_BASE, GATEWAY_DEPLOY_SOURCE_V2, SUPERSEDED_GATEWAY_SOURCE_V1, STEP2_DIR, RUNTIME_MANIFEST_FILES, STEP2_BINDING_CONTRACT,
  STEP2_PIN_STATUS_PRESERVED, STEP2_TRUSTED_PROVENANCE, manifestDigestOf, measureRuntimeManifest } from "../identity/v2-source-identity.mjs";

const HEX40 = /^[0-9a-f]{40}$/;
export function makeGit(repo) {
  const run = (args, enc = "utf8") => execFileSync("git", ["-C", repo, ...args], { encoding: enc, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  return {
    revParse: (x) => { try { return run(["rev-parse", "--verify", "--quiet", x]).trim(); } catch { return null; } },
    isAncestor: (a, b) => { try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; } catch { return false; } },
    diffNameStatus: (a, b) => run(["diff", "--no-renames", "--name-status", a, b]).split("\n").filter(Boolean).map((l) => { const [st, ...p] = l.split("\t"); return { status: st, path: p.join("\t") }; }),
    blobBytes: (rev, path) => run(["cat-file", "blob", `${rev}:${path}`], "buffer"),
  };
}

/** Pure verification over an injected read-only git interface. */
export function verifyStep2Preservation(git, commitArg, opts) {
  const measured = (opts && opts.measured) || measureRuntimeManifest();
  const fail = (reason) => ({ ok: false, reason });
  const commit = git.revParse(`${commitArg}^{commit}`);
  if (!commit || !HEX40.test(commit)) return fail("commit_absent");
  if ([DERIVATION_BASE.commit, GATEWAY_DEPLOY_SOURCE_V2.commit, SUPERSEDED_GATEWAY_SOURCE_V1.commit].includes(commit)) return fail("commit_is_a_non_step2_pin");
  if (!git.isAncestor(GATEWAY_DEPLOY_SOURCE_V2.commit, commit)) return fail("gateway_deploy_source_not_ancestor");
  const changes = git.diffNameStatus(GATEWAY_DEPLOY_SOURCE_V2.commit, commit);
  if (changes.length === 0) return fail("no_step2_additions");
  for (const c of changes) {
    if (!c.path.startsWith(STEP2_DIR + "/")) return fail("non_step2_path_changed:" + c.path.slice(0, 160));
    if (c.status !== "A") return fail("step2_path_not_additive:" + c.path.slice(0, 160));
  }
  const tree = git.revParse(`${commit}^{tree}`);
  const dirTree = git.revParse(`${commit}:${STEP2_DIR}`);
  if (!HEX40.test(String(tree)) || !HEX40.test(String(dirTree))) return fail("tree_unresolvable");
  let files;
  try { files = RUNTIME_MANIFEST_FILES.map((p) => ({ path: p, sha256: createHash("sha256").update(git.blobBytes(commit, `${STEP2_DIR}/${p}`)).digest("hex") })); }
  catch { return fail("runtime_file_absent_at_commit"); }
  const digest = manifestDigestOf(files);
  if (digest !== measured.digest) return fail("runtime_manifest_at_commit_differs_from_reviewed_bytes");
  return { ok: true, binding: { contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_PRESERVED, provenance: STEP2_TRUSTED_PROVENANCE,
    commit, tree, step2_dir_tree: dirTree, runtime_manifest_digest: digest } };
}

function main(argv) {
  const at = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const repo = at("--repo"), commit = at("--commit");
  if (!repo || !commit) { process.stderr.write("usage: verify-step2-preservation.mjs --repo <clone> --commit <sha>\n"); process.exit(2); }
  const r = verifyStep2Preservation(makeGit(repo), commit);
  process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  process.exit(r.ok ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
