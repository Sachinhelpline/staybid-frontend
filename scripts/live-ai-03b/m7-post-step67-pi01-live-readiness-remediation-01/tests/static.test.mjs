// OFFLINE static tests — import-graph boundaries (no V1 executor attestation anywhere in the V3/V2 deployable graph),
// prohibited live-action wiring, secret scan, accepted PI01 runtime byte identity, frozen-source identity.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { counter } from "./_h.mjs";
import { FIXED as FIXED_V1 } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { FIXED_V3 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/pricing-approval-contract-v3.mjs";

const { ok, done } = counter("static");
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const S = resolve(PKG, "..");                 // scripts/live-ai-03b
const REPO = resolve(S, "../..");
const rel = (p) => relative(S, p);

function graph(entry) {
  const seen = new Set(); const stack = [resolve(entry)];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(f, "utf8");
    const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    let m; while ((m = re.exec(src))) { const t = resolve(dirname(f), m[1] || m[2]); if (existsSync(t)) stack.push(t); }
  }
  return [...seen].map(rel).sort();
}
const FORBIDDEN_V1 = [
  "m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs",
  "m7-v2-production-authority-provisioning-offline-01/src/role-binding.mjs",
  "m7-v2-production-authority-provisioning-offline-01/src/provisioner.mjs",
  "m7-v2-production-authority-provisioning-offline-01/src/production-entrypoint.mjs",
  "m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-server.mjs",
  "m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs",
  "m7-v2-executor-attester-issuer-offline-01/src/executor-signing-adapter.mjs",
  "m7-v2-executor-attester-issuer-offline-01/src/executor-evidence-evaluator.mjs",
  "m7-v2-executor-attester-issuer-offline-01/src/executor-observer.mjs",
  "m7-v2-executor-attester-issuer-offline-01/src/executor-attester-entrypoint.mjs",
];
const ENTRIES = {
  authorityStandby: join(PKG, "src/authority-v3-standby-entrypoint.mjs"),
  authorityOneshot: join(PKG, "src/authority-v3-activation-oneshot.mjs"),
  executorV2: join(PKG, "src/executor-attester-v2-entrypoint.mjs"),
};
for (const [name, e] of Object.entries(ENTRIES)) {
  const g = graph(e);
  const bad = g.filter((f) => FORBIDDEN_V1.includes(f));
  ok(`S01 ${name}: import graph (${g.length} modules) contains NO V1 executor attestation/issuer/fallback module`, bad.length === 0, bad);
  ok(`S02 ${name}: graph uses the frozen R3 V2 attestation module`, g.includes("m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs"));
}
{ const g = graph(ENTRIES.authorityStandby);
  ok("S03 standby graph does NOT include the one-shot activation runner", !g.includes("m7-post-step67-pi01-live-readiness-remediation-01/src/authority-v3-activation-oneshot.mjs"));
  ok("S04 standby graph binds the materialized accepted PI01 composition", g.includes("m7-post-step67-production-integration-01-runtime-01/src/production-composition.mjs") && g.includes("m7-post-step67-production-integration-01-runtime-01/src/v3-integration-core.mjs")); }
{ const g = graph(ENTRIES.executorV2);
  ok("S05 executor V2 graph uses the frozen R3 issuer/signing/evidence-policy modules", ["executor-attester-issuer-v2.mjs", "executor-attester-signing-v2.mjs", "executor-evidence-policy-v2.mjs"].every((x) => g.includes("m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/" + x)));
  ok("S06 executor V2 graph does NOT include any Authority activation module", !g.some((f) => /authority-v3-|production-integration-01-runtime-01/.test(f))); }

