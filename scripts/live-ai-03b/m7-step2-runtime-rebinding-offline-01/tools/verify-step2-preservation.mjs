#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — PIN C verifier (V2, lifecycle correction): how the LATER preservation of the
// CORRECTED Step-2 runtime is verified. OFFLINE, READ-ONLY git. No network, no write, no commit. The corrected
// preservation commit does NOT exist yet and is NOT fabricated here; this tool is what the Owner runs AFTER it
// exists.
//
// Repository reality: the accepted HEAD 3fda6af1 (M5 attester clock-recovery closure) sits AFTER the historical
// Step-2 preservation f5ec5807, so "every change since PIN B is a Step-2 addition" (the V1 rule) no longer holds
// and must NOT be forced (the accepted M5 commit is retained, never reverted). The smallest rigorous model is a
// THREE-SEGMENT lineage over FIXED, independently re-derived commits:
//   S1  PIN B 4f390b74 → historical PIN C f5ec5807: ancestor; every change is an ADDITION under the Step-2 dir
//       (the accepted historical Step-2 lineage), and f5ec5807's tree / Step-2 dir tree are the recorded values.
//   S2  f5ec5807 → accepted M5 closure 3fda6af1: ancestor; 3fda6af1's parent is f5ec5807; ZERO Step-2 paths
//       change (Step-2 dir tree identical) and every changed path lies under the two accepted M5 prefixes ⇒ the
//       M5 changes are retained and are NEVER classified as Step-2 drift.
//   S3  3fda6af1 → candidate X: ancestor; X is none of the known commits; at least one change; EVERY changed path
//       is under the Step-2 dir and is an addition or modification (no deletion) ⇒ the correction touches Step 2
//       ONLY and every M5 / frozen path at X equals 3fda6af1.
// Then: the runtime module bytes at X reproduce EXACTLY the corrected manifest this runtime measures of itself,
// that manifest is NOT the historical 9a460078…, and the Step-2 dir tree at X differs from the historical one.
// It emits the Step2RuntimePreservationBindingV2 the Owner-controlled authority supplies to the runtime.
// Usage: node verify-step2-preservation.mjs --repo <clone> --commit <sha>
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DERIVATION_BASE, GATEWAY_DEPLOY_SOURCE_V2, SUPERSEDED_GATEWAY_SOURCE_V1, STEP2_DIR, RUNTIME_MANIFEST_FILES, STEP2_BINDING_CONTRACT,
  STEP2_PIN_STATUS_PRESERVED, STEP2_TRUSTED_PROVENANCE, HISTORICAL_STEP2_PRESERVATION, ACCEPTED_M5_CLOSURE, manifestDigestOf,
  measureRuntimeManifest } from "../identity/v2-source-identity.mjs";

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

const inStep2 = (p) => p.startsWith(STEP2_DIR + "/");
const inM5 = (p) => ACCEPTED_M5_CLOSURE.path_prefixes.some((x) => p.startsWith(x));

