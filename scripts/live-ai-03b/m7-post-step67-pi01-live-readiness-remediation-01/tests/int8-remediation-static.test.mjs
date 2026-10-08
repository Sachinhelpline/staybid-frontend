// OFFLINE static/identity test — V3 RUNTIME PG BIGINT NORMALIZATION REMEDIATION 01.
// Proves, against the authoritative preservation commit a2b84c4, that the candidate changes ONLY the PI01 Authority
// composition wiring + one additive helper (+ tests), and that the frozen R3 runtime, the accepted PI01 runtime /
// preservation binding, the successor runtime pin, the one-shot, the standby entrypoint and the reader session are
// byte-identical. Requires the git workspace (exits 2 = SKIPPED/UNPROVEN otherwise).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";
import { counter } from "./_h.mjs";
import { PINNED_SUCCESSOR_RUNTIME_PIN_REF, PINNED_RUNTIME_BINDING } from "../../m7-post-step67-production-integration-01-runtime-01/src/runtime-preservation-binding.mjs";
import { runtimePinRef, validateRuntimePreservationBinding } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-identity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const S = resolve(PKG, "..");
const REPO = resolve(S, "../..");
const rel = (p) => relative(REPO, p);
const { ok, done } = counter("int8-remediation-static");
if (!existsSync(join(REPO, ".git"))) { console.log("SKIPPED: not inside the git workspace (a skip is never a pass)"); process.exit(2); }
const git = (...a) => spawnSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).stdout;
const BASE = "a2b84c4fc3acf14e2f63e6ffe3e4a80805833ae3";
const P = "scripts/live-ai-03b/m7-post-step67-pi01-live-readiness-remediation-01/";
const COMPOSITION = P + "src/authority-v3-composition.mjs";
const HELPER = P + "src/authority-v3-int8-observation-normalizer.mjs";
const NEW_TESTS = [P + "tests/int8-normalizer.test.mjs", P + "tests/int8-remediation-static.test.mjs", P + "tests/localpg/authority-v3-int8-localpg.test.mjs", P + "tests/run-bigint01.mjs"];

ok("R01 workspace HEAD is the authoritative preservation commit a2b84c4", git("rev-parse", "HEAD").trim() === BASE);
const tracked = git("diff", "--name-only", BASE).trim().split("\n").filter(Boolean);
ok("R02 exactly ONE tracked file differs from a2b84c4: the PI01 Authority composition", tracked.length === 1 && tracked[0] === COMPOSITION, tracked);
const untracked = git("ls-files", "--others", "--exclude-standard").trim().split("\n").filter(Boolean).sort();
const expectedUntracked = [HELPER, ...NEW_TESTS].sort();
ok("R03 untracked files are exactly the 1 helper + 4 test files", JSON.stringify(untracked) === JSON.stringify(expectedUntracked), untracked);
const diff = git("diff", "-U0", BASE, "--", COMPOSITION).split("\n").filter((l) => /^[+-][^+-]/.test(l));
const added = diff.filter((l) => l.startsWith("+")).map((l) => l.slice(1)), removed = diff.filter((l) => l.startsWith("-")).map((l) => l.slice(1));
ok("R04 composition diff = 3 added lines (comment + import + wrapped reader factory) and 1 removed line (the unwrapped reader factory)",
  added.length === 3 && removed.length === 1 &&
  added[0].startsWith("// BIGINT normalization remediation 01:") &&
  added[1] === 'import { makeInt8NormalizingReaderPhysicalFactory } from "./authority-v3-int8-observation-normalizer.mjs";' &&
  added[2] === "      readerPhysicalFactory: makeInt8NormalizingReaderPhysicalFactory(makePgPhysicalFactory({ env, connectionStringEnvName: config.readerDbUrlEnvName }))," &&
  removed[0] === "      readerPhysicalFactory: makePgPhysicalFactory({ env, connectionStringEnvName: config.readerDbUrlEnvName }),", { added, removed });