{ // the frozen first-text-probe module is reached ONLY as a constant dependency (v2-identity → PROBE_TEXT)
  const probe = readFileSync(join(S, "first-text-probe-activation-01/first-text-probe.mjs"), "utf8");
  const imports = [...probe.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]);
  const all = Object.values(ENTRIES).flatMap((e) => graph(e)).filter((f) => !f.startsWith("first-text-probe-activation-01/"));
  const callers = all.filter((f) => /\brunProbe\s*\(/.test(readFileSync(join(S, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n")));
  ok("S26 transitive first-text-probe module: imports only node:crypto, and NO module in the deployable graphs calls runProbe()", JSON.stringify(imports) === '["node:crypto"]' && callers.length === 0, { imports, callers }); }
const srcFiles = readdirSync(join(PKG, "src")).map((f) => join(PKG, "src", f));
const SRC = Object.fromEntries(srcFiles.map((f) => [f, readFileSync(f, "utf8")]));
const code = (f) => SRC[f].split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
ok("S07 standby source never calls run()", !/\.run\(/.test(code(join(PKG, "src/authority-v3-standby-entrypoint.mjs"))));
ok("S08 composition source never calls run()", !/\.run\(/.test(code(join(PKG, "src/authority-v3-composition.mjs"))));
ok("S09 the only run() call is the one-shot runner's single boundary.run", srcFiles.filter((f) => /\.run\(/.test(code(f))).map((f) => f.split("/").pop()).join(",") === "authority-v3-activation-oneshot.mjs"
  && (code(join(PKG, "src/authority-v3-activation-oneshot.mjs")).match(/\.run\(/g) || []).length === 1);
ok("S10 no automatic restoration anywhere (no restore_catalog / .restore( )", srcFiles.every((f) => !/restore_catalog|\.restore\(/.test(code(f))));
ok("S11 no provider/OpenAI/gateway wiring (no OPENAI, api.openai, gateway deploy)", srcFiles.every((f) => !/OPENAI|api\.openai|gatewayDeploy|startGateway/i.test(code(f))));
ok("S12 no Railway CLI / child_process / shell execution in deployable source", srcFiles.every((f) => !/child_process|(?<![.\w])spawn\(|(?<![.\w])exec\(|railway\s+(up|redeploy|variables|run|ssh|link)/.test(code(f))));
ok("S13 no fetch()/http client in deployable source (only the private net channel)", srcFiles.every((f) => !/\bfetch\(|node:https?["']/.test(code(f))));
ok("S14 no process.env mutation", srcFiles.every((f) => !/process\.env\[[^\]]+\]\s*=(?!=)|process\.env\.[A-Z_]+\s*=(?!=)/.test(code(f))));
ok("S15 no SQL mutation statement text in deployable source (executor V2 issues only the frozen read-only registry)", srcFiles.every((f) => !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+(ROLE|TABLE|SYSTEM)|GRANT\s+[A-Z]|REVOKE\s+[A-Z]|DROP\s+(TABLE|ROLE|SCHEMA|FUNCTION)|TRUNCATE\s)/.test(code(f))));
ok("S16 no retry loop around boundary.run / obtain (no 'retry' identifiers in deployable code)", srcFiles.every((f) => !/\bretry\w*\s*\(|for\s*\(.*attempt/i.test(code(f))));
ok("S17 V1/V3 FIXED AI-STAGING + CORE identities are identical (executor anchor binding is V3-safe)", ["ai_staging_project", "ai_staging_environment", "ai_staging_postgres", "core_excluded_project", "core_excluded_postgres"].every((k) => FIXED_V1[k] === FIXED_V3[k]));

// scanner negative controls (each scanner provably fires on a positive sample)
ok("S17b scanner controls: SQL-mutation, shell, retry, run and secret scanners fire on positive samples",
  /\b(GRANT\s+[A-Z]|ALTER\s+(ROLE|TABLE|SYSTEM))/.test("GRANT SELECT ON t TO r; ALTER ROLE x") && /(?<![.\w])spawn\(/.test("spawn('railway')") && /\bretry\w*\s*\(/.test("retryActivation(")
  && /\.run\(/.test("boundary.run(") && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test("-----BEGIN " + "PRIVATE KEY-----") && /postgres(ql)?:\/\/[^\s"'`@]+:[^\s"'`@]+@/.test("postgresql://u" + ":p@h/db"));

// ── secret scan over the whole candidate package (+ the materialized PI01 runtime) ──
function walk(d, out = []) { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p, out); else out.push(p); } return out; }
const scanFiles = [...walk(PKG), ...walk(join(S, "m7-post-step67-production-integration-01-runtime-01"))].filter((f) => !/\.zip$/.test(f));
const SECRET_RE = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /rzp_(live|test)_[A-Za-z0-9]{6,}/, /sk-[A-Za-z0-9]{20,}/, /postgres(ql)?:\/\/[^\s"'`@]+:[^\s"'`@]+@/, /ghp_[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/,
  new RegExp("MC4CAQAw" + "BQYDK2VwBCIEI" + "[A-Za-z0-9+/]{20,}")];
const hits = scanFiles.flatMap((f) => SECRET_RE.filter((re) => re.test(readFileSync(f, "utf8"))).map((re) => rel(f) + " :: " + re));
ok(`S18 secret scan: ${scanFiles.length} files, no private key / API key / DB credential material`, hits.length === 0, hits);
const MODEL_RE = new RegExp(["cla" + "ude-(op" + "us|son" + "net|hai" + "ku|fa" + "ble)", "\\b" + "Op" + "us 5", "\\b" + "Son" + "net 5", "\\b" + "Fa" + "ble 5"].join("|"), "i");   // fragments: no identifier literal in this file
ok("S19 no model identifier in any candidate file", scanFiles.every((f) => !MODEL_RE.test(readFileSync(f, "utf8"))));

// ── accepted PI01 runtime byte identity vs the authoritative preserved artifact (cbcb2689) ──
const ZIP = join(S, "m7-post-step67-production-integration-01-preservation-01-remediation-01/artifact/M7_POST_STEP67_FRESH_SUCCESSOR_R3_PRODUCTION_INTEGRATION_01_IDENTITY_BINDING_REMEDIATION_01.zip");
if (existsSync(ZIP)) {
  const z = readFileSync(ZIP);
  ok("S20 authoritative preserved artifact present: 25341 bytes, sha256 d9c9c6ed…", z.length === 25341 && createHash("sha256").update(z).digest("hex") === "d9c9c6edb6111618c0388b25a8df7375aa00b1f2b5d96e9dd600b877d89f8956");
  const names = spawnSync("unzip", ["-Z1", ZIP], { encoding: "utf8" }).stdout.split("\n").filter((x) => x && !x.endsWith("/")).sort();
  const RT = join(S, "m7-post-step67-production-integration-01-runtime-01");
  const local = walk(RT).map((f) => relative(RT, f)).sort();
  ok("S21 materialized PI01 runtime has EXACTLY the 21 artifact entries (no extra, none missing)", JSON.stringify(names) === JSON.stringify(local) && names.length === 21, { names: names.length, local: local.length });
  const diff = names.filter((n) => { const a = spawnSync("unzip", ["-p", ZIP, n], { encoding: "buffer", maxBuffer: 1 << 24 }).stdout; return !a.equals(readFileSync(join(RT, n))); });
  ok("S22 every materialized PI01 file is byte-identical to the preserved artifact entry", diff.length === 0, diff);
} else ok("S20 authoritative preserved artifact present", false, "missing " + rel(ZIP));

// ── frozen-source identity (only when run inside the reconstructed git workspace) ──
if (existsSync(join(REPO, ".git"))) {
  const head = spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  ok("S23 workspace HEAD is the authoritative preservation commit cbcb2689…", head === "cbcb268939b2c8384188239ba8c228e8ca77c10d", head);
  const tracked = spawnSync("git", ["-C", REPO, "diff", "--name-only", "HEAD"], { encoding: "utf8" }).stdout.trim();
  ok("S24 ZERO tracked file modified vs cbcb2689 (frozen R3, PI01 preservation, V1, reader, every accepted file byte-identical)", tracked === "", tracked.split("\n").slice(0, 10));
  const untracked = spawnSync("git", ["-C", REPO, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const allowed = new Set(["?? node_modules", "?? scripts/live-ai-03b/m7-post-step67-pi01-live-readiness-remediation-01/", "?? scripts/live-ai-03b/m7-post-step67-production-integration-01-runtime-01/"]);
  ok("S25 only the two additive candidate directories are new (plus the local-only test node_modules link)", untracked.every((l) => allowed.has(l)), untracked);
} else console.log("  NOTE S23–S25 frozen-source git identity not run (not inside the reconstructed workspace); use tools/verify-frozen.mjs");

done();
