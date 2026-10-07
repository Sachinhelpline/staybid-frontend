// Candidate identity tool (offline). Usage, from a checkout of cbcb2689 with this candidate's overlay applied:
//   node tools/candidate-identity.mjs generate <out.json>   — write the identity receipt
//   node tools/candidate-identity.mjs verify   <receipt.json> — re-verify every recorded identity (exit 0 only on full PASS)
// Records: the authoritative preservation anchor; the accepted PI01 artifact; every FROZEN dependency reachable from
// the four deployable entrypoints (git blob recomputed from bytes and compared with the anchor tree); the historical
// V1 executor files (unchanged); the byte-identical PI01 runtime materialization; every new candidate file.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const S = resolve(PKG, "..");
const REPO = resolve(S, "../..");
const ANCHOR = Object.freeze({ commit: "cbcb268939b2c8384188239ba8c228e8ca77c10d", tree: "36b25416a331d56175853190559dbd9948925309", parent: "f1e1f1272b751b99c8a705d868e7762e928c6238",
  branch: "m7-post-step67-production-integration-01-preservation-01-remediation-01" });
const PI01 = Object.freeze({ path: "scripts/live-ai-03b/m7-post-step67-production-integration-01-preservation-01-remediation-01/artifact/M7_POST_STEP67_FRESH_SUCCESSOR_R3_PRODUCTION_INTEGRATION_01_IDENTITY_BINDING_REMEDIATION_01.zip",
  size: 25341, sha256: "d9c9c6edb6111618c0388b25a8df7375aa00b1f2b5d96e9dd600b877d89f8956", gitBlob: "8e9cc8ce06311763bfb0dd625606eae38198b5dd",
  manifestSha256: "dbf49804e224d3b7a1cd3c4a0c5e63c76d374f3500f6ca28e8059e1dedb371af", payloadCount: 19,
  runtimeDigest: "3e4be815d493b6854e3ef4467cad1b8d3c0494fc677049a099f351ebdb4e55f8", successorRuntimePinRef: "78804a8648e684bcdfb7d52dd34463310dec43c592fb2530216be19a04bc203d" });
