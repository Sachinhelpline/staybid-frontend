// §3/§12/§14/§22 — change boundary: exactly the 5 allowed runtime files changed; the 9 protected files (and every
// other tracked file) byte-identical to the baseline commit; frozen constants/protocol unchanged. Git READ-ONLY.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { CANDIDATE_TREE, bdir, s03b, makeOk } from "./lib.mjs";

const REF = process.env.M5ACR_BASELINE_REF || "f5ec5807014442884c1d156c51a4edd1563b25bd";
const git = (...a) => execFileSync("git", ["-C", CANDIDATE_TREE, ...a], { encoding: "utf8" });
const T = makeOk("m5acr-boundary"); const { ok } = T;
const D = "scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/";
const ALLOWED = ["clock-gate.mjs", "production-db-clock.mjs", "attester-bootstrap.mjs", "production-attester.mjs", "bootstrap-entrypoint-attester.mjs"].map((f) => D + f).sort();
const PROTECTED = {
  [D + "reader-bootstrap.mjs"]: "eb547bb69dad6b5c6f8becdb4988ef364cd8d03d",
  [D + "production-reader.mjs"]: "470eb5bb7f1a784ea9577af69b8aefb0959e2aef",
  [D + "attestation-channel-v2.mjs"]: null,
  [D + "private-peer-resolver.mjs"]: "967d81a721e76e339274c11630a7401b29305ccc",
  "scripts/live-ai-03b/private-reader-attester-offline-01/observer-connection.mjs": "632a3b624087d4d268e969b1ba75e3a9c1090f80",
  "scripts/live-ai-03b/private-reader-production-integration-offline-01/reader-session.mjs": "c24a2781b7b5f435edd653fc7fc29b84160df72f",
  "scripts/live-ai-03b/private-reader-attester-offline-01/signing-adapter.mjs": null,
  "scripts/live-ai-03b/private-reader-attester-offline-01/target-binding.mjs": null,
  "scripts/live-ai-03b/private-reader-attester-offline-01/evidence-evaluator.mjs": null,
};
ok("B0 HEAD is the baseline commit (candidate changes are uncommitted working-tree edits only)", git("rev-parse", "HEAD").trim() === REF);
const changed = git("diff", "--name-only", REF).trim().split("\n").filter(Boolean).sort();
ok("B1 tracked changes vs baseline are EXACTLY the 5 allowed runtime files", JSON.stringify(changed) === JSON.stringify(ALLOWED));
const untracked = git("ls-files", "--others", "--exclude-standard").trim().split("\n").filter(Boolean);
ok("B2 every untracked file lives in the new evidence directory only", untracked.every((f) => f.startsWith("scripts/live-ai-03b/m5-attester-clock-recovery-remediation-offline-01/")));
let allProt = true; const protReport = [];
for (const [f, blob] of Object.entries(PROTECTED)) {
  const base = git("rev-parse", `${REF}:${f}`).trim(); const cur = git("hash-object", f).trim();
  const same = base === cur && (blob === null || blob === cur); protReport.push(`${f.split("/").pop()}=${cur.slice(0, 12)}`); if (!same) allProt = false;
}
ok("B3 the 9 protected runtime files are byte-identical to the baseline (reader/v2 channel/peer/observer/session/signing/target/evidence)", allProt);
const staged = git("diff", "--cached", "--name-only").trim();
ok("B4 nothing is staged; no commit was made", staged === "");
const B = bdir(CANDIDATE_TREE);
const ci = await import(B + "/clock-interval.mjs");
ok("B5 frozen clock constants unchanged (RTT 100, discrepancy 10, service 250, pairwise 500, ceiling 600, 5/30, 1 s, 2 s)",
  ci.RTT_MAX_MS === 100 && ci.WALL_MONO_DISCREPANCY_MAX_MS === 10 && ci.SERVICE_ABS_BOUND_MS === 250 && ci.PAIRWISE_ABS_BOUND_MS === 500 && ci.ACCEPTED_MAX_MS === 600 && ci.STARTUP_SAMPLES === 5 && ci.STARTUP_MAX_ATTEMPTS === 30 && ci.MONITOR_PERIOD_MS === 1000 && ci.MAX_SAMPLE_AGE_MS === 2000);