/** Pure verification over an injected read-only git interface. */
export function verifyStep2Preservation(git, commitArg, opts) {
  const measured = (opts && opts.measured) || measureRuntimeManifest();
  const fail = (reason) => ({ ok: false, reason });
  const H = HISTORICAL_STEP2_PRESERVATION, M = ACCEPTED_M5_CLOSURE, B = GATEWAY_DEPLOY_SOURCE_V2.commit;
  const commit = git.revParse(`${commitArg}^{commit}`);
  if (!commit || !HEX40.test(commit)) return fail("commit_absent");
  if (commit === H.commit) return fail("historical_pin_c_cannot_authorize_corrected_runtime");
  if (commit === M.commit) return fail("commit_is_the_uncorrected_baseline");
  if ([DERIVATION_BASE.commit, B, SUPERSEDED_GATEWAY_SOURCE_V1.commit].includes(commit)) return fail("commit_is_a_non_step2_pin");

  // S1 — historical Step-2 lineage (PIN B → historical PIN C), re-derived from git, never assumed.
  if (!git.isAncestor(B, H.commit)) return fail("s1_gateway_deploy_source_not_ancestor_of_historical_pin_c");
  if (git.revParse(`${H.commit}^{tree}`) !== H.tree || git.revParse(`${H.commit}:${STEP2_DIR}`) !== H.step2_dir_tree) return fail("s1_historical_pin_c_identity_mismatch");
  const s1 = git.diffNameStatus(B, H.commit);
  if (s1.length === 0) return fail("s1_historical_lineage_empty");
  for (const c of s1) {
    if (!inStep2(c.path)) return fail("s1_non_step2_path_in_historical_lineage:" + c.path.slice(0, 160));
    if (c.status !== "A") return fail("s1_historical_step2_path_not_additive:" + c.path.slice(0, 160));
  }
  // S2 — accepted M5 closure (historical PIN C → 3fda6af1): retained, never Step-2 drift.
  if (!git.isAncestor(H.commit, M.commit)) return fail("s2_historical_pin_c_not_ancestor_of_m5_closure");
  if (git.revParse(`${M.commit}^{tree}`) !== M.tree || git.revParse(`${M.commit}^1`) !== M.parent) return fail("s2_m5_closure_identity_mismatch");
  if (git.revParse(`${M.commit}:${STEP2_DIR}`) !== M.step2_dir_tree || M.step2_dir_tree !== H.step2_dir_tree) return fail("s2_m5_closure_changed_step2_tree");
  const s2 = git.diffNameStatus(H.commit, M.commit);
  if (s2.length === 0) return fail("s2_m5_closure_empty");
  for (const c of s2) {
    if (inStep2(c.path)) return fail("s2_m5_closure_touches_step2:" + c.path.slice(0, 160));
    if (!inM5(c.path)) return fail("s2_path_outside_accepted_m5_scope:" + c.path.slice(0, 160));
  }
  // S3 — the correction (3fda6af1 → X): Step-2 paths only, additions/modifications only.
  if (!git.isAncestor(M.commit, commit)) return fail("s3_m5_closure_not_ancestor");
  const s3 = git.diffNameStatus(M.commit, commit);
  if (s3.length === 0) return fail("s3_no_step2_correction");
  for (const c of s3) {
    if (!inStep2(c.path)) return fail("s3_non_step2_path_changed:" + c.path.slice(0, 160));
    if (c.status !== "A" && c.status !== "M") return fail("s3_step2_path_not_add_or_modify:" + c.path.slice(0, 160));
  }
  const tree = git.revParse(`${commit}^{tree}`);
  const dirTree = git.revParse(`${commit}:${STEP2_DIR}`);
  if (!HEX40.test(String(tree)) || !HEX40.test(String(dirTree))) return fail("tree_unresolvable");
  if (dirTree === H.step2_dir_tree) return fail("historical_step2_dir_tree_cannot_authorize_corrected_runtime");
  let files;
  try { files = RUNTIME_MANIFEST_FILES.map((p) => ({ path: p, sha256: createHash("sha256").update(git.blobBytes(commit, `${STEP2_DIR}/${p}`)).digest("hex") })); }
  catch { return fail("runtime_file_absent_at_commit"); }
  const digest = manifestDigestOf(files);
  if (digest === H.runtime_manifest_digest) return fail("historical_runtime_manifest_cannot_authorize_corrected_runtime");
  if (digest !== measured.digest) return fail("runtime_manifest_at_commit_differs_from_reviewed_bytes");
  return { ok: true, lineage: { s1_historical_additions: s1.length, s2_m5_changes_retained: s2.length, s3_step2_correction_changes: s3.length },
    binding: { contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_PRESERVED, provenance: STEP2_TRUSTED_PROVENANCE,
      commit, tree, step2_dir_tree: dirTree, runtime_manifest_digest: digest, correction_base: M.commit, historical_pin_c: H.commit } };
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
