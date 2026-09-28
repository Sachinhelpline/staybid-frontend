#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — GATEWAY DEPLOY-SOURCE closure proof (PIN B). OFFLINE, READ-ONLY git.
// Runs ONLY read-only git plumbing (rev-parse / cat-file / ls-tree / diff / merge-base) against a local
// clone. No network, no write, no commit. Proves that the gateway build closure at 4f390b74 differs from
// the superseded V1 deploy source 2b69ce… ONLY by the reviewed service_tier:"default" pin, and pins every
// closure identity. Usage: node prove-gateway-source.mjs --repo <clone> [--write <out.json>]
// ─────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { GATEWAY_DEPLOY_SOURCE_V2 as P, SUPERSEDED_GATEWAY_SOURCE_V1 as S } from "../identity/v2-source-identity.mjs";

export function makeGit(repo) {
  const run = (args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return {
    revParse: (x) => { try { return run(["rev-parse", "--verify", "--quiet", x]); } catch { return null; } },
    isAncestor: (a, b) => { try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; } catch { return false; } },
    show: (rev, path) => run(["cat-file", "blob", `${rev}:${path}`]),
    diffNameStatus: (a, b, paths) => run(["diff", "--no-renames", "--name-status", a, b, "--", ...(paths || [])]).split("\n").filter(Boolean).map((l) => { const [st, ...p] = l.split("\t"); return { status: st, path: p.join("\t") }; }),
    diffUnified: (a, b, path) => run(["diff", "--no-renames", "-U0", a, b, "--", path]),
    lsTree: (rev, path) => run(["ls-tree", `${rev}`, path.endsWith("/") ? path : path + "/"]).split("\n").filter(Boolean).map((l) => { const [meta, p] = l.split("\t"); const [, type, oid] = meta.split(" "); return { type, oid, path: p }; }),
  };
}

export function proveGatewaySource(git) {
  const f = [];
  const need = (c, r) => { if (!c) f.push(r); };
  need(git.revParse(`${P.commit}^{commit}`) === P.commit, "gateway_commit_absent");
  need(git.revParse(`${P.commit}^{tree}`) === P.tree, "gateway_tree_mismatch");
  need(git.revParse(`${P.commit}:server/voice-gateway`) === P.voice_gateway_tree, "voice_gateway_tree_mismatch");
  need(git.revParse(`${S.commit}:server/voice-gateway`) === S.voice_gateway_tree, "superseded_voice_gateway_tree_mismatch");
  need(git.isAncestor(S.commit, P.commit), "superseded_source_not_ancestor");
  // closure definition from the tsconfig AT the pinned commit.
  let ts; try { ts = JSON.parse(git.show(P.commit, "server/voice-gateway/tsconfig.json")); } catch { ts = null; }
  need(ts && Array.isArray(ts.include) && ts.include.length === 1 && ts.include[0] === "*.ts" && ts.compilerOptions && ts.compilerOptions.rootDir === ".", "tsconfig_closure_not_local_ts_only");
  let pkg; try { pkg = JSON.parse(git.show(P.commit, "package.json")); } catch { pkg = null; }
  need(pkg && pkg.scripts && pkg.scripts["build:gateway"] === "tsc -p server/voice-gateway/tsconfig.json", "build_script_mismatch");
  need(pkg && pkg.scripts && pkg.scripts["start:live-ai-staging"] === "node server/voice-gateway/dist/live-ai-staging-main.js", "start_script_mismatch");
  for (const [path, oid] of Object.entries({ ...P.closure_blobs, ...P.broker_blobs })) need(git.revParse(`${P.commit}:${path}`) === oid, "blob_mismatch:" + path);
  const closureFiles = git.lsTree(P.commit, "server/voice-gateway").filter((e) => e.type === "blob").map((e) => ({ path: e.path, blob: e.oid }));
  // what changed inside the build closure (+ build manifests + broker) between the two sources.
  const changed = git.diffNameStatus(S.commit, P.commit, ["server/voice-gateway", "package.json", "package-lock.json", ...Object.keys(P.broker_blobs)]);
  need(changed.length === 1 && changed[0].status === "M" && changed[0].path === "server/voice-gateway/openai-responses.ts", "closure_changes_not_exactly_openai_responses");
  const u = changed.length === 1 ? git.diffUnified(S.commit, P.commit, "server/voice-gateway/openai-responses.ts") : "";
  const added = u.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  const removed = u.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  need(removed.length === 0, "closure_diff_removes_lines");
  need(added.length === 7, "closure_diff_not_7_added_lines");
  const code = added.filter((l) => !/^\s*\/\//.test(l));
  need(code.length === 2 && code[0] === 'export const REASONING_03B_SERVICE_TIER = "default" as const;' && code[1].trim() === "service_tier: REASONING_03B_SERVICE_TIER,", "closure_diff_not_exactly_service_tier_pin");
  return {
    contract: "GatewayDeploySourceProofV2", pass: f.length === 0, failures: f,
    gateway_source: { commit: P.commit, tree: P.tree, voice_gateway_tree: P.voice_gateway_tree },
    superseded_rejected: { commit: S.commit, tree: S.tree, voice_gateway_tree: S.voice_gateway_tree, reason: "gateway closure omits service_tier:\"default\" ⇒ an OMITTED tier inherits the project default (may be Fast/Priority ⇒ re-priced)" },
    build_closure_rule: "tsc -p server/voice-gateway/tsconfig.json — include [\"*.ts\"], rootDir \".\" ⇒ server/voice-gateway/*.ts only (+ package.json / package-lock.json for dependency resolution)",
    closure_files: closureFiles,
    pinned_blobs: { ...P.closure_blobs }, broker_blobs: { ...P.broker_blobs },
    closure_diff_vs_superseded: { changed, added_lines: added.length, removed_lines: removed.length, added_code_lines: code },
    build_command: P.build_command, start_command: P.start_command,
  };
}

function main(argv) {
  const repo = argv[argv.indexOf("--repo") + 1];
  if (!argv.includes("--repo") || !repo) { process.stderr.write("usage: prove-gateway-source.mjs --repo <clone> [--write out.json]\n"); process.exit(2); }
  const proof = proveGatewaySource(makeGit(repo));
  const out = JSON.stringify(proof, null, 2) + "\n";
  if (argv.includes("--write")) writeFileSync(argv[argv.indexOf("--write") + 1], out); else process.stdout.write(out);
  process.exit(proof.pass ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