const v2 = await import(B + "/attestation-channel-v2.mjs");
ok("B6 v2 request budget + wire codes unchanged (1900 ms)", v2.V2_REQUEST_BUDGET_MS === 1900 && v2.V2_WIRE_CODES.length === 11);
const ab = await import(B + "/attester-bootstrap.mjs");
ok("B7 attester bootstrap version string + exit codes unchanged", ab.ATTESTER_BOOTSTRAP_VERSION === "reader-attester-bootstrap-v1" && ab.EXIT.unprovisioned === 70 && ab.EXIT.clock_lost === 74);
const imports = ALLOWED.map((f) => fs.readFileSync(`${CANDIDATE_TREE}/${f}`, "utf8")).join("\n").match(/^import .* from "([^"]+)";$/gm).map((l) => /from "([^"]+)"/.exec(l)[1]);
const OK_IMPORTS = new Set(["node:perf_hooks", "node:process", "node:url", "./clock-interval.mjs", "./clock-gate.mjs", "./attestation-channel-v2.mjs", "./bootstrap-state.mjs", "./attester-bootstrap.mjs", "./production-config.mjs", "./production-db-clock.mjs", "./private-peer-resolver.mjs", "./production-attester.mjs", "./db-clock-probe.mjs", "../private-reader-attester-offline-01/signing-adapter.mjs", "../private-reader-attester-offline-01/observer-connection.mjs", "../private-reader-production-integration-offline-01/reader-session.mjs"]);
ok("B8 the changed files import only built-ins already in use + in-tree modules (no network/child_process/fs/new deps)", imports.every((i) => OK_IMPORTS.has(i)));
const diff = git("diff", REF, "--", ...ALLOWED);
ok("B9 no secret-looking literal added (no DSN, no key/secret assignment, no rzp_ key)", !/^\+.*(postgres(ql)?:\/\/[^"`\s]*@|rzp_(live|test)_|BEGIN (RSA|PRIVATE)|password\s*=\s*["'])/m.test(diff));
ok("B10 no Railway / provider / gateway surface introduced by the diff", !/^\+.*\b(railway (up|redeploy|restart)|api\.openai\.com|fetch\(|https?:\/\/)/m.test(diff));
const pa = fs.readFileSync(B + "/production-attester.mjs", "utf8");
ok("B11 exact-host peer allowlist, observer provider, signer and anchor wiring unchanged in the production composition", pa.includes("const peerCidrs = supervisor.current();") && pa.includes("establishObserverSession(await observerFactory.open())") && pa.includes("createSigningAdapter({ issuer: cfg.issuer, privateKeyPkcs8B64: env[cfg.signingKeyEnvName], proofLifetimeMs: ATTESTER_PROOF_LIFETIME_MS })") && pa.includes("anchor: cfg.anchor,"));
// delta B: prior reviewed candidate (v1) → revised. The shutdown-only runtime delta, with the entrypoint unchanged.
const V1SHA = { "clock-gate.mjs": "3b30dd0fbcd23ca00c3ec2c0460d27cf4b9777b99667d228cbd2e588bdba9b50", "production-db-clock.mjs": "d919b6ec3a965f3d20f8f5600fc85f5ded2d66cecdaf985167d42372ee071de2",
  "attester-bootstrap.mjs": "56a44b7fbd5ff426f0bba530e06136cd0ab0062a1c2a966d1840c16a509e24ff", "production-attester.mjs": "a36c66ee3fbc66be2ca16c365370de7b4f594ee25be4621808c495e1c74998fc",
  "bootstrap-entrypoint-attester.mjs": "3eb85ee323c5673e59fdf2627522b88326454dfeab477ca95173ad5b5cd69820" };
const { createHash } = await import("node:crypto");
const changedVsV1 = Object.keys(V1SHA).filter((f) => createHash("sha256").update(fs.readFileSync(`${CANDIDATE_TREE}/${D}${f}`)).digest("hex") !== V1SHA[f]).sort();
console.log("  changed vs prior candidate: " + changedVsV1.join(" "));
ok("B12 delta B (prior candidate → revised) touches only clock-gate / production-db-clock / attester-bootstrap / production-attester; the entrypoint is byte-identical to the prior candidate",
  JSON.stringify(changedVsV1) === JSON.stringify(["attester-bootstrap.mjs", "clock-gate.mjs", "production-attester.mjs", "production-db-clock.mjs"]));
console.log("  protected blobs: " + protReport.join(" "));
T.done(13);