const SUPERSEDED = Object.freeze({ commit: "63d15b78755120f8cd640a03ce29b3e7a5c65ce3", status: "SUPERSEDED_CORRUPT_HISTORICAL_EVIDENCE_ONLY — never an authority anchor", corruptBlob: "4333da91462d4b4271465f547bfe0a95527c24b6", corruptSize: 6024 });
const NEW_DIRS = ["scripts/live-ai-03b/m7-post-step67-pi01-live-readiness-remediation-01", "scripts/live-ai-03b/m7-post-step67-production-integration-01-runtime-01"];
const ENTRIES = ["src/authority-v3-standby-entrypoint.mjs", "src/authority-v3-activation-oneshot.mjs", "src/authority-v3-composition.mjs", "src/executor-attester-v2-entrypoint.mjs"].map((p) => join(PKG, p));

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const gitBlob = (b) => createHash("sha1").update(Buffer.concat([Buffer.from("blob " + b.length + "\0"), b])).digest("hex");
const repoRel = (p) => relative(REPO, p).split("\\").join("/");
function walk(d, out = []) { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; }
function graph(entries) {
  const seen = new Set(); const stack = entries.map((e) => resolve(e));
  while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(f, "utf8"); const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    let m; while ((m = re.exec(src))) { const t = resolve(dirname(f), m[1] || m[2]); if (existsSync(t)) stack.push(t); } }
  return [...seen].map(repoRel).sort();
}
function anchorBlob(path) {
  const r = spawnSync("git", ["-C", REPO, "rev-parse", `${ANCHOR.commit}:${path}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const isNew = (p) => NEW_DIRS.some((d) => p === d || p.startsWith(d + "/"));

function generate() {
  const fail = [];
  const z = readFileSync(join(REPO, PI01.path));
  if (z.length !== PI01.size || sha256(z) !== PI01.sha256 || gitBlob(z) !== PI01.gitBlob) fail.push("pi01_artifact_identity");
  const deps = graph(ENTRIES);
  const frozen = deps.filter((p) => !isNew(p)).map((p) => { const b = readFileSync(join(REPO, p)); const blob = gitBlob(b); const ab = anchorBlob(p);
    if (ab !== null && ab !== blob) fail.push("frozen_mismatch:" + p); if (ab === null) fail.push("frozen_not_in_anchor:" + p); return { path: p, gitBlob: blob, anchorBlob: ab, size: b.length }; });
  const v1ref = JSON.parse(readFileSync(join(S, "m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/FROZEN-V1-EXECUTOR-ATTESTATION-REFERENCE.json"), "utf8")).frozen_blobs;
  const historicalV1 = Object.entries(v1ref).map(([p, blob]) => { const actual = gitBlob(readFileSync(join(REPO, p))); if (actual !== blob) fail.push("historical_v1_changed:" + p); return { path: p, expectedBlob: blob, actualBlob: actual }; });
  const rt = join(REPO, NEW_DIRS[1]);
  const runtime = walk(rt).map((f) => { const b = readFileSync(f); const n = relative(rt, f);
    const e = spawnSync("unzip", ["-p", join(REPO, PI01.path), n], { encoding: "buffer", maxBuffer: 1 << 24 }).stdout; if (!e.equals(b)) fail.push("runtime_not_byte_identical:" + n);
    return { path: repoRel(f), size: b.length, sha256: sha256(b), gitBlob: gitBlob(b), equalsArtifactEntry: e.equals(b) }; });
  const pkgFiles = walk(PKG).map((f) => { const b = readFileSync(f); return { path: repoRel(f), size: b.length, sha256: sha256(b), gitBlob: gitBlob(b) }; });
  return { fail, receipt: {
    contract: "M7PI01LiveReadinessRemediation01IdentityReceiptV1",
    authoritativePreservationAnchor: ANCHOR, supersededPreservation: SUPERSEDED, acceptedPi01Artifact: PI01,
    frozenR3: { commit: "f1e1f1272b751b99c8a705d868e7762e928c6238", tree: "5659ea8432f3ca76e267ff9e0a6b3896e0b79b88" },
    deployableEntrypoints: ENTRIES.map(repoRel),
    frozenDependencies: { count: frozen.length, allEqualAnchorBlob: frozen.every((x) => x.anchorBlob === x.gitBlob), files: frozen },
    historicalV1ExecutorFilesUnchanged: { count: historicalV1.length, allUnchanged: historicalV1.every((x) => x.expectedBlob === x.actualBlob), files: historicalV1 },
    pi01RuntimeMaterialization: { dir: NEW_DIRS[1], count: runtime.length, allByteIdenticalToArtifact: runtime.every((x) => x.equalsArtifactEntry), files: runtime },
    newCandidatePackage: { dir: NEW_DIRS[0], count: pkgFiles.length, files: pkgFiles },
  } };
}

const [mode, file] = process.argv.slice(2);
if (mode === "generate" && file) {
  const { fail, receipt } = generate();
  if (fail.length) { console.error("IDENTITY_FAIL " + fail.join(" ")); process.exit(1); }
  writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
  console.log(`IDENTITY_GENERATED frozen=${receipt.frozenDependencies.count} historicalV1=${receipt.historicalV1ExecutorFilesUnchanged.count} runtime=${receipt.pi01RuntimeMaterialization.count} package=${receipt.newCandidatePackage.count}`);
} else if (mode === "verify" && file) {
  const want = JSON.parse(readFileSync(file, "utf8")); const fails = [];
  const { fail, receipt } = generate(); fails.push(...fail);
  const cmp = (a, b, k) => { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push("receipt_mismatch:" + k); };
  cmp(receipt.authoritativePreservationAnchor, want.authoritativePreservationAnchor, "anchor");
  cmp(receipt.acceptedPi01Artifact, want.acceptedPi01Artifact, "pi01");
  cmp(receipt.frozenDependencies, want.frozenDependencies, "frozenDependencies");
  cmp(receipt.historicalV1ExecutorFilesUnchanged, want.historicalV1ExecutorFilesUnchanged, "historicalV1");
  cmp(receipt.pi01RuntimeMaterialization, want.pi01RuntimeMaterialization, "runtime");
  const pk = (r) => r.newCandidatePackage.files.filter((f) => !/\/tests\/out\//.test(f.path));
  cmp(pk(receipt), pk(want), "package");
  if (fails.length) { console.error("IDENTITY_VERIFY_FAIL " + fails.join(" ")); process.exit(1); }
  console.log(`IDENTITY_VERIFY_PASS frozen=${receipt.frozenDependencies.count} historicalV1=${receipt.historicalV1ExecutorFilesUnchanged.count} runtime=${receipt.pi01RuntimeMaterialization.count} package=${receipt.newCandidatePackage.count}`);
} else { console.error("usage: candidate-identity.mjs generate|verify <file>"); process.exit(2); }