const FROZEN_DIRS = ["scripts/live-ai-03b/m7-post-step67-fresh-successor-r3-preservation-02", "scripts/live-ai-03b/m7-post-step67-production-integration-01-runtime-01",
  "scripts/live-ai-03b/private-reader-production-integration-offline-01", "scripts/live-ai-03b/m7-v2-production-authority-provisioning-offline-01",
  "scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01", "migrations"];
for (const d of FROZEN_DIRS) ok(`R05 frozen tree byte-identical to a2b84c4: ${d}`, spawnSync("git", ["-C", REPO, "diff", "--quiet", BASE, "--", d]).status === 0 && git("ls-files", "--others", "--exclude-standard", "--", d).trim() === "");
const blob = (p) => spawnSync("git", ["-C", REPO, "hash-object", join(REPO, p)], { encoding: "utf8" }).stdout.trim();
const R3S = "scripts/live-ai-03b/m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/";
for (const [p, b] of [[R3S + "v3-runtime-contract.mjs", "235ea45b459b1283fe78c009ba257e736825a126"], [R3S + "v3-query-registry.mjs", "61076cb946ea605a2e6f45caf12c6a97ee0da6e0"],
  [R3S + "v3-digest-gen.mjs", "5ccebf2c768ff8530c0f1ea5456705164619f878"], [P + "src/authority-v3-activation-oneshot.mjs", "a6a8d15941cb8b1c5683408f8762f0fa0b1e48da"]])
  ok(`R06 git blob unchanged ${p.split("/").pop()} = ${b.slice(0, 8)}…`, blob(p) === b, blob(p));
for (const f of ["src/authority-v3-standby-entrypoint.mjs", "src/authority-v3-activation-oneshot.mjs", "src/authority-v3-config.mjs", "src/executor-attestation-channel-v2.mjs"])
  ok(`R07 PI01 deployable file unchanged: ${f}`, spawnSync("git", ["-C", REPO, "diff", "--quiet", BASE, "--", P + f]).status === 0);
ok("R08 successor runtime pin ref unchanged = 78804a86…", PINNED_SUCCESSOR_RUNTIME_PIN_REF === "78804a8648e684bcdfb7d52dd34463310dec43c592fb2530216be19a04bc203d"
  && runtimePinRef(PINNED_RUNTIME_BINDING) === PINNED_SUCCESSOR_RUNTIME_PIN_REF && validateRuntimePreservationBinding(PINNED_RUNTIME_BINDING)?.ok === true);
// helper reachability: imported ONLY by the composition
const walk = (d) => readdirSync(d).flatMap((n) => { const f = join(d, n); return n === "node_modules" || n === ".git" ? [] : statSync(f).isDirectory() ? walk(f) : f.endsWith(".mjs") ? [f] : []; });
const importers = walk(S).filter((f) => /from\s+["'][^"']*authority-v3-int8-observation-normalizer\.mjs["']/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !f.includes("/tests/")).sort();
ok("R09 the helper is imported by exactly one production module: the Authority composition", JSON.stringify(importers) === JSON.stringify([COMPOSITION]), importers);
const changedCode = [COMPOSITION, HELPER].map((f) => readFileSync(join(REPO, f), "utf8")).join("\n");
ok("R10 no global pg type-parser change anywhere in the changed/added production code", !/setTypeParser|pg\.types|types\.setTypeParser|parseInt8/.test(changedCode));
ok("R11 no SQL mutation statement in changed/added production code", !/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+(ROLE|TABLE)|CREATE\s+(TABLE|ROLE)|GRANT\s+|DROP\s+)/i.test(changedCode));
ok("R12 no secret-shaped material in changed/added files", ![COMPOSITION, HELPER, ...NEW_TESTS].some((f) => /postgres(ql)?:\/\/[^$`"'\s]*:[^@\s]*@|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}/.test(readFileSync(join(REPO, f), "utf8"))));
const sha = (f) => createHash("sha256").update(readFileSync(join(REPO, f))).digest("hex");
console.log(`  INFO composition sha256 ${sha(COMPOSITION)} blob ${blob(COMPOSITION)}`);
console.log(`  INFO helper      sha256 ${sha(HELPER)} blob ${blob(HELPER)}`);
done();
